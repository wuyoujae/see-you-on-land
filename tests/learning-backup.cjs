"use strict";
// Run with: node --test tests/learning-backup.cjs
// Trigger the real backup UI handlers in a DOM-free Node VM. Storage and file
// boundaries are controlled; validation/import/export code is never duplicated.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Core = require("../assets/js/learning-core.js");
const PracticeCore = require("../assets/js/practice-core.js");
const SOURCE = fs.readFileSync(path.join(__dirname, "../assets/js/backup.js"), "utf8");
const COURSE_KEY = "summer-politics-courses-v1";
const PRACTICE_KEY = "summer-politics-practice-v1";
const DRILL_KEY = "summer-politics-drill-v1";
const PROGRESS_KEY = "summer-politics-learning-progress-v1";
const clone = value => JSON.parse(JSON.stringify(value));

function course(at = 100, answer = "B") {
  return { version: 1, updatedAt: at, groups: { group1: {
    lastCardId: "q1-question", updatedAt: at, completed: { "q1-question": at },
    answers: { q1: { answer, status: "correct", submittedAt: at } },
    drafts: { q1: { value: answer, updatedAt: at } }
  } } };
}

function backup(courseProgress, extras = {}) {
  const data = { progress: '["restored-item"]', sessions: "[]", activeSession: null, clockShowsSeconds: "true", ...extras };
  if (courseProgress !== undefined) data.courseProgress = courseProgress === null ? null : JSON.stringify(courseProgress);
  return { schema: "see-you-on-land-backup", version: 1, data };
}

function harness(initial = {}, options = {}) {
  const values = new Map(Object.entries(initial));
  const nodes = new Map();
  const events = [], blobs = [], timers = [], confirms = [];
  const storage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem(key, value) {
      if (options.failWrite?.(key, value)) throw new Error("simulated storage failure");
      values.set(key, String(value));
    },
    removeItem: key => values.delete(key)
  };
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, {
      id, listeners: {}, disabled: false, textContent: "", value: "", files: [],
      classList: { toggle() {} },
      addEventListener(type, listener) { this.listeners[type] = listener; },
      click() { return this.listeners.click?.(); }, remove() {}
    });
    return nodes.get(id);
  }
  let flushes = 0, merges = 0;
  const app = {
    async flush() { flushes++; await options.flush?.(storage); },
    mergeBackupProgress(raw) {
      merges++;
      if (options.merge) return options.merge(raw, storage);
      return JSON.stringify(Core.mergeProgress(JSON.parse(storage.getItem(COURSE_KEY) || "null"), JSON.parse(raw || "null")));
    }
  };
  const window = {
    PracticeCore,
    LearningApp: options.noLearningApp ? undefined : app,
    PracticeStudy: options.practice ? options.practice(storage) : { storageKey: PRACTICE_KEY, mergeBackupProgress: raw => raw },
    AIExplanation: options.ai,
    wrongQuestionBook: {
      exportData: async () => ({ records: [] }),
      validateImportData: async value => value,
      importData: async value => { await options.importWrong?.(value, storage); }
    },
    AppUI: { confirm: async config => { confirms.push(config); return options.confirm ? options.confirm(config, storage) : true; } },
    dispatchEvent: event => { events.push(event.type); options.onEvent?.(event, storage); },
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
    location: { reload() {} }
  };
  vm.runInNewContext(SOURCE, {
    window, localStorage: storage,
    document: { getElementById: node, createElement: () => node("download"), body: { appendChild() {} } },
    Blob, Event: class { constructor(type) { this.type = type; } },
    URL: { createObjectURL: blob => { blobs.push(blob); return "blob:backup-test"; }, revokeObjectURL() {} },
    console
  }, { timeout: 1000 });
  return {
    storage, events, blobs, timers, confirms, nodes,
    get flushes() { return flushes; }, get merges() { return merges; },
    async export() { await node("export-backup").click(); },
    async import(value, size) {
      const text = typeof value === "string" ? value : JSON.stringify(value);
      node("backup-file").files = [{ size: size ?? Buffer.byteLength(text), text: async () => text }];
      node("backup-file").listeners.change();
      for (let step = 0; step < 100; step++) {
        await new Promise(resolve => setImmediate(resolve));
        if (!node("import-backup").disabled) return;
      }
      throw new Error("backup handler did not settle");
    },
    status() { return node("backup-status").textContent; }
  };
}

test("export awaits pending course drafts before taking the full existing backup snapshot", async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const state = course(200);
  const h = harness({ [COURSE_KEY]: JSON.stringify(course(100)), [PROGRESS_KEY]: '["one"]' }, {
    flush: async storage => { await waiting; storage.setItem(COURSE_KEY, JSON.stringify(state)); }
  });
  const exporting = h.export();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.blobs.length, 0, "snapshot must not precede flush completion");
  release();
  await exporting;
  assert.equal(h.flushes, 1);
  assert.equal(h.blobs.length, 1);
  const result = JSON.parse(await h.blobs[0].text());
  assert.deepEqual(JSON.parse(result.data.courseProgress), state);
  assert.equal(result.summary.courseGroups, 1);
  assert.equal(result.data.progress, '["one"]');
  assert.deepEqual(result.wrongQuestions, { records: [] });
  assert.equal(h.nodes.get("export-backup").disabled, false);
});

test("an old backup without a course field preserves newer local progress and pending drafts", async () => {
  const local = course(200);
  const drafted = clone(local);
  drafted.groups.group1.drafts.q1 = { value: "A", updatedAt: 300 };
  const h = harness({ [COURSE_KEY]: JSON.stringify(local) }, {
    flush: storage => storage.setItem(COURSE_KEY, JSON.stringify(drafted))
  });
  await h.import(backup(undefined));
  const restored = JSON.parse(h.storage.getItem(COURSE_KEY));
  assert.deepEqual(restored, drafted);
  assert.equal(h.flushes, 1);
  assert.equal(h.merges, 1);
  assert.ok(h.events.includes("summer-politics:courses-restored"));
  assert.ok(h.events.includes("summer-politics:practice-restored"));
  assert.match(h.status(), /恢复成功/);
});

test("import merges completions and per-question timestamps instead of replacing newer submissions", async () => {
  const local = course(300, "B");
  const incoming = course(100, "A");
  incoming.groups.group1.completed["another-card"] = 400;
  incoming.groups.group1.drafts.q1 = { value: "A", updatedAt: 500 };
  incoming.groups.group2 = { ...Core.createRecord(), updatedAt: 50, completed: { "group2-card": 50 } };
  const h = harness({ [COURSE_KEY]: JSON.stringify(local) });
  await h.import(backup(incoming));
  const restored = JSON.parse(h.storage.getItem(COURSE_KEY));
  assert.equal(restored.groups.group1.answers.q1.answer, "B");
  assert.equal(restored.groups.group1.answers.q1.submittedAt, 300);
  assert.equal(restored.groups.group1.drafts.q1.value, "A");
  assert.equal(restored.groups.group1.completed["another-card"], 400);
  assert.equal(restored.groups.group2.completed["group2-card"], 50);
  assert.equal(h.merges, 1);
  assert.match(h.confirms[0].message, /2 组课程进度/);
});

test("an explicit null course field cannot erase existing course progress through the merge API", async () => {
  const local = course(100);
  const h = harness({ [COURSE_KEY]: JSON.stringify(local) });
  await h.import(backup(null));
  assert.deepEqual(JSON.parse(h.storage.getItem(COURSE_KEY)), local);
  assert.equal(h.merges, 1);
});

test("ungraded study answers survive backup restore and export without becoming correct or incorrect", async () => {
  const value = course(100, "D"); value.groups.group1.answers.q1.status = "ungraded";
  const h = harness();
  await h.import(backup(value));
  assert.match(h.status(), /恢复成功/);
  assert.equal(JSON.parse(h.storage.getItem(COURSE_KEY)).groups.group1.answers.q1.status, "ungraded");
  await h.export();
  const exported = JSON.parse(await h.blobs.at(-1).text());
  assert.equal(JSON.parse(exported.data.courseProgress).groups.group1.answers.q1.status, "ungraded");
});

test("inline analysis completion exports the original card IDs and merges older page-by-page records", async () => {
  const card = {id: "q1-question", type: "question", question: {id: "q1", type: "single", answer: "B"}};
  const parts = [card, {id: "q1-explanation-one", type: "text", role: "explanation", questionId: "q1"},
    {id: "q1-explanation-two", type: "text", role: "explanation", questionId: "q1"}];
  const submitted = Core.submit(card, "A", Core.createRecord(), () => "incorrect", 100);
  const displayed = Core.completeQuestion(parts, card, submitted, 200);
  const state = {version: 1, updatedAt: 200, groups: {group1: {...displayed, lastCardId: "q1-question"}}};
  const h = harness({[COURSE_KEY]: JSON.stringify(state)});
  await h.export();
  const exported = JSON.parse(await h.blobs.at(-1).text());
  const older = {version: 1, updatedAt: 150, groups: {group1: {...submitted, lastCardId: "q1-explanation-one",
    completed: {...submitted.completed, "q1-explanation-one": 150}}}};
  const restored = harness({[COURSE_KEY]: JSON.stringify(older)});
  await restored.import(exported);
  const rec = JSON.parse(restored.storage.getItem(COURSE_KEY)).groups.group1;
  assert.equal(rec.answers.q1.answer, "A"); assert.equal(rec.answers.q1.submittedAt, 100);
  assert.deepEqual(rec.completed, {"q1-question": 100, "q1-explanation-one": 200, "q1-explanation-two": 200});
  assert.equal(rec.lastCardId, "q1-question");
  assert.equal(Core.progress(parts, rec).complete, true);
});

test("course answers preserve numeric zero, boolean false, exact multi-select and blank drafts", async () => {
  const value = course();
  value.groups.group1.answers = {
    zero: { answer: 0, status: "correct", submittedAt: 1 },
    boolean: { answer: false, status: "correct", submittedAt: 2 },
    multi: { answer: ["A", "C"], status: "incorrect", submittedAt: 3 }
  };
  value.groups.group1.drafts = { blank: { value: "", updatedAt: 4 }, multi: { value: [], updatedAt: 5 } };
  const h = harness();
  await h.import(backup(value));
  const restored = JSON.parse(h.storage.getItem(COURSE_KEY));
  assert.equal(restored.groups.group1.answers.zero.answer, 0);
  assert.equal(restored.groups.group1.answers.boolean.answer, false);
  assert.deepEqual(restored.groups.group1.answers.multi.answer, ["A", "C"]);
  assert.equal(restored.groups.group1.drafts.blank.value, "");
  assert.deepEqual(restored.groups.group1.drafts.multi.value, []);
  assert.match(h.status(), /恢复成功/);
});

test("malformed course data is rejected before confirmation or any storage write", async () => {
  const corruptions = [
    value => { value.version = 2; },
    value => { value.groups = []; },
    value => { value.groups.group1.updatedAt = -1; },
    value => { value.groups.group1.completed["q1-question"] = 0; },
    value => { value.groups.group1.lastCardId = "../outside"; },
    value => { value.groups.group1.answers.q1.status = "unanswered"; },
    value => { value.groups.group1.answers.q1.answer = "  "; },
    value => { value.groups.group1.answers.q1.answer = ["A", {}]; },
    value => { value.groups.group1.answers.q1.submittedAt = 0; },
    value => { value.groups.group1.drafts.q1.value = {}; },
    value => { value.groups.group1.drafts.q1.updatedAt = -1; },
    value => { value.groups = JSON.parse('{"__proto__":{"lastCardId":null,"updatedAt":0,"completed":{},"answers":{},"drafts":{}}}'); }
  ];
  for (const corrupt of corruptions) {
    const local = JSON.stringify(course(500));
    const h = harness({ [COURSE_KEY]: local, [PROGRESS_KEY]: '["unchanged"]' });
    const invalid = course();
    corrupt(invalid);
    await h.import(backup(invalid));
    assert.match(h.status(), /恢复失败.*课程/, corrupt.toString());
    assert.equal(h.storage.getItem(COURSE_KEY), local);
    assert.equal(h.storage.getItem(PROGRESS_KEY), '["unchanged"]');
    assert.equal(h.confirms.length, 0);
    assert.equal(h.merges, 0);
    assert.equal(h.events.length, 0);
  }
});

test("invalid merged output is revalidated without writing or dispatching restored events", async () => {
  const initial = JSON.stringify(course(100));
  const h = harness({ [COURSE_KEY]: initial }, { merge: () => '{"version":2}' });
  await h.import(backup(course(200)));
  assert.match(h.status(), /恢复失败.*课程/);
  assert.equal(h.storage.getItem(COURSE_KEY), initial);
  assert.equal(h.events.length, 0);
});

test("canceling restore leaves course storage and all existing backup fields unchanged", async () => {
  const initial = JSON.stringify(course(500));
  const h = harness({ [COURSE_KEY]: initial, [PROGRESS_KEY]: '["current"]' }, { confirm: () => false });
  await h.import(backup(course(100)));
  assert.equal(h.storage.getItem(COURSE_KEY), initial);
  assert.equal(h.storage.getItem(PROGRESS_KEY), '["current"]');
  assert.equal(h.flushes, 0);
  assert.equal(h.merges, 0);
  assert.equal(h.events.length, 0);
  assert.match(h.status(), /已取消/);
});

test("an IndexedDB import failure rolls course and legacy keys back before notifying both modules", async () => {
  const initial = JSON.stringify(course(500));
  const observed = [];
  const h = harness({ [COURSE_KEY]: initial, [PROGRESS_KEY]: '["current"]', [PRACTICE_KEY]: "{}" }, {
    importWrong: () => { throw new Error("simulated IndexedDB failure"); },
    onEvent: (event, storage) => observed.push([event.type, storage.getItem(COURSE_KEY)])
  });
  const incoming = backup(course(100));
  incoming.wrongQuestions = { records: [{ id: "wrong1" }] };
  await h.import(incoming);
  assert.match(h.status(), /恢复失败.*IndexedDB/);
  assert.equal(h.storage.getItem(COURSE_KEY), initial);
  assert.equal(h.storage.getItem(PROGRESS_KEY), '["current"]');
  assert.equal(h.storage.getItem(PRACTICE_KEY), "{}");
  assert.deepEqual(observed, [["summer-politics:practice-restored", initial], ["summer-politics:courses-restored", initial], ["summer-politics:drill-restored", initial]]);
  assert.equal(h.timers.some(timer => timer.delay === 350), false);
});

test("old-backup fallback rereads progress advanced during confirmation even before LearningApp is available", async () => {
  const newer = JSON.stringify(course(600));
  const h = harness({ [COURSE_KEY]: JSON.stringify(course(100)) }, {
    noLearningApp: true,
    confirm: (_config, storage) => { storage.setItem(COURSE_KEY, newer); return true; }
  });
  await h.import(backup(undefined));
  assert.equal(h.storage.getItem(COURSE_KEY), newer);
  assert.match(h.status(), /恢复成功/);
});

test("a failed course flush aborts export instead of creating a stale backup", async () => {
  const h = harness({}, { flush: () => { throw new Error("pending draft could not be saved"); } });
  await h.export();
  assert.equal(h.blobs.length, 0);
  assert.match(h.status(), /导出失败.*pending draft/);
  assert.equal(h.nodes.get("export-backup").disabled, false);
});

test("a full localStorage still exports the newest in-memory course draft through the merge API", async () => {
  const persisted = course(100), memory = course(200);
  memory.groups.group1.drafts.q1 = { value: "A", updatedAt: 300 };
  const h = harness({ [COURSE_KEY]: JSON.stringify(persisted) }, {
    failWrite: key => key === COURSE_KEY,
    flush: storage => { try { storage.setItem(COURSE_KEY, JSON.stringify(memory)); } catch { /* Production flush retains its in-memory state. */ } },
    merge: raw => JSON.stringify(Core.mergeProgress(JSON.parse(raw || "null"), memory))
  });
  await h.export();
  assert.deepEqual(JSON.parse(h.storage.getItem(COURSE_KEY)), persisted);
  assert.equal(h.blobs.length, 1);
  const exported = JSON.parse(await h.blobs[0].text());
  assert.equal(h.merges, 1);
  assert.deepEqual(JSON.parse(exported.data.courseProgress), memory);
});

function drill(now = 100, ids = ["paper-q001", "paper-q002"]) {
  const record = PracticeCore.createSession({ id: "drill-one", questionIds: ids, subjectId: "all", topicId: "all", setId: "paper-one", now });
  const submitted = PracticeCore.submit(record, { id: ids[0], answer: "B" }, "B", () => "correct", now + 1);
  return PracticeCore.mergeProgress({}, { version: 1, updatedAt: now + 1, sessions: { "drill-one": submitted } });
}
function practiceAPI(memory) {
  return storage => ({
    storageKey: DRILL_KEY, flush() {}, exportProgress: () => JSON.stringify(memory),
    mergeBackupProgress() { throw new Error("new controller must not touch legacy storage"); },
    mergeDrillProgress(raw) {
      const local = PracticeCore.mergeProgress(memory, JSON.parse(storage.getItem(DRILL_KEY) || "null"));
      return JSON.stringify(PracticeCore.mergeProgress(local, JSON.parse(raw || "null")));
    }
  });
}

test("ordinary-question sessions export separately from legacy pages, including memory-only drafts", async () => {
  const persisted = drill(), memory = drill(200);
  memory.sessions["drill-one"] = PracticeCore.setDraft(memory.sessions["drill-one"], "paper-q002", "A", 300);
  memory.updatedAt = 300;
  const legacy = '{"history-p001":{"answers":{},"current":0,"submitted":false,"updatedAt":1}}';
  const h = harness({ [DRILL_KEY]: JSON.stringify(persisted), [PRACTICE_KEY]: legacy }, { practice: practiceAPI(memory) });
  await h.export();
  const exported = JSON.parse(await h.blobs[0].text());
  assert.deepEqual(JSON.parse(exported.data.drillProgress), PracticeCore.mergeProgress(persisted, memory));
  assert.equal(exported.data.practiceAnswers, legacy);
  assert.equal(exported.summary.drillSessions, 1);
  assert.equal(exported.summary.practicePages, 1);
  assert.doesNotMatch(exported.data.drillProgress, /stem|options|sourceAnswer|explanationBlocks/);
});

test("old backups preserve new ordinary-question sessions and never pass legacy pages to the new merger", async () => {
  const local = drill(200);
  const h = harness({ [DRILL_KEY]: JSON.stringify(local), [PRACTICE_KEY]: "{}" }, { practice: practiceAPI(local) });
  await h.import(backup(undefined, { practiceAnswers: "{}" }));
  assert.deepEqual(JSON.parse(h.storage.getItem(DRILL_KEY)), local);
  assert.equal(h.storage.getItem(PRACTICE_KEY), "{}");
  assert.ok(h.events.includes("summer-politics:drill-restored"));
  assert.match(h.status(), /恢复成功/);
});

test("same-session question-order conflicts reject restore before any existing record is overwritten", async () => {
  const local = drill(200), incoming = drill(100, ["paper-q002", "paper-q001"]);
  const h = harness({ [DRILL_KEY]: JSON.stringify(local), [PROGRESS_KEY]: '["current"]' }, { practice: practiceAPI(local) });
  await h.import(backup(undefined, { drillProgress: JSON.stringify(incoming) }));
  assert.match(h.status(), /恢复失败.*题目或来源不一致/);
  assert.deepEqual(JSON.parse(h.storage.getItem(DRILL_KEY)), local);
  assert.equal(h.storage.getItem(PROGRESS_KEY), '["current"]');
  assert.equal(h.events.length, 0);
});

test("strict drill import rejects answers not belonging to the fixed session and embedded question-bank data", async () => {
  for (const mutate of [
    value => { value.sessions["drill-one"].answers.foreign = { answer: "B", status: "correct", submittedAt: 200 }; },
    value => { value.sessions["drill-one"].questions = [{ stem: "do not back up the bank" }]; },
    value => { value.sessions["drill-one"].answers["paper-q001"].status = "unanswered"; },
    value => { value.sessions["drill-one"].current = 999; }
  ]) {
    const invalid = drill(); mutate(invalid);
    const h = harness({ [PROGRESS_KEY]: '["current"]' });
    await h.import(backup(undefined, { drillProgress: JSON.stringify(invalid) }));
    assert.match(h.status(), /恢复失败.*刷题会话/);
    assert.equal(h.storage.getItem(PROGRESS_KEY), '["current"]');
    assert.equal(h.confirms.length, 0);
  }
});

test("failed external-store import rolls newly written drill sessions back before restored notifications", async () => {
  const local = drill(200), raw = JSON.stringify(local);
  const h = harness({ [DRILL_KEY]: raw }, { practice: practiceAPI(local), importWrong: () => { throw new Error("IDB failed"); } });
  const incoming = backup(undefined, { drillProgress: JSON.stringify(drill(300)) });
  incoming.wrongQuestions = { records: [] };
  await h.import(incoming);
  assert.equal(h.storage.getItem(DRILL_KEY), raw);
  assert.ok(h.events.includes("summer-politics:drill-restored"));
  assert.match(h.status(), /恢复失败.*IDB/);
});

test("optional AI cache uses its public validation/export/import API and is restored on import failure", async () => {
  const before = { version: 1, entries: [{ key: "old-success" }] };
  const incoming = { version: 1, entries: [{ key: "new-success" }] };
  let cached = clone(before), validations = 0;
  const imports = [];
  const ai = {
    exportCache: async () => clone(cached),
    validateImportCache: value => { validations++; assert.equal(value.version, 1); return clone(value); },
    importCache: async (value, mode) => { imports.push([clone(value), mode.merge]); cached = clone(value); if (mode.merge) throw new Error("cache import failed"); }
  };
  const h = harness({ [PROGRESS_KEY]: '["current"]' }, { ai });
  await h.export();
  const exported = JSON.parse(await h.blobs[0].text());
  assert.deepEqual(exported.aiExplanations, before);
  const file = backup(undefined); file.aiExplanations = incoming;
  await h.import(file);
  assert.equal(validations, 1);
  assert.deepEqual(imports, [[incoming, true], [before, false]]);
  assert.deepEqual(cached, before);
  assert.equal(h.storage.getItem(PROGRESS_KEY), '["current"]');
  assert.match(h.status(), /恢复失败.*cache import failed/);
});
