(() => {
  "use strict";

  const SESSION_KEY = "summer-politics-study-sessions-v1";
  const ACTIVE_KEY = "summer-politics-active-study-v1";
  const CLOCK_FORMAT_KEY = "summer-politics-clock-seconds-v1";
  const QUESTION_TIMER_KEY = "summer-politics-question-timer-v1";
  const QUESTION_RING_MS = 7000;
  const DAY_MS = 86400000;

  let sessions = loadJSON(SESSION_KEY, []);
  let activeSession = loadJSON(ACTIVE_KEY, null);
  let showSeconds = localStorage.getItem(CLOCK_FORMAT_KEY) === "true";
  let questionTimer = sanitizeQuestionTimer(loadJSON(QUESTION_TIMER_KEY, null));
  let selectedDate = dayKey(Date.now());
  let statsRange = "day";
  let clockMode = "clock";
  let wakeLock = null;
  let wakeLockRequestInFlight = false;
  let wakeLockEpoch = 0;
  let audioContext = null;
  let bellNodes = [];
  let bellPhaseEndAt = null;
  let normalCarouselTimer = null;
  let fullscreenCarouselTimer = null;

  const dom = {
    clockMain: document.getElementById("clock-main-panel"),
    statsPanel: document.getElementById("clock-stats-panel"),
    timeline: document.getElementById("study-timeline"),
    cardCarousel: document.getElementById("clock-card-carousel"),
    fullscreenCarousel: document.getElementById("fullscreen-mode-carousel"),
    liveClock: document.getElementById("live-clock"),
    fullscreenClock: document.getElementById("fullscreen-clock"),
    fullscreenTime: document.getElementById("fullscreen-clock-time"),
    enterFullscreen: document.getElementById("enter-fullscreen-clock"),
    enterQuestionFullscreen: document.getElementById("enter-question-fullscreen"),
    exitFullscreen: document.getElementById("exit-fullscreen-clock"),
    siteFullscreen: document.getElementById("site-fullscreen-toggle"),
    siteFullscreenLabel: document.getElementById("site-fullscreen-label"),
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
    formError: document.getElementById("timer-form-error"),
    questionCount: document.getElementById("question-count"),
    questionMinutes: document.getElementById("question-minutes"),
    questionProgressWrap: document.getElementById("question-progress-wrap"),
    questionProgress: document.getElementById("question-progress-value"),
    questionProgressLabel: document.getElementById("question-progress-label"),
    questionTimeLeft: document.getElementById("question-time-left"),
    questionRoundStatus: document.getElementById("question-round-status"),
    questionStart: document.getElementById("start-question-timer"),
    questionReset: document.getElementById("reset-question-timer"),
    questionPause: document.getElementById("pause-question-timer"),
    fullscreenQuestionProgressWrap: document.getElementById("fullscreen-question-progress"),
    fullscreenQuestionProgress: document.getElementById("fullscreen-question-progress-value"),
    fullscreenQuestionLabel: document.getElementById("fullscreen-question-label"),
    fullscreenQuestionTime: document.getElementById("fullscreen-question-time"),
    fullscreenQuestionStatus: document.getElementById("fullscreen-question-status"),
    fullscreenQuestionRemaining: document.getElementById("fullscreen-question-remaining"),
    fullscreenQuestionReset: document.getElementById("fullscreen-reset-question"),
    fullscreenQuestionPause: document.getElementById("fullscreen-pause-question")
  };

  function loadJSON(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function sanitizeQuestionTimer(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const totalQuestions = clamp(Math.round(Number(source.totalQuestions) || 40), 1, 200);
    const secondsPerQuestion = clamp(Math.round(Number(source.secondsPerQuestion) || 180), 30, 3600);
    const currentQuestion = clamp(Math.round(Number(source.currentQuestion) || 1), 1, totalQuestions);
    const phase = source.phase === "ring" ? "ring" : "question";
    const allowedStatuses = ["idle", "running", "paused", "completed"];
    let status = allowedStatuses.includes(source.status) ? source.status : "idle";
    let phaseEndsAt = Number.isFinite(source.phaseEndsAt) ? source.phaseEndsAt : null;
    const phaseDuration = phase === "ring" ? QUESTION_RING_MS : secondsPerQuestion * 1000;
    let remainingMs = Number.isFinite(source.remainingMs) ? clamp(source.remainingMs, 0, phaseDuration) : phaseDuration;

    if (status === "running" && !phaseEndsAt) status = "paused";
    if (status !== "running") phaseEndsAt = null;
    if (status === "idle") remainingMs = secondsPerQuestion * 1000;
    if (status === "completed") remainingMs = 0;

    return { totalQuestions, secondsPerQuestion, currentQuestion, status, phase, remainingMs, phaseEndsAt };
  }

  function saveSessions() {
    localStorage.setItem(SESSION_KEY, JSON.stringify(sessions));
  }

  function saveActive() {
    if (activeSession) localStorage.setItem(ACTIVE_KEY, JSON.stringify(activeSession));
    else localStorage.removeItem(ACTIVE_KEY);
  }

  function saveQuestionTimer() {
    localStorage.setItem(QUESTION_TIMER_KEY, JSON.stringify(questionTimer));
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

  function questionCountdown(milliseconds) {
    const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${pad(minutes)}:${pad(seconds)}`;
  }

  function questionRemaining(now = Date.now()) {
    if (questionTimer.status === "running") return Math.max(0, questionTimer.phaseEndsAt - now);
    return Math.max(0, questionTimer.remainingMs);
  }

  async function primeQuestionAudio() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!audioContext) audioContext = new AudioContextClass();
    if (audioContext.state === "suspended") await audioContext.resume();
    return audioContext;
  }

  function stopQuestionBell() {
    bellNodes.forEach(node => {
      try { node.stop(); } catch {}
    });
    bellNodes = [];
    bellPhaseEndAt = null;
    try { navigator.vibrate?.(0); } catch {}
  }

  async function playQuestionBell(durationMs, targetEndAt) {
    if (durationMs <= 0 || bellPhaseEndAt === targetEndAt) return;
    stopQuestionBell();
    bellPhaseEndAt = targetEndAt;
    try {
      const context = await primeQuestionAudio();
      if (!context || bellPhaseEndAt !== targetEndAt || questionTimer.status !== "running" || questionTimer.phase !== "ring") return;
      const startAt = context.currentTime + 0.02;
      const seconds = Math.max(0.1, durationMs / 1000);
      for (let offset = 0; offset < seconds; offset += 0.82) {
        const toneLength = Math.min(0.68, seconds - offset);
        [880, 1320].forEach((frequency, index) => {
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          const toneStart = startAt + offset;
          oscillator.type = "sine";
          oscillator.frequency.setValueAtTime(frequency, toneStart);
          gain.gain.setValueAtTime(0.0001, toneStart);
          gain.gain.exponentialRampToValueAtTime(index ? 0.035 : 0.07, toneStart + 0.025);
          gain.gain.exponentialRampToValueAtTime(0.0001, toneStart + toneLength);
          oscillator.connect(gain).connect(context.destination);
          oscillator.start(toneStart);
          oscillator.stop(toneStart + toneLength + 0.02);
          bellNodes.push(oscillator);
        });
      }
      const vibrationPattern = [];
      for (let elapsed = 0; elapsed < durationMs; elapsed += 820) vibrationPattern.push(260, Math.min(560, Math.max(0, durationMs - elapsed - 260)));
      try { navigator.vibrate?.(vibrationPattern); } catch {}
    } catch {
      if (bellPhaseEndAt === targetEndAt) bellPhaseEndAt = null;
    }
  }

  function questionTimerIdle(totalQuestions = questionTimer.totalQuestions, secondsPerQuestion = questionTimer.secondsPerQuestion) {
    return {
      totalQuestions,
      secondsPerQuestion,
      currentQuestion: 1,
      status: "idle",
      phase: "question",
      remainingMs: secondsPerQuestion * 1000,
      phaseEndsAt: null
    };
  }

  function advanceQuestionTimer(now = Date.now()) {
    if (questionTimer.status !== "running") return false;
    let changed = false;
    let transitions = 0;
    while (questionTimer.status === "running" && now >= questionTimer.phaseEndsAt && transitions < 500) {
      transitions += 1;
      changed = true;
      const previousEnd = questionTimer.phaseEndsAt;
      if (questionTimer.phase === "question") {
        questionTimer.phase = "ring";
        questionTimer.remainingMs = QUESTION_RING_MS;
        questionTimer.phaseEndsAt = previousEnd + QUESTION_RING_MS;
      } else if (questionTimer.currentQuestion >= questionTimer.totalQuestions) {
        questionTimer.status = "completed";
        questionTimer.remainingMs = 0;
        questionTimer.phaseEndsAt = null;
        stopQuestionBell();
      } else {
        questionTimer.currentQuestion += 1;
        questionTimer.phase = "question";
        questionTimer.remainingMs = questionTimer.secondsPerQuestion * 1000;
        questionTimer.phaseEndsAt = previousEnd + questionTimer.remainingMs;
        stopQuestionBell();
      }
    }
    if (changed) saveQuestionTimer();
    if (questionTimer.status === "running" && questionTimer.phase === "ring") {
      playQuestionBell(questionRemaining(now), questionTimer.phaseEndsAt);
    } else if (bellPhaseEndAt !== null || bellNodes.length) {
      stopQuestionBell();
    }
    if (changed) syncWakeLock();
    return changed;
  }

  function updatePauseButton(button, paused, disabled) {
    const iconName = paused ? "play" : "pause";
    const label = paused ? "继续做题计时" : "暂停做题计时";
    button.disabled = disabled;
    button.title = label;
    button.setAttribute("aria-label", label);
    if (button.dataset.iconName !== iconName) {
      button.dataset.iconName = iconName;
      button.innerHTML = `<i data-lucide="${iconName}" aria-hidden="true"></i>`;
      refreshIcons();
    }
  }

  function renderQuestionTimer(now = Date.now()) {
    const remainingMs = questionRemaining(now);
    const phaseDuration = questionTimer.phase === "ring" ? QUESTION_RING_MS : questionTimer.secondsPerQuestion * 1000;
    const progress = questionTimer.status === "completed" ? 0 : clamp(remainingMs / phaseDuration, 0, 1);
    const strokeOffset = (100 - progress * 100).toFixed(2);
    const remainingQuestions = questionTimer.status === "completed" ? 0 : questionTimer.totalQuestions - questionTimer.currentQuestion + 1;
    const locked = questionTimer.status === "running" || questionTimer.status === "paused";
    const paused = questionTimer.status === "paused";
    const ringing = questionTimer.phase === "ring" && questionTimer.status !== "completed";
    let progressLabel = `第 ${questionTimer.currentQuestion} 题`;
    let statusLabel = `第 ${questionTimer.currentQuestion} 题 / 共 ${questionTimer.totalQuestions} 题 · 含本题剩余 ${remainingQuestions} 题`;
    let fullscreenStatus = paused ? "已暂停" : "本题剩余";

    if (questionTimer.status === "idle") {
      progressLabel = "准备开始";
      fullscreenStatus = "准备开始";
    } else if (questionTimer.status === "completed") {
      progressLabel = "全部完成";
      statusLabel = `已完成全部 ${questionTimer.totalQuestions} 题`;
      fullscreenStatus = "全部完成";
    } else if (ringing) {
      progressLabel = paused ? "换题铃声暂停" : "换题铃声";
      statusLabel = `第 ${questionTimer.currentQuestion} 题计时结束 · 7 秒换题铃声`;
      fullscreenStatus = paused ? "铃声已暂停" : (questionTimer.currentQuestion === questionTimer.totalQuestions ? "完成提示" : "即将进入下一题");
    }

    if (document.activeElement !== dom.questionCount) dom.questionCount.value = String(questionTimer.totalQuestions);
    if (document.activeElement !== dom.questionMinutes) dom.questionMinutes.value = String(questionTimer.secondsPerQuestion / 60).replace(/\.0$/, "");
    dom.questionCount.disabled = locked;
    dom.questionMinutes.disabled = locked;
    dom.questionProgress.style.strokeDashoffset = strokeOffset;
    dom.fullscreenQuestionProgress.style.strokeDashoffset = strokeOffset;
    dom.questionProgressWrap.classList.toggle("ringing", ringing);
    dom.fullscreenQuestionProgressWrap.classList.toggle("ringing", ringing);
    dom.questionProgressWrap.classList.toggle("completed", questionTimer.status === "completed");
    dom.fullscreenQuestionProgressWrap.classList.toggle("completed", questionTimer.status === "completed");
    dom.questionProgressLabel.textContent = progressLabel;
    dom.questionTimeLeft.textContent = questionCountdown(remainingMs);
    dom.questionRoundStatus.textContent = statusLabel;
    dom.fullscreenQuestionRemaining.textContent = String(remainingQuestions);
    dom.fullscreenQuestionLabel.textContent = ringing ? `第 ${questionTimer.currentQuestion} 题完成` : progressLabel;
    dom.fullscreenQuestionTime.textContent = questionCountdown(remainingMs);
    dom.fullscreenQuestionStatus.textContent = fullscreenStatus;
    dom.questionStart.hidden = locked;
    dom.questionStart.querySelector("span").textContent = questionTimer.status === "completed" ? "再来一轮" : "开始做题";
    updatePauseButton(dom.questionPause, paused, !locked);
    updatePauseButton(dom.fullscreenQuestionPause, paused, !locked);
  }

  function applyQuestionSettings() {
    if (questionTimer.status === "running" || questionTimer.status === "paused") return;
    const totalQuestions = clamp(Math.round(Number(dom.questionCount.value) || 40), 1, 200);
    const secondsPerQuestion = clamp(Math.round((Number(dom.questionMinutes.value) || 3) * 60), 30, 3600);
    questionTimer = questionTimerIdle(totalQuestions, secondsPerQuestion);
    saveQuestionTimer();
    renderQuestionTimer();
  }

  function startQuestionTimer() {
    if (questionTimer.status === "running" || questionTimer.status === "paused") return;
    applyQuestionSettings();
    primeQuestionAudio().catch(() => null);
    questionTimer.status = "running";
    questionTimer.phase = "question";
    questionTimer.currentQuestion = 1;
    questionTimer.remainingMs = questionTimer.secondsPerQuestion * 1000;
    questionTimer.phaseEndsAt = Date.now() + questionTimer.remainingMs;
    saveQuestionTimer();
    renderQuestionTimer();
    syncWakeLock();
  }

  function toggleQuestionPause() {
    if (questionTimer.status === "running") {
      questionTimer.remainingMs = questionRemaining();
      questionTimer.status = "paused";
      questionTimer.phaseEndsAt = null;
      stopQuestionBell();
    } else if (questionTimer.status === "paused") {
      primeQuestionAudio().catch(() => null);
      questionTimer.status = "running";
      questionTimer.phaseEndsAt = Date.now() + questionTimer.remainingMs;
      if (questionTimer.phase === "ring") playQuestionBell(questionTimer.remainingMs, questionTimer.phaseEndsAt);
    } else {
      return;
    }
    saveQuestionTimer();
    renderQuestionTimer();
    syncWakeLock();
  }

  function resetQuestionTimer() {
    const active = questionTimer.status === "running" || questionTimer.status === "paused";
    if (active && !window.confirm("确定重置本轮做题计时吗？当前进度将清零。")) return;
    stopQuestionBell();
    questionTimer = questionTimerIdle();
    saveQuestionTimer();
    renderQuestionTimer();
    syncWakeLock();
  }

  function updateQuestionTimer() {
    const now = Date.now();
    advanceQuestionTimer(now);
    renderQuestionTimer(now);
  }

  function carouselMode(element) {
    if (!element?.clientWidth) return clockMode;
    return Math.round(element.scrollLeft / element.clientWidth) >= 1 ? "questions" : "clock";
  }

  function scrollCarouselToMode(element, mode, behavior = "smooth") {
    if (!element?.clientWidth) return;
    element.scrollTo({ left: mode === "questions" ? element.clientWidth : 0, behavior });
  }

  function renderClockMode() {
    document.querySelectorAll("[data-clock-mode-target]").forEach(button => {
      const active = button.dataset.clockModeTarget === clockMode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    document.querySelectorAll("[data-fullscreen-mode-target]").forEach(button => {
      const active = button.dataset.fullscreenModeTarget === clockMode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function setClockMode(mode, source = null, behavior = "smooth") {
    clockMode = mode === "questions" ? "questions" : "clock";
    renderClockMode();
    if (source !== dom.cardCarousel) scrollCarouselToMode(dom.cardCarousel, clockMode, behavior);
    if (source !== dom.fullscreenCarousel && !dom.fullscreenClock.hidden) scrollCarouselToMode(dom.fullscreenCarousel, clockMode, behavior);
  }

  function scheduleCarouselSync(element, fullscreen = false) {
    const timer = fullscreen ? fullscreenCarouselTimer : normalCarouselTimer;
    if (timer) window.clearTimeout(timer);
    const nextTimer = window.setTimeout(() => setClockMode(carouselMode(element), element, "auto"), 80);
    if (fullscreen) fullscreenCarouselTimer = nextTimer;
    else normalCarouselTimer = nextTimer;
  }

  function syncFullscreenCarouselPosition() {
    if (dom.fullscreenClock.hidden) return;
    requestAnimationFrame(() => scrollCarouselToMode(dom.fullscreenCarousel, clockMode, "auto"));
    window.setTimeout(() => {
      if (!dom.fullscreenClock.hidden) scrollCarouselToMode(dom.fullscreenCarousel, clockMode, "auto");
    }, 160);
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
    const time = `${pad(now.getHours())}:${pad(now.getMinutes())}${showSeconds ? `:${pad(now.getSeconds())}` : ""}`;
    dom.liveClock.textContent = time;
    dom.fullscreenTime.textContent = time;
    if (activeSession) dom.activeElapsed.textContent = `${activeSession.status === "paused" ? "已暂停" : "本次学习"} ${stopwatch(elapsedNow())}`;
  }

  function isFullscreen() {
    return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
  }

  function shouldHoldWakeLock() {
    return !dom.fullscreenClock.hidden || questionTimer.status === "running";
  }

  async function requestWakeLock() {
    if (!("wakeLock" in navigator) || wakeLock || wakeLockRequestInFlight) return;
    if (document.visibilityState !== "visible" || !shouldHoldWakeLock()) return;

    const requestEpoch = wakeLockEpoch;
    wakeLockRequestInFlight = true;
    try {
      const lock = await navigator.wakeLock.request("screen");
      if (requestEpoch !== wakeLockEpoch || !shouldHoldWakeLock()) {
        await lock.release();
        return;
      }
      wakeLock = lock;
      lock.addEventListener("release", () => {
        if (wakeLock === lock) wakeLock = null;
      });
    } catch {
      wakeLock = null;
    } finally {
      wakeLockRequestInFlight = false;
      if (requestEpoch !== wakeLockEpoch && document.visibilityState === "visible" && shouldHoldWakeLock()) {
        requestWakeLock();
      }
    }
  }

  async function releaseWakeLock() {
    wakeLockEpoch += 1;
    const lock = wakeLock;
    wakeLock = null;
    if (!lock) return;
    try {
      await lock.release();
    } catch {}
  }

  function syncWakeLock() {
    if (document.visibilityState === "visible" && shouldHoldWakeLock()) requestWakeLock();
    else releaseWakeLock();
  }

  async function enterFullscreenClock() {
    dom.fullscreenClock.hidden = false;
    dom.fullscreenClock.classList.add("force-landscape");
    document.body.classList.add("clock-fullscreen-active");
    syncFullscreenCarouselPosition();
    refreshIcons();
    const wakeLockRequest = requestWakeLock();

    try {
      if (dom.fullscreenClock.requestFullscreen) await dom.fullscreenClock.requestFullscreen();
      else if (dom.fullscreenClock.webkitRequestFullscreen) dom.fullscreenClock.webkitRequestFullscreen();
    } catch {
      // The fixed overlay remains available when a browser blocks the Fullscreen API.
    }

    try {
      if (screen.orientation?.lock) await screen.orientation.lock("landscape");
    } catch {
      // CSS rotates the clock when orientation locking is unavailable.
    }
    syncFullscreenCarouselPosition();
    await wakeLockRequest;
  }

  async function exitFullscreenClock() {
    try {
      if (document.exitFullscreen && document.fullscreenElement) await document.exitFullscreen();
      else if (document.webkitExitFullscreen && document.webkitFullscreenElement) document.webkitExitFullscreen();
    } catch {
      // Cleanup below also handles browsers with partial Fullscreen API support.
    }
    try {
      if (screen.orientation?.unlock) screen.orientation.unlock();
    } catch {}
    dom.fullscreenClock.hidden = true;
    dom.fullscreenClock.classList.remove("force-landscape");
    document.body.classList.remove("clock-fullscreen-active");
    syncWakeLock();
  }

  function syncFullscreenState() {
    if (!isFullscreen() && !dom.fullscreenClock.hidden) exitFullscreenClock();
  }

  function isSiteFullscreen() {
    const fullscreenElement = document.fullscreenElement || document.webkitFullscreenElement;
    return fullscreenElement === document.documentElement || document.body.classList.contains("site-fullscreen-fallback");
  }

  function renderSiteFullscreenButton() {
    const active = isSiteFullscreen();
    dom.siteFullscreen.setAttribute("aria-pressed", String(active));
    dom.siteFullscreen.setAttribute("aria-label", active ? "退出网站全屏" : "网站全屏");
    dom.siteFullscreen.title = active ? "退出网站全屏" : "网站全屏";
    dom.siteFullscreenLabel.textContent = active ? "退出" : "全屏";
    const icon = dom.siteFullscreen.querySelector(".tab-icon");
    icon.innerHTML = `<i data-lucide="${active ? "minimize" : "maximize"}" aria-hidden="true"></i>`;
    refreshIcons();
  }

  async function toggleSiteFullscreen() {
    if (isSiteFullscreen()) {
      document.body.classList.remove("site-fullscreen-fallback");
      try {
        if (document.exitFullscreen && document.fullscreenElement) await document.exitFullscreen();
        else if (document.webkitExitFullscreen && document.webkitFullscreenElement) document.webkitExitFullscreen();
      } catch {}
      renderSiteFullscreenButton();
      return;
    }

    let enteredNativeFullscreen = false;
    try {
      if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
        enteredNativeFullscreen = true;
      } else if (document.documentElement.webkitRequestFullscreen) {
        document.documentElement.webkitRequestFullscreen();
        enteredNativeFullscreen = true;
      }
    } catch {}

    if (!enteredNativeFullscreen) document.body.classList.add("site-fullscreen-fallback");
    renderSiteFullscreenButton();
  }

  function toggleClockFormat() {
    showSeconds = !showSeconds;
    localStorage.setItem(CLOCK_FORMAT_KEY, String(showSeconds));
    updateClock();
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

  dom.liveClock.addEventListener("click", toggleClockFormat);
  dom.fullscreenTime.addEventListener("click", toggleClockFormat);
  dom.enterFullscreen.addEventListener("click", () => {
    setClockMode("clock", null, "auto");
    enterFullscreenClock();
  });
  dom.enterQuestionFullscreen.addEventListener("click", () => {
    setClockMode("questions", null, "auto");
    enterFullscreenClock();
  });
  dom.exitFullscreen.addEventListener("click", exitFullscreenClock);
  dom.siteFullscreen.addEventListener("click", toggleSiteFullscreen);
  document.addEventListener("fullscreenchange", () => {
    syncFullscreenState();
    syncFullscreenCarouselPosition();
    renderSiteFullscreenButton();
  });
  document.addEventListener("webkitfullscreenchange", () => {
    syncFullscreenState();
    syncFullscreenCarouselPosition();
    renderSiteFullscreenButton();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      advanceQuestionTimer();
      renderQuestionTimer();
    }
    syncWakeLock();
  });

  dom.cardCarousel.addEventListener("scroll", () => scheduleCarouselSync(dom.cardCarousel, false), { passive: true });
  dom.fullscreenCarousel.addEventListener("scroll", () => scheduleCarouselSync(dom.fullscreenCarousel, true), { passive: true });
  document.querySelectorAll("[data-clock-mode-target]").forEach(button => {
    button.addEventListener("click", () => setClockMode(button.dataset.clockModeTarget));
  });
  document.querySelectorAll("[data-fullscreen-mode-target]").forEach(button => {
    button.addEventListener("click", () => setClockMode(button.dataset.fullscreenModeTarget));
  });

  dom.questionCount.addEventListener("change", applyQuestionSettings);
  dom.questionMinutes.addEventListener("change", applyQuestionSettings);
  dom.questionStart.addEventListener("click", startQuestionTimer);
  dom.questionPause.addEventListener("click", toggleQuestionPause);
  dom.fullscreenQuestionPause.addEventListener("click", toggleQuestionPause);
  dom.questionReset.addEventListener("click", resetQuestionTimer);
  dom.fullscreenQuestionReset.addEventListener("click", resetQuestionTimer);

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
  window.addEventListener("pagehide", stopQuestionBell);

  if (!Array.isArray(sessions)) sessions = [];
  if (activeSession && (!activeSession.startedAt || !["running", "paused"].includes(activeSession.status))) activeSession = null;
  advanceQuestionTimer();
  renderTimeline();
  renderRecords();
  renderTimerControls();
  renderQuestionTimer();
  renderClockMode();
  renderStats();
  renderSiteFullscreenButton();
  updateClock();
  syncWakeLock();
  window.setInterval(updateClock, 1000);
  window.setInterval(updateQuestionTimer, 250);
})();
