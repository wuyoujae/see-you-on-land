"use strict";
// Run with: node --test tests/practice-core.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Core = require("../assets/js/practice-core.js");
const window = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../assets/js/question-components.js"), "utf8"), { window });
const grade = window.PracticeQuestions.grade;
const question = {
  id: "paper-one-q001", subjectId: "language", type: "single", stem: "请选择乙", options: [{ value: "A", label: "甲" }, { value: "B", label: "乙" }], answer: "B",
  sourceAnswer: { answer: "B", explanationBlocks: [{ type: "paragraph", text: "乙对应条件。" }], provider: "来源平台", url: "https://source.test/answer/1" },
  source: { paperId: "paper-one", year: 2025, variant: "administrative", questionNumber: 1, url: "https://source.test/paper/1", answerUrl: "https://source.test/answer/1" },
  revision: "source-r1"
};
const second = { ...question, id: "paper-one-q002", subjectId: "reasoning", answer: "A" };
const third = { ...question, id: "paper-one-q003", answer: "B" };
const session = (id = "session-one", ids = [question.id, second.id], now = 100) => Core.createSession({ id, subjectId: "", topicId: "all", setId: "paper-one", questionIds: ids, now });
const clone = value => JSON.parse(JSON.stringify(value));
const cacheContext = { promptVersion: "solver-v3:language-v2", model: "example-model", baseUrl: "https://api.example.test/v1" };

test("selection defaults to the full eligible bank, supports large counts and keeps source arrays intact", () => {
  const bank = Array.from({ length: 25000 }, (_, index) => ({ id: `bank-q${index}` }));
  const selected = Core.selectQuestionIds(bank, { count: 22000, seed: "session-a" });
  assert.equal(selected.length, 22000);
  assert.equal(new Set(selected).size, 22000);
  assert.equal(Core.selectQuestionIds(bank, { seed: "all" }).length, 25000);
  assert.equal(Core.selectQuestionIds(bank, { count: "all", order: "source" }).length, 25000);
  assert.deepEqual(Core.selectQuestionIds(bank, { count: 3, order: "source" }), ["bank-q0", "bank-q1", "bank-q2"]);
  assert.deepEqual(bank.slice(0, 3), [{ id: "bank-q0" }, { id: "bank-q1" }, { id: "bank-q2" }]);
});

test("random selection is reproducible by seed, unique by stable ID and validates actual available count", () => {
  const bank = Array.from({ length: 100 }, (_, index) => ({ id: `q-${index}` }));
  assert.deepEqual(Core.selectQuestionIds(bank, { count: 30, seed: "same" }), Core.selectQuestionIds(bank, { count: 30, seed: "same" }));
  assert.notDeepEqual(Core.selectQuestionIds(bank, { count: 30, seed: "one" }), Core.selectQuestionIds(bank, { count: 30, seed: "two" }));
  assert.deepEqual(Core.selectQuestionIds([{ id: "q-one" }, { id: "q-one" }, { id: "q-two" }], { order: "source" }), ["q-one", "q-two"]);
  for (const count of [0, -1, 101, 1.5, "20", NaN, Infinity]) assert.throws(() => Core.selectQuestionIds(bank, { count }), RangeError);
  assert.throws(() => Core.selectQuestionIds([{ id: "same" }, { id: "same" }], { count: 2 }), RangeError);
  assert.throws(() => Core.selectQuestionIds([{ id: "__proto__" }]), TypeError);
  assert.deepEqual(Core.selectQuestionIds([]), []);
});

test("session creation snapshots an immutable question order and rejects empty or duplicate sessions", () => {
  const ids = [question.id, second.id];
  const record = session("fixed", ids);
  ids.reverse();
  assert.deepEqual(record.questionIds, [question.id, second.id]);
  assert.equal(record.current, 0);
  assert.equal(record.version, 1);
  assert.deepEqual(record.answers, {});
  assert.throws(() => session("bad", []), TypeError);
  assert.throws(() => session("bad", [question.id, question.id]), TypeError);
  assert.throws(() => session("constructor"), TypeError);
});

test("unsubmitted answers and drafts cannot open source, answer or AI cards", () => {
  let record = session();
  record = Core.setDraft(record, question.id, "B", 110);
  assert.equal(Core.canShow(record, question.id, "question"), true);
  for (const view of ["answer", "source", "ai"]) assert.equal(Core.canShow(record, question.id, view), false);
  assert.equal(Core.canShow(record, "unknown-question", "question"), false);
  assert.equal(Core.canShow(record, question.id, "nonsense"), false);
  let grades = 0;
  for (const empty of ["", "  ", undefined, null, []]) {
    assert.equal(Core.submit(record, question, empty, () => { grades++; return "correct"; }, 120), record);
  }
  assert.equal(grades, 0);
  assert.equal(Core.statistics(record).submitted, 0);
});

test("a submitted answer unlocks explanation and is immutable until starting another session", () => {
  const original = session();
  const submitted = Core.submit(original, question, "A", grade, 110);
  assert.equal(original.answers[question.id], undefined);
  assert.deepEqual(submitted.answers[question.id], { answer: "A", status: "incorrect", submittedAt: 110 });
  for (const view of ["answer", "source", "ai"]) assert.equal(Core.canShow(submitted, question.id, view), true);
  const edited = Core.setDraft(submitted, question.id, "B", 120);
  assert.equal(edited, submitted);
  assert.equal(edited.answers[question.id].answer, "A");
  assert.equal(edited.drafts[question.id].value, "A");
  assert.equal(Core.submit(submitted, question, "A", grade, 130), submitted);
  const retried = Core.submit(edited, question, "B", grade, 140);
  assert.equal(retried, submitted);
  assert.equal(retried.answers[question.id].status, "incorrect");
  assert.equal(Core.statistics(retried).submitted, 1);
  assert.equal(Core.statistics(retried).correct, 0);
});

test("false, zero, multi-select and normalized fill-in answers use the real shared grader", () => {
  const cases = [
    [{ type: "boolean", answer: false }, false],
    [{ type: "fill", answer: 0 }, 0],
    [{ type: "fill", answer: "-0.5", aliases: ["负二分之一"] }, "①－０.５。"],
    [{ type: "fill", answer: "-0.5", aliases: ["负二分之一"] }, "负二分之一"],
    [{ type: "single", answer: "B" }, " ｂ。 "],
    [{ type: "multiple", answer: ["A", "C"] }, ["c", "a"]]
  ];
  for (const [spec, answer] of cases) {
    const q = { ...question, ...spec };
    const record = Core.submit(session(), q, answer, grade, 110);
    assert.equal(record.answers[q.id].status, "correct", JSON.stringify({ spec, answer }));
    assert.equal(Core.canShow(record, q.id, "answer"), true);
  }
  const bad = Core.submit(session(), { ...question, type: "fill", answer: "0.5" }, "05", grade, 110);
  assert.equal(bad.answers[question.id].status, "incorrect");
});

test("unverified or missing references submit neutrally, unlock explanation and stay outside accuracy", () => {
  for (const q of [{ ...question, grading: "unverified" }, { ...question, answer: undefined, sourceAnswer: {} }]) {
    const record = Core.submit(session(), q, "A", grade, 110);
    assert.equal(record.answers[q.id].status, "ungraded");
    assert.equal(Core.canShow(record, q.id, "answer"), true);
    const stats = Core.statistics(record);
    assert.equal(stats.submitted, 1); assert.equal(stats.ungraded, 1); assert.equal(stats.graded, 0);
    assert.equal(stats.incorrect, 0); assert.equal(stats.accuracy, null);
    const saved = { version: 1, updatedAt: record.updatedAt, sessions: { [record.id]: record } };
    assert.deepEqual(Core.validateProgress(clone(saved)), saved);
    const mixed = Core.submit(record, second, "A", grade, 120);
    assert.equal(Core.statistics(mixed).accuracy, 100);
    assert.equal(Core.statistics(mixed).complete, true);
    assert.equal(Core.getStatistics({ sessions: { [mixed.id]: mixed } }, [q, second]).accuracy, 100);
  }
});

test("question navigation is separate from submission, clamps nothing silently and never advances progress", () => {
  const original = session();
  const jumped = Core.setCurrent(original, 1, 110);
  assert.equal(original.current, 0);
  assert.equal(jumped.current, 1);
  assert.equal(Core.statistics(jumped).done, 0);
  assert.equal(Core.statistics(jumped).submitted, 0);
  assert.equal(Core.setCurrent(jumped, 1, 120), jumped);
  for (const index of [-1, 2, 1.5, NaN]) assert.equal(Core.setCurrent(jumped, index, 120), jumped);
});

test("refresh round-trips the exact selected order, drafts and submitted analysis access", () => {
  let record = session("restored", [second.id, question.id, third.id]);
  record = Core.submit(record, question, "B", grade, 110);
  record = Core.setDraft(record, second.id, "A", 120);
  record = Core.setCurrent(record, 2, 130);
  const restored = Core.mergeProgress({}, clone({ version: 1, updatedAt: 130, sessions: { restored: record } }));
  assert.deepEqual(restored.sessions.restored.questionIds, [second.id, question.id, third.id]);
  assert.equal(restored.sessions.restored.current, 2);
  assert.equal(Core.canShow(restored.sessions.restored, question.id, "answer"), true);
  assert.equal(Core.canShow(restored.sessions.restored, second.id, "answer"), false);
});

test("cross-tab/session merges retain the latest submission and independent draft without mutating either side", () => {
  const original = session();
  let local = Core.submit(original, question, "A", grade, 110);
  // Legacy backups may contain a later independent draft, even though the new
  // UI and reducer no longer let us edit a submitted question.
  local = { ...local, updatedAt: 150, drafts: { ...local.drafts, [question.id]: { value: "B", updatedAt: 150 } } };
  let remote = Core.submit(original, question, "B", grade, 130);
  remote = Core.submit(remote, second, "A", grade, 140);
  const before = clone([local, remote]);
  const merged = Core.mergeSession(local, remote);
  assert.equal(merged.answers[question.id].answer, "B");
  assert.equal(merged.drafts[question.id].value, "B");
  assert.equal(merged.drafts[question.id].updatedAt, 150);
  assert.equal(merged.answers[second.id].status, "correct");
  assert.deepEqual([local, remote], before);
  assert.deepEqual(Core.mergeSession(remote, local), merged);
  assert.deepEqual(Core.mergeSession(merged, merged), merged);
  assert.equal(Core.statistics(merged).complete, true);
});

test("equal-time conflicts converge deterministically instead of oscillating between browser tabs", () => {
  const a = Core.submit(session(), question, "A", grade, 110);
  const b = Core.submit(session(), question, "B", grade, 110);
  assert.deepEqual(Core.mergeSession(a, b), Core.mergeSession(b, a));
  const once = Core.mergeSession(a, b);
  assert.deepEqual(Core.mergeSession(once, a), once);
  assert.deepEqual(Core.mergeSession(once, b), once);
});

test("the same session ID cannot silently merge a different question order or source set", () => {
  const record = session();
  const reordered = { ...record, questionIds: [...record.questionIds].reverse() };
  assert.throws(() => Core.mergeSession(record, reordered), /题目或来源不一致/);
  assert.throws(() => Core.mergeSession(record, { ...record, setId: "different-paper" }), /题目或来源不一致/);
  assert.throws(() => Core.mergeProgress({ sessions: { [record.id]: record } }, { sessions: { [record.id]: reordered } }), /题目或来源不一致/);
});

test("aggregate statistics deduplicate stable question IDs and select the newest score across sessions", () => {
  let a = Core.submit(session("one"), question, "A", grade, 110);
  a = Core.setDraft(a, second.id, "A", 120);
  let b = Core.submit(session("two"), question, "B", grade, 140);
  b = Core.submit(b, second, "A", grade, 150);
  const progress = { version: 1, updatedAt: 150, sessions: { one: a, two: b } };
  assert.deepEqual(Core.getStatistics(progress, [question, second, third]), {
    total: 3, done: 2, submitted: 2, correct: 2, incorrect: 0, graded: 2, ungraded: 0, unanswered: 1, accuracy: 100, attempts: 3, pagesDone: 2
  });
  assert.deepEqual(Core.getStatistics(progress, [question, second, third], "language"), {
    total: 2, done: 1, submitted: 1, correct: 1, incorrect: 0, graded: 1, ungraded: 0, unanswered: 1, accuracy: 100, attempts: 2, pagesDone: 2
  });
  assert.equal(Core.getStatistics({}, [question]).accuracy, null);
  assert.deepEqual(Core.getStatistics(progress, [question, second, third], "all"), Core.getStatistics(progress, [question, second, third]));
  const mixedPaper = { ...progress, sessions: { one: { ...a, subjectId: "language" }, two: { ...b, subjectId: "language" } } };
  assert.equal(Core.getStatistics(mixedPaper, [question, second, third], "reasoning").submitted, 1);
});

test("restored records discard foreign question answers, malformed statuses and unsafe object IDs", () => {
  const record = session();
  record.answers["foreign"] = { answer: "B", status: "correct", submittedAt: 200 };
  record.answers[question.id] = { answer: "B", status: "unanswered", submittedAt: 200 };
  record.drafts[second.id] = { value: { injected: true }, updatedAt: 200 };
  const restored = Core.sanitizeSession(record);
  assert.deepEqual(restored.answers, {});
  assert.deepEqual(restored.drafts, {});
  assert.equal(Core.canShow(restored, question.id, "answer"), false);
  assert.deepEqual(Core.mergeProgress(null, JSON.parse('{"sessions":{"__proto__":{"id":"poison"}}}')), { version: 1, updatedAt: 0, sessions: {} });
  assert.equal(Core.sanitizeSession({ ...record, version: 2 }), null);
});

test("backup validation is strict even though local damaged-record reads can sanitize", () => {
  const record = Core.submit(session(), question, "B", grade, 110);
  const clean = Core.mergeProgress({}, { version: 1, updatedAt: 110, sessions: { [record.id]: record } });
  assert.deepEqual(Core.validateProgress(clone(clean)), clean);
  const invalid = clone(clean);
  invalid.sessions[record.id].questions = [{ stem: "the bank is not session data" }];
  assert.throws(() => Core.validateProgress(invalid), /刷题会话/);
  const foreign = clone(clean);
  foreign.sessions[record.id].answers.foreign = { answer: "A", status: "correct", submittedAt: 111 };
  assert.throws(() => Core.validateProgress(foreign), /刷题会话/);
  assert.equal(Core.sanitizeSession(foreign.sessions[record.id]).answers.foreign, undefined);
});

test("AI cache identity is a stable SHA-256 key, ignores user answers and credentials, and canonicalizes object keys", async () => {
  const key = await Core.aiCacheKey(question, cacheContext);
  assert.match(key, /^practice-ai-v1:[a-f0-9]{64}$/);
  assert.equal(await Core.aiCacheKey({ userAnswer: "A", ...question }, { ...cacheContext, apiKey: "PRIVATE-ONE", token: "SECRET" }), key);
  assert.equal(await Core.aiCacheKey({ ...question, userAnswer: "B" }, { ...cacheContext, apiKey: "PRIVATE-TWO" }), key);
  const reordered = Object.fromEntries(Object.entries(question).reverse());
  reordered.options = question.options.map(option => Object.fromEntries(Object.entries(option).reverse()));
  assert.equal(await Core.aiCacheKey(reordered, cacheContext), key);
  const credentialURL = { ...cacheContext, baseUrl: "https://user:pass@api.example.test/v1/?api_key=SECRET&token=PRIVATE#fragment" };
  assert.equal(await Core.aiCacheKey(question, credentialURL), key);
  assert.doesNotMatch(key, /api\.example|SECRET|PRIVATE|请选择/);
  assert.throws(() => Core.normalizeBaseUrl("javascript:alert(1)"), /服务地址不正确/);
});

test("AI cache changes for every request-relevant content, source, model, endpoint or prompt revision", async () => {
  const original = await Core.aiCacheKey(question, cacheContext);
  const variants = [
    { ...question, stem: "新的题干" },
    { ...question, stemBlocks: [{ type: "image", src: "new-stem.png", alt: "新图" }] },
    { ...question, materialBlocks: [{ type: "table", rows: [[1, 2]] }] },
    { ...question, options: [{ value: "A", label: "变更选项" }, question.options[1]] },
    { ...question, answer: "A" },
    { ...question, sourceAnswer: { ...question.sourceAnswer, answer: "A" } },
    { ...question, sourceAnswer: { ...question.sourceAnswer, explanationBlocks: [{ type: "paragraph", text: "更正解析" }] } },
    { ...question, revision: "source-r2" },
    { ...question, subjectId: "common" }
  ];
  for (const variant of variants) assert.notEqual(await Core.aiCacheKey(variant, cacheContext), original);
  for (const context of [
    { ...cacheContext, promptVersion: "solver-v4" }, { ...cacheContext, model: "another-model" },
    { ...cacheContext, baseUrl: "https://other-api.example.test/v1" }, { ...cacheContext, contentRevision: "explicit-r3" },
    { ...cacheContext, baseUrl: "https://api.example.test/v1?api-version=2026" }
  ]) assert.notEqual(await Core.aiCacheKey(question, context), original);
});
