"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=file=>JSON.parse(fs.readFileSync(path.join(root,file),"utf8"));
const reviewed=read("data/courses/sources/quantity-wy27-reviewed.json");
const manifest=read("data/courses/manifest.json");
const quantity=manifest.subjects.find(s=>s.id==="quantity");
const lessons=quantity.groups.flatMap(g=>g.lessons.map(e=>read(e.path)));
const questions=lessons.flatMap(l=>l.cards.filter(c=>c.type==="question").map(c=>c.question));

test("all 349 handout exercises and source evidence survive the public course build",()=>{
  assert.equal(quantity.groups.length,15);
  assert.deepEqual(reviewed.sections.map(s=>s.questions.length),[27,22,25,25,25,22,20,20,20,29,26,26,19,21,22]);
  assert.equal(questions.length,349);
  const authored=new Map(reviewed.sections.flatMap(s=>s.questions).map(q=>[q.id,q]));
  assert.equal(authored.size,349);
  assert.deepEqual([...new Set(questions.map(q=>q.id))].sort(),[...authored.keys()].sort());
  for(const q of questions){
    const original=authored.get(q.id);
    assert.equal(q.stem,original.stem,q.id);
    assert.deepEqual(q.options,original.options,q.id);
    assert.equal(q.answer,original.answer,q.id);
    assert.equal(q.sourceAnswer,original.sourceAnswer,q.id);
  }
  assert.equal(fs.readdirSync(path.join(root,"data/courses/lessons")).filter(f=>/^quantity-p1-/.test(f)).length,0);
});

test("source defects stay explicit and cannot be graded from the printed answer letter",()=>{
  const Core=require("../assets/js/learning-core.js");
  const expected=["quantity-wy27-s04-t03-drill-08","quantity-wy27-s06-t02-mother-02","quantity-wy27-s11-t02-drill-02","quantity-wy27-s12-t02-drill-09","quantity-wy27-s15-t03-drill-10"];
  const flagged=questions.filter(q=>q.grading==="unverified");
  assert.deepEqual(flagged.map(q=>q.id).sort(),expected.sort());
  for(const q of flagged){
    assert.ok(q.sourceIssue.trim(),q.id);
    const card={id:q.id+"-question",type:"question",question:q};
    const progress=Core.submit(card,q.answer,Core.createRecord(),()=>"correct",100);
    assert.equal(progress.answers[q.id].status,"ungraded");
    assert.equal(Core.progress([card],progress).scoredQuestions,0);
    assert.equal(Core.progress([card],progress).correct,0);
  }
});

test("the actual method library covers all sections and supplies the first-person teaching guide",async()=>{
  const Solver=require("../assets/js/solver-prompts.js");
  const library=read("assets/prompts/quantity-wy27-methods.json");
  assert.equal(Solver.validateMethodLibrary(library),library);
  assert.equal(library.revision,reviewed.revision);
  assert.equal(library.topics.length,28);
  assert.equal(new Set(library.topics.map(t=>t.id.match(/^s(\d+)/)[1])).size,15);
  const store=Solver.createStore({fetch:async file=>({ok:true,json:async()=>library})});
  const instructions=await store.instructions("quantity",{question:{stem:"甲乙合作完成工程，甲单独施工效率提高20%"}});
  assert.match(instructions,/数量关系讲解要求/);
  assert.match(instructions,/第一人称/);
  assert.match(instructions,/工作量/);
  assert.match(instructions,/古典概率/);
  assert.match(instructions,/相似/);
  assert.doesNotMatch(instructions,/quantity-four-examples|行李箱长宽高|若杯200|红色水笔/);
});
