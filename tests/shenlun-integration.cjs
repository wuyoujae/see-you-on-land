"use strict";
// Execute the production controller. The DOM below supplies render/event
// boundaries only; navigation, job ownership and invalidation stay in shenlun.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto").webcrypto;
const {setTimeout: delay} = require("node:timers/promises");
const Core = require("../assets/js/shenlun-core.js");
const Prompts = require("../assets/js/shenlun-prompts.js");
const controllerSource = fs.readFileSync(path.join(__dirname, "../assets/js/shenlun.js"), "utf8");
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; };
function project(id = "p-a", extra = {}) {
  return {id, title: "概括做法 " + id, type: "summary", subtype: "countermeasure", maxScore: 10, wordLimit: 100,
    questionText: "概括做法。\n开展调查。\n建设平台。", answerText: "开展调查。", questionImages: [], answerImages: [], answerProvenance: null,
    revision: 1, questionRevision: 1, answerRevision: 1, status: "draft", reference: null, report: null,
    createdAt: "2026-10-27T10:00:00.000Z", updatedAt: "2026-10-27T10:00:00.000Z", ...extra};
}
function reference(p) {
  return Core.validateReference({status: "ready", limitations: ["教学参考配分。"], question: {subtype: "countermeasure", maxScore: 10, wordLimit: 100, task: "概括做法", scope: "给定材料"},
    rubric: [{id: "r1", title: "开展调查", maxPoints: 5, explanation: "明确需求。", sourceAnchors: [{quote: "开展调查。", occurrence: 1}], acceptedExpressions: ["调查需求"]},
      {id: "r2", title: "建设平台", maxPoints: 5, explanation: "完善载体。", sourceAnchors: [{quote: "建设平台。", occurrence: 1}], acceptedExpressions: []}],
    referenceAnswer: "开展调查；建设平台。", analysis: [{id: "a1", title: "我们先找做法", text: "我们从材料中的行动找到两个要点。", sourceAnchors: [{quote: "开展调查。", occurrence: 1}], answerQuote: "开展调查"}]}, p);
}
function report(p, ref) {
  return Core.validateReport({status: "ready", score: 5, maxScore: 10, summary: "调查准确，平台遗漏。", dimensions: [{id: "coverage", label: "内容覆盖", comment: "我们答出一个要点。"}],
    points: [{rubricId: "r1", earned: 5, maxPoints: 5, status: "earned", reason: "调查行动准确。", answerAnchors: [{quote: "开展调查。", occurrence: 1}], sourceAnchors: [{quote: "开展调查。", occurrence: 1}]},
      {rubricId: "r2", earned: 0, maxPoints: 5, status: "missing", reason: "缺少平台建设。", answerAnchors: [], sourceAnchors: [{quote: "建设平台。", occurrence: 1}]}],
    annotations: [{id: "n1", kind: "credit", answerAnchor: {quote: "开展调查。", occurrence: 1}, title: "调查得分", comment: "这一句有明确材料依据。", suggestion: "保留，并补充第二点。", example: "开展调查；建设平台。", relatedRubricIds: ["r1"]}],
    writing: {typos: [], crossoutsCount: null, comment: "未评估笔迹。"}, nextSteps: ["补充平台建设。"]}, p, ref);
}
function completedProject(id) { const p = project(id); p.reference = reference(p); p.report = report(p, p.reference); p.status = "completed"; return p; }
function ocr(text = "开展调查。") { return Core.validateOCR({text, questionMeta: {subtype: null, maxScore: null, wordLimit: null, task: "", scope: ""}, observations: {crossouts: [], suspectedTypos: [], uncertain: []}}); }

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, callback) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type).add(callback); }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  dispatchEvent(event) { for (const callback of [...(this.listeners.get(event.type) || [])]) callback(event); }
}
class Classes {
  constructor(...values) { this.values = new Set(values); }
  add(...values) { values.forEach(value => this.values.add(value)); }
  remove(...values) { values.forEach(value => this.values.delete(value)); }
  contains(value) { return this.values.has(value); }
  toggle(value, force) { const enabled = force === undefined ? !this.contains(value) : force; if (enabled) this.add(value); else this.remove(value); return enabled; }
}
class Element extends Events {
  constructor(id = "") { super(); this.id = id; this.classList = new Classes(); this.dataset = {}; this.children = new Map(); this._html = ""; this.isConnected = true; this.scrollTop = 0; this.disabled = false; this.attributes = {}; }
  set className(value) { this._className = value; this.classList = new Classes(...String(value).split(/\s+/)); }
  get className() { return this._className || ""; }
  set innerHTML(value) { this._html = String(value); for (const child of this.children.values()) child.isConnected = false; this.children.clear(); }
  get innerHTML() { return this._html; }
  querySelector(selector) {
    let present = false;
    if (selector.startsWith(".")) present = this._html.includes(selector.slice(1).split(/[ .]/)[0]);
    else if (selector.startsWith("#")) present = this._html.includes(`id="${selector.slice(1)}"`);
    else if (selector.startsWith("[data-")) present = [...selector.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)].every(([, key, value]) => this._html.includes(value === undefined ? key : `${key}="${value}"`));
    if (!present) return null;
    if (!this.children.has(selector)) { const child = new Element(selector); child.parent = this; this.children.set(selector, child); }
    return this.children.get(selector);
  }
  querySelectorAll(selector) {
    if (selector === "[data-sl-entry-tab]") return ["question", "answer"].map(kind => {
      const tab = this.querySelector(`[data-sl-entry-tab="${kind}"]`);
      if (tab) tab.dataset.slEntryTab = kind;
      return tab;
    }).filter(Boolean);
    return [];
  }
  append(...values) { for (const value of values) this.children.set("child-" + this.children.size, value); }
  remove() { this.isConnected = false; this.removed = true; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  scrollIntoView() {}
  scrollTo({top = 0} = {}) { this.scrollTop = top; }
  focus() { this.focused = true; }
  click() { this.clicked = true; }
}

function harness(options = {}) {
  const root = new Element("view-shenlun"), app = new Element("app"), body = new Element("body"), document = new Events(), window = new Events();
  const records = new Map((options.projects || []).map(p => [p.id, clone(p)])), assets = new Map(options.assets || []), cache = new Map();
  const writes = [], calls = [], clients = [], timers = new Map(), intervals = new Map(), values = new Map(); let nextTimer = 0;
  const location = {hash: options.hash ?? "#/shenlun/draft/p-a", pathname: "/", search: ""};
  const history = {pushState(_state, _title, url) { location.hash = String(url).includes("#") ? String(url).slice(String(url).indexOf("#")) : ""; }, replaceState(...args) { this.pushState(...args); }};
  const store = {persistent: true, getHook: null,
    async list() { return [...records.values()].map(clone); },
    async get(id) { if (store.getHook) { const result = store.getHook(id); if (result !== undefined) return clone(await result); } return clone(records.get(id) || null); },
    async put(p) { records.set(p.id, clone(p)); writes.push(clone(p)); return clone(p); }, async remove(id) { records.delete(id); },
    async putAsset(value) { assets.set(value.id, value); return value; }, async getAsset(id) { return assets.get(id) || null; }, async removeAsset(id) { assets.delete(id); },
    async getOCR(key) { return clone(cache.get(key) || null); }, async putOCR(value) { cache.set(value.key, clone(value)); },
    async exportData() { return {schema: "summer-politics-shenlun", version: 1, projects: [...records.values()].map(clone), ocr: [...cache.values()].map(clone), assetsIncluded: false}; },
    validateImportData(value) { return value; }, async importData(value) { value.projects.forEach(p => records.set(p.id, clone(p))); }
  };
  let settings = {apiKey: "test-secret", baseUrl: "https://model.invalid/v1", model: "model-a"};
  const service = {createStore: () => store, createClient(config = {}) {
    const client = {};
    for (const phase of ["reference", "grade", "recognize"]) client[phase] = async args => {
      const call = {phase, args, settings: clone(config.getSettings ? config.getSettings() : settings)}; calls.push(call);
      if (options.handlers?.[phase]) return options.handlers[phase](args, call);
      if (phase === "reference") return reference(args.project);
      if (phase === "grade") return report(args.project, args.reference);
      return ocr();
    };
    clients.push(client); return client;
  }};
  const nav = new Element("shenlun-nav");
  nav.click = () => { nav.classList.add("active"); root.classList.add("active"); window.dispatchEvent({type: "summer-politics:tabchange", detail: {tab: "shenlun"}}); };
  Object.assign(document, {body, visibilityState: "visible", getElementById: id => id === root.id ? root : id === "app" ? app : null,
    querySelector: selector => selector === '[data-tab="shenlun"]' ? nav : selector === ".sl-toast" ? [...body.children.values()].findLast(child => child.className === "sl-toast" && !child.removed) || null : null,
    createElement: tag => new Element(tag)});
  const setTimeout = (callback, delay) => { const id = ++nextTimer; timers.set(id, {callback, delay}); return id; };
  const clearTimeout = id => timers.delete(id);
  const setInterval = (callback, delay) => { const id = ++nextTimer; intervals.set(id, {callback, delay}); return id; };
  const clearInterval = id => intervals.delete(id);
  const urlAPI = {createObjectURL: () => "blob:test", revokeObjectURL() {}};
  class FileReader {
    readAsDataURL(blob) { this.result = "data:" + blob.type + ";base64,aGVsbG8="; queueMicrotask(() => this.onload?.()); }
  }
  Object.assign(window, {ShenlunCore: Core, ShenlunService: service, ShenlunPrompts: Prompts,
    AIExplanation: {getSettings: () => clone(settings), openSettings() {}}, AppUI: {refresh() {}, confirm: async () => true, dialogOpen() {}, dialogClose: async () => {}}});
  const context = vm.createContext({window, document, location, history, crypto, navigator: {}, TextEncoder, AbortController, Blob, FileReader, URL: urlAPI,
    createImageBitmap: options.createImageBitmap || (async () => ({close() {}})), queueMicrotask,
    localStorage: {getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value)},
    setTimeout, clearTimeout, setInterval, clearInterval, matchMedia: () => ({matches: false}), console});
  vm.runInContext(controllerSource, context, {timeout: 1000});
  const h = {window, document, root, app, nav, location, history, store, records, assets, cache, writes, calls, clients, timers, intervals,
    get current() { return window.ShenlunApp.current; },
    setSettings(value) { settings = {...settings, ...value}; },
    async settle() { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); },
    async until(predicate) { for (let i = 0; i < 100 && !predicate(); i++) await delay(2); assert.ok(predicate(), "expected asynchronous controller state"); },
    async navigate(hash) { location.hash = hash; window.dispatchEvent({type: "hashchange"}); await h.settle(); },
    async tab(tab) { if (tab !== "shenlun") { nav.classList.remove("active"); root.classList.remove("active"); } window.dispatchEvent({type: "summer-politics:tabchange", detail: {tab}}); await h.settle(); },
    async action(action, data = {}) {
      const target = {dataset: {slAction: action, ...data}, disabled: false, closest: selector => selector === "[data-sl-action]" ? target : null};
      root.dispatchEvent({type: "click", target, preventDefault() {}}); await h.settle();
    },
    async editorTab(kind) {
      const target = {dataset: {slEntryTab: kind}, closest: selector => selector === "[data-sl-entry-tab]" ? target : null};
      root.dispatchEvent({type: "click", target, preventDefault() {}}); await h.settle();
    },
    async input(field, value) { root.dispatchEvent({type: "input", target: {dataset: {slField: field}, value: String(value)}}); await h.settle(); },
    async upload(kind, files) { root.dispatchEvent({type: "change", target: {dataset: {slFile: kind}, files, hasAttribute: () => false}}); await h.settle(); },
    async poll() { const pending = [...intervals.values()].map(value => value.callback()); await h.settle(); return pending; },
    text() { return root.innerHTML; },
    toasts() { return [...body.children.values()].filter(child => child.className === "sl-toast").map(child => child.textContent); }
  };
  return h;
}

test("editor tabs preserve both live textareas and image observations without rerendering or starting a model request", async () => {
  const provenance = {mode: "image", imageHash: "image-hash", textHash: "answer-hash", observations: {crossouts: [{text: "旧字"}]}};
  const p = project("p-a", {answerText: "开展调查。\n建设平台。", answerProvenance: provenance});
  const h = harness({projects: [p]}); await h.settle();
  const question = h.root.querySelector('[data-sl-field="questionText"]');
  const answer = h.root.querySelector('[data-sl-field="answerText"]');
  question.value = "我们正在校对的材料。\n换行与标点，保留。";
  answer.value = p.answerText;
  await h.input("questionText", question.value);
  const html = h.text(), pendingSaveCount = h.timers.size, beforeWrites = h.writes.length;
  await h.editorTab("answer");
  assert.equal(h.root.querySelector(".sl-entry").dataset.editor, "answer");
  assert.equal(h.root.querySelector('[data-sl-entry-tab="answer"]').attributes["aria-selected"], "true");
  assert.equal(h.root.querySelector('[data-sl-entry-tab="question"]').tabIndex, -1);
  await h.editorTab("question");
  assert.equal(h.root.querySelector(".sl-entry").dataset.editor, "question");
  assert.equal(h.root.querySelector('[data-sl-entry-tab="question"]').attributes["aria-selected"], "true");
  assert.equal(h.root.querySelector('[data-sl-field="questionText"]'), question);
  assert.equal(h.root.querySelector('[data-sl-field="answerText"]'), answer);
  assert.equal(question.isConnected, true); assert.equal(answer.isConnected, true);
  assert.equal(h.text(), html, "switching only updates tab/panel attributes, never root.innerHTML");
  assert.equal(h.current.questionText, question.value); assert.equal(h.current.answerText, answer.value);
  assert.deepEqual(h.current.answerProvenance, provenance);
  assert.equal(h.calls.length, 0); assert.equal(h.writes.length, beforeWrites);
  assert.equal(h.timers.size, pendingSaveCount, "switching must not cancel a pending text save");
});

test("missing question or answer submission reveals and focuses its editor instead of grading the other tab", async () => {
  for (const kind of ["question", "answer"]) {
    const field = kind + "Text", p = project("p-a", {[field]: " \n "});
    const h = harness({projects: [p]}); await h.settle();
    await h.editorTab(kind === "question" ? "answer" : "question");
    await h.action("start");
    assert.equal(h.root.querySelector(".sl-entry").dataset.editor, kind);
    assert.equal(h.root.querySelector(`[data-sl-entry-tab="${kind}"]`).attributes["aria-selected"], "true");
    assert.equal(h.root.querySelector(`[data-sl-field="${field}"]`).focused, true);
    assert.match(h.root.querySelector(".sl-notice").textContent, kind === "question" ? /补齐题目要求和给定材料/ : /填写或识别我们的答案/);
    assert.equal(h.root.querySelector(".sl-notice").hidden, false);
    assert.equal(h.location.hash, "#/shenlun/draft/p-a");
    assert.equal(h.current.status, "draft"); assert.equal(h.calls.length, 0);
  }
});

test("submit persists a running project, generates its reference before grading and avoids duplicate clicks", async () => {
  const refGate = deferred(), gradeGate = deferred(), p = project();
  const h = harness({projects: [p], handlers: {reference: () => refGate.promise, grade: () => gradeGate.promise}}); await h.settle();
  await h.action("start");
  assert.equal(h.location.hash, "#/shenlun/project/p-a");
  assert.equal(h.records.get("p-a").status, "running");
  assert.match(h.text(), /正在分析题目与材料/);
  assert.deepEqual(h.calls.map(call => call.phase), ["reference"]);
  await h.action("retry"); assert.equal(h.calls.length, 1);
  const ref = reference(p); refGate.resolve(ref); await h.settle();
  assert.deepEqual(h.calls.map(call => call.phase), ["reference", "grade"]);
  assert.equal(h.records.get("p-a").reference.status, "ready");
  assert.match(h.text(), /正在逐点批改答案/);
  gradeGate.resolve(report(p, ref)); await h.settle();
  assert.equal(h.records.get("p-a").status, "completed"); assert.equal(h.records.get("p-a").report.score, 5);
  assert.match(h.text(), /AI 参考评分/);
  await h.action("annotation", {id: "n1"}); assert.match(h.text(), /调查得分/); assert.match(h.text(), /这一句有明确材料依据/);
});

test("leaving the tab keeps the original job alive and stores its result without repainting another project", async () => {
  const refGate = deferred(), gradeGate = deferred(), p = project(), b = completedProject("p-b");
  const h = harness({projects: [p, b], handlers: {reference: () => refGate.promise, grade: () => gradeGate.promise}}); await h.settle();
  await h.action("start"); await h.tab("search");
  assert.equal(h.calls[0].args.signal.aborted, false);
  await h.navigate("#/shenlun/project/p-b");
  const ref = reference(p); refGate.resolve(ref); await h.settle(); gradeGate.resolve(report(p, ref)); await h.settle();
  assert.equal(h.records.get("p-a").status, "completed");
  assert.equal(h.current.id, "p-b"); assert.equal(h.location.hash, "#/shenlun/project/p-b");
  assert.match(h.text(), /概括做法 p-b/); assert.doesNotMatch(h.text(), /概括做法 p-a/);
});

test("an already-awaited poll from A cannot replace newly opened B", async () => {
  const a = completedProject("p-a"), b = completedProject("p-b"), gate = deferred();
  const h = harness({hash: "#/shenlun/project/p-a", projects: [a, b]}); await h.settle();
  let intercepted = false;
  h.store.getHook = id => id === "p-a" && !intercepted ? (intercepted = true, gate.promise) : undefined;
  const polls = await h.poll(); assert.equal(intercepted, true);
  await h.navigate("#/shenlun/project/p-b"); gate.resolve({...a, updatedAt: "2026-10-27T11:00:00.000Z"}); await Promise.all(polls); await h.settle();
  assert.equal(h.current.id, "p-b"); assert.equal(h.location.hash, "#/shenlun/project/p-b");
  assert.match(h.text(), /概括做法 p-b/);
});

test("refresh recovers an orphaned running project without issuing a paid request or rewriting it on later tab changes", async () => {
  const p = project("p-a", {status: "running", run: {id: "old-run", phase: "reference"}});
  const h = harness({hash: "#/shenlun/project/p-a", projects: [p]}); await h.settle();
  assert.equal(h.records.get("p-a").status, "interrupted"); assert.equal(h.calls.length, 0);
  assert.match(h.text(), /上次生成因刷新或关闭页面中断/);
  await h.tab("search");
  const newer = completedProject("p-a"); newer.updatedAt = "2026-10-27T12:00:00.000Z"; h.records.set("p-a", clone(newer));
  await h.tab("clock"); h.document.visibilityState = "hidden"; h.document.dispatchEvent({type: "visibilitychange"}); await h.settle();
  assert.equal(h.records.get("p-a").status, "completed"); assert.equal(h.records.get("p-a").updatedAt, newer.updatedAt);
});

test("editing or pasting answer text invalidates visual observations and rapid browser navigation flushes the latest draft", async () => {
  const p = project("p-a", {answerImages: [{id: "im-a", hash: "image-hash", name: "答案.png"}], answerProvenance: {mode: "image", imageHash: "image-hash", textHash: "previous", observations: {crossouts: []}}});
  const h = harness({projects: [p, project("p-b")]}); await h.settle();
  await h.input("answerText", "我们新粘贴的作答。\n标点和换行保留。");
  assert.equal(h.current.answerProvenance, null);
  assert.notEqual(h.records.get("p-a").answerText, h.current.answerText, "the debounce must still be pending before navigation");
  await h.navigate("#/shenlun/draft/p-b");
  assert.equal(h.records.get("p-a").answerText, "我们新粘贴的作答。\n标点和换行保留。");
  assert.equal(h.records.get("p-a").answerProvenance, null); assert.equal(h.current.id, "p-b");
  await h.navigate("#/shenlun/draft/p-a"); assert.equal(h.current.answerText, "我们新粘贴的作答。\n标点和换行保留。");
});

test("each scoring run pins one model configuration across delayed reference and grading phases", async () => {
  const p = project(), refGate = deferred(), gradeGate = deferred();
  const h = harness({projects: [p], handlers: {reference: () => refGate.promise, grade: () => gradeGate.promise}}); await h.settle();
  await h.action("start"); h.setSettings({model: "model-b", apiKey: "new-secret"});
  const ref = reference(p); refGate.resolve(ref); await h.settle();
  assert.equal(h.calls[0].settings.model, "model-a"); assert.equal(h.calls[1].settings.model, "model-a");
  assert.equal(h.calls[1].settings.apiKey, "test-secret");
  gradeGate.resolve(report(p, ref)); await h.settle();
  assert.equal(h.records.get("p-a").run.model, "model-a");
});

test("explicit stop preserves the original project and does not advance to grading", async () => {
  const p = project();
  const h = harness({projects: [p], handlers: {reference: args => new Promise((_, reject) => args.signal.addEventListener("abort", () => reject(Object.assign(new Error("stopped"), {name: "AbortError"})), {once: true}))}}); await h.settle();
  await h.action("start"); await h.action("stop");
  assert.equal(h.records.get("p-a").status, "interrupted");
  assert.equal(h.records.get("p-a").questionText, p.questionText); assert.equal(h.records.get("p-a").answerText, p.answerText);
  assert.deepEqual(h.calls.map(call => call.phase), ["reference"]);
  assert.equal(h.window.ShenlunApp.pending.length, 0); assert.match(h.text(), /已停止生成/);
});

test("upload decoding blocks scoring and cannot erase text edited while the image was decoding", async () => {
  const bitmap = deferred(), p = project();
  const h = harness({projects: [p], createImageBitmap: () => bitmap.promise}); await h.settle();
  const file = {name: "答案.png", type: "image/png", size: 5, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4, 5]).buffer};
  await h.upload("answer", [file]); await h.action("start");
  assert.equal(h.calls.length, 0); assert.match(h.root.querySelector(".sl-notice").textContent, /图片正在读取/);
  await h.input("answerText", "读取期间保留的新答案。"); bitmap.resolve({close() {}}); await h.settle();
  await h.until(() => h.toasts().length > 0);
  assert.equal(h.current.answerText, "读取期间保留的新答案。"); assert.equal(h.current.answerImages.length, 0);
  assert.equal(h.assets.size, 0, "discarded uploads must not leave orphan assets");
  assert.ok(h.toasts().some(value => value.includes("当前文字已保留")), JSON.stringify(h.toasts()));
});

test("OCR uses the current image cache and a changed text revision requires explicit adoption", async () => {
  const gate = deferred(), p = project("p-a", {answerImages: [{id: "im-a", name: "答案.png", hash: "image-hash", type: "image/png", size: 5}]});
  const h = harness({projects: [p], assets: [["im-a", {id: "im-a", blob: new Blob(["image"], {type: "image/png"})}]], handlers: {recognize: () => gate.promise}}); await h.settle();
  await h.action("recognize", {kind: "answer"}); await h.until(() => h.calls.length === 1);
  h.setSettings({model: "different-model"}); await h.input("answerText", "我们正在手动校对的作答。");
  gate.resolve(ocr()); await h.until(() => h.cache.size === 1); await h.settle();
  assert.equal(h.current.answerText, "我们正在手动校对的作答。"); assert.equal(h.current.answerProvenance, null);
  assert.match(h.root.querySelector('[data-sl-ocr-status="answer"]').innerHTML, /采用识别结果/);
  assert.equal(h.cache.size, 1); assert.equal(h.calls[0].settings.model, "model-a");
  await h.action("adopt-ocr", {kind: "answer"}); await h.until(() => h.current.answerProvenance !== null); assert.equal(h.current.answerText, "开展调查。");
  assert.equal(h.current.answerProvenance.imageHash, "image-hash");
  const beforeToasts = h.toasts().length;
  h.setSettings({model: "model-a"}); await h.action("recognize", {kind: "answer"}); await h.until(() => h.toasts().length > beforeToasts);
  assert.equal(h.calls.length, 1, "re-recognizing identical bytes with the same model reuses completed OCR");
});
