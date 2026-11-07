"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { create, valid, remaining, act } = require("../assets/js/exam-timer.js");

test("exam blocks share displayed boundaries and exclude paused time", () => {
  const timer = create(2);
  act(timer, "start", 0);
  act(timer, "mark", 10490);
  assert.equal(act(timer, "mark", 10499), false);
  act(timer, "pause", 20350);
  assert.equal(remaining(timer, 80000), 99650);
  const restored = JSON.parse(JSON.stringify(timer));
  assert.ok(valid(restored));
  act(restored, "start", 80000);
  act(restored, "mark", 90651);
  assert.deepEqual(restored.marks, [110, 89]);
  act(restored, "tick", 200000);
  assert.equal(restored.status, "finished");
  assert.deepEqual(restored.marks, [110, 89, 0]);
  assert.equal(act(restored, "tick", 200001), false);
});

test("a click at the deadline closes the final block exactly once", () => {
  for (const action of ["mark", "pause"]) {
    const timer = create(1);
    act(timer, "start", 0);
    act(timer, action, 60000);
    assert.deepEqual(timer.marks, [0]);
    assert.equal(timer.status, "finished");
  }
});

test("ending early closes only unrecorded time", () => {
  const timer = create(1);
  act(timer, "start", 0);
  act(timer, "mark", 15001);
  act(timer, "pause", 15100);
  act(timer, "finish", 200000);
  assert.deepEqual(timer.marks, [45]);
  assert.equal(timer.remainingMs, 44900);
  assert.ok(valid(timer));
  assert.equal(valid({ ...timer, marks: [45, 48] }), false);
});
