"use strict";
// Shared rendering and locking contracts; no browser or model requests.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
function api(rich = false) {
  const window = rich ? {RichContent: require("../assets/js/rich-content.js")} : {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../assets/js/question-components.js"), "utf8"), { window });
  return window.PracticeQuestions;
}
const Questions = api();
const single = { id: "one", type: "single", stem: "选择乙", options: [{value: "A", label: "甲"}, {value: "B", label: "乙"}, {value: "C", label: "丙"}], answer: "B" };
const feedback = { readonly: true, submitted: true, feedback: true };
function option(html, value) {
  return [...html.matchAll(/<label class="practice-option[\s\S]*?<\/label>/g)].map(match => match[0]).find(label => label.includes(`value="${value}"`));
}
test("drafts and read-only previews never expose correctness or answer markers", () => {
  for (const options of [{}, {feedback: true}, {readonly: true}, {readonly: true, feedback: true}, {submitted: true}]) {
    const html = Questions.render(single, "A", options);
    assert.doesNotMatch(html, /is-correct|is-incorrect|正确答案|data-result|practice-component-feedback/);
    assert.match(option(html, "A"), / checked/);
  }
});
test("a submitted wrong choice is red-marked and the correct choice is green-marked with visible text and icons", () => {
  const html = Questions.render(single, "A", feedback);
  assert.match(option(html, "A"), /is-incorrect/);
  assert.match(option(html, "A"), /已选 · 选错/);
  assert.match(option(html, "A"), /data-lucide="x"/);
  assert.match(option(html, "B"), /is-correct/);
  assert.match(option(html, "B"), /正确答案/);
  assert.match(option(html, "B"), /data-lucide="check"/);
  assert.doesNotMatch(option(html, "C"), /is-correct|is-incorrect/);
  assert.equal((html.match(/ disabled/g) || []).length, 3);
  assert.match(html, /role="status"/);
});
test("a submitted correct choice stays selected and all inputs lock even without readonly", () => {
  const html = Questions.render(single, "B", {submitted: true, feedback: true});
  assert.match(option(html, "B"), /is-correct/);
  assert.match(option(html, "B"), /已选 · 正确/);
  assert.match(option(html, "B"), / checked disabled/);
  assert.doesNotMatch(html, /is-incorrect/);
  assert.match(html, /答对了/);
});
test("multiple-choice feedback distinguishes a correct selection, wrong selection, and omitted correct answer", () => {
  const question = {...single, type: "multiple", answer: ["A", "C"]};
  const html = Questions.render(question, ["A", "B"], feedback);
  assert.equal(Questions.grade(question, ["A", "B"]), "incorrect");
  assert.match(option(html, "A"), /is-correct[\s\S]*已选 · 正确/);
  assert.match(option(html, "B"), /is-incorrect[\s\S]*已选 · 选错/);
  assert.match(option(html, "C"), /is-correct[\s\S]*漏选 · 正确答案/);
  assert.doesNotMatch(option(html, "C"), / checked/);
});
test("boolean feedback uses boolean aliases consistently for checked state and grading", () => {
  const question = {id: "boolean", type: "boolean", stem: "判断正误", answer: false};
  const html = Questions.render(question, "正确", feedback);
  assert.match(option(html, "true"), /is-incorrect[\s\S]* checked disabled/);
  assert.match(option(html, "false"), /is-correct[\s\S]*正确答案/);
  assert.equal(Questions.grade(question, "错误"), "correct");
});
test("fill answers preserve aliases, label incorrect input, and only reveal a reference after submission", () => {
  const question = {id: "fill", type: "fill", stem: "填写结果", answer: "0.5", aliases: ["1/2"]};
  assert.match(Questions.render(question, "1/2", feedback), /practice-text-input is-correct[\s\S]* readonly/);
  const wrong = Questions.render(question, "1/3", feedback);
  assert.match(wrong, /practice-text-input is-incorrect/);
  assert.match(wrong, /aria-invalid="true"/);
  assert.match(wrong, /参考答案：0.5/);
  assert.doesNotMatch(Questions.render(question, "1/3", {readonly: true}), /参考答案|is-incorrect/);
});
test("unverified or missing-reference questions stay neutral for every input type", () => {
  for (const question of [single, {...single, type: "multiple", answer: ["B"]}, {id: "bool", type: "boolean", answer: true}, {id: "fill", type: "fill", answer: "B"}]) {
    const answer = question.type === "multiple" ? ["B"] : question.type === "boolean" ? true : "B";
    const html = Questions.render({...question, grading: "unverified"}, answer, feedback);
    assert.doesNotMatch(html, /is-correct|is-incorrect|正确答案|参考答案：/);
    assert.match(html, /条件待核，不计分/);
    assert.equal(Questions.grade({...question, grading: "unverified"}, answer), "ungraded");
  }
  assert.equal(Questions.grade({...single, answer: undefined}, "B"), "ungraded");
});
test("letter-only image choices retain accessible correctness text without leaking before submission", () => {
  const question = {...single, options: [{value: "A", label: "A"}, {value: "B", label: "B"}]};
  const html = Questions.render(question, "A", feedback);
  assert.match(option(html, "A"), /aria-label="选项 A · 已选，选错"/);
  assert.match(option(html, "B"), /aria-label="选项 B · 正确答案"/);
  assert.doesNotMatch(Questions.render(question, "A"), /选错|正确答案/);
});
test("feedback preserves rich option images and formulas, including labelBlocks rather than hiding them as letter-only", () => {
  const question = {...single, options: [
    {value: "A", label: "A", labelBlocks: [{type: "image", src: "assets/option-a.png", alt: "选项图A"}]},
    {value: "B", label: "B", blocks: [{type: "paragraph", text: "半数"}, {type: "formula", latex: "1/2"}]}
  ]};
  const html = api(true).render(question, "A", feedback);
  assert.match(option(html, "A"), /assets\/option-a.png/);
  assert.match(option(html, "A"), /is-incorrect/);
  assert.match(option(html, "B"), /rich-content__math/);
  assert.match(option(html, "B"), /正确答案/);
  assert.doesNotMatch(html, /practice-options--letters/);
});
test("mount restores submitted feedback, ignores edits, and submit is idempotent", () => {
  function host() {
    return {innerHTML: "", events: {}, addEventListener(name, callback) {this.events[name] = callback;}, removeEventListener(name) {delete this.events[name];}};
  }
  let changes = 0, submits = 0;
  const view = host(), mounted = Questions.mount(view, [single], {...feedback, answers: {one: "A"}, onChange() {changes++;}, onSubmit() {submits++;}});
  assert.match(view.innerHTML, /is-incorrect/);
  view.events.input({target: {closest: () => ({dataset: {questionId: "one"}}), value: "B"}});
  assert.equal(mounted.getAnswers().one, "A"); assert.equal(changes, 0);
  assert.equal(mounted.submit(), mounted.submit()); assert.equal(submits, 0);
  const fresh = host(), editable = Questions.mount(fresh, [single], {answers: {one: "A"}, onSubmit() {submits++;}});
  assert.doesNotMatch(fresh.innerHTML, /is-incorrect/);
  editable.submit(); editable.submit();
  assert.match(fresh.innerHTML, /is-incorrect/); assert.equal(submits, 1);
  mounted.destroy(); assert.equal(view.events.input, undefined);
});
