(() => {
  "use strict";

  const SCHEMA = "see-you-on-land-backup";
  const VERSION = 1;
  const LAST_EXPORT_KEY = "summer-politics-last-export-v1";
  const REQUIRED_DATA_NAMES = ["progress", "sessions", "activeSession", "clockShowsSeconds"];
  const DATA_KEYS = {
    progress: "summer-politics-learning-progress-v1",
    sessions: "summer-politics-study-sessions-v1",
    activeSession: "summer-politics-active-study-v1",
    clockShowsSeconds: "summer-politics-clock-seconds-v1",
    questionTimer: "summer-politics-question-timer-v1"
  };

  const dom = {
    exportButton: document.getElementById("export-backup"),
    importButton: document.getElementById("import-backup"),
    fileInput: document.getElementById("backup-file"),
    status: document.getElementById("backup-status")
  };

  if (!dom.exportButton || !dom.importButton || !dom.fileInput || !dom.status) return;

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function localDate(value) {
    const date = new Date(value);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function localDateTime(value) {
    const date = new Date(value);
    return `${localDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function parseStoredJSON(raw, fallback) {
    if (raw === null) return fallback;
    return JSON.parse(raw);
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function validNumber(value, minimum = 0) {
    return Number.isFinite(value) && value >= minimum;
  }

  function validateProgress(raw) {
    const value = parseStoredJSON(raw, []);
    if (!Array.isArray(value) || value.some(item => typeof item !== "string")) {
      throw new Error("清单进度格式不正确");
    }
  }

  function validateSessions(raw) {
    const value = parseStoredJSON(raw, []);
    const valid = Array.isArray(value) && value.every(item =>
      isPlainObject(item) &&
      typeof item.id === "string" &&
      validNumber(item.start, 1) &&
      validNumber(item.end, item.start) &&
      validNumber(item.durationMs)
    );
    if (!valid) throw new Error("学习计时记录格式不正确");
  }

  function validateActiveSession(raw) {
    if (raw === null) return;
    const value = parseStoredJSON(raw, null);
    const valid = isPlainObject(value) &&
      typeof value.id === "string" &&
      validNumber(value.startedAt, 1) &&
      validNumber(value.accumulatedMs) &&
      ["running", "paused"].includes(value.status) &&
      (value.status === "paused" || validNumber(value.resumedAt, 1));
    if (!valid) throw new Error("进行中的计时数据格式不正确");
  }

  function validateClockFormat(raw) {
    if (raw !== null && raw !== "true" && raw !== "false") {
      throw new Error("时钟显示设置格式不正确");
    }
  }

  function validateQuestionTimer(raw) {
    if (raw === null) return;
    const value = parseStoredJSON(raw, null);
    const statuses = ["idle", "running", "paused", "completed"];
    const valid = isPlainObject(value) &&
      Number.isInteger(value.totalQuestions) && value.totalQuestions >= 1 && value.totalQuestions <= 200 &&
      Number.isInteger(value.secondsPerQuestion) && value.secondsPerQuestion >= 30 && value.secondsPerQuestion <= 3600 &&
      Number.isInteger(value.currentQuestion) && value.currentQuestion >= 1 && value.currentQuestion <= value.totalQuestions &&
      statuses.includes(value.status) && ["question", "ring"].includes(value.phase) &&
      validNumber(value.remainingMs) &&
      (value.status !== "running" || validNumber(value.phaseEndsAt, 1));
    if (!valid) throw new Error("做题计时数据格式不正确");
  }

  function snapshot() {
    const data = Object.fromEntries(
      Object.entries(DATA_KEYS).map(([name, key]) => [name, localStorage.getItem(key)])
    );
    const progress = parseStoredJSON(data.progress, []);
    const sessions = parseStoredJSON(data.sessions, []);
    return {
      schema: SCHEMA,
      version: VERSION,
      exportedAt: new Date().toISOString(),
      summary: {
        completedItems: Array.isArray(progress) ? progress.length : 0,
        studySessions: Array.isArray(sessions) ? sessions.length : 0
      },
      data
    };
  }

  function validateBackup(backup) {
    if (!isPlainObject(backup) || backup.schema !== SCHEMA || backup.version !== VERSION || !isPlainObject(backup.data)) {
      throw new Error("这不是本网站生成的有效备份文件");
    }
    const data = { ...backup.data };
    for (const name of REQUIRED_DATA_NAMES) {
      if (!(name in backup.data) || (backup.data[name] !== null && typeof backup.data[name] !== "string")) {
        throw new Error("备份文件缺少必要数据");
      }
    }
    if (!("questionTimer" in data)) data.questionTimer = null;
    if (data.questionTimer !== null && typeof data.questionTimer !== "string") throw new Error("做题计时数据格式不正确");
    validateProgress(data.progress);
    validateSessions(data.sessions);
    validateActiveSession(data.activeSession);
    validateClockFormat(data.clockShowsSeconds);
    validateQuestionTimer(data.questionTimer);
    return data;
  }

  function setStatus(message, isError = false) {
    dom.status.textContent = message;
    dom.status.classList.toggle("error", isError);
  }

  function renderBackupStatus() {
    const lastExport = localStorage.getItem(LAST_EXPORT_KEY);
    if (!lastExport || !Number.isFinite(new Date(lastExport).getTime())) {
      setStatus("今天尚未备份，建议每天导出一次。", false);
      return;
    }
    const exportedToday = localDate(lastExport) === localDate(Date.now());
    setStatus(`${exportedToday ? "今天已备份" : "上次备份"}：${localDateTime(lastExport)}`, false);
  }

  function exportBackup() {
    try {
      const backup = snapshot();
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `上岸学习备份-${localDate(Date.now())}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      localStorage.setItem(LAST_EXPORT_KEY, new Date().toISOString());
      renderBackupStatus();
    } catch (error) {
      setStatus(`导出失败：${error.message || "请稍后重试"}`, true);
    }
  }

  async function importBackup(file) {
    try {
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) throw new Error("备份文件不能超过 5MB");
      const backup = JSON.parse(await file.text());
      const data = validateBackup(backup);
      const summary = backup.summary || {};
      const completedItems = Number.isFinite(summary.completedItems) ? summary.completedItems : parseStoredJSON(data.progress, []).length;
      const studySessions = Number.isFinite(summary.studySessions) ? summary.studySessions : parseStoredJSON(data.sessions, []).length;
      const confirmed = window.confirm(`将恢复 ${completedItems} 项学习进度和 ${studySessions} 条计时记录。当前数据会被覆盖，确定继续吗？`);
      if (!confirmed) {
        setStatus("已取消恢复，当前数据没有改变。", false);
        return;
      }
      Object.entries(DATA_KEYS).forEach(([name, key]) => {
        const value = data[name];
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      });
      setStatus("恢复成功，正在刷新页面…", false);
      window.setTimeout(() => window.location.reload(), 350);
    } catch (error) {
      setStatus(`恢复失败：${error.message || "文件无法读取"}`, true);
    } finally {
      dom.fileInput.value = "";
    }
  }

  dom.exportButton.addEventListener("click", exportBackup);
  dom.importButton.addEventListener("click", () => dom.fileInput.click());
  dom.fileInput.addEventListener("change", () => importBackup(dom.fileInput.files[0]));
  renderBackupStatus();
})();
