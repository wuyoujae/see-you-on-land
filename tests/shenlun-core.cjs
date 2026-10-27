"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../assets/js/shenlun-core.js");
const Service = require("../assets/js/shenlun-service.js");
const AI = require("../assets/js/ai-explanation.js");
const TeachingPrompts = require("../assets/js/shenlun-prompts.js");
const settings = {apiKey: "test-shenlun-secret", baseUrl: "https://model.invalid/v1", model: "vision-text-model"};
const project = (overrides = {}) => ({id: "p-1", title: "测试概括题", type: "summary", subtype: "countermeasure", maxScore: 10, wordLimit: 100,
  questionText: "概括做法，10分，100字。\n开展需求调查。\n建设服务平台。", answerText: "开展需求调查。加强服务。", answerProvenance: null,
  status: "draft", revision: 1, questionRevision: 1, answerRevision: 1, createdAt: 1, updatedAt: 1, ...overrides});
function referenceRaw(overrides = {}) {
  return {status: "ready", limitations: [], question: {subtype: "countermeasure", maxScore: 10, wordLimit: 100, task: "概括做法", scope: "给定材料"},
    rubric: [{id: "r1", title: "开展需求调查", maxPoints: 5, explanation: "明确服务需求。", sourceAnchors: [{quote: "开展需求调查。", occurrence: 1}], acceptedExpressions: ["调查需求"]},
      {id: "r2", title: "建设服务平台", maxPoints: 5, explanation: "提供服务载体。", sourceAnchors: [{quote: "建设服务平台。", occurrence: 1}], acceptedExpressions: ["搭建服务平台"]}],
    referenceAnswer: "一、开展需求调查。二、建设服务平台。", analysis: [{id: "a1", title: "先确定任务", text: "我们先看题目，概括做法，按行动归纳。", sourceAnchors: [{quote: "概括做法", occurrence: 1}], answerQuote: "开展需求调查。"}], ...overrides};
}
function reportRaw(overrides = {}) {
  return {status: "ready", score: 5, maxScore: 10, summary: "第一点准确，第二点缺少具体载体。", dimensions: [{id: "content", label: "要点覆盖", comment: "覆盖一项。"}],
    points: [{rubricId: "r1", earned: 5, maxPoints: 5, status: "earned", reason: "明确写出调查需求。", answerAnchors: [{quote: "开展需求调查。", occurrence: 1}], sourceAnchors: [{quote: "开展需求调查。", occurrence: 1}]},
      {rubricId: "r2", earned: 0, maxPoints: 5, status: "missing", reason: "缺少平台建设。", answerAnchors: [], sourceAnchors: [{quote: "建设服务平台。", occurrence: 1}]}],
    annotations: [{id: "n1", kind: "credit", answerAnchor: {quote: "开展需求调查。", occurrence: 1}, title: "命中得分点", comment: "行动清晰。", suggestion: "保留。", example: "开展需求调查。", relatedRubricIds: ["r1"]},
      {id: "n2", kind: "issue", answerAnchor: {quote: "加强服务。", occurrence: 1}, title: "表达笼统", comment: "未写具体载体。", suggestion: "补充平台建设。", example: "建设服务平台。", relatedRubricIds: ["r2"]}],
    writing: {typos: [], crossoutsCount: null, comment: "表述简洁。"}, nextSteps: ["补充第二个材料要点。"], ...overrides};
}
function ocrRaw(overrides = {}) {
  return {text: "一、调查需求。\n二、建设平台。", questionMeta: {subtype: null, maxScore: null, wordLimit: null, task: "", scope: ""},
    observations: {crossouts: [{quote: "", description: "一处被划掉的字无法辨认。", confidence: 0.5}], suspectedTypos: [{quote: "建没", suggestion: "建设", confidence: 0.7}], uncertain: [{quote: "[无法辨认]", description: "第二行末字模糊。"}]}, ...overrides};
}
const response = payload => new Response(JSON.stringify({status: "completed", output_text: JSON.stringify(payload)}), {headers: {"content-type": "application/json"}});
const prompts = {ocrInstructions: kind => `OCR ${kind}，返回JSON`, referenceInstructions: snapshot => "独立分析题目：" + JSON.stringify(snapshot), gradeInstructions: (snapshot, reference) => "评分：" + JSON.stringify({snapshot, reference})};
function clientHarness(handler, extra = {}) {
  const requests = [];
  return {requests, client: Service.createClient({ai: AI, getSettings: () => settings, prompts, ...extra, fetch: async (url, options) => { requests.push({url, options, body: JSON.parse(options.body)}); return handler ? handler(url, options) : response(referenceRaw()); }})};
}
function sharedIndexedDB() {
  const tables = new Map([["projects", new Map()], ["assets", new Map()], ["ocr", new Map()]]);
  const factory = {failWrites: false, open() {
    const request = {result: {objectStoreNames: {contains: name => tables.has(name)}, close() {}, transaction(names, mode) {
      names = Array.isArray(names) ? names : [names];
      const staged = new Map(names.map(name => [name, new Map([...tables.get(name)].map(([key, value]) => [key, structuredClone(value)]))]));
      let pending = 0, ended = false;
      const tx = {error: null, objectStore(name) {
        function operation(action) {
          const req = {}; pending++;
          queueMicrotask(() => {
            if (ended) return;
            if (mode === "readwrite" && factory.failWrites) {
              ended = true; tx.error = Object.assign(new Error("quota"), {name: "QuotaExceededError"}); req.error = tx.error; req.onerror?.(); tx.onerror?.(); return;
            }
            req.result = action(); req.onsuccess?.(); pending--;
            queueMicrotask(() => {
              if (!pending && !ended) { ended = true; if (mode === "readwrite") staged.forEach((value, key) => tables.set(key, value)); tx.oncomplete?.(); }
            });
          });
          return req;
        }
        const table = staged.get(name);
        return {get: key => operation(() => structuredClone(table.get(key))), getAll: () => operation(() => [...table.values()].map(value => structuredClone(value))),
          put: value => operation(() => { table.set(name === "ocr" ? value.key : value.id, structuredClone(value)); }),
          delete: key => operation(() => table.delete(key)), clear: () => operation(() => table.clear())};
      }};
      return tx;
    }}};
    queueMicrotask(() => request.onsuccess?.()); return request;
  }};
  return factory;
}

test("exact anchors use UTF-16 offsets, protect surrogate pairs and never guess duplicate quotes", () => {
  const text = "😀甲\n乙，甲。";
  assert.deepEqual(Core.anchor(text, {quote: "😀甲", occurrence: 1}), {start: 0, end: 3, quote: "😀甲"});
  assert.deepEqual(Core.anchor(text, {quote: "甲", occurrence: 2}), {start: 6, end: 7, quote: "甲"});
  assert.equal(Core.anchor(text, {quote: "甲"}), null);
  assert.equal(Core.anchor(text, {quote: "甲", occurrence: 0}), null);
  assert.equal(Core.anchor(text, {quote: "甲", occurrence: 3}), null);
  assert.equal(Core.anchor(text, {quote: "乙,甲"}), null);
  assert.equal(Core.anchor(text, {quote: "\uDE00", occurrence: 1}), null);
  assert.equal(Core.anchor(text, {quote: " "}), null);
  assert.deepEqual(Core.anchor("aaaa", {quote: "aa", occurrence: 3}), {start: 2, end: 4, quote: "aa"});
  assert.equal(Core.countWords("中 文，\n😀。"), 5);
});

test("JSON parsing accepts whole JSON fences but rejects truncated, prose-mixed and dangerous output", () => {
  assert.deepEqual(Core.parseJSON('\uFEFF```json\n{"text":"甲\\n乙。"}\n```'), {text: "甲\n乙。"});
  for (const value of ['{"score":5', '以下是结果：{"score":5}', '[]', '{"__proto__":{"x":1}}', '{"constructor":{}}', "x".repeat(2 * 1024 * 1024 + 1)]) assert.throws(() => Core.parseJSON(value), error => error.code === "VALIDATION");
});

test("live teaching prompts and validators share one OCR and result contract", () => {
  assert.deepEqual(TeachingPrompts.schemas.reference.properties.status.enum, ["ready", "needs_review"]);
  assert.deepEqual(TeachingPrompts.schemas.grade.properties.status.enum, ["ready", "needs_review"]);
  assert.deepEqual(Object.keys(ocrRaw().questionMeta).sort(), TeachingPrompts.schemas.ocr.properties.questionMeta.required.slice().sort());
  assert.deepEqual(Object.keys(referenceRaw()).sort(), TeachingPrompts.schemas.reference.required.slice().sort());
  assert.deepEqual(Object.keys(reportRaw()).sort(), TeachingPrompts.schemas.grade.required.slice().sort());
  assert.doesNotMatch(TeachingPrompts.referenceInstructions(project()), /status=complete|status为complete/);
});

test("reference grading rubric must match confirmed score, type, word limit and unique points", () => {
  const normalized = Core.validateReference(referenceRaw(), project());
  assert.equal(normalized.rubric[0].sourceAnchors[0].resolvedAnchor.quote, "开展需求调查。");
  assert.equal(normalized.analysis[0].resolvedAnswerAnchor.quote, "开展需求调查。");
  const mismatch = referenceRaw(); mismatch.rubric[0].maxPoints = 4;
  assert.throws(() => Core.validateReference(mismatch, project()), /分值之和/);
  assert.throws(() => Core.validateReference(referenceRaw(), project({maxScore: 20})), /满分/);
  assert.throws(() => Core.validateReference(referenceRaw(), project({subtype: "cause"})), /题型/);
  assert.equal(Core.validateReference(referenceRaw(), project({subtype: "auto"})).question.subtype, "countermeasure");
  assert.throws(() => Core.validateReference(referenceRaw(), project({wordLimit: 200})), /字数/);
  const duplicate = referenceRaw(); duplicate.rubric[1].id = "r1";
  assert.throws(() => Core.validateReference(duplicate, project()), /重复/);
  const unsupported = referenceRaw(); unsupported.rubric[0].sourceAnchors = [{quote: "材料中不存在的依据", occurrence: 1}];
  assert.throws(() => Core.validateReference(unsupported, project()), /材料依据/);
  const noEvidence = referenceRaw(); noEvidence.rubric[0].sourceAnchors = [];
  assert.throws(() => Core.validateReference(noEvidence, project()), /材料依据/);
});

test("report enforces score integrity and preserves unlocated annotations without marking unrelated text", () => {
  const reference = Core.validateReference(referenceRaw(), project());
  const raw = reportRaw(); raw.annotations[1].answerAnchor.quote = "模型编造的原文";
  const normalized = Core.validateReport(raw, project(), reference);
  assert.equal(normalized.score, 5); assert.equal(normalized.annotations[1].resolvedAnchor, null);
  assert.equal(normalized.annotations[1].answerAnchor.quote, "模型编造的原文");
  assert.throws(() => Core.validateReport(reportRaw({score: 6}), project(), reference), /得分合计/);
  assert.throws(() => Core.validateReport(reportRaw({score: 11}), project(), reference), /得分/);
  assert.throws(() => Core.validateReport(reportRaw({score: NaN}), project(), reference), /得分/);
  const missing = reportRaw(); missing.points.pop(); assert.throws(() => Core.validateReport(missing, project(), reference), /不一致/);
  const duplicate = reportRaw(); duplicate.points[1].rubricId = "r1"; assert.throws(() => Core.validateReport(duplicate, project(), reference), /重复/);
  const changed = reportRaw(); changed.points[1].maxPoints = 4; assert.throws(() => Core.validateReport(changed, project(), reference), /改变/);
  const lying = reportRaw(); lying.points[0].earned = 3; assert.throws(() => Core.validateReport(lying, project(), reference), /状态/);
  const noEvidence = reportRaw(); noEvidence.points[0].answerAnchors = [];
  assert.throws(() => Core.validateReport(noEvidence, project(), reference), /答卷依据/);
  const inventedEvidence = reportRaw(); inventedEvidence.points[0].answerAnchors = [{quote: "这句答卷里没有", occurrence: 1}];
  assert.throws(() => Core.validateReport(inventedEvidence, project(), reference), /答卷依据/);
  const crossouts = Core.validateReport(reportRaw({writing: {typos: [], crossoutsCount: 6, comment: ""}}), project(), reference);
  assert.equal(crossouts.writing.crossoutsCount, null, "pasted text must never gain invented handwriting data");
});

test("needs-review output has no effective score and cannot be treated as a completed grading result", () => {
  const reference = Core.validateReference(referenceRaw({status: "needs_review", limitations: ["材料缺页。"], rubric: [], referenceAnswer: "", analysis: []}), project());
  assert.equal(reference.status, "needs_review");
  const report = reportRaw({status: "needs_review", score: null, points: [], annotations: [], summary: "请补全材料。"});
  assert.equal(Core.validateReport(report, project(), reference).score, null);
  assert.throws(() => Core.validateReport({...report, score: 0}, project(), reference), /有效分数/);
  assert.throws(() => Core.validateReport(reportRaw(), project(), reference), /不能给出有效评分/);
});

test("OCR preserves line breaks, punctuation and uncertain handwriting without trusting invalid confidences", () => {
  const result = Core.validateOCR(ocrRaw());
  assert.equal(result.text, "一、调查需求。\n二、建设平台。");
  assert.equal(result.observations.crossouts[0].quote, "");
  assert.equal(result.observations.uncertain.length, 1);
  const invalid = ocrRaw(); invalid.observations.crossouts[0].confidence = 2;
  assert.throws(() => Core.validateOCR(invalid), /置信度/);
  assert.throws(() => Core.validateOCR(ocrRaw({text: "", observations: {crossouts: [], suspectedTypos: [], uncertain: []}})), /没有识别到/);
});

test("independent reference request contains no student answer, image metadata or chat history", async () => {
  const h = clientHarness();
  const result = await h.client.reference({project: project({answerText: "PRIVATE_STUDENT_ANSWER", answerProvenance: {mode: "image", observations: {secret: "PRIVATE_METADATA"}}, previous_response_id: "old-conversation"})});
  assert.equal(result.status, "ready"); assert.equal(h.requests.length, 1);
  const {body, url, options} = h.requests[0];
  assert.equal(url, "https://model.invalid/v1/responses"); assert.equal(body.store, false); assert.equal(body.stream, true);
  assert.equal(body.input.length, 1); assert.equal(body.input[0].role, "user");
  assert.doesNotMatch(JSON.stringify(body), /PRIVATE_STUDENT|PRIVATE_METADATA|answerText|answerProvenance|previous_response_id|history/);
  assert.equal(options.headers.Authorization, "Bearer test-shenlun-secret");
});

test("grading carries current OCR provenance and rejects a reference still needing review", async () => {
  const h = clientHarness(() => response(reportRaw()));
  const draft = project({answerImages: [{id: "im1", hash: "img123"}], answerProvenance: {mode: "image", imageHash: "img123", ocrKey: "key123", textHash: await Core.fingerprint(new TextEncoder().encode(project().answerText)), observations: {crossouts: [], suspectedTypos: [], uncertain: []}}});
  await h.client.grade({project: draft, reference: referenceRaw()});
  const payload = JSON.parse(h.requests[0].body.input[0].content[0].text);
  assert.equal(payload.project.answerProvenance.imageHash, "img123");
  await h.client.grade({project: {...draft, answerText: draft.answerText + "（已手动编辑）"}, reference: referenceRaw()});
  assert.equal(JSON.parse(h.requests[1].body.input[0].content[0].text).project.answerProvenance, null, "editing text invalidates old handwriting observations");
  await h.client.grade({project: {...draft, answerImages: [{id: "im2", hash: "different-image"}]}, reference: referenceRaw()});
  assert.equal(JSON.parse(h.requests[2].body.input[0].content[0].text).project.answerProvenance, null, "changing the image invalidates old handwriting observations");
  const unresolved = referenceRaw({status: "needs_review", limitations: ["材料缺页"], rubric: [], referenceAnswer: "", analysis: []});
  await assert.rejects(h.client.grade({project: draft, reference: unresolved}), error => error.code === "NEEDS_REVIEW");
  assert.equal(h.requests.length, 3);
});

test("OCR sends high-detail image bytes, has no conversation and parses structured results", async () => {
  const h = clientHarness(() => response(ocrRaw()));
  const png = "data:image/png;base64,aGVsbG8=";
  const result = await h.client.recognize({images: [png], kind: "answer"});
  assert.equal(result.text.includes("\n"), true);
  const {body} = h.requests[0]; assert.equal(body.input[0].content[1].image_url, png); assert.equal(body.input[0].content[1].detail, "high");
  assert.equal(body.store, false); assert.equal(body.previous_response_id, undefined);
  await assert.rejects(h.client.recognize({images: ["https://external.invalid/image.png"], kind: "question"}), error => error.code === "IMAGE");
  await assert.rejects(h.client.recognize({images: [png, png], kind: "answer"}), error => error.code === "INPUT");
});

test("gateway failures, incomplete output and malformed JSON never retry or produce a valid score", async () => {
  const failure = clientHarness(() => new Response(JSON.stringify({error: {message: settings.apiKey + " https://x.invalid?token=abc"}}), {status: 429}));
  await assert.rejects(failure.client.reference({project: project()}), error => error.code === "HTTP" && error.status === 429 && !error.message.includes(settings.apiKey) && !error.message.includes("token="));
  assert.equal(failure.requests.length, 1);
  const incomplete = clientHarness(() => new Response(JSON.stringify({status: "incomplete", error: {message: "secret=" + settings.apiKey + " https://x.invalid?key=abc"}}), {headers: {"content-type": "application/json"}}));
  await assert.rejects(incomplete.client.reference({project: project()}), error => error.code === "INCOMPLETE" && !error.message.includes(settings.apiKey) && !error.message.includes("x.invalid"));
  const malformed = clientHarness(() => new Response(JSON.stringify({status: "completed", output_text: '{"status":"ready"'}), {headers: {"content-type": "application/json"}}));
  await assert.rejects(malformed.client.reference({project: project()}), error => error.code === "VALIDATION");
});

test("user cancellation and explicit timeout stop requests without a second paid attempt", async () => {
  const abortingFetch = (_, options) => new Promise((resolve, reject) => { options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), {name: "AbortError"})), {once: true}); });
  const h = clientHarness(abortingFetch), controller = new AbortController();
  const waiting = h.client.reference({project: project(), signal: controller.signal});
  await new Promise(resolve => setTimeout(resolve, 5)); controller.abort();
  await assert.rejects(waiting, error => error.name === "AbortError" && error.code === "CANCELLED");
  assert.equal(h.requests.length, 1);
  const timed = clientHarness(abortingFetch, {timeoutMs: 5});
  await assert.rejects(timed.client.reference({project: project()}), error => error.code === "TIMEOUT");
  assert.equal(timed.requests.length, 1);
  const uncooperative = clientHarness(() => new Promise(() => {}), {timeoutMs: 5});
  await assert.rejects(uncooperative.client.reference({project: project()}), error => error.code === "TIMEOUT");
  assert.equal(uncooperative.requests.length, 1, "an ignored abort cannot keep the UI request pending forever");
});

test("memory fallback is explicit, projects preserve reports and export never includes keys, image bytes or blobs", async () => {
  const store = Service.createStore({indexedDB: null});
  const reference = Core.validateReference(referenceRaw(), project()), report = Core.validateReport(reportRaw(), project(), reference);
  await store.put(project({status: "completed", reference, report, run: {id: "run1", model: "m", apiKey: settings.apiKey}, pendingOCR: {kind: "answer", result: ocrRaw()}, apiKey: settings.apiKey,
    questionImages: [{id: "image1", name: "题目.png", hash: "abc", dataUrl: "data:image/png;base64,aGVsbG8="}]}));
  assert.equal(store.persistent, false); assert.equal(store.isPersistent(), false);
  assert.equal((await store.get("p-1")).report.score, 5);
  await store.putAsset({id: "image1", blob: new Blob(["image"], {type: "image/png"}), name: "题目.png", hash: "abc"});
  assert.equal((await store.getAsset("image1")).blob.size, 5);
  await store.putOCR({key: "ocr-key", result: ocrRaw(), createdAt: 10});
  const exported = await store.exportData();
  assert.equal(exported.projects.length, 1); assert.equal(exported.ocr.length, 1); assert.equal(exported.assetsIncluded, false);
  assert.doesNotMatch(JSON.stringify(exported), /test-shenlun-secret|apiKey|data:image|"blob"/);
  const restored = Service.createStore({indexedDB: null}); await restored.importData(exported);
  assert.equal((await restored.get("p-1")).reference.referenceAnswer, reference.referenceAnswer);
  assert.equal((await restored.get("p-1")).report.annotations.length, 2);
  assert.equal((await restored.getOCR("ocr-key")).result.text, ocrRaw().text);
  assert.equal(await restored.getAsset("image1"), null);
  const detached = await restored.get("p-1"); detached.answerText = "changed";
  assert.notEqual((await restored.get("p-1")).answerText, "changed");
  await restored.remove("p-1"); assert.deepEqual(await restored.list(), []);
  await store.removeAsset("image1"); assert.equal(await store.getAsset("image1"), null);
});

test("import validates before mutation and keeps newer local projects", async () => {
  const store = Service.createStore({indexedDB: null}); await store.put(project({updatedAt: 30}));
  const invalid = {schema: "summer-politics-shenlun", version: 1, projects: [project({report: reportRaw()})], ocr: []};
  await assert.rejects(store.importData(invalid), /缺少对应/);
  await assert.rejects(store.importData({schema: "summer-politics-shenlun", version: 1, projects: [project({maxScore: '"><img src=x onerror=alert(1)>'})], ocr: []}), /满分格式/);
  await assert.rejects(store.put(project({questionImages: "not-an-array"})), /图片列表/);
  assert.equal((await store.get("p-1")).updatedAt, 30);
  await store.importData({schema: "summer-politics-shenlun", version: 1, projects: [project({updatedAt: 2})], ocr: []});
  assert.equal((await store.get("p-1")).updatedAt, 30);
  await store.importData({schema: "summer-politics-shenlun", version: 1, projects: [project({id: "p-2", status: "running"})], ocr: []});
  assert.equal((await store.get("p-2")).status, "interrupted");
  assert.equal((await store.list()).length, 2);
});

test("IndexedDB quota failures keep the latest report in memory with an explicit nonpersistent warning", async () => {
  const quota = Object.assign(new Error("quota"), {name: "QuotaExceededError"});
  const idb = {open() {
    const request = {result: {objectStoreNames: {contains: () => true}, close() {}, transaction() {
      const tx = {error: quota, objectStore() { return {put() { queueMicrotask(() => tx.onerror?.()); }}; }};
      return tx;
    }}};
    queueMicrotask(() => request.onsuccess?.());
    return request;
  }};
  const store = Service.createStore({indexedDB: idb});
  await store.put(project());
  assert.equal(store.isPersistent(), false);
  assert.match(store.warning, /空间不足/);
  assert.equal((await store.get("p-1")).answerText, project().answerText);
});

test("separate tabs observe persisted updates, deletions and recreations without overwriting unsaved local changes", async () => {
  const db = sharedIndexedDB(), first = Service.createStore({indexedDB: db}), second = Service.createStore({indexedDB: db});
  await first.put(project({updatedAt: "2026-10-27T10:00:00.000Z"}));
  assert.equal((await second.get("p-1")).status, "draft");
  await first.put(project({status: "completed", updatedAt: "2026-10-27T10:01:00.000Z"}));
  assert.equal((await second.get("p-1")).status, "completed", "a cached object must not hide a report completed in another tab");
  assert.equal((await second.list())[0].status, "completed");
  await first.remove("p-1");
  assert.equal(await second.get("p-1"), null, "another tab's deletion must invalidate a clean cached object");
  assert.deepEqual(await second.list(), []);
  await first.put(project({status: "draft", updatedAt: "2026-10-27T10:02:00.000Z"}));
  assert.equal((await second.get("p-1")).status, "draft");
  await first.put(project({id: "p-2", updatedAt: "2026-10-27T10:03:00.000Z"}));
  assert.equal((await second.list())[0].id, "p-2", "ISO timestamps sort by recency");
  db.failWrites = true;
  await second.put(project({answerText: "未能落盘的新作答", updatedAt: "2026-10-27T10:04:00.000Z"}));
  db.failWrites = false;
  await first.put(project({answerText: "另一标签的旧文字", updatedAt: "2026-10-27T10:05:00.000Z"}));
  assert.equal((await second.get("p-1")).answerText, "未能落盘的新作答", "failed writes must remain authoritative in this tab's memory");
  assert.equal((await second.list()).find(item => item.id === "p-1").answerText, "未能落盘的新作答");
  db.failWrites = true; await second.remove("p-1"); db.failWrites = false;
  assert.equal(await second.get("p-1"), null, "a failed local deletion cannot resurrect a disk record in the current tab");
});

test("content fingerprints are stable across property order and change with actual content", async () => {
  assert.equal(await Core.fingerprint({b: 2, a: "甲"}), await Core.fingerprint({a: "甲", b: 2}));
  assert.notEqual(await Core.fingerprint({a: "甲"}), await Core.fingerprint({a: "乙"}));
  assert.match(await Core.fingerprint(new Uint8Array([1, 2, 3])), /^[a-f0-9]{64}$/);
});
