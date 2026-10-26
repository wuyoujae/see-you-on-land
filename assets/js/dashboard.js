/* Exam dates are maintained separately from the learning and practice modules. */
(() => {
  "use strict";
  let exams = [];

  function render() {
    const now = new Date();
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    for (const exam of exams) {
      const target = document.getElementById(`${exam.id}-exam-countdown`);
      if (!target) continue;
      const [year, month, day] = exam.date.split("-").map(Number);
      const remaining = Math.max(0, Math.round((Date.UTC(year, month - 1, day) - today) / 86400000));
      target.textContent = String(remaining);
      target.setAttribute("aria-label", `${exam.name}${exam.status === "estimated" ? "预计" : ""}笔试还有${remaining}天`);
      document.getElementById(`${exam.id}-exam-date`).textContent = exam.dateLabel;
      document.getElementById(`${exam.id}-exam-status`).textContent = exam.statusLabel;
      document.getElementById(`${exam.id}-exam-source`).href = exam.sourceUrl;
    }
  }

  fetch("data/exams.json", { cache: "no-cache" })
    .then(response => {
      if (!response.ok) throw new Error("考试日程加载失败");
      return response.json();
    })
    .then(data => { exams = data.exams; render(); })
    .catch(() => {
      document.querySelectorAll(".exam-countdown-value").forEach(value => {
        value.querySelector("strong").textContent = "—";
        value.setAttribute("aria-label", "考试日程加载失败，请刷新页面");
      });
    });

  window.addEventListener("summer-politics:daychange", render);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) render(); });
})();
