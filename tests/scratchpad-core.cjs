"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../assets/js/scratchpad-core.js");

function storage(initial) {
  const data = new Map(initial ? [[Core.STORAGE_KEY, initial]] : []);
  let writes = 0, fail = false;
  return {
    getItem: key => data.get(key) ?? null,
    setItem(key, value) { if (fail) throw new Error("QuotaExceededError"); writes++; data.set(key, String(value)); },
    removeItem: key => data.delete(key),
    get writes() { return writes; },
    set fail(value) { fail = value; }
  };
}
const store = localStorage => Core.createStore({ indexedDB: null, localStorage });
const draft = (id = "draft-one", now = 100) => Core.createDraft({ id, title: "草稿 1", now });
const stroke = () => ({ id: "stroke-one", color: "#315f42", width: 4, points: [{ x: -100, y: 20, pressure: .2 }, { x: 100, y: 20, pressure: .9 }] });
const copy = value => JSON.parse(JSON.stringify(value));

test("new documents have independent identities, viewports and ink", () => {
  const first = Core.createDraft();
  first.strokes.push(stroke()); first.viewport.x = 400;
  const second = Core.createDraft();
  assert.notEqual(first.id, second.id);
  assert.deepEqual(second.strokes, []);
  assert.deepEqual(second.viewport, { x: 0, y: 0, scale: 1 });
  assert.equal(first.strokes.length, 1);
  assert.throws(() => Core.createDraft({ id: "__proto__" }), TypeError);
  assert.throws(() => Core.createDraft({ title: " " }), TypeError);
});

test("screen/world positions round-trip across all four quadrants", () => {
  const viewport = { x: -187, y: 251, scale: 1.5 };
  for (const point of [{ x: 0, y: 0 }, { x: -900, y: 400 }, { x: 500, y: -300 }, { x: -150, y: -40 }]) {
    assert.deepEqual(Core.screenToWorld(Core.worldToScreen(point, viewport), viewport), point);
  }
});

test("zoom anchors stay under the same screen point and clamp at supported scales", () => {
  const viewport = { x: -280, y: 185, scale: 2 }, anchor = { x: 200, y: 300 };
  const before = Core.screenToWorld(anchor, viewport);
  const zoomed = Core.zoomAt(viewport, 1.7, anchor);
  assert.deepEqual(Core.screenToWorld(anchor, zoomed), before);
  assert.equal(Core.zoomAt(viewport, 1000, anchor).scale, 8);
  assert.equal(Core.zoomAt(viewport, .00001, anchor).scale, .1);
  assert.throws(() => Core.zoomAt(viewport, -1, anchor), TypeError);
});

test("ink bounds include stroke width and erasure hits between distant samples", () => {
  const ink = stroke();
  assert.deepEqual(Core.strokeBounds(ink), { minX: -102, minY: 18, maxX: 102, maxY: 22 });
  assert.equal(Core.hitStroke(ink, { x: 0, y: 25 }, 3), true);
  assert.equal(Core.hitStroke(ink, { x: 0, y: 26 }, 3), false);
  assert.equal(Core.hitStroke(ink, { x: 105, y: 20 }, 3), true);
  assert.equal(Core.hitStroke(ink, { x: 110, y: 20 }, 3), false);
  assert.equal(Core.hitStroke({ ...ink, points: [{ x: -20, y: -50 }] }, { x: -20, y: -52 }, 1), true);
});

test("pressure normalization stays finite and validation refuses damaged ink", () => {
  assert.deepEqual(Core.normalizePoint({ x: -4, y: 9 }), { x: -4, y: 9, pressure: .5 });
  assert.equal(Core.normalizePoint({ x: Infinity, y: 0 }), null);
  assert.equal(Core.normalizePoint({ x: 0, y: 0, pressure: 9 }).pressure, 1);
  const original = draft(); original.strokes.push(stroke());
  assert.deepEqual(Core.sanitizeDraft(original), original);
  const clean = Core.sanitizeDraft(original);
  original.strokes[0].points[0].x = 0;
  assert.equal(clean.strokes[0].points[0].x, -100);
  for (const mutate of [
    item => { item.version = 2; },
    item => { item.viewport.scale = -1; },
    item => { item.viewport.x = NaN; },
    item => { item.strokes[0].color = "url(javascript:bad)"; },
    item => { item.strokes[0].width = 0; },
    item => { item.strokes[0].points[0].x = "5"; },
    item => { item.strokes[0].points[0].pressure = Infinity; },
    item => { item.strokes.push(copy(item.strokes[0])); },
    item => { item.updatedAt = 1; },
    item => { item.id = "constructor"; }
  ]) {
    const damaged = copy(clean); mutate(damaged);
    assert.equal(Core.sanitizeDraft(damaged), null);
  }
});

test("fallback storage preserves old drafts, ink and viewport when creating and reopening", async () => {
  const local = storage(), firstStore = store(local), first = draft();
  first.strokes.push(stroke()); first.viewport = { x: -300, y: 120, scale: .7 };
  await firstStore.save(first);
  await firstStore.setActiveId(first.id);
  const second = draft("draft-two", 200);
  await firstStore.saveMany([second], second.id);
  assert.equal(firstStore.backend, "localstorage");
  const reopened = store(local);
  assert.equal(await reopened.getActiveId(), second.id);
  assert.deepEqual(await reopened.get(first.id), first);
  assert.deepEqual(await reopened.get(second.id), second);
  assert.deepEqual((await reopened.list()).map(item => [item.id, item.strokeCount]), [[second.id, 0], [first.id, 1]]);
  assert.equal(await reopened.get("missing"), null);
});

test("queued writes capture immutable snapshots and retain independent documents", async () => {
  const local = storage(), repository = store(local), first = draft();
  first.strokes.push(stroke());
  const one = repository.save(first);
  first.strokes[0].points[0].x = 999;
  const two = repository.save(draft("draft-two", 200));
  await Promise.all([one, two]);
  assert.equal((await repository.get(first.id)).strokes[0].points[0].x, -100);
  assert.equal((await repository.list()).length, 2);
});

test("batch saving uses one fallback write, merges documents and atomically switches active draft", async () => {
  const local = storage(), repository = store(local);
  await repository.saveMany([draft()], "draft-one");
  const updated = draft(); updated.updatedAt = 300; updated.strokes.push(stroke());
  const before = local.writes;
  await repository.saveMany([updated, draft("draft-two", 200)], "draft-two");
  assert.equal(local.writes - before, 1);
  assert.equal(await repository.getActiveId(), "draft-two");
  assert.equal((await repository.get("draft-one")).strokes.length, 1);
});

test("quota failure rejects without losing previous draft or selected document and can be retried", async () => {
  const local = storage(), repository = store(local);
  const first = draft();
  await repository.saveMany([first], first.id);
  local.fail = true;
  await assert.rejects(repository.saveMany([draft("draft-two", 200)], "draft-two"), /存储空间|保存/);
  assert.deepEqual(await repository.get(first.id), first);
  assert.equal(await repository.getActiveId(), first.id);
  assert.equal((await repository.list()).length, 1);
  local.fail = false;
  await repository.saveMany([draft("draft-two", 200)], "draft-two");
  assert.equal((await repository.list()).length, 2);
});

test("invalid writes, duplicate IDs and unknown active document leave saved content untouched", async () => {
  const local = storage(), repository = store(local);
  await repository.saveMany([draft()], "draft-one");
  const before = local.getItem(Core.STORAGE_KEY);
  const bad = draft(); bad.viewport.scale = 0;
  await assert.rejects(repository.save(bad), TypeError);
  await assert.rejects(repository.saveMany([draft(), draft()]), TypeError);
  await assert.rejects(repository.setActiveId("missing"), /不存在/);
  assert.equal(local.getItem(Core.STORAGE_KEY), before);
});

test("damaged saved JSON is never silently replaced with an empty collection", async () => {
  for (const raw of ["{damaged", JSON.stringify({ version: 7, activeId: null, drafts: [] }), JSON.stringify({ version: 1, activeId: "missing", drafts: [] })]) {
    const local = storage(raw), repository = store(local);
    await assert.rejects(repository.list(), /损坏/);
    await assert.rejects(repository.save(draft()), /损坏/);
    assert.equal(local.getItem(Core.STORAGE_KEY), raw);
    assert.equal(local.writes, 0);
  }
});

test("unavailable IndexedDB falls back safely and having no durable backend is an explicit failure", async () => {
  const local = storage();
  const repository = Core.createStore({ indexedDB: { open() { throw new Error("SecurityError"); } }, localStorage: local });
  await repository.save(draft());
  assert.equal(repository.backend, "localstorage");
  assert.equal((await repository.list()).length, 1);
  const unavailable = Core.createStore({ indexedDB: null, localStorage: null });
  await assert.rejects(unavailable.list(), /存储空间|保存/);
  await assert.rejects(unavailable.save(draft()), /存储空间|保存/);
});
