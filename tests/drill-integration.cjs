"use strict";
// Production practice/core/question components plus the real shared AI service.
// The minimal DOM implements only rendering/event boundaries, never navigation,
// submission, grading, pending deduplication, cache or cancellation decisions.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {webcrypto} = require("node:crypto");
const Core = require("../assets/js/practice-core.js");
const Rich = require("../assets/js/rich-content.js");
const AI = require("../assets/js/ai-explanation.js");
const scripts = ["practice-core.js", "question-components.js", "practice.js"].map(name => fs.readFileSync(path.join(__dirname, "../assets/js", name), "utf8"));
const KEY = "summer-politics-drill-v1";
const clone = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; };
const response = value => ({ok: true, json: async () => clone(value)});
const QUESTION_IDS = ["drill-q1", "drill-q2", "drill-q3"];
const questions = [
  {id: QUESTION_IDS[0], subjectId: "language", type: "single", stem: "请选择乙", options: [{value: "A", label: "甲"}, {value: "B", label: "乙"}], answer: "B", revision: "1",
    source: {paperId: "paper-one", year: 2025, questionNumber: 1}, sourceAnswer: {answer: "B", provider: "原题来源", url: "https://source.invalid/answer", explanationBlocks: [{type: "paragraph", text: "SOURCE_Q1：乙是正确答案。"}]}},
  {id: QUESTION_IDS[1], subjectId: "language", type: "multiple", stem: "请选择甲和丙", options: [{value: "A", label: "甲"}, {value: "B", label: "乙"}, {value: "C", label: "丙"}], answer: ["A", "C"], revision: "1",
    source: {paperId: "paper-one", year: 2025, questionNumber: 2}, sourceAnswer: {answer: ["A", "C"], explanationBlocks: [{type: "paragraph", text: "SOURCE_Q2：要同时选择甲、丙。"}]}},
  {id: QUESTION_IDS[2], subjectId: "language", type: "fill", stem: "填写四十二", answer: "42", revision: "1",
    source: {paperId: "paper-one", year: 2025, questionNumber: 3}, sourceAnswer: {answer: "42", explanationBlocks: [{type: "paragraph", text: "SOURCE_Q3：填写42。"}]}}
];
const bank = {version: 1, subjects: [{id: "language", title: "言语理解", questionCount: 3, questionIds: QUESTION_IDS, path: "data/question-bank/subjects/language.json"}],
  papers: [{id: "paper-one", year: 2025, title: "2025国考试卷", questionCount: 3, questionIds: QUESTION_IDS, subjectCounts: {language: 3}, path: "data/question-bank/papers/paper-one.json"}], totals: {questionCount: 3, paperCount: 1}};
const baseSession = () => Core.createSession({id: "session-test", subjectId: "language", questionIds: QUESTION_IDS, now: 100});
function progressFor(session) { return {version: 1, updatedAt: session.updatedAt, sessions: {[session.id]: session}}; }
const routeFor = (index = 0, view = "", id = "session-test") => `#/study/session/${id}?q=${index}${view ? `&view=${view}` : ""}`;

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
  toggle(value, force) { const active = force === undefined ? !this.contains(value) : force; active ? this.add(value) : this.remove(value); return active; }
}
class Element extends Events {
  constructor(id = "", parent = null) {
    super(); this.id = id; this.parent = parent; this.connected = true; this.children = new Map(); this.classList = new Classes();
    this.dataset = {}; this._html = ""; this._text = ""; this.value = ""; this.hidden = false; this.disabled = false; this.style = {setProperty() {}}; this.focused = false; this.scrollTop = 0;
  }
  get isConnected() { return this.connected && (!this.parent || this.parent.isConnected); }
  disconnect() { this.connected = false; for (const value of this.children.values()) value.disconnect(); }
  set innerHTML(value) { for (const child of this.children.values()) child.disconnect(); this.children.clear(); this._html = value; this._text = ""; }
  get innerHTML() { return this._html; }
  set textContent(value) { this.innerHTML = ""; this._text = String(value); }
  get textContent() { return this._text || this._html.replace(/<[^>]*>/g, ""); }
  querySelector(selector) {
    if (/^#[\w-]+\s+/.test(selector)) { const [head, ...rest] = selector.split(/\s+/); return this.querySelector(head)?.querySelector(rest.join(" ")) || null; }
    if (this.children.get(selector)?.isConnected) return this.children.get(selector);
    let tag = "";
    const tags = this._html.match(/<[a-zA-Z][^>]*>/g) || [];
    if (selector.startsWith("#")) tag = tags.find(value => value.includes(`id="${selector.slice(1)}"`));
    else if (selector.startsWith(".")) tag = tags.find(value => new RegExp('class="[^"]*\\b' + selector.slice(1) + '\\b').test(value));
    else if (selector.startsWith("[")) tag = tags.find(value => value.includes(selector.slice(1, -1)));
    else if (selector === "input") tag = tags.find(value => value.startsWith("<input"));
    if (!tag) {
      for (const child of this.children.values()) { const nested = child.querySelector(selector); if (nested) return nested; }
      return null;
    }
    if (!this.children.has(selector)) {
      const child = new Element(selector, this);
      child.ownerDocument = this.ownerDocument;
      for (const match of tag.matchAll(/([\w-]+)="([^"]*)"/g)) {
        if (match[1] === "class") child.classList.add(...match[2].split(/\s+/));
        else if (match[1] === "style") child.style.cssText = match[2];
        else if (match[1].startsWith("data-")) child.dataset[match[1].slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = match[2];
        else child[match[1]] = match[2];
      }
      child.disabled = /\sdisabled(?:\s|>)/.test(tag); child.hidden = /\shidden(?:\s|>)/.test(tag);
      if (tag.startsWith("<select")) {
        const after = this._html.slice(this._html.indexOf(tag) + tag.length), first = /<option\b[^>]*value="([^"]*)"/.exec(after);
        if (first) child.value = first[1];
      }
      this.children.set(selector, child);
    }
    return this.children.get(selector);
  }
  querySelectorAll() { return []; }
  append(child) { child.parent = this; child.connected = true; this.children.set("append-" + this.children.size, child); }
  setAttribute(name, value) { this[name] = String(value); }
  focus() { this.focused = true; if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  close() { this.open = false; }
  showModal() { this.open = true; }
  content() { return this._html + this._text + [...this.children.values()].filter(value => value.isConnected).map(value => value.content()).join(""); }
}
function memoryCache() {
  const values = new Map();
  return {values, async get(key) { return values.get(key); }, async set(value) { values.set(value.key, value); return true; },
    async all() { return [...values.values()]; }, async importEntries(entries, merge) { if (!merge) values.clear(); entries.forEach(value => values.set(value.key, value)); return {total: values.size}; }};
}
async function until(predicate) { for (let i = 0; i < 300; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 1)); } assert.ok(predicate(), "async boundary did not settle"); }

function harness(t, options = {}) {
  const session = options.session || baseSession(), seed = options.noSession ? {} : {[KEY]: JSON.stringify(progressFor(session))};
  const values = new Map(Object.entries({...seed, ...options.storage})), writes = [], fetches = [], timers = new Map();
  const root = new Element("view-practice"), app = new Element("app"), html = new Element("html"), window = new Events(), document = new Events();
  root.ownerDocument = app.ownerDocument = html.ownerDocument = document;
  let clock = 1000, timerId = 0, uuid = 0, remembered = "practice", settingsOpened = 0;
  const location = {hash: options.hash || routeFor(), pathname: "/", search: "", href: "https://fixture.invalid/"};
  const historyEntries = [location.hash]; let historyIndex = 0;
  const url = value => { location.hash = String(value).includes("#") ? String(value).slice(String(value).indexOf("#")) : ""; };
  const history = {state: null, pushState(_state, _title, value) { url(value); historyEntries.splice(++historyIndex); historyEntries.push(location.hash); },
    replaceState(_state, _title, value) { url(value); historyEntries[historyIndex] = location.hash; },
    go(step) { const next = historyIndex + step; if (next < 0 || next >= historyEntries.length) return; historyIndex = next; location.hash = historyEntries[next]; window.dispatchEvent({type: "hashchange"}); }};
  const tab = {click() { root.classList.add("active"); window.dispatchEvent({type: "summer-politics:tabchange", detail: {tab: "practice"}}); }};
  Object.assign(document, {documentElement: html, visibilityState: "visible", createElement: tag => new Element(tag),
    getElementById: id => id === "view-practice" ? root : id === "app" ? app : null,
    querySelector: selector => selector.includes("tab-item") ? tab : selector === "dialog[open]" ? [...root.children.values()].find(value => value.open) || null : null});
  const localStorage = {getItem: key => values.get(key) ?? null, setItem(key, value) { values.set(key, String(value)); writes.push({key, value: String(value)}); }, removeItem: key => values.delete(key)};
  const resources = {"data/question-bank/manifest.json": bank, "data/question-bank/subjects/language.json": {questions},
    "data/question-bank/papers/paper-one.json": {id: "paper-one", questionIds: QUESTION_IDS}, ...options.resources};
  const fetch = async path => { fetches.push(path); if (options.fetch?.[path]) return options.fetch[path]; return path in resources ? response(resources[path]) : {ok: false}; };
  const setTimer = callback => { const id = ++timerId; timers.set(id, callback); return id; }, clearTimer = id => timers.delete(id);
  const cache = options.cache || memoryCache(), backend = [], explainCalls = [], renderWrites = [], jobs = new Map(), transitions = [];
  const settings = {apiKey: "mock-only", baseUrl: "https://no-paid-request.invalid/v1", model: "mock-model", ...options.settings};
  let providerFailures = options.providerFailures || 0;
  const client = AI.createClient({storage: cache, prompts: {version: "vm-test", instructions: async () => "只讲解当前题目。"}, getSettings: () => settings, timeoutMs: 5000,
    fetch: async (_url, request) => {
      const body = JSON.parse(request.body), text = body.input.at(-1).content[0].text, data = JSON.parse(text.slice(text.indexOf("{"))), qid = data.题目编号;
      backend.push({qid, request});
      if (providerFailures-- > 0) return new Response(JSON.stringify({error: {message: "rate limited"}}), {status: 429});
      if (options.immediateAI) return new Response(JSON.stringify({status: "completed", output_text: "AI_" + qid}), {headers: {"content-type": "application/json"}});
      let controller;
      const stream = new ReadableStream({start(value) { controller = value; }});
      const job = {qid, controller}; if (!jobs.has(qid)) jobs.set(qid, []); jobs.get(qid).push(job);
      return new Response(stream, {headers: {"content-type": "text/event-stream"}});
    }});
  const ai = options.aiService || {explain(args) { explainCalls.push(args); return client.explain(args); },
    renderMarkdown(host, text) { renderWrites.push({host, text, connected: host.isConnected}); host.textContent = text; }, openSettings() { settingsOpened++; }};
  Object.assign(window, {crypto: {subtle: webcrypto.subtle, randomUUID: () => "fixture-" + (++uuid)}, RichContent: {...Rich, hydrate() {}}, AIExplanation: ai,
    PageTransitions: {enter(host, options) { transitions.push({host, options}); }, cancel() {}},
    AppUI: {refresh() {}}, LearningApp: {routeHandling: false, handlesRoute: hash => hash.startsWith("#/learn"),
      resolveRoute() { root.innerHTML = '<article id="learning-owned">LEARNING_CONTENT</article>'; return Promise.resolve(); },
      rememberMode(value) { remembered = value; }, lastMode: () => remembered, modeSwitchMarkup: () => ""}});
  class TestDate extends Date { static now() { return ++clock; } }
  const context = vm.createContext({window, document, location, history, localStorage, fetch, crypto: window.crypto,
    setTimeout: setTimer, clearTimeout: clearTimer, Date: TestDate, URL, URLSearchParams, AbortController, navigator: {onLine: true}, console,
    CustomEvent: class { constructor(type, value) { this.type = type; Object.assign(this, value); } }});
  for (const source of scripts) vm.runInContext(source, context, {timeout: 1000});
  const h = {
    root, window, document, location, history, localStorage, cache, backend, explainCalls, renderWrites, fetches, settings, transitions,
    get settingsOpened() { return settingsOpened; },
    get historyLength() { return historyEntries.length; },
    async settle() { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); },
    async navigate(hash) { location.hash = hash; window.dispatchEvent({type: "hashchange"}); await this.settle(); },
    async action(action, data = {}) {
      const target = {dataset: {drillAction: action, ...data}, closest(selector) {
        if (selector === "[data-drill-action]" && action) return this;
        if (selector === "[data-drill-jump]" && "drillJump" in data) return this;
        return null;
      }};
      root.dispatchEvent({type: "click", target, preventDefault() {}}); await this.settle();
    },
    async answer(value) {
      const host = root.querySelector("#drill-question"); assert.ok(host, "a question must actually be mounted");
      const match = /data-question-id="([^"]+)"/.exec(host.innerHTML); assert.ok(match);
      const field = {dataset: {questionId: match[1]}, querySelectorAll: () => (Array.isArray(value) ? value : [value]).map(value => ({value}))};
      host.dispatchEvent({type: "input", target: {value, closest: selector => selector === "[data-question-id]" ? field : null}}); await this.settle();
    },
    async start(count, order = "source") {
      root.querySelector("#drill-count").value = String(count); root.querySelector("#drill-order").value = order;
      root.dispatchEvent({type: "submit", target: {id: "drill-start-form"}, preventDefault() {}}); await this.settle();
    },
    emit(qid, delta) { const job = jobs.get(qid)?.at(-1); assert.ok(job, "network job must exist"); job.controller.enqueue(new TextEncoder().encode("data: " + JSON.stringify({type: "response.output_text.delta", delta}) + "\n\n")); },
    complete(qid, text = "AI_" + qid) { const job = jobs.get(qid)?.at(-1); assert.ok(job); job.controller.enqueue(new TextEncoder().encode("data: " + JSON.stringify({type: "response.completed", response: {status: "completed", output_text: text}}) + "\n\n")); job.controller.close(); },
    progress() { return JSON.parse(localStorage.getItem(KEY) || "{}"); },
    flush() { window.PracticeStudy.flush(); }, text() { return root.content(); },
    async close() { for (const job of client.getPending()) client.cancel(job.key); await this.settle(); }
  };
  t.after(() => h.close()); return h;
}

test("empty single/fill answers stay on the question card and never expose answers or start AI", async t => {
  const h = harness(t); await h.settle();
  assert.equal(h.root.querySelector('[data-drill-action="next"]').disabled, false, "empty submit remains clickable so it can explain the required action");
  await h.action("next");
  assert.equal(h.location.hash, routeFor()); assert.match(h.root.querySelector(".drill-notice").textContent, /先选择答案/);
  assert.doesNotMatch(h.text(), /SOURCE_Q1|超级思维解析/); assert.equal(h.explainCalls.length, 0);
  await h.navigate(routeFor(1)); await h.answer([]); await h.action("next");
  assert.equal(h.location.hash, routeFor(1)); assert.match(h.root.querySelector(".drill-notice").textContent, /先选择答案/);
  await h.navigate(routeFor(2)); await h.answer("   "); await h.action("next");
  assert.equal(h.location.hash, routeFor(2)); assert.match(h.root.querySelector(".drill-notice").textContent, /先填写答案/);
  h.flush(); assert.equal(Object.keys(h.progress().sessions["session-test"].answers).length, 0);
});

test("submission preserves the question/pane/focus, expands both explanations inline and locks the submitted answer", async t => {
  const h = harness(t); await h.settle();
  const host = h.root.querySelector("#drill-question"), pane = h.root.querySelector(".drill-question-pane"), button = h.root.querySelector('[data-drill-action="next"]');
  pane.scrollTop = 420; button.focus(); const transitions = h.transitions.length, historyLength = h.historyLength;
  await h.answer("A"); await h.action("next"); await until(() => h.backend.length === 1);
  assert.equal(h.location.hash, routeFor());
  assert.equal(h.historyLength, historyLength, "submission does not create a separate answer history entry");
  assert.equal(h.root.querySelector("#drill-question"), host, "submission must keep the question host in place");
  assert.equal(h.root.querySelector(".drill-question-pane"), pane); assert.equal(pane.scrollTop, 420);
  assert.equal(h.document.activeElement, button, "the existing submit/next toolbar button keeps keyboard focus");
  assert.equal(h.transitions.length, transitions, "submission must not start a page transition");
  assert.equal(h.root.querySelector(".drill-question-layout").classList.contains("is-submitted"), true);
  assert.equal(h.root.querySelector("#drill-explanation").hidden, false);
  assert.match(host.innerHTML, /请选择乙/); assert.match(host.innerHTML, /value="A" checked disabled/);
  assert.match(host.innerHTML, /has-feedback/); assert.match(button.innerHTML, /下一题/);
  assert.match(h.text(), /题目来源答案和解析/); assert.match(h.text(), /SOURCE_Q1/); assert.match(h.text(), /超级思维解析/);
  assert.equal(h.explainCalls.length, 1); assert.equal(h.backend[0].qid, QUESTION_IDS[0]);
  assert.equal(h.root.querySelector("#drill-ai-body").dataset.questionId, QUESTION_IDS[0]);
  h.complete(QUESTION_IDS[0]); await until(() => h.cache.values.size === 1); await h.settle();
  assert.match(h.root.querySelector("#drill-ai-body").textContent, /AI_drill-q1/);
  h.flush(); const submitted = h.progress().sessions["session-test"].answers[QUESTION_IDS[0]];
  assert.equal(submitted.answer, "A"); assert.equal(submitted.status, "incorrect");
  await h.action("next"); assert.equal(h.location.hash, routeFor(1));
  assert.doesNotMatch(h.text(), /SOURCE_Q1|SOURCE_Q2|超级思维解析/);
  assert.doesNotMatch(h.root.querySelector("#drill-question").innerHTML, /has-feedback|readonly|disabled/);
  assert.equal(h.backend.length, 1, "opening the next unsubmitted question does not prefetch its AI");
  await h.action("previous"); await until(() => h.root.querySelector("#drill-ai-state")?.textContent === "已保存");
  assert.equal(h.location.hash, routeFor()); assert.match(h.root.querySelector("#drill-question").innerHTML, /value="A" checked disabled/);
  await h.answer("B"); h.flush();
  assert.equal(h.progress().sessions["session-test"].answers[QUESTION_IDS[0]].answer, "A");
  assert.equal(h.progress().sessions["session-test"].drafts[QUESTION_IDS[0]].value, "A");
  assert.equal(h.progress().sessions["session-test"].answers[QUESTION_IDS[0]].submittedAt, submitted.submittedAt);
  assert.equal(h.backend.length, 1);
});

test("flipping unsubscribes the old UI but its real shared job completes into cache and never writes the new card", async t => {
  const h = harness(t); await h.settle(); await h.answer("B"); await h.action("next"); await until(() => h.backend.length === 1);
  const oldHost = h.root.querySelector("#drill-ai-body"), subscription = h.explainCalls[0].signal;
  h.emit(QUESTION_IDS[0], "OLD_PARTIAL"); await until(() => oldHost.textContent.includes("OLD_PARTIAL"));
  await h.action("next");
  assert.equal(subscription.aborted, true); assert.equal(h.backend[0].request.signal.aborted, false); assert.equal(oldHost.isConnected, false);
  assert.equal(h.location.hash, routeFor(1));
  h.complete(QUESTION_IDS[0]); await until(() => h.cache.values.size === 1); await h.settle();
  assert.doesNotMatch(h.text(), /OLD_PARTIAL|AI_drill-q1/);
  assert.equal(h.renderWrites.filter(value => !value.connected).length, 0);
  await h.action("previous"); await h.settle();
  await until(() => h.root.querySelector("#drill-ai-state")?.textContent === "已保存");
  assert.equal(h.location.hash, routeFor()); assert.equal(h.backend.length, 1);
  assert.match(h.root.querySelector("#drill-ai-body").textContent, /OLD_PARTIAL/);
  assert.equal(h.root.querySelector("#drill-ai-state").textContent, "已保存");
});

test("even an adapter ignoring unsubscribe cannot write a stale result into the next question", async t => {
  const calls = [], writes = [];
  const h = harness(t, {aiService: {
    explain(args) { const job = deferred(); calls.push({args, job}); return job.promise; },
    renderMarkdown(host, text) { writes.push({host, text, connected: host.isConnected}); host.textContent = text; }, openSettings() {}
  }});
  await h.settle(); await h.answer("B"); await h.action("next"); assert.equal(calls.length, 1);
  await h.action("next"); assert.equal(calls[0].args.signal.aborted, true);
  calls[0].args.onChunk({text: "LATE_OLD_UI"}); calls[0].job.resolve({text: "LATE_OLD_UI", cached: false}); await h.settle();
  assert.equal(h.location.hash, routeFor(1)); assert.doesNotMatch(h.text(), /LATE_OLD_UI/);
  assert.equal(writes.length, 0);
});

test("returning before completion joins pending text instead of posting the same question again", async t => {
  const h = harness(t); await h.settle(); await h.answer("B"); await h.action("next"); await until(() => h.backend.length === 1);
  h.emit(QUESTION_IDS[0], "PENDING_PREFIX"); await until(() => h.root.querySelector("#drill-ai-body").textContent.includes("PENDING_PREFIX"));
  await h.action("next"); await h.action("previous");
  await until(() => h.root.querySelector("#drill-ai-body").textContent.includes("PENDING_PREFIX"));
  assert.equal(h.backend.length, 1);
  h.emit(QUESTION_IDS[0], "_SUFFIX"); h.complete(QUESTION_IDS[0]);
  await until(() => h.cache.values.size === 1); await h.settle();
  assert.equal(h.root.querySelector("#drill-ai-body").textContent, "PENDING_PREFIX_SUFFIX");
});

test("session order and submissions survive a new page instance without resampling", async t => {
  const h = harness(t, {hash: "#/study/language", noSession: true, immediateAI: true}); await h.settle(); await h.start(3, "random");
  h.flush(); const stored = h.progress(), [session] = Object.values(stored.sessions), order = [...session.questionIds];
  assert.equal(order.length, 3); assert.equal(new Set(order).size, 3);
  const current = questions.find(value => value.id === order[0]); await h.answer(current.answer); await h.action("next");
  await until(() => h.backend.length === 1); await h.settle(); h.flush();
  const refreshed = harness(t, {hash: h.location.hash, storage: {[KEY]: h.localStorage.getItem(KEY)}, cache: h.cache, noSession: true, immediateAI: true});
  await refreshed.settle(); await until(() => refreshed.explainCalls.length === 1); await refreshed.settle(); refreshed.flush();
  assert.deepEqual(refreshed.progress().sessions[session.id].questionIds, order);
  assert.equal(Object.keys(refreshed.progress().sessions).length, 1);
  assert.equal(refreshed.backend.length, 0, "refresh must use the saved explanation");
  assert.equal(refreshed.root.querySelector("#drill-ai-state").textContent, "已保存");
});

test("quick-jump and forged answer deep links cannot reveal an unsubmitted source/AI card", async t => {
  const h = harness(t); await h.settle(); await h.action("jump"); assert.equal(h.root.querySelector(".drill-jump").open, true);
  await h.action(null, {drillJump: "1"}); assert.equal(h.location.hash, routeFor(1));
  assert.doesNotMatch(h.text(), /SOURCE_Q2|超级思维解析/);
  await h.navigate(routeFor(1, "answer")); assert.equal(h.location.hash, routeFor(1));
  assert.match(h.root.querySelector(".drill-notice").textContent, /先完成这道题/);
  await h.navigate(`${routeFor(1)}&side=answer`); assert.equal(h.location.hash, routeFor(1));
  assert.match(h.root.querySelector(".drill-notice").textContent, /先完成这道题/);
  assert.doesNotMatch(h.text(), /SOURCE_Q2|超级思维解析/);
  assert.equal(h.explainCalls.length, 0); h.flush(); assert.equal(Object.keys(h.progress().sessions["session-test"].answers).length, 0);
});

test("legacy submitted deep links show question plus answer and never promote a later unsubmitted draft", async t => {
  let session = Core.submit(baseSession(), questions[0], "A", () => "incorrect", 110);
  session = { ...session, updatedAt: 150, drafts: { ...session.drafts, [QUESTION_IDS[0]]: { value: "B", updatedAt: 150 } } };
  const h = harness(t, {session, hash: `${routeFor()}&side=answer`, immediateAI: true});
  await h.settle(); await until(() => h.cache.values.size === 1);
  assert.equal(h.location.hash, routeFor()); assert.match(h.root.querySelector("#drill-question").innerHTML, /value="A" checked disabled/);
  assert.doesNotMatch(h.root.querySelector("#drill-question").innerHTML, /value="B" checked/);
  assert.match(h.text(), /SOURCE_Q1|我们的答案 A/);
  await h.navigate(routeFor(0, "question")); await h.settle();
  assert.equal(h.location.hash, routeFor()); assert.equal(h.root.querySelector("#drill-explanation").hidden, false);
  assert.equal(h.backend.length, 1); assert.match(h.root.querySelector("#drill-question").innerHTML, /value="A" checked disabled/);
});

test("multi-select and fill submissions lock in place and the next question starts without prior feedback", async t => {
  const h = harness(t, {hash: routeFor(1), immediateAI: true}); await h.settle(); await h.answer(["A", "C"]); await h.action("next");
  await until(() => h.cache.values.size === 1);
  let markup = h.root.querySelector("#drill-question").innerHTML;
  assert.match(markup, /value="A" checked disabled/); assert.match(markup, /value="C" checked disabled/);
  assert.equal(h.location.hash, routeFor(1)); await h.answer(["B"]); h.flush();
  assert.deepEqual(h.progress().sessions["session-test"].answers[QUESTION_IDS[1]].answer, ["A", "C"]);
  await h.action("next"); assert.equal(h.location.hash, routeFor(2));
  assert.equal(h.root.querySelector("#drill-explanation").hidden, true); assert.doesNotMatch(h.text(), /SOURCE_Q2/);
  await h.answer("42"); await h.action("next"); await until(() => h.cache.values.size === 2);
  markup = h.root.querySelector("#drill-question").innerHTML;
  assert.match(markup, /value="42"[^>]* readonly/); assert.match(h.root.querySelector('[data-drill-action="next"]').innerHTML, /完成练习/);
  assert.equal(h.location.hash, routeFor(2)); await h.answer("0"); h.flush();
  assert.equal(h.progress().sessions["session-test"].answers[QUESTION_IDS[2]].answer, "42");
});

test("disputed references remain visible and missing reference answers submit with neutral feedback", async t => {
  const disputed = clone(questions);
  disputed[0].sourceAnswer.notice = "来源答案存在分歧";
  disputed[0].alternativeReferences = [{answer: "A", provider: "另一来源", url: "https://reference.invalid/answer"}];
  const h = harness(t, {resources: {"data/question-bank/subjects/language.json": {questions: disputed}}, immediateAI: true});
  await h.settle(); assert.doesNotMatch(h.text(), /来源答案存在分歧|另一来源/);
  await h.answer("A"); await h.action("next"); await until(() => h.cache.values.size === 1);
  assert.match(h.text(), /来源答案存在分歧/); assert.match(h.text(), /另一来源/); assert.match(h.text(), /我们的答案 A/);
  const missing = clone(questions); delete missing[0].answer; missing[0].sourceAnswer = {provider: "来源尚未核验"};
  const session = Core.createSession({id: "session-test", subjectId: "language", questionIds: [QUESTION_IDS[0]], now: 100});
  const unknown = harness(t, {session, resources: {"data/question-bank/subjects/language.json": {questions: missing}}, immediateAI: true});
  await unknown.settle(); await unknown.answer("A"); await unknown.action("next"); await until(() => unknown.cache.values.size === 1);
  assert.match(unknown.root.querySelector("#drill-question").innerHTML, /is-neutral/);
  assert.doesNotMatch(unknown.root.querySelector("#drill-question").innerHTML, /is-correct|is-incorrect/);
  assert.match(unknown.text(), /暂无|本题不计分/); unknown.flush();
  assert.equal(unknown.progress().sessions["session-test"].answers[QUESTION_IDS[0]].status, "ungraded");
  await unknown.action("next"); assert.match(unknown.text(), /正确率/); assert.doesNotMatch(unknown.text(), /null|NaN/);
});

test("leaving for learning invalidates late AI and question-bank failures without overwriting its page", async t => {
  const h = harness(t); await h.settle(); await h.answer("B"); await h.action("next"); await until(() => h.backend.length === 1);
  await h.navigate("#/learn/language"); assert.match(h.text(), /LEARNING_CONTENT/);
  h.complete(QUESTION_IDS[0]); await until(() => h.cache.values.size === 1); await h.settle();
  assert.match(h.text(), /LEARNING_CONTENT/); assert.doesNotMatch(h.text(), /AI_drill-q1/);
  const request = deferred(), loading = harness(t, {hash: "#/study", noSession: true, fetch: {"data/question-bank/manifest.json": request.promise}});
  await loading.settle(); await loading.navigate("#/learn/language"); request.reject(new Error("late bank failure")); await loading.settle();
  assert.match(loading.text(), /LEARNING_CONTENT/); assert.doesNotMatch(loading.text(), /late bank failure|题库暂时没有打开/);
});

test("missing configuration and provider errors keep source answers visible and allow an explicit retry", async t => {
  const h = harness(t, {settings: {apiKey: ""}}); await h.settle(); await h.answer("B"); await h.action("next");
  await until(() => h.root.querySelector("#drill-ai-state")?.textContent === "待配置");
  assert.equal(h.backend.length, 0); assert.match(h.text(), /SOURCE_Q1|配置 AI/);
  await h.action("ai-settings"); assert.equal(h.settingsOpened, 1);
  h.settings.apiKey = "mock-only"; await h.action("ai-retry"); await until(() => h.backend.length === 1);
  h.complete(QUESTION_IDS[0]); await until(() => h.cache.values.size === 1); await h.settle(); assert.equal(h.root.querySelector("#drill-ai-state").textContent, "已生成");
  const failed = harness(t, {providerFailures: 1}); await failed.settle(); await failed.answer("B"); await failed.action("next");
  await until(() => failed.root.querySelector("#drill-ai-state")?.textContent === "未完成");
  assert.match(failed.text(), /SOURCE_Q1|重新生成|稍后重试/); assert.equal(failed.cache.values.size, 0);
  await failed.action("ai-retry"); await until(() => failed.backend.length === 2); failed.complete(QUESTION_IDS[0]); await until(() => failed.cache.values.size === 1);
});

test("setup rejects counts exceeding available questions without creating a session", async t => {
  const h = harness(t, {hash: "#/study/language", noSession: true}); await h.settle();
  assert.equal(h.root.querySelector("#drill-count").max, "3");
  await h.start(4); assert.equal(h.location.hash, "#/study/language");
  assert.match(h.root.querySelector(".drill-notice").textContent, /1 到 3/); assert.equal(h.root.querySelector("#drill-count").focused, true);
  h.flush(); assert.equal(Object.keys(h.progress().sessions).length, 0); assert.equal(h.explainCalls.length, 0);
});

test("running state replaces queued status as soon as the real request starts", async t => {
  const h = harness(t); await h.settle(); await h.answer("B"); await h.action("next"); await until(() => h.backend.length === 1);
  assert.equal(h.root.querySelector("#drill-ai-state").textContent, "生成中");
  h.complete(QUESTION_IDS[0]); await until(() => h.cache.values.size === 1);
});

test("focused formula/table scrollers keep arrow keys while ordinary question focus still submits", async t => {
  const h = harness(t, {hash: routeFor(1)}); await h.settle(); await h.answer(["A", "C"]);
  for (const scroller of [".rich-content__math--display", ".rich-content__table-scroll"]) {
    for (const key of ["ArrowLeft", "ArrowRight"]) {
      let prevented = false;
      h.document.dispatchEvent({type: "keydown", key,
        target: {closest: selector => selector.includes(scroller) ? {} : null},
        preventDefault() { prevented = true; }});
      await h.settle();
      assert.equal(prevented, false, `${scroller} ${key} must remain available for horizontal scrolling`);
      assert.equal(h.location.hash, routeFor(1));
      assert.equal(h.root.querySelector("#drill-explanation").hidden, true);
      assert.equal(h.explainCalls.length, 0);
    }
  }
  let prevented = false;
  h.document.dispatchEvent({type: "keydown", key: "ArrowRight", target: {closest: () => null}, preventDefault() { prevented = true; }});
  await h.settle(); await until(() => h.backend.length === 1);
  assert.equal(prevented, true); assert.equal(h.root.querySelector("#drill-explanation").hidden, false);
});
