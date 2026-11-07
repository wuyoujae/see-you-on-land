/* Remaining times are stored in milliseconds. Split marks use the whole
   second shown on the dial so adjacent ranges always share a boundary. */
(() => {
  "use strict";

  function create(minutes = 120) {
    return { minutes, status: "idle", remainingMs: minutes * 60000, endsAt: null, marks: [] };
  }

  function valid(timer) {
    if (!timer || !Number.isInteger(timer.minutes) || timer.minutes < 1 || timer.minutes > 1440) return false;
    const total = timer.minutes * 60000;
    return ["idle", "running", "paused", "finished"].includes(timer.status) &&
      Number.isSafeInteger(timer.remainingMs) && timer.remainingMs >= 0 && timer.remainingMs <= total &&
      (timer.status === "running" ? Number.isSafeInteger(timer.endsAt) && timer.endsAt > 0 : timer.endsAt === null) &&
      Array.isArray(timer.marks) && timer.marks.every((mark, i) =>
        Number.isInteger(mark) && mark >= 0 && mark < (i ? timer.marks[i - 1] : total / 1000));
  }

  function remaining(timer, now) {
    if (timer.status !== "running") return timer.remainingMs;
    return Math.max(0, Math.min(timer.remainingMs, timer.endsAt - now));
  }

  function mark(timer, ms) {
    const second = Math.ceil(ms / 1000);
    if (second >= (timer.marks.at(-1) ?? timer.minutes * 60)) return false;
    timer.marks.push(second);
    return true;
  }

  function finish(timer, ms) {
    mark(timer, ms);
    timer.remainingMs = ms;
    timer.endsAt = null;
    timer.status = "finished";
  }

  function act(timer, action, now = Date.now()) {
    const ms = remaining(timer, now);
    if (timer.status === "running" && ms === 0) {
      finish(timer, 0);
    } else if (action === "start" && ["idle", "paused"].includes(timer.status)) {
      timer.endsAt = now + ms;
      timer.status = "running";
    } else if (action === "pause" && timer.status === "running") {
      timer.remainingMs = ms;
      timer.endsAt = null;
      timer.status = "paused";
    } else if (action === "mark" && timer.status === "running") {
      return mark(timer, ms);
    } else if (action === "finish" && timer.status === "paused") {
      finish(timer, ms);
    } else {
      return false;
    }
    return true;
  }

  const api = { create, valid, remaining, act };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.ExamTimer = api;
})();
