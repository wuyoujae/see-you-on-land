"use strict";
// Run with: node --test tests/learning-integration.cjs
// Execute both production modules. This minimal DOM supplies event/render
// boundaries only; it contains no navigation, completion or grading logic.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Core = require("../assets/js/learning-core.js");
const Rich = require("../assets/js/rich-content.js");
const componentSource = fs.readFileSync(path.join(__dirname, "../assets/js/question-components.js"), "utf8");
const learningSource = fs.readFileSync(path.join(__dirname, "../assets/js/learning.js"), "utf8");
const practiceSource = fs.readFileSync(path.join(__dirname, "../assets/js/practice.js"), "utf8");
const COURSE_KEY = "summer-politics-courses-v1";
const firstHash = "#/learn/language/group-one/lesson-one?card=0";
const questionHash = "#/learn/language/group-one/lesson-one?card=1";
const explanationHash = "#/learn/language/group-one/lesson-one?card=2";
const nextLessonHash = "#/learn/language/group-one/lesson-two?card=0";
const fixtureLessons = [
  { id: "lesson-one", subjectId: "language", groupId: "group-one", title: "第一知识点", cards: [
    { id: "knowledge-one", type: "text", role: "knowledge", title: "先找对应关系", blocks: [{ type: "paragraph", text: "认识题型" }] },
    { id: "question-one", type: "question", title: "独立例题", question: { id: "q-one", type: "single", stem: "请选择乙", options: [{ value: "A", label: "甲" }, { value: "B", label: "乙" }], answer: "B" } },
    { id: "explanation-one", type: "text", role: "explanation", questionId: "q-one", title: "一起分析", blocks: [{ type: "paragraph", text: "PRIVATE_SOLUTION：乙刚好对应，所以选B。" }] }
  ] },
  { id: "lesson-two", subjectId: "language", groupId: "group-one", title: "下一知识点", cards: [
    { id: "knowledge-two", type: "text", role: "knowledge", title: "继续下一知识点", blocks: [{ type: "paragraph", text: "下一知识点正文" }] }
  ] }
];
const fixtureManifest = { version: 1, subjects: [{ id: "language", title: "言语理解", groups: [{
  id: "group-one", title: "题型组", lessons: fixtureLessons.map(lesson => ({
    id: lesson.id, title: lesson.title, path: `data/courses/lessons/${lesson.id}.json`,
    cardCount: lesson.cards.length, questionCount: lesson.cards.filter(card => card.type === "question").length,
    cardIds: lesson.cards.map(card => card.id)
  }))
}] }] };
const clone = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const response = value => ({ ok: true, json: async () => clone(value) });
function resourcesForLesson(lesson) {
  const manifest = clone(fixtureManifest), meta = manifest.subjects[0].groups[0].lessons[0];
  meta.cardCount = lesson.cards.length; meta.cardIds = lesson.cards.map(card => card.id);
  meta.questionIds = lesson.cards.filter(card => card.type === "question").map(card => card.question.id);
  meta.questionCount = meta.questionIds.length;
  return {"data/courses/manifest.json": manifest, "data/courses/lessons/lesson-one.json": lesson};
}

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
  toggle(value, force) { const active = force === undefined ? !this.contains(value) : force; if (active) this.add(value); else this.remove(value); return active; }
}
class Element extends Events {
  constructor(id = "") { super(); this.id = id; this.classList = new Classes(); this.children = new Map(); this.dataset = {}; this.disabled = false; this._html = ""; this.style = { setProperty() {} }; }
  set innerHTML(html) { this._html = html; this.children.clear(); }
  get innerHTML() { return this._html; }
  querySelector(selector) {
    let present;
    if (selector.startsWith("#")) present = this._html.includes(`id="${selector.slice(1)}"`);
    else if (selector.startsWith(".")) present = this._html.includes(selector.slice(1));
    else if (selector.startsWith("[data-learn-action=")) present = this._html.includes(selector.slice(1, -1));
    else if (selector.startsWith("input")) present = [...this._html.matchAll(/<input\b[^>]*>/g)].some(match => !selector.includes(":not([disabled])") || !/\sdisabled(?:[\s=>])/.test(match[0]));
    else present = false;
    if (!present) return null;
    if (!this.children.has(selector)) {
      const element = new Element(selector);
      element.parent = this;
      this.children.set(selector, element);
    }
    return this.children.get(selector);
  }
  querySelectorAll() { return []; }
  insertAdjacentHTML(_where, html) { this._html += html; }
  scrollTo() {}
  focus(options) { this.focused = true; this.focusOptions = options; }
  close() { this.open = false; }
  showModal() { this.open = true; }
  setAttribute() {}
}

function harness(options = {}) {
  const values = new Map(Object.entries(options.storage || {})), writes = [], fetches = [], timers = new Map();
  const root = new Element("view-practice"), app = new Element("app"), html = new Element("html");
  const window = new Events(), document = new Events();
  let clock = 1000, timerId = 0;
  const location = { hash: options.hash ?? firstHash, pathname: "/", search: "", href: "https://example.test/" };
  const historyEntries = [{ hash: location.hash, state: null }];
  let historyIndex = 0;
  function setURL(url) { location.hash = String(url).includes("#") ? String(url).slice(String(url).indexOf("#")) : ""; }
  const history = {
    state: null,
    pushState(state, _title, url) { setURL(url); this.state = state; historyEntries.splice(++historyIndex); historyEntries.push({ hash: location.hash, state }); },
    replaceState(state, _title, url) { setURL(url); this.state = state; historyEntries[historyIndex] = { hash: location.hash, state }; },
    go(step) {
      const target = historyIndex + step;
      if (target < 0 || target >= historyEntries.length) return;
      historyIndex = target;
      const entry = historyEntries[historyIndex]; location.hash = entry.hash; this.state = entry.state;
      window.dispatchEvent({ type: "popstate", state: entry.state }); window.dispatchEvent({ type: "hashchange" });
    }
  };
  const practiceTab = { click() { root.classList.add("active"); window.dispatchEvent({ type: "summer-politics:tabchange", detail: { tab: "practice" } }); } };
  Object.assign(document, {
    documentElement: html, visibilityState: "visible",
    getElementById: id => id === "view-practice" ? root : id === "app" ? app : null,
    querySelector: selector => selector.includes('.tab-item') || selector.includes('[data-tab="practice"]') ? practiceTab :
      selector === "dialog[open]" ? [...root.children.values()].find(child => child.open) || null : null,
    querySelectorAll: () => []
  });
  const localStorage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem(key, value) { values.set(key, String(value)); writes.push({ key, value: String(value) }); },
    removeItem: key => values.delete(key)
  };
  const resources = {
    "data/courses/manifest.json": fixtureManifest,
    "data/courses/lessons/lesson-one.json": fixtureLessons[0],
    "data/courses/lessons/lesson-two.json": fixtureLessons[1],
    "data/question-bank/manifest.json": { version: 1, subjects: [], papers: [], totals: {questionCount: 0} },
    "data/knowledge/manifest.json": { books: [] },
    "data/knowledge/points.json": { points: [] },
    ...options.resources
  };
  function fetch(url) {
    fetches.push(url);
    if (options.fetch?.[url]) return options.fetch[url];
    if (!(url in resources)) return Promise.resolve({ ok: false });
    return Promise.resolve(response(resources[url]));
  }
  const setTimeout = callback => { const id = ++timerId; timers.set(id, callback); return id; };
  const clearTimeout = id => timers.delete(id);
  Object.assign(window, {
    LearningCore: Core, PracticeCore: require("../assets/js/practice-core.js"), RichContent: { ...Rich, hydrate() {} }, AppUI: { refresh() {} },
    getSelection: () => ({ toString: () => "" }), setTimeout, matchMedia: () => ({ matches: false })
  });
  class TestDate extends Date { static now() { return ++clock; } }
  const context = vm.createContext({ window, document, location, history, localStorage, fetch, setTimeout, clearTimeout, Date: TestDate,
    URLSearchParams, Intl, console, CustomEvent: class { constructor(type, init) { this.type = type; Object.assign(this, init); } }
  });
  vm.runInContext(learningSource, context, { timeout: 1000 });
  vm.runInContext(componentSource, context, { timeout: 1000 });
  vm.runInContext(practiceSource, context, { timeout: 1000 });
  return {
    window, document, root, app, location, history, localStorage, writes, fetches,
    async settle() { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); },
    async navigate(hash) { location.hash = hash; window.dispatchEvent({ type: "hashchange" }); await this.settle(); },
    async action(action, data = {}) {
      const target = { dataset: { learnAction: action, ...data }, closest(selector) {
        if (selector === "[data-learn-action]" && action) return this;
        if (selector === "[data-learn-jump]" && "learnJump" in data) return this;
        if (selector === "[data-learn-resume]" && "learnResume" in data) return this;
        return null;
      } };
      root.dispatchEvent({ type: "click", target, preventDefault() {} }); await this.settle();
    },
    async answer(value, questionId = "q-one") {
      const host = root.querySelector("#learn-question-host");
      assert.ok(host, "question must actually be mounted");
      const field = { dataset: { questionId } };
      host.dispatchEvent({ type: "input", target: { value, closest: selector => selector === "[data-question-id]" ? field : null } });
      await this.settle();
    },
    runTimers() {
      for (let step = 0; timers.size && step < 50; step++) {
        const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback());
      }
      assert.equal(timers.size, 0, "timer feedback loop");
    },
    text() { return root.innerHTML + (root.querySelector("#learn-question-host")?.innerHTML || ""); },
    course() { return JSON.parse(localStorage.getItem(COURSE_KEY) || "null"); }
  };
}

test("refreshing an unsubmitted analysis deep link redirects to its question without exposing the solution", async () => {
  const h = harness({ hash: explanationHash }); await h.settle();
  assert.equal(h.location.hash, questionHash);
  assert.match(h.text(), /请选择乙/);
  assert.doesNotMatch(h.text(), /PRIVATE_SOLUTION/);
  assert.equal(h.root.querySelector('[data-learn-action="next"]').disabled, false);
  await h.action("next");
  assert.equal(h.root.querySelector(".learn-notice").textContent, "请先选择或填写答案，再提交。");
  assert.equal(h.root.querySelector("#learn-question-host").querySelector("input:not([disabled]),textarea:not([disabled])").focused, true);
  assert.equal(h.location.hash, questionHash);
  h.window.LearningApp.flush();
  assert.equal(Object.keys(h.course().groups["group-one"].completed).length, 0);
});

test("a retired quantity bookmark opens the handout without transferring old completion", async () => {
  const gid = "quantity-wy27-s01", lid = "quantity-wy27-s01-t01";
  const lesson = {id:lid, subjectId:"quantity", groupId:gid, title:"整除思维", cards:[
    {id:lid+"-knowledge", type:"text", role:"knowledge", title:"整除思维", blocks:[{type:"paragraph", text:"我们先核对整数条件"}]}
  ]};
  const catalog = {version:1, subjects:[{id:"quantity",title:"数量关系",groups:[{id:gid,title:"和差倍比问题（一）",lessons:[
    {id:lid,title:lesson.title,path:`data/courses/lessons/${lid}.json`,cardCount:1,questionCount:0,cardIds:[lesson.cards[0].id]}
  ]}]}]};
  const old = {version:1,updatedAt:100,groups:{"quantity-proportion":{lastCardId:"quantity-q001-question",updatedAt:100,
    completed:{"quantity-q001-question":100},answers:{"quantity-q001":{answer:"B",status:"correct",submittedAt:100}},drafts:{}}}};
  const h = harness({hash:"#/learn/quantity/quantity-proportion/quantity-p1-l02?card=1",storage:{[COURSE_KEY]:JSON.stringify(old)},resources:{
    "data/courses/manifest.json":catalog,[`data/courses/lessons/${lid}.json`]:lesson
  }});
  await h.settle(); h.runTimers();
  assert.equal(h.location.hash,`#/learn/quantity/${gid}/${lid}`);
  assert.match(h.text(),/我们先核对整数条件/);
  const saved=h.course();
  assert.equal(saved.groups["quantity-proportion"].answers["quantity-q001"].status,"correct");
  assert.equal(Object.keys(saved.groups[gid].completed).length,0);
});

test("handout page references and original-question links render without loading duplicate source images", async () => {
  const lesson = clone(fixtureLessons[0]);
  lesson.source = {type: "pdf", documentId: "quantity-wy27", title: '讲义"名称', pages: [7], printedPages: [1]};
  lesson.cards[1].source = {...lesson.source, pages: [8, 9], printedPages: [2, 3], originalImages: [
    {src: "assets/images/courses/wy27/q001.png", alt: '第1题"原图'},
    {src: "javascript:alert(1)", alt: "unsafe"}
  ]};
  const h = harness({resources: {"data/courses/lessons/lesson-one.json": lesson}});
  await h.settle();
  assert.match(h.text(), /讲义 第1页/); assert.match(h.text(), /PDF 第7页/);
  await h.navigate(questionHash);
  const html = h.text();
  assert.match(html, /讲义 第2–3页/); assert.match(html, /PDF 第8–9页/);
  assert.match(html, /data-rich-image data-rich-alt="第1题&quot;原图"/);
  assert.match(html, /href="assets\/images\/courses\/wy27\/q001.png"/);
  assert.match(html, /查看原题/); assert.doesNotMatch(html, /<img[^>]+q001\.png|javascript:alert|unsafe/);
  assert.doesNotMatch(html, /PRIVATE_SOLUTION/);
});

test("an unverified problem can be submitted and revisited without being labeled right or wrong", async () => {
  const lesson = clone(fixtureLessons[0]);
  Object.assign(lesson.cards[1].question, {grading: "unverified", sourceAnswer: {answer: "B"}, sourceIssue: "原页比例空缺"});
  const h = harness({hash: questionHash, resources: {"data/courses/lessons/lesson-one.json": lesson}});
  await h.settle(); await h.answer("B"); await h.action("next");
  assert.equal(h.location.hash, questionHash);
  assert.match(h.text(), /本题条件待核，不计分/); assert.match(h.text(), /来源参考 B/);
  assert.doesNotMatch(h.text(), /答对了！|正确答案|一起看看这道题/);
  h.runTimers(); assert.equal(h.course().groups["group-one"].answers["q-one"].status, "ungraded");
  await h.navigate(firstHash); await h.navigate(explanationHash);
  assert.match(h.text(), /本题条件待核，不计分/);
});

test("Next submits in place, locks the submitted answer, and skips the former analysis page in both directions", async () => {
  const h = harness(); await h.settle();
  await h.action("next"); assert.equal(h.location.hash, questionHash);
  await h.answer("A"); await h.action("next");
  assert.equal(h.location.hash, questionHash);
  assert.match(h.text(), /PRIVATE_SOLUTION/);
  assert.match(h.text(), /我们的答案 A/);
  assert.match(h.text(), /正确答案 B/);
  h.window.LearningApp.flush();
  const submittedAt = h.course().groups["group-one"].answers["q-one"].submittedAt;
  assert.match(h.text(), /value="A" checked disabled/);
  assert.match(h.text(), /study-question-layout is-submitted/);
  assert.match(h.text(), /study-question-pane[^>]*tabindex="0"[^>]*aria-label="题目"/);
  assert.match(h.text(), /study-explanation-pane[^>]*tabindex="0"[^>]*aria-label="解析"/);
  await h.action("previous"); assert.equal(h.location.hash, firstHash);
  await h.action("next"); assert.equal(h.location.hash, questionHash);
  assert.match(h.text(), /value="A" checked disabled/);
  h.window.LearningApp.flush();
  assert.equal(h.course().groups["group-one"].answers["q-one"].submittedAt, submittedAt);
  await h.action("next"); assert.equal(h.location.hash, nextLessonHash);
  assert.match(h.text(), /下一知识点正文/);
  await h.action("previous"); assert.equal(h.location.hash, questionHash);
  assert.match(h.text(), /PRIVATE_SOLUTION/);
  await h.action("next"); assert.equal(h.location.hash, nextLessonHash);
  await h.action("next");
  assert.match(h.text(), /这一关，学会了/);
  assert.equal(Object.keys(h.course().groups["group-one"].completed).length, 4);
});

test("all original analysis parts display together after one submit and never reveal the next question's analysis", async () => {
  const lesson = clone(fixtureLessons[0]);
  lesson.cards.push({id: "explanation-one-more", type: "text", role: "explanation", questionId: "q-one", title: "补充方法",
    blocks: [{type: "paragraph", text: "SECOND_SOLUTION_PART"}, {type: "formula", latex: "x_1=2"}]});
  lesson.cards.push({id: "question-two", type: "question", title: "第二例题", question: {id: "q-two", type: "single", stem: "SECOND_QUESTION", answer: "A", options: [{value: "A", label: "一"}, {value: "B", label: "二"}]}});
  lesson.cards.push({id: "explanation-two", type: "text", role: "explanation", questionId: "q-two", title: "下一题解析", blocks: [{type: "paragraph", text: "FUTURE_PRIVATE_SOLUTION"}]});
  const h = harness({hash: questionHash, resources: resourcesForLesson(lesson)}); await h.settle();
  assert.doesNotMatch(h.text(), /PRIVATE_SOLUTION|SECOND_SOLUTION_PART|FUTURE_PRIVATE_SOLUTION/);
  assert.doesNotMatch(h.text(), /data-learn-jump="(?:2|3|5)"/);
  await h.answer("A"); await h.action("next");
  assert.equal(h.location.hash, questionHash);
  const html = h.text();
  assert.ok(html.indexOf("PRIVATE_SOLUTION") < html.indexOf("SECOND_SOLUTION_PART"));
  assert.match(html, /data-learn-explanation-id="explanation-one"/);
  assert.match(html, /data-learn-explanation-id="explanation-one-more"/);
  assert.doesNotMatch(html, /FUTURE_PRIVATE_SOLUTION/);
  await h.answer("B"); h.window.LearningApp.flush();
  const rec = h.course().groups["group-one"];
  assert.equal(rec.answers["q-one"].answer, "A", "readonly input events cannot alter the submission");
  assert.deepEqual(Object.keys(rec.completed).sort(), ["explanation-one", "explanation-one-more", "question-one"]);
  await h.action("next");
  assert.equal(h.location.hash, "#/learn/language/group-one/lesson-one?card=4");
  assert.match(h.text(), /SECOND_QUESTION/);
  assert.doesNotMatch(h.text(), /FUTURE_PRIVATE_SOLUTION|study-question-layout is-submitted/);
  await h.action("previous"); assert.equal(h.location.hash, questionHash);
  assert.match(h.text(), /SECOND_SOLUTION_PART/);
});

test("submission preserves current reading scroll and never focuses or scrolls into the analysis pane", async () => {
  const h = harness({hash: questionHash}); await h.settle();
  h.root.querySelector(".learn-stage").scrollTop = 420;
  h.root.querySelector(".study-question-pane").scrollTop = 110;
  h.document.activeElement = {closest: () => ({dataset: {learnAction: "next"}})};
  const transitions = [];
  h.window.PageTransitions = {enter(_root, settings) { transitions.push(settings); }};
  await h.answer("B"); await h.action("next");
  assert.equal(h.location.hash, questionHash);
  assert.equal(h.root.querySelector(".learn-stage").scrollTop, 420);
  assert.equal(h.root.querySelector(".study-question-pane").scrollTop, 110);
  assert.equal(h.root.querySelector(".study-explanation-pane").focused, undefined);
  assert.deepEqual(transitions, []);
  const next = h.root.querySelector('[data-learn-action="next"]');
  assert.equal(next.focused, true); assert.equal(next.focusOptions.preventScroll, true);
  assert.match(h.text(), /data-learn-action="previous" aria-label="上一页"/);
});

test("horizontal scrolling of formulas and tables does not flip a submitted learning question", async () => {
  const h = harness({hash: questionHash}); await h.settle(); await h.answer("B"); await h.action("next");
  for (const container of [".rich-content__math--display", ".rich-content__table-scroll"]) {
    h.root.dispatchEvent({type: "touchstart", touches: [{clientX: 300, clientY: 100}], target: {closest: selector => selector.includes(container) ? {} : null}});
    h.root.dispatchEvent({type: "touchend", changedTouches: [{clientX: 50, clientY: 100}]});
    await h.settle(); assert.equal(h.location.hash, questionHash);
  }
  h.root.dispatchEvent({type: "touchstart", touches: [{clientX: 300, clientY: 100}], target: {closest: () => null}});
  h.root.dispatchEvent({type: "touchend", changedTouches: [{clientX: 50, clientY: 100}]});
  await h.settle(); assert.equal(h.location.hash, nextLessonHash);
});

test("arrow keys focused in scrollable formulas and tables remain native scrolling rather than question navigation", async () => {
  const h = harness({hash: questionHash}); await h.settle(); await h.answer("B"); await h.action("next");
  for (const container of [".rich-content__math--display", ".rich-content__table-scroll"]) {
    for (const key of ["ArrowLeft", "ArrowRight"]) {
      let prevented = false;
      h.document.dispatchEvent({type: "keydown", key, target: {closest: selector => selector.includes(container) ? {} : null}, preventDefault() { prevented = true; }});
      await h.settle();
      assert.equal(prevented, false); assert.equal(h.location.hash, questionHash);
    }
  }
  let prevented = false;
  h.document.dispatchEvent({type: "keydown", key: "ArrowRight", target: {closest: () => null}, preventDefault() { prevented = true; }});
  await h.settle();
  assert.equal(prevented, true); assert.equal(h.location.hash, nextLessonHash);
});

test("resuming a legacy explanation restores the actual submitted answer rather than its newer unsubmitted draft", async () => {
  const stored = {version: 1, updatedAt: 200, groups: {"group-one": {
    ...Core.createRecord(), lastCardId: "explanation-one", updatedAt: 200,
    completed: {"knowledge-one": 50, "question-one": 100},
    answers: {"q-one": {answer: "A", status: "incorrect", submittedAt: 100}},
    drafts: {"q-one": {value: "B", updatedAt: 200}}
  }}};
  const h = harness({hash: "#/learn", storage: {[COURSE_KEY]: JSON.stringify(stored)}}); await h.settle();
  await h.action(null, {learnResume: "group-one"});
  assert.equal(h.location.hash, questionHash); assert.match(h.text(), /PRIVATE_SOLUTION/);
  assert.match(h.text(), /value="A" checked disabled/); assert.doesNotMatch(h.text(), /value="B" checked/);
  h.window.LearningApp.flush();
  const rec = h.course().groups["group-one"];
  assert.equal(rec.lastCardId, "question-one"); assert.equal(rec.answers["q-one"].submittedAt, 100);
  assert.equal(rec.drafts["q-one"].value, "B", "historical draft may survive, but cannot become the displayed answer");
  assert.ok(rec.completed["explanation-one"]);
});

test("legacy completion flags and drafts cannot reveal answers or deadlock Continue unfinished", async () => {
  const stored = {version: 1, updatedAt: 200, groups: {"group-one": {
    ...Core.createRecord(), lastCardId: "explanation-one", updatedAt: 200,
    completed: {"knowledge-one": 100, "question-one": 100, "explanation-one": 100, "knowledge-two": 100},
    drafts: {"q-one": {value: "B", updatedAt: 200}}
  }}};
  const h = harness({hash: explanationHash, storage: {[COURSE_KEY]: JSON.stringify(stored)}}); await h.settle();
  assert.equal(h.location.hash, questionHash); assert.doesNotMatch(h.text(), /PRIVATE_SOLUTION/);
  await h.navigate(nextLessonHash); await h.action("next");
  assert.match(h.text(), /这一轮学习结束/);
  await h.action("unfinished");
  assert.equal(h.location.hash, questionHash); assert.doesNotMatch(h.text(), /PRIVATE_SOLUTION/);
  assert.match(h.text(), /提交答案/);
});

test("quick jumps cannot expose unsubmitted analysis or inflate completed progress", async () => {
  const h = harness(); await h.settle();
  await h.action(null, { learnJump: "2" });
  assert.equal(h.location.hash, questionHash);
  assert.doesNotMatch(h.text(), /PRIVATE_SOLUTION/);
  await h.action(null, { learnJump: "3" });
  assert.equal(h.location.hash, nextLessonHash);
  h.window.LearningApp.flush();
  assert.equal(Object.keys(h.course().groups["group-one"].completed).length, 0);
  await h.action("next");
  assert.match(h.text(), /这一轮学习结束/);
  assert.equal(Object.keys(h.course().groups["group-one"].completed).length, 1);
  await h.action("unfinished");
  assert.equal(h.location.hash, firstHash);
});

test("history restores the question with inline analysis and old analysis links canonicalize to the question", async () => {
  const h = harness(); await h.settle(); await h.action("next"); await h.answer("B"); await h.action("next");
  assert.equal(h.location.hash, questionHash);
  await h.action("next"); assert.equal(h.location.hash, nextLessonHash);
  h.history.go(-1); await h.settle();
  assert.equal(h.location.hash, questionHash);
  assert.match(h.text(), /value="B" checked/);
  h.history.go(1); await h.settle();
  assert.equal(h.location.hash, nextLessonHash);
  assert.match(h.text(), /下一知识点正文/);
  h.window.LearningApp.flush();
  const refreshed = harness({ hash: explanationHash, storage: { [COURSE_KEY]: h.localStorage.getItem(COURSE_KEY) } });
  await refreshed.settle();
  assert.equal(refreshed.location.hash, questionHash);
  assert.match(refreshed.text(), /PRIVATE_SOLUTION/);
  assert.match(refreshed.text(), /答对了/);
});

test("canceling an in-flight course load allows the identical deep link to be opened again", async () => {
  const request = deferred();
  const h = harness({ fetch: { "data/courses/lessons/lesson-one.json": request.promise } });
  await h.settle();
  assert.match(h.text(), /正在打开课程/);
  await h.navigate("#/study");
  request.resolve(response(fixtureLessons[0])); await h.settle();
  assert.equal(h.location.hash, "#/study");
  assert.match(h.text(), /drill-subject-list/);
  await h.navigate(firstHash);
  assert.equal(h.location.hash, firstHash);
  assert.match(h.text(), /认识题型/);
});

test("an old resume request cannot pull the user back after switching to practice", async () => {
  const request = deferred();
  const stored = { version: 1, updatedAt: 10, groups: { "group-one": { ...Core.createRecord(), lastCardId: "knowledge-one", updatedAt: 10 } } };
  const h = harness({ hash: "#/learn", storage: { [COURSE_KEY]: JSON.stringify(stored) }, fetch: { "data/courses/lessons/lesson-one.json": request.promise } });
  await h.settle();
  assert.match(h.text(), /继续学习/);
  await h.action(null, { learnResume: "group-one" });
  await h.navigate("#/study");
  request.resolve(response(fixtureLessons[0])); await h.settle();
  assert.equal(h.location.hash, "#/study");
  assert.match(h.text(), /drill-subject-list/);
});

test("a late question-bank manifest failure cannot overwrite a newly opened learning session", async () => {
  const request = deferred();
  const h = harness({ hash: "#/study", fetch: { "data/question-bank/manifest.json": request.promise } });
  await h.navigate(firstHash);
  assert.match(h.text(), /认识题型/);
  request.reject(new Error("late legacy failure")); await h.settle();
  assert.equal(h.location.hash, firstHash);
  assert.match(h.text(), /认识题型/);
  assert.doesNotMatch(h.text(), /late legacy failure/);
});

test("storage refresh merges a newer submission without a write/re-render feedback loop", async () => {
  const h = harness({ hash: questionHash }); await h.settle(); await h.answer("A"); h.window.LearningApp.flush();
  const remote = h.course();
  remote.updatedAt = 9000; remote.groups["group-one"].updatedAt = 9000;
  remote.groups["group-one"].answers["q-one"] = { answer: "B", status: "correct", submittedAt: 8000 };
  remote.groups["group-one"].completed["question-one"] = 8000;
  remote.groups["group-one"].drafts["q-one"] = { value: "A", updatedAt: 8500 };
  h.localStorage.setItem(COURSE_KEY, JSON.stringify(remote));
  const before = h.writes.length;
  h.window.dispatchEvent({ type: "storage", key: COURSE_KEY }); await h.settle(); h.runTimers();
  assert.equal(h.writes.length, before + 1, "showing the restored answer completes its original analysis card once");
  const after = h.writes.length;
  h.window.dispatchEvent({ type: "storage", key: COURSE_KEY }); await h.settle(); h.runTimers();
  assert.equal(h.writes.length, after, "repeated storage notification must not cause a write/render feedback loop");
  await h.navigate(explanationHash);
  assert.match(h.text(), /我们的答案 B/);
  assert.doesNotMatch(h.text(), /我们的答案 A/);
});

test("the catalog derives completed knowledge points from actual card IDs after exiting a session", async () => {
  const h = harness(); await h.settle(); await h.action("next"); await h.answer("B"); await h.action("next"); await h.action("next"); await h.action("exit");
  assert.match(h.text(), /1 \/ 2 知识点/);
  assert.match(h.text(), /is-complete/);
});

test("storage events during a new group load cannot redraw an old card under the new URL", async () => {
  const request = deferred(), manifest = clone(fixtureManifest);
  const next = { id: "lesson-three", subjectId: "language", groupId: "group-two", title: "第三知识点", cards: [
    { id: "knowledge-three", type: "text", role: "knowledge", title: "新分组", blocks: [{ type: "paragraph", text: "NEW_GROUP_CONTENT" }] }
  ] };
  manifest.subjects[0].groups.push({ id: "group-two", title: "第二组", lessons: [{
    id: next.id, title: next.title, path: "data/courses/lessons/lesson-three.json", cardCount: 1, questionCount: 0,
    cardIds: ["knowledge-three"], questionIds: []
  }] });
  const h = harness({ resources: { "data/courses/manifest.json": manifest }, fetch: { "data/courses/lessons/lesson-three.json": request.promise } });
  await h.settle(); assert.match(h.text(), /认识题型/);
  const target = "#/learn/language/group-two/lesson-three?card=0";
  await h.navigate(target); assert.match(h.text(), /正在打开课程/);
  h.window.dispatchEvent({ type: "storage", key: COURSE_KEY }); await h.settle();
  assert.match(h.text(), /正在打开课程/);
  assert.doesNotMatch(h.text(), /认识题型/);
  await h.action("next");
  assert.equal(h.location.hash, target);
  request.resolve(response(next)); await h.settle();
  assert.match(h.text(), /NEW_GROUP_CONTENT/);
});
