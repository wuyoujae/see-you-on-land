"use strict";
// Run with: node --test tests/learning-core.cjs
// Exercise the production state machine and the existing production grader.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Core = require("../assets/js/learning-core.js");

function productionGrader() {
  // Load the real shared component module, independent of either page's route
  // controller. No source extraction or copied normalization is involved.
  const element = { addEventListener() {}, classList: { contains: () => false } };
  const window = { addEventListener() {} };
  const context = vm.createContext({
    window,
    document: {
      getElementById: id => id === "view-practice" ? element : null,
      addEventListener() {}, querySelector: () => null
    },
    localStorage: { getItem: () => null, setItem() {} },
    location: { hash: "", pathname: "/", search: "" },
    history: { state: null },
    fetch: () => new Promise(() => {}),
    URLSearchParams, Intl, setTimeout, clearTimeout, console
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../assets/js/question-components.js"), "utf8"), context, { timeout: 1000 });
  assert.equal(typeof window.PracticeQuestions?.grade, "function");
  return window.PracticeQuestions.grade;
}
const grade = productionGrader();
const knowledge = { id: "lesson-one-knowledge", type: "text", role: "knowledge" };
const question = {
  id: "q-one-question", type: "question",
  question: { id: "q-one", type: "single", stem: "选择正确答案", options: [{ value: "A", label: "甲" }, { value: "B", label: "乙" }], answer: "B" }
};
const explanation = { id: "q-one-explanation", type: "text", role: "explanation", questionId: "q-one" };
const cards = [knowledge, question, explanation];
const jsonCopy = value => JSON.parse(JSON.stringify(value));

test("deep links parse independently of legacy practice routes and reject invalid paths", () => {
  assert.deepEqual(Core.parseRoute("#/learn"), { subjectId: null, groupId: null, lessonId: null, card: 0 });
  assert.deepEqual(Core.parseRoute("#/learn/language/fill/lesson-1?card=12"), {
    subjectId: "language", groupId: "fill", lessonId: "lesson-1", card: 12
  });
  assert.equal(Core.parseRoute("#/learn/language/fill/lesson-1?card=0").card, 0);
  for (const hash of ["#/study/language/page-1", "#practice", "#/learning", "#/learn/a/b/c/d", "#/learn/../g/l", "#/learn/__proto__", "#/learn/%2e%2e"]) {
    assert.equal(Core.parseRoute(hash), null, hash);
  }
  for (const value of ["-1", "1.5", "NaN", "Infinity", "<script>"]) {
    assert.equal(Core.parseRoute(`#/learn/language/fill/lesson-1?card=${value}`).card, 0, value);
  }
  assert.ok(Core.parseRoute("#/learn/a/b/c?card=999999999").card <= 100000);
});

test("flattening retains lesson boundaries and gives a continuous next-card order", () => {
  const lessons = [
    { id: "one", title: "第一知识点", cards },
    { id: "empty", title: "空知识点", cards: [] },
    { id: "two", title: "下一知识点", cards: [{ id: "lesson-two-first", type: "text" }] }
  ];
  const before = jsonCopy(lessons);
  const flattened = Core.flattenLessons(lessons);
  assert.equal(flattened.length, 4);
  assert.deepEqual(flattened.map(card => card.index), [0, 1, 2, 3]);
  assert.equal(flattened[2].lessonId, "one");
  assert.equal(flattened[3].lessonId, "two");
  assert.equal(flattened[3].cardIndex, 0);
  assert.equal(flattened[3].lessonIndex, 2);
  assert.equal(flattened[3].lessonTitle, "下一知识点");
  assert.deepEqual(lessons, before);
  assert.deepEqual(Core.flattenLessons([]), []);
});

test("inline question navigation preserves raw IDs and maps every former explanation page to its owner", () => {
  const more = {...explanation, id: "q-one-explanation-more"};
  const other = {id: "q-two-question", type: "question", question: {id: "q-two", type: "single", answer: "A"}};
  const otherSolution = {id: "q-two-explanation", type: "text", role: "explanation", questionId: "q-two"};
  const flat = Core.flattenLessons([{id: "one", title: "知识点", cards: [knowledge, question, explanation, more, other, otherSolution]}]);
  const before = structuredClone(flat);
  assert.deepEqual(Core.navigationCards(flat).map(card => [card.id, card.index, card.cardIndex]), [
    [knowledge.id, 0, 0], [question.id, 1, 1], [other.id, 4, 4]
  ]);
  assert.equal(Core.ownerCard(flat, flat[2]), flat[1]);
  assert.equal(Core.ownerCard(flat, more.id), flat[1]);
  assert.equal(Core.ownerCard(flat, flat[5]), flat[4]);
  assert.equal(Core.ownerCard(flat, "missing"), null);
  assert.deepEqual(Core.explanationsFor(flat, flat[1]).map(card => card.id), [explanation.id, more.id]);
  assert.deepEqual(Core.explanationsFor(flat, flat[4]).map(card => card.id), [otherSolution.id]);
  assert.deepEqual(flat, before);
});

test("showing submitted inline analysis completes all original explanation IDs once but drafts and jumps complete nothing", () => {
  const more = {...explanation, id: "q-one-explanation-more"};
  const all = [knowledge, question, explanation, more];
  const empty = Core.createRecord();
  const drafted = {...empty, drafts: {"q-one": {value: "B", updatedAt: 10}}, completed: {[explanation.id]: 11}};
  assert.equal(Core.completeQuestion(all, question, empty, 20), empty);
  assert.equal(Core.completeQuestion(all, question, drafted, 20), drafted);
  assert.equal(Core.submittedAnswer(question, drafted), null);
  assert.equal(Core.stepComplete(all, question, drafted), false);
  const submitted = Core.submit(question, "A", empty, grade, 30), before = jsonCopy(submitted);
  const shown = Core.completeQuestion(all, question, submitted, 40);
  assert.deepEqual(shown.completed, {[question.id]: 30, [explanation.id]: 40, [more.id]: 40});
  assert.equal(Core.progress(all, shown).completed, 3);
  assert.equal(Core.progress(all, shown).correct, 0);
  assert.equal(Core.completeQuestion(all, question, shown, 50), shown);
  assert.equal(Core.stepComplete(all, question, shown), true);
  assert.deepEqual(submitted, before);
  const restored = Core.mergeRecord({}, shown);
  assert.deepEqual(restored, shown);
  assert.equal(Core.submittedAnswer(question, restored).answer, "A");
});

test("PDF references inherit from lessons, permit per-card pages and never mutate source data", () => {
  const source = {type: "pdf", documentId: "quantity-wy27", title: "数量关系讲义", pages: [7, 8, 9], printedPages: [1, 2, 3]};
  const override = {...source, pages: [11, 10, 10, 14], printedPages: [5, 4, 4, 8]};
  const lessons = [{id: "quantity-wy27-foundation", title: "基础", source, cards: [
    {id: "quantity-wy27-knowledge", type: "text"}, {id: "quantity-wy27-question", type: "question", source: override}
  ]}];
  const before = jsonCopy(lessons), flattened = Core.flattenLessons(lessons);
  assert.deepEqual(flattened[0].source, source); assert.deepEqual(flattened[1].source, override);
  assert.deepEqual(Core.sourceReference(flattened[0].source), {label: "讲义 第1–3页", title: "数量关系讲义 · PDF 第7–9页"});
  assert.deepEqual(Core.sourceReference(flattened[1].source), {label: "讲义 第4–5、8页", title: "数量关系讲义 · PDF 第10–11、14页"});
  assert.deepEqual(Core.sourceReference({type: "pdf", pages: [0, "2", -1, 7.5, 8]}), {label: "PDF 第8页", title: "PDF 第8页"});
  assert.equal(Core.sourceReference({videoId: "old-video", startSeconds: 5}), null);
  assert.equal(Core.sourceReference({type: "pdf"}), null);
  assert.deepEqual(lessons, before);
});

test("namespaced handout groups/cards/questions stay fresh when legacy video progress is restored", () => {
  const legacy = {version: 1, updatedAt: 100, groups: {"quantity-proportion": {
    ...Core.createRecord(), updatedAt: 100, lastCardId: "quantity-q001-explanation",
    completed: {"quantity-q001-question": 100, "quantity-q001-explanation": 100},
    answers: {"quantity-q001": {answer: "B", status: "correct", submittedAt: 100}}
  }}};
  const fresh = {version: 1, updatedAt: 200, groups: {"quantity-wy27-foundation": Core.createRecord()}};
  const merged = Core.mergeProgress(fresh, legacy);
  assert.deepEqual(merged.groups["quantity-proportion"], legacy.groups["quantity-proportion"]);
  const rec = merged.groups["quantity-wy27-foundation"];
  assert.deepEqual(rec, Core.createRecord());
  const next = [{id: "quantity-wy27-q001-question", type: "question", question: {id: "quantity-wy27-q001"}},
    {id: "quantity-wy27-q001-explanation", type: "text", role: "explanation", questionId: "quantity-wy27-q001"}];
  assert.equal(Core.progress(next, rec).completed, 0);
  assert.equal(Core.canVisit(next[1], rec), false);
  assert.equal(Core.canVisit(next[1], legacy.groups["quantity-proportion"]), false);
});

test("false and zero are answers, while whitespace and an empty multi-selection are not", () => {
  for (const value of [false, true, 0, 1, "A", "0", ["B"]]) assert.equal(Core.isAnswered(value), true, String(value));
  for (const value of [undefined, null, "", " \n\t　", []]) assert.equal(Core.isAnswered(value), false, String(value));
});

test("drafts, navigation and completion flags alone never unlock an explanation", () => {
  const record = Core.createRecord();
  record.lastCardId = explanation.id;
  record.drafts[question.question.id] = { value: "B", updatedAt: 10 };
  record.completed[explanation.id] = 11;
  assert.equal(Core.canVisit(knowledge, record), true);
  assert.equal(Core.canVisit(question, record), true);
  assert.equal(Core.canVisit(explanation, record), false);
  assert.equal(Core.canVisit(null, record), false);
  assert.equal(Core.markComplete(explanation, record, 12), record);
  assert.equal(Core.markComplete(question, record, 12), record);
  assert.deepEqual(Core.progress(cards, record), {
    completed: 0, total: 3, percentage: 0, complete: false, questions: 1, answered: 0, scoredQuestions: 1, gradedAnswered: 0, ungraded: 0, correct: 0
  });
});

test("an unanswered Next is a no-op and does not call the grader", () => {
  const original = Core.createRecord();
  let calls = 0;
  for (const value of [undefined, null, "", "   ", []]) {
    assert.equal(Core.submit(question, value, original, () => { calls++; return "correct"; }, 100), original);
  }
  assert.equal(calls, 0);
  assert.equal(Core.progress(cards, original).completed, 0);
  assert.equal(Core.canVisit(explanation, original), false);
});

test("submitting an incorrect answer completes only the question and unlocks its own explanation", () => {
  const original = Core.createRecord();
  const before = jsonCopy(original);
  const result = Core.submit(question, "A", original, grade, 100);
  assert.notEqual(result, original);
  assert.deepEqual(original, before);
  assert.deepEqual(result.answers["q-one"], { answer: "A", status: "incorrect", submittedAt: 100 });
  assert.deepEqual(result.drafts["q-one"], { value: "A", updatedAt: 100 });
  assert.equal(result.completed[question.id], 100);
  assert.equal(result.completed[explanation.id], undefined);
  assert.equal(Core.canVisit(explanation, result), true);
  assert.equal(Core.canVisit({ ...explanation, questionId: "different-q" }, result), false);
  assert.equal(Core.progress(cards, result).completed, 1);
  assert.equal(Core.progress(cards, result).correct, 0);
});

test("Next completes knowledge and submitted analysis immutably, and repeated Next is idempotent", () => {
  const original = Core.createRecord();
  const first = Core.markComplete(knowledge, original, 10);
  assert.equal(original.completed[knowledge.id], undefined);
  assert.equal(first.completed[knowledge.id], 10);
  assert.equal(Core.markComplete(knowledge, first, 20), first);
  const submitted = Core.submit(question, "B", first, grade, 30);
  const finished = Core.markComplete(explanation, submitted, 40);
  assert.equal(submitted.completed[explanation.id], undefined);
  assert.deepEqual(Core.progress(cards, finished), {
    completed: 3, total: 3, percentage: 100, complete: true, questions: 1, answered: 1, scoredQuestions: 1, gradedAnswered: 1, ungraded: 0, correct: 1
  });
  assert.equal(Core.markComplete(explanation, finished, 50), finished);
  assert.equal(Core.submit(question, "B", finished, grade, 60), finished);
  assert.equal(finished.answers["q-one"].submittedAt, 30);
  assert.equal(Core.progress([], finished).complete, false);
});

test("a changed draft does not overwrite a prior submission; resubmission does not double-count", () => {
  const submitted = Core.submit(question, "A", Core.createRecord(), grade, 10);
  const edited = { ...submitted, drafts: { ...submitted.drafts, "q-one": { value: "B", updatedAt: 20 } } };
  assert.equal(Core.canVisit(explanation, edited), true);
  assert.equal(edited.answers["q-one"].answer, "A");
  assert.equal(edited.answers["q-one"].status, "incorrect");
  const resubmitted = Core.submit(question, "B", edited, grade, 30);
  assert.equal(resubmitted.answers["q-one"].answer, "B");
  assert.equal(resubmitted.answers["q-one"].status, "correct");
  assert.equal(resubmitted.completed[question.id], 10);
  assert.equal(Core.progress(cards, resubmitted).completed, 1);
  assert.equal(Core.progress(cards, resubmitted).answered, 1);
  assert.equal(edited.answers["q-one"].answer, "A");
});

test("production grading normalizes choice, exact multi-select, boolean and fill-in without changing numeric meaning", () => {
  const cases = [
    [{ type: "single", answer: "B" }, " ｂ。 ", "correct"],
    [{ type: "single", answer: "B" }, "A", "incorrect"],
    [{ type: "multiple", answer: ["A", "C"] }, ["ｃ", "a"], "correct"],
    [{ type: "multiple", answer: ["A", "C"] }, ["A"], "incorrect"],
    [{ type: "multiple", answer: ["A", "C"] }, ["A", "A", "C"], "incorrect"],
    [{ type: "boolean", answer: false }, false, "correct"],
    [{ type: "boolean", answer: false }, "错误", "correct"],
    [{ type: "boolean", answer: true }, "正确", "correct"],
    [{ type: "boolean", answer: true }, false, "incorrect"],
    [{ type: "fill", answer: "-0.5", aliases: ["负二分之一"] }, "①－０.５。", "correct"],
    [{ type: "fill", answer: "-0.5", aliases: ["负二分之一"] }, "负二分之一", "correct"],
    [{ type: "fill", answer: "0.5" }, "05", "incorrect"],
    [{ type: "fill", answer: "1:2" }, "12", "incorrect"],
    [{ type: "fill", answer: 0 }, 0, "correct"]
  ];
  for (const [spec, answer, status] of cases) {
    const card = { id: "type-question", type: "question", question: { id: "type-q", ...spec } };
    const result = Core.submit(card, answer, Core.createRecord(), grade, 100);
    assert.equal(result.answers["type-q"]?.status, status, JSON.stringify({ spec, answer }));
    assert.equal(Core.progress([card], result).answered, 1);
  }
});

test("submission snapshots array answers and does not expose mutable input references", () => {
  const answer = ["A", "C"];
  const card = { id: "multiple-card", type: "question", question: { id: "multiple-q", type: "multiple", answer: ["A", "C"] } };
  const result = Core.submit(card, answer, Core.createRecord(), grade, 100);
  answer.push("B");
  assert.deepEqual(result.answers["multiple-q"].answer, ["A", "C"]);
  assert.deepEqual(result.drafts["multiple-q"].value, ["A", "C"]);
});

test("refresh preserves submitted analysis access and progress while arbitrary current-card changes add nothing", () => {
  const submitted = Core.submit(question, "B", Core.createRecord(), grade, 100);
  submitted.lastCardId = explanation.id;
  const restored = Core.mergeRecord(Core.createRecord(), jsonCopy(submitted));
  assert.equal(Core.canVisit(explanation, restored), true);
  assert.deepEqual(Core.progress(cards, restored), Core.progress(cards, submitted));
  const jumped = { ...restored, lastCardId: "unvisited-last-card", updatedAt: 200 };
  assert.deepEqual(Core.progress(cards, jumped), Core.progress(cards, restored));
  jumped.completed["unrelated-old-card"] = 250;
  assert.equal(Core.progress(cards, jumped).completed, 1);
});

test("cross-tab merges retain independent completions, freshest submitted answers and freshest drafts", () => {
  const local = {
    ...Core.createRecord(), lastCardId: knowledge.id, updatedAt: 500,
    completed: { [knowledge.id]: 100, [question.id]: 200 },
    answers: { "q-one": { answer: "A", status: "incorrect", submittedAt: 200 } },
    drafts: { "q-one": { value: "B", updatedAt: 450 } }
  };
  const remote = {
    ...Core.createRecord(), lastCardId: explanation.id, updatedAt: 400,
    completed: { [question.id]: 300, [explanation.id]: 400 },
    answers: { "q-one": { answer: "B", status: "correct", submittedAt: 300 } },
    drafts: { "q-one": { value: "A", updatedAt: 350 } }
  };
  const before = [jsonCopy(local), jsonCopy(remote)];
  const result = Core.mergeProgress({ version: 1, updatedAt: 500, groups: { g1: local } }, {
    version: 1, updatedAt: 400, groups: { g1: remote, g2: { ...Core.createRecord(), completed: { second: 50 } } }
  });
  assert.equal(result.version, 1);
  assert.equal(result.updatedAt, 500);
  assert.equal(result.groups.g1.lastCardId, knowledge.id);
  assert.deepEqual(result.groups.g1.completed, { [knowledge.id]: 100, [question.id]: 300, [explanation.id]: 400 });
  assert.equal(result.groups.g1.answers["q-one"].answer, "B");
  assert.equal(result.groups.g1.drafts["q-one"].value, "B");
  assert.equal(result.groups.g2.completed.second, 50);
  assert.deepEqual([local, remote], before);
  assert.deepEqual(Core.mergeProgress(result, result), result);
  assert.deepEqual(Core.progress(cards, result.groups.g1), { completed: 3, total: 3, percentage: 100, complete: true, questions: 1, answered: 1, scoredQuestions: 1, gradedAnswered: 1, ungraded: 0, correct: 1 });
});

test("unverified source questions accept study submissions but never award correctness or enlarge its denominator", () => {
  const uncertain = {...question, question: {...question.question, answer: "D", grading: "unverified", sourceIssue: "原页缺少一个比例。"}};
  assert.equal(grade(uncertain.question, "D"), "ungraded");
  assert.equal(grade(uncertain.question, "A"), "ungraded");
  assert.equal(grade(uncertain.question, ""), "unanswered");
  const empty = Core.createRecord();
  assert.equal(Core.submit(uncertain, "", empty, grade, 10), empty);
  const submitted = Core.submit(uncertain, "D", empty, () => "correct", 20);
  assert.equal(submitted.answers["q-one"].status, "ungraded");
  assert.equal(Core.canVisit(explanation, submitted), true);
  const finished = Core.markComplete(explanation, submitted, 30);
  const restored = Core.mergeRecord({}, finished);
  assert.deepEqual(restored.answers["q-one"], submitted.answers["q-one"]);
  const stats = Core.progress([uncertain, explanation], restored);
  assert.equal(stats.complete, true); assert.equal(stats.answered, 1);
  assert.equal(stats.scoredQuestions, 0); assert.equal(stats.gradedAnswered, 0); assert.equal(stats.ungraded, 1); assert.equal(stats.correct, 0);
  const stale = {...restored, answers: {"q-one": {...restored.answers["q-one"], status: "correct"}}};
  assert.equal(Core.progress([uncertain, explanation], stale).correct, 0);
});

test("old or malformed restored records cannot fabricate submissions or poison object keys", () => {
  const incoming = JSON.parse('{"version":1,"groups":{"__proto__":{"completed":{"x":1}},"safe":{"lastCardId":"constructor","updatedAt":-1,"completed":{"x":10,"bad":-1},"answers":{"q-one":{"answer":"B","status":"unanswered","submittedAt":10}},"drafts":{"q-one":{"value":false,"updatedAt":20}}}}}');
  const merged = Core.mergeProgress(undefined, incoming);
  assert.equal(Object.hasOwn(merged.groups, "__proto__"), false);
  assert.equal(merged.groups.safe.lastCardId, null);
  assert.equal(merged.groups.safe.completed.x, 10);
  assert.equal(merged.groups.safe.completed.bad, undefined);
  assert.equal(merged.groups.safe.answers["q-one"], undefined);
  assert.equal(merged.groups.safe.drafts["q-one"].value, false);
  assert.equal(Core.canVisit(explanation, merged.groups.safe), false);
  assert.equal({}.polluted, undefined);
  assert.deepEqual(Core.mergeProgress(null, null), { version: 1, updatedAt: 0, groups: {} });
});
