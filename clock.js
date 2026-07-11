(() => {
  "use strict";

  const SESSION_KEY = "summer-politics-study-sessions-v1";
  const ACTIVE_KEY = "summer-politics-active-study-v1";
  const CLOCK_FORMAT_KEY = "summer-politics-clock-seconds-v1";
  const DAY_MS = 86400000;

  let sessions = loadJSON(SESSION_KEY, []);
  let activeSession = loadJSON(ACTIVE_KEY, null);
  let showSeconds = localStorage.getItem(CLOCK_FORMAT_KEY) === "true";
  let selectedDate = dayKey(Date.now());
  let statsRange = "day";

  const dom = {
    clockMain: document.getElementById("clock-main-panel"),
    statsPanel: document.getElementById("clock-stats-panel"),
    timeline: document.getElementById("study-timeline"),
    liveClock: document.getElementById("live-clock"),
    activeElapsed: document.getElementById("active-elapsed"),
    timerActions: document.getElementById("timer-actions"),
    recordDateLabel: document.getElementById("record-date-label"),
    recordDayTotal: document.getElementById("record-day-total"),
    recordList: document.getElementById("study-record-list"),
    statsPeriod: document.getElementById("stats-period"),
    statsSummary: document.getElementById("stats-summary"),
    chart: document.getElementById("study-bar-chart"),
    chartTotal: document.getElementById("chart-total"),
    peakTitle: document.getElementById("peak-title"),
    peakDetail: document.getElementById("peak-detail"),
    modal: document.getElementById("timer-edit-modal"),
    editForm: document.getElementById("timer-edit-form"),
    editId: document.getElementById("edit-record-id"),
    editStart: document.getElementById("edit-record-start"),
    editEnd: document.getElementById("edit-record-end"),
    editMinutes: document.getElementById("edit-record-minutes"),
    formError: document.getElementById("timer-form-error")
  };

  function loadJSON(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function saveSessions() {
    localStorage.setItem(SESSION_KEY, JSON.stringify(sessions));
  }

  function saveActive() {
    if (activeSession) localStorage.setItem(ACTIVE_KEY, JSON.stringify(activeSession));
    else localStorage.removeItem(ACTIVE_KEY);
  }

  function refreshIcons() {
    if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 2 } });
  }

  function escapeHTML(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function dayKey(value) {
    const date = new Date(value);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function parseDay(value) {
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function shortDate(value) {
    const date = parseDay(value);
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }

  function dateLabel(value) {
    const date = parseDay(value);
    const weekday = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][date.getDay()];
    return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 · ${weekday}`;
  }

  function timeLabel(value, withDate = false) {
    const date = new Date(value);
    const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    return withDate ? `${date.getMonth() + 1}/${date.getDate()} ${time}` : time;
  }

  function inputDateTime(value) {
    const date = new Date(value);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function formatDuration(milliseconds) {
    const totalMinutes = Math.max(1, Math.round(milliseconds / 60000));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (!hours) return `${totalMinutes}分钟`;
    return minutes ? `${hours}小时${minutes}分钟` : `${hours}小时`;
  }

  function stopwatch(milliseconds) {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor(totalSeconds % 3600 / 60);
    const seconds = totalSeconds % 60;
    return hours ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
  }

  function elapsedNow() {
    if (!activeSession) return 0;
    const running = activeSession.status === "running" ? Date.now() - activeSession.resumedAt : 0;
    return Math.max(0, activeSession.accumulatedMs + running);
  }

  function sessionsForDay(value) {
    return sessions.filter(item => dayKey(item.start) === value);
  }

  function timelineDates() {
    const today = parseDay(dayKey(Date.now()));
    let start = new Date(today.getFullYear(), today.getMonth(), 1);
    if (sessions.length) {
      const earliest = new Date(Math.min(...sessions.map(item => item.start)));
      const earliestDay = new Date(earliest.getFullYear(), earliest.getMonth(), earliest.getDate());
      if (earliestDay < start && today - earliestDay <= DAY_MS * 90) start = earliestDay;
    }
    const result = [];
    for (let cursor = new Date(start); cursor <= today; cursor.setDate(cursor.getDate() + 1)) {
      result.push(dayKey(cursor));
    }
    return result;
  }

  function renderTimeline() {
    const week = ["日", "一", "二", "三", "四", "五", "六"];
    dom.timeline.innerHTML = timelineDates().map(value => {
      const date = parseDay(value);
      const hasRecords = sessionsForDay(value).length > 0;
      return `
        <button type="button" class="study-day-node ${hasRecords ? "has-records" : ""} ${value === selectedDate ? "active" : ""}" data-study-date="${value}" aria-label="查看${escapeHTML(shortDate(value))}学习记录">
          <span class="study-day-week">周${week[date.getDay()]}</span>
          <span class="study-day-dot" aria-hidden="true"></span>
          <span class="study-day-date">${date.getMonth() + 1}/${date.getDate()}</span>
        </button>`;
    }).join("");
    requestAnimationFrame(() => {
      dom.timeline.querySelector(".study-day-node.active")?.scrollIntoView({ behavior: "auto", block: "nearest", inline: "center" });
    });
  }

  function renderRecords() {
    const records = sessionsForDay(selectedDate).sort((a, b) => b.start - a.start);
    const total = records.reduce((sum, item) => sum + item.durationMs, 0);
    dom.recordDateLabel.textContent = selectedDate === dayKey(Date.now()) ? `今日 · ${shortDate(selectedDate)}` : dateLabel(selectedDate);
    dom.recordDayTotal.textContent = records.length ? formatDuration(total) : "0分钟";
    if (!records.length) {
      dom.recordList.innerHTML = '<div class="clock-empty">这一天还没有学习记录<br>点击上方“开始学习”记录第一段专注时间</div>';
      return;
    }
    dom.recordList.innerHTML = records.map(item => {
      const crossesDay = dayKey(item.start) !== dayKey(item.end);
      return `
        <article class="study-record">
          <div>
            <h3 class="record-duration">学习了 ${escapeHTML(formatDuration(item.durationMs))}</h3>
            <p class="record-time-range">${escapeHTML(timeLabel(item.start))} - ${escapeHTML(timeLabel(item.end, crossesDay))}</p>
          </div>
          <button type="button" class="icon-button edit-record-button" data-edit-record="${escapeHTML(item.id)}" title="编辑记录" aria-label="编辑${escapeHTML(timeLabel(item.start))}开始的学习记录"><i data-lucide="pencil" aria-hidden="true"></i></button>
        </article>`;
    }).join("");
    refreshIcons();
  }

  function renderTimerControls() {
    if (!activeSession) {
      dom.activeElapsed.hidden = true;
      dom.timerActions.innerHTML = '<button type="button" class="study-start-button" id="start-study"><i data-lucide="play" aria-hidden="true"></i><span>开始学习！</span></button>';
    } else {
      dom.activeElapsed.hidden = false;
      const paused = activeSession.status === "paused";
      dom.timerActions.innerHTML = `
        <button type="button" class="pause-study-button" data-timer-action="${paused ? "resume" : "pause"}"><i data-lucide="${paused ? "play" : "pause"}" aria-hidden="true"></i><span>${paused ? "继续学习" : "暂停学习"}</span></button>
        <button type="button" class="stop-study-button" data-timer-action="stop"><i data-lucide="square" aria-hidden="true"></i><span>终止学习</span></button>`;
      dom.activeElapsed.textContent = `${paused ? "已暂停" : "本次学习"} ${stopwatch(elapsedNow())}`;
    }
    refreshIcons();
  }

  function startStudy() {
    if (activeSession) return;
    const now = Date.now();
    activeSession = { id: `active-${now}`, startedAt: now, resumedAt: now, accumulatedMs: 0, status: "running" };
    selectedDate = dayKey(now);
    saveActive();
    renderTimeline();
    renderTimerControls();
    renderRecords();
  }

  function pauseStudy() {
    if (!activeSession || activeSession.status !== "running") return;
    activeSession.accumulatedMs = elapsedNow();
    activeSession.status = "paused";
    activeSession.resumedAt = null;
    saveActive();
    renderTimerControls();
  }

  function resumeStudy() {
    if (!activeSession || activeSession.status !== "paused") return;
    activeSession.resumedAt = Date.now();
    activeSession.status = "running";
    saveActive();
    renderTimerControls();
  }

  function stopStudy() {
    if (!activeSession) return;
    const end = Date.now();
    const durationMs = elapsedNow();
    sessions.push({ id: `study-${end}-${Math.random().toString(36).slice(2, 7)}`, start: activeSession.startedAt, end, durationMs });
    selectedDate = dayKey(activeSession.startedAt);
    activeSession = null;
    saveActive();
    saveSessions();
    renderTimerControls();
    renderTimeline();
    renderRecords();
    renderStats();
  }

  function updateClock() {
    const now = new Date();
    dom.liveClock.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}${showSeconds ? `:${pad(now.getSeconds())}` : ""}`;
    if (activeSession) dom.activeElapsed.textContent = `${activeSession.status === "paused" ? "已暂停" : "本次学习"} ${stopwatch(elapsedNow())}`;
  }

  function openEdit(recordId) {
    const record = sessions.find(item => item.id === recordId);
    if (!record) return;
    dom.editId.value = record.id;
    dom.editStart.value = inputDateTime(record.start);
    dom.editEnd.value = inputDateTime(record.end);
    dom.editMinutes.value = Math.max(1, Math.round(record.durationMs / 60000));
    dom.formError.textContent = "";
    dom.modal.hidden = false;
    requestAnimationFrame(() => dom.editStart.focus());
  }

  function closeEdit() {
    dom.modal.hidden = true;
    dom.formError.textContent = "";
  }

  function saveEdit(event) {
    event.preventDefault();
    const record = sessions.find(item => item.id === dom.editId.value);
    const start = new Date(dom.editStart.value).getTime();
    const end = new Date(dom.editEnd.value).getTime();
    const minutes = Number(dom.editMinutes.value);
    if (!record || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || !Number.isFinite(minutes) || minutes < 1) {
      dom.formError.textContent = "请检查开始时间、结束时间和有效学习分钟。";
      return;
    }
    record.start = start;
    record.end = end;
    record.durationMs = minutes * 60000;
    selectedDate = dayKey(start);
    saveSessions();
    closeEdit();
    renderTimeline();
    renderRecords();
    renderStats();
  }

  function deleteRecord() {
    const record = sessions.find(item => item.id === dom.editId.value);
    if (!record || !window.confirm("确定删除这条学习记录吗？")) return;
    sessions = sessions.filter(item => item.id !== record.id);
    saveSessions();
    closeEdit();
    renderTimeline();
    renderRecords();
    renderStats();
  }

  function periodData() {
    const focus = parseDay(selectedDate);
    let start;
    let end;
    let label;
    let bars;
    if (statsRange === "week") {
      start = new Date(focus);
      start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
      end = new Date(start);
      end.setDate(end.getDate() + 7);
      label = `${shortDate(dayKey(start))} - ${shortDate(dayKey(new Date(end.getTime() - DAY_MS)))}`;
      bars = Array.from({ length: 7 }, (_, index) => {
        const date = new Date(start);
        date.setDate(date.getDate() + index);
        return { key: dayKey(date), label: ["一", "二", "三", "四", "五", "六", "日"][index], value: 0 };
      });
    } else if (statsRange === "month") {
      start = new Date(focus.getFullYear(), focus.getMonth(), 1);
      end = new Date(focus.getFullYear(), focus.getMonth() + 1, 1);
      label = `${focus.getFullYear()}年${focus.getMonth() + 1}月`;
      const days = new Date(end.getTime() - DAY_MS).getDate();
      bars = Array.from({ length: days }, (_, index) => {
        const date = new Date(start.getFullYear(), start.getMonth(), index + 1);
        return { key: dayKey(date), label: String(index + 1), value: 0 };
      });
    } else {
      start = parseDay(selectedDate);
      end = new Date(start.getTime() + DAY_MS);
      label = dateLabel(selectedDate);
      bars = [
        { key: "0-6", label: "凌晨", value: 0 },
        { key: "6-12", label: "上午", value: 0 },
        { key: "12-18", label: "下午", value: 0 },
        { key: "18-24", label: "晚上", value: 0 }
      ];
    }
    const records = sessions.filter(item => item.start >= start.getTime() && item.start < end.getTime());
    if (statsRange === "day") {
      records.forEach(item => {
        const hour = new Date(item.start).getHours();
        const index = hour < 6 ? 0 : hour < 12 ? 1 : hour < 18 ? 2 : 3;
        bars[index].value += item.durationMs;
      });
    } else {
      const map = new Map(bars.map(item => [item.key, item]));
      records.forEach(item => {
        const bar = map.get(dayKey(item.start));
        if (bar) bar.value += item.durationMs;
      });
    }
    return { start, end, label, bars, records };
  }

  function peakPeriod(records) {
    const buckets = [
      { label: "凌晨 00:00-06:00", value: 0 },
      { label: "上午 06:00-12:00", value: 0 },
      { label: "下午 12:00-18:00", value: 0 },
      { label: "晚上 18:00-24:00", value: 0 }
    ];
    records.forEach(item => {
      const hour = new Date(item.start).getHours();
      const index = hour < 6 ? 0 : hour < 12 ? 1 : hour < 18 ? 2 : 3;
      buckets[index].value += item.durationMs;
    });
    return buckets.sort((a, b) => b.value - a.value)[0];
  }

  function renderStats() {
    const data = periodData();
    const total = data.records.reduce((sum, item) => sum + item.durationMs, 0);
    const average = data.records.length ? total / data.records.length : 0;
    const longest = data.records.length ? Math.max(...data.records.map(item => item.durationMs)) : 0;
    dom.statsPeriod.textContent = data.label;
    dom.statsSummary.innerHTML = `
      <div class="stat-metric"><span>总学习时长</span><strong>${total ? escapeHTML(formatDuration(total)) : "0分钟"}</strong></div>
      <div class="stat-metric"><span>学习次数</span><strong>${data.records.length}次</strong></div>
      <div class="stat-metric"><span>平均单次</span><strong>${average ? escapeHTML(formatDuration(average)) : "0分钟"}</strong></div>
      <div class="stat-metric"><span>最长单次</span><strong>${longest ? escapeHTML(formatDuration(longest)) : "0分钟"}</strong></div>`;
    dom.chartTotal.textContent = total ? `合计 ${formatDuration(total)}` : "暂无记录";
    const max = Math.max(...data.bars.map(item => item.value), 1);
    dom.chart.innerHTML = data.bars.map(item => {
      const height = item.value ? Math.max(4, Math.round(item.value / max * 100)) : 0;
      return `<div class="chart-column ${item.value === max && item.value ? "peak" : ""}" title="${escapeHTML(item.label)}：${item.value ? escapeHTML(formatDuration(item.value)) : "0分钟"}"><div class="chart-bar-track"><span class="chart-bar-fill" style="height:${height}%"></span></div><label>${escapeHTML(item.label)}</label></div>`;
    }).join("");
    const peak = peakPeriod(data.records);
    dom.peakTitle.textContent = peak.value ? peak.label : "暂无数据";
    dom.peakDetail.textContent = peak.value ? `累计学习 ${formatDuration(peak.value)}` : "完成一次学习后生成";
    refreshIcons();
  }

  function showStats() {
    dom.clockMain.hidden = true;
    dom.statsPanel.hidden = false;
    renderStats();
    document.getElementById("view-clock").scrollTo({ top: 0, behavior: "auto" });
  }

  function hideStats() {
    dom.statsPanel.hidden = true;
    dom.clockMain.hidden = false;
    document.getElementById("view-clock").scrollTo({ top: 0, behavior: "auto" });
  }

  dom.liveClock.addEventListener("click", () => {
    showSeconds = !showSeconds;
    localStorage.setItem(CLOCK_FORMAT_KEY, String(showSeconds));
    updateClock();
  });

  dom.timeline.addEventListener("click", event => {
    const button = event.target.closest("button[data-study-date]");
    if (!button) return;
    selectedDate = button.dataset.studyDate;
    renderTimeline();
    renderRecords();
    renderStats();
  });

  dom.timerActions.addEventListener("click", event => {
    if (event.target.closest("#start-study")) startStudy();
    const action = event.target.closest("button[data-timer-action]")?.dataset.timerAction;
    if (action === "pause") pauseStudy();
    if (action === "resume") resumeStudy();
    if (action === "stop") stopStudy();
  });

  dom.recordList.addEventListener("click", event => {
    const button = event.target.closest("button[data-edit-record]");
    if (button) openEdit(button.dataset.editRecord);
  });

  document.getElementById("open-clock-stats").addEventListener("click", showStats);
  document.getElementById("close-clock-stats").addEventListener("click", hideStats);
  document.getElementById("stats-range").addEventListener("click", event => {
    const button = event.target.closest("button[data-range]");
    if (!button) return;
    statsRange = button.dataset.range;
    document.querySelectorAll("#stats-range button").forEach(item => item.classList.toggle("active", item === button));
    renderStats();
  });

  document.querySelectorAll("[data-close-timer-modal]").forEach(button => button.addEventListener("click", closeEdit));
  dom.editForm.addEventListener("submit", saveEdit);
  document.getElementById("delete-study-record").addEventListener("click", deleteRecord);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !dom.modal.hidden) closeEdit();
  });

  if (!Array.isArray(sessions)) sessions = [];
  if (activeSession && (!activeSession.startedAt || !["running", "paused"].includes(activeSession.status))) activeSession = null;
  renderTimeline();
  renderRecords();
  renderTimerControls();
  renderStats();
  updateClock();
  window.setInterval(updateClock, 1000);
})();
