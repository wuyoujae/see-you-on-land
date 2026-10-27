(() => {
  "use strict";

  const SCHEMA = "see-you-on-land-backup";
  const VERSION = 1;
  const MAX_BACKUP_BYTES = 256 * 1024 * 1024;
  const LAST_EXPORT_KEY = "summer-politics-last-export-v1";
  const REQUIRED_DATA_NAMES = ["progress", "sessions", "activeSession", "clockShowsSeconds"];
  const DATA_KEYS = {
    progress: "summer-politics-learning-progress-v1",
    sessions: "summer-politics-study-sessions-v1",
    activeSession: "summer-politics-active-study-v1",
    clockShowsSeconds: "summer-politics-clock-seconds-v1",
    questionTimer: "summer-politics-question-timer-v1",
    studySubject: "summer-politics-last-study-subject-v1",
    practiceAnswers: "summer-politics-practice-v1",
    knowledgeCycle: "summer-politics-daily-knowledge-v1",
    courseProgress: "summer-politics-courses-v1",
    drillProgress: "summer-politics-drill-v1"
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
      validNumber(item.durationMs) &&
      (item.subject === undefined || (typeof item.subject === "string" && item.subject.length <= 30))
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
      (value.status === "paused" || validNumber(value.resumedAt, 1)) &&
      (value.subject === undefined || (typeof value.subject === "string" && value.subject.length <= 30));
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
    const validTotal = isPlainObject(value) && value.mode === "total" &&
      Number.isInteger(value.totalQuestions) && value.totalQuestions >= 1 && value.totalQuestions <= 200 &&
      Number.isInteger(value.secondsPerQuestion) && value.secondsPerQuestion >= 30 && value.secondsPerQuestion <= 3600 &&
      validNumber(value.totalDurationMs, 30000) && statuses.includes(value.status) &&
      validNumber(value.remainingMs) &&
      (value.status !== "running" || validNumber(value.endsAt, 1)) &&
      (value.alertEndsAt === null || value.alertEndsAt === undefined || validNumber(value.alertEndsAt, 1));
    const validLegacy = isPlainObject(value) &&
      Number.isInteger(value.totalQuestions) && value.totalQuestions >= 1 && value.totalQuestions <= 200 &&
      Number.isInteger(value.secondsPerQuestion) && value.secondsPerQuestion >= 30 && value.secondsPerQuestion <= 3600 &&
      Number.isInteger(value.currentQuestion) && value.currentQuestion >= 1 && value.currentQuestion <= value.totalQuestions &&
      statuses.includes(value.status) && ["question", "ring"].includes(value.phase) && validNumber(value.remainingMs) &&
      (value.status !== "running" || validNumber(value.phaseEndsAt, 1));
    if (!validTotal && !validLegacy) throw new Error("做题计时数据格式不正确");
  }

  function validateStudySubject(raw) {
    if (raw !== null && (typeof raw !== "string" || raw.length > 30)) {
      throw new Error("学习科目设置格式不正确");
    }
  }

  function snapshot() {
    const data = Object.fromEntries(
      Object.entries(DATA_KEYS).map(([name, key]) => [name, localStorage.getItem(key)])
    );
    // A full localStorage may leave the newest draft only in LearningApp's
    // memory. Export that merged state even when flush could not write it.
    if (window.LearningApp?.mergeBackupProgress) data.courseProgress = window.LearningApp.mergeBackupProgress(data.courseProgress);
    validateCourseProgress(data.courseProgress);
    if (window.PracticeStudy?.storageKey === DATA_KEYS.drillProgress) {
      if (window.PracticeStudy.mergeDrillProgress) data.drillProgress = window.PracticeStudy.mergeDrillProgress(data.drillProgress);
      else if (window.PracticeStudy.exportProgress) data.drillProgress = window.PracticeStudy.exportProgress();
    }
    validateDrillProgress(data.drillProgress);
    const progress = parseStoredJSON(data.progress, []);
    const sessions = parseStoredJSON(data.sessions, []);
    const practice = parseStoredJSON(data.practiceAnswers, {});
    const courses = parseStoredJSON(data.courseProgress, {});
    const drill = parseStoredJSON(data.drillProgress, {});
    return {
      schema: SCHEMA,
      version: VERSION,
      exportedAt: new Date().toISOString(),
      summary: {
        completedItems: Array.isArray(progress) ? progress.length : 0,
        studySessions: Array.isArray(sessions) ? sessions.length : 0,
        practicePages: isPlainObject(practice) ? Object.keys(practice).length : 0,
        courseGroups: isPlainObject(courses?.groups) ? Object.keys(courses.groups).length : 0,
        drillSessions: isPlainObject(drill?.sessions) ? Object.keys(drill.sessions).length : 0
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
    if (!("studySubject" in data)) data.studySubject = null;
    // A backup made before the practice module must not erase newer answers.
    if (!("practiceAnswers" in data)) data.practiceAnswers = localStorage.getItem(DATA_KEYS.practiceAnswers);
    if (!("knowledgeCycle" in data)) data.knowledgeCycle = localStorage.getItem(DATA_KEYS.knowledgeCycle);
    if (!("courseProgress" in data)) data.courseProgress = localStorage.getItem(DATA_KEYS.courseProgress);
    if (!("drillProgress" in data)) data.drillProgress = localStorage.getItem(DATA_KEYS.drillProgress);
    if (data.questionTimer !== null && typeof data.questionTimer !== "string") throw new Error("做题计时数据格式不正确");
    validateProgress(data.progress);
    validateSessions(data.sessions);
    validateActiveSession(data.activeSession);
    validateClockFormat(data.clockShowsSeconds);
    validateQuestionTimer(data.questionTimer);
    validateStudySubject(data.studySubject);
    validatePractice(data.practiceAnswers);
    validateKnowledgeCycle(data.knowledgeCycle);
    validateCourseProgress(data.courseProgress);
    validateDrillProgress(data.drillProgress);
    return data;
  }

  function validatePractice(raw) {
    if (raw === null) return;
    if (typeof raw !== "string") throw new Error("做题记录格式不正确");
    const pages = JSON.parse(raw);
    if (!isPlainObject(pages)) throw new Error("做题记录格式不正确");
    for (const [id, page] of Object.entries(pages)) {
      if (!/^[a-z0-9-]+$/.test(id) || !isPlainObject(page) || !isPlainObject(page.answers) ||
          !Number.isInteger(page.current) || page.current < 0 || typeof page.submitted !== "boolean" ||
          !validNumber(page.updatedAt) || !validAnswers(page.answers)) {
        throw new Error("做题记录格式不正确");
      }
      if (page.seen !== undefined && (!isPlainObject(page.seen) || Object.entries(page.seen).some(([questionId, at]) => !validQuestionId(questionId) || !validNumber(at)))) throw new Error("已做题目统计格式不正确");
      if (page.results !== undefined && (!isPlainObject(page.results) || Object.entries(page.results).some(([questionId, result]) =>
        !validQuestionId(questionId) || !isPlainObject(result) || !["correct", "incorrect", "unanswered"].includes(result.status) ||
        !validNumber(result.submittedAt) || (result.answer !== undefined && !validAnswer(result.answer))))) throw new Error("做题成绩格式不正确");
      if (page.attemptCount !== undefined && (!Number.isInteger(page.attemptCount) || page.attemptCount < 0)) throw new Error("交卷次数格式不正确");
      if (page.submittedAt !== undefined && !validNumber(page.submittedAt)) throw new Error("交卷时间格式不正确");
      if (page.history !== undefined && (!Array.isArray(page.history) || page.history.some(attempt =>
        !isPlainObject(attempt) || !validNumber(attempt.submittedAt) ||
        ["correct", "incorrect", "unanswered", "answered", "total"].some(name => attempt[name] !== undefined && (!Number.isInteger(attempt[name]) || attempt[name] < 0)) ||
        (attempt.scope !== undefined && !["page", "question"].includes(attempt.scope)) ||
        (attempt.submissionId !== undefined && (typeof attempt.submissionId !== "string" || attempt.submissionId.length > 200)) ||
        (attempt.questionIds !== undefined && (!Array.isArray(attempt.questionIds) || attempt.questionIds.some(qid => !belongsToPage(qid, id)))) ||
        (attempt.answers !== undefined && (!isPlainObject(attempt.answers) || !validAnswers(attempt.answers)))))) throw new Error("交卷历史格式不正确");
      for (const name of ["wrongBookBackfilledAt", "submissionStateAt"]) if (page[name] !== undefined && !validNumber(page[name])) throw new Error("做题同步时间格式不正确");
      if (page.answerUpdatedAt !== undefined && (!isPlainObject(page.answerUpdatedAt) || Object.entries(page.answerUpdatedAt).some(([qid, at]) => !belongsToPage(qid, id) || !validNumber(at)))) throw new Error("答案更新时间格式不正确");
      if (page.reviewDraft !== undefined && !validReviewDraft(page.reviewDraft, id)) throw new Error("错题复习草稿格式不正确");
      if (page.reviewDrafts !== undefined && (!isPlainObject(page.reviewDrafts) || Object.entries(page.reviewDrafts).some(([qid, draft]) => qid !== draft?.questionId || !validReviewDraft(draft, id)))) throw new Error("错题复习草稿格式不正确");
      if (page.pendingWrongSubmissions !== undefined && (!Array.isArray(page.pendingWrongSubmissions) || page.pendingWrongSubmissions.some(payload => !validStudySubmission(payload, id)))) throw new Error("待同步错题格式不正确");
    }
  }

  function validQuestionId(value) { return typeof value === "string" && /^[a-z0-9-]+$/.test(value); }
  function validAnswer(value) {
    return typeof value === "boolean" || (typeof value === "string" && value.length <= 20000) ||
      (Array.isArray(value) && value.length <= 100 && value.every(item => typeof item === "string" && item.length <= 2000));
  }
  function validAnswers(answers) { return Object.entries(answers).every(([id, value]) => validQuestionId(id) && validAnswer(value)); }
  function belongsToPage(id, pageId) { return validQuestionId(id) && id.startsWith(`${pageId}-q`) && /^\d+$/.test(id.slice(pageId.length + 2)); }
  function validReviewDraft(draft, pageId) {
    return isPlainObject(draft) && belongsToPage(draft.questionId, pageId) && validAnswer(draft.answer) &&
      validNumber(draft.startedAt) && typeof draft.submitted === "boolean" && (draft.updatedAt === undefined || validNumber(draft.updatedAt));
  }
  function validStudySubmission(payload, pageId) {
    if (!isPlainObject(payload) || typeof payload.id !== "string" || !payload.id || payload.id.length > 200 ||
        !validNumber(payload.submittedAt) || !["politics", "common"].includes(payload.module) ||
        !isPlainObject(payload.page) || payload.page.id !== pageId || !isPlainObject(payload.book) ||
        !validQuestionId(payload.book.id) || !pageId.startsWith(`${payload.book.id}-p`) ||
        !Array.isArray(payload.questions) || !payload.questions.length || !isPlainObject(payload.results)) return false;
    const ids = new Set();
    for (const question of payload.questions) {
      if (!isPlainObject(question) || !belongsToPage(question.id, pageId) || ids.has(question.id) ||
          !Number.isInteger(question.index) || question.index < 0 || !Number.isInteger(question.number) || question.number < 1 || typeof question.answer !== "string") return false;
      ids.add(question.id);
    }
    return Object.entries(payload.results).every(([id, result]) => ids.has(id) && isPlainObject(result) &&
      ["correct", "incorrect", "unanswered"].includes(result.status) && validAnswer(result.answer) && validNumber(result.submittedAt)) &&
      (payload.reviewQuestionIds === undefined || (Array.isArray(payload.reviewQuestionIds) && payload.reviewQuestionIds.every(id => ids.has(id))));
  }

  function validateKnowledgeCycle(raw) {
    if (raw === null) return;
    if (typeof raw !== "string") throw new Error("知识点阅读记录格式不正确");
    const value = JSON.parse(raw);
    if (!isPlainObject(value) || value.version !== 1 || !Array.isArray(value.seen) ||
        value.seen.some(id => typeof id !== "string" || id.length > 160) ||
        !Number.isInteger(value.cycle) || value.cycle < 1 || typeof value.sourceVersion !== "string" ||
        typeof value.lastId !== "string" || !validNumber(value.updatedAt)) throw new Error("知识点阅读记录格式不正确");
  }

  function validCourseId(value) {
    return typeof value === "string" && /^[a-zA-Z0-9_-]{1,160}$/.test(value) &&
      !["__proto__", "constructor", "prototype"].includes(value);
  }

  function validCourseAnswer(value) {
    return (typeof value === "number" && Number.isFinite(value)) || validAnswer(value);
  }

  function courseAnswerPresent(value) {
    return Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && String(value).trim().length > 0;
  }

  function validateCourseProgress(raw) {
    if (raw === null) return;
    if (typeof raw !== "string") throw new Error("课程进度格式不正确");
    const value = JSON.parse(raw);
    if (!isPlainObject(value) || value.version !== 1 || !validNumber(value.updatedAt) ||
        !isPlainObject(value.groups) || Object.keys(value.groups).length > 1000) throw new Error("课程进度格式不正确");
    for (const [groupId, record] of Object.entries(value.groups)) {
      if (!validCourseId(groupId) || !isPlainObject(record) || !validNumber(record.updatedAt) ||
          (record.lastCardId !== null && !validCourseId(record.lastCardId)) ||
          !isPlainObject(record.completed) || Object.keys(record.completed).length > 15000 ||
          !isPlainObject(record.answers) || Object.keys(record.answers).length > 5000 ||
          !isPlainObject(record.drafts) || Object.keys(record.drafts).length > 5000) throw new Error("课程分组记录格式不正确");
      if (Object.entries(record.completed).some(([id, at]) => !validCourseId(id) || !validNumber(at, 1))) throw new Error("课程完成记录格式不正确");
      if (Object.entries(record.answers).some(([id, answer]) => !validCourseId(id) || !isPlainObject(answer) ||
          !validCourseAnswer(answer.answer) || !courseAnswerPresent(answer.answer) ||
          !["correct", "incorrect", "ungraded"].includes(answer.status) || !validNumber(answer.submittedAt, 1))) throw new Error("课程作答记录格式不正确");
      if (Object.entries(record.drafts).some(([id, draft]) => !validCourseId(id) || !isPlainObject(draft) ||
          !validCourseAnswer(draft.value) || !validNumber(draft.updatedAt, 1))) throw new Error("课程草稿格式不正确");
    }
  }

  function validateDrillProgress(raw) {
    if (raw === null) return;
    if (typeof raw !== "string") throw new Error("刷题会话格式不正确");
    if (!window.PracticeCore?.validateProgress) throw new Error("刷题模块尚未就绪，请刷新后重试");
    window.PracticeCore.validateProgress(JSON.parse(raw));
  }

  function mergeDrillProgress(raw) {
    const practice = window.PracticeStudy;
    if (practice?.storageKey === DATA_KEYS.drillProgress && practice.mergeDrillProgress) return practice.mergeDrillProgress(raw);
    const local = practice?.storageKey === DATA_KEYS.drillProgress && practice.exportProgress
      ? practice.exportProgress() : localStorage.getItem(DATA_KEYS.drillProgress);
    if (local === null && raw === null) return null;
    if (!window.PracticeCore?.mergeProgress) throw new Error("刷题模块尚未就绪，请刷新后重试");
    return JSON.stringify(window.PracticeCore.mergeProgress(parseStoredJSON(local, {}), parseStoredJSON(raw, {})));
  }

  function notifyProgressRestored() {
    window.dispatchEvent(new Event("summer-politics:practice-restored"));
    window.dispatchEvent(new Event("summer-politics:courses-restored"));
    window.dispatchEvent(new Event("summer-politics:drill-restored"));
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

  async function exportBackup() {
    dom.exportButton.disabled = true;
    try {
      await window.LearningApp?.flush?.();
      if (window.PracticeStudy?.storageKey === DATA_KEYS.drillProgress) await window.PracticeStudy.flush?.();
      const backup = snapshot();
      if (!window.wrongQuestionBook?.exportData) throw new Error("错题模块尚未就绪，请刷新后重试");
      backup.wrongQuestions = await window.wrongQuestionBook.exportData();
      backup.summary.wrongQuestions = backup.wrongQuestions.records.length;
      if (window.AIExplanation?.exportCache) {
        backup.aiExplanations = await window.AIExplanation.exportCache();
        backup.summary.aiExplanations = backup.aiExplanations.entries.length;
      }
      if (window.ShenlunApp?.exportData) {
        await window.ShenlunApp.flush();
        backup.shenlun = await window.ShenlunApp.exportData();
        backup.summary.shenlunProjects = backup.shenlun.projects.length;
      }
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json;charset=utf-8" });
      if (blob.size > MAX_BACKUP_BYTES) throw new Error("完整备份超过256 MiB");
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
    } finally {
      dom.exportButton.disabled = false;
    }
  }

  async function importBackup(file) {
    dom.importButton.disabled = true;
    try {
      if (!file) return;
      if (file.size > MAX_BACKUP_BYTES) throw new Error("备份文件不能超过256 MiB");
      setStatus("正在校验备份…");
      const backup = JSON.parse(await file.text());
      const data = validateBackup(backup);
      let wrongQuestions;
      if (backup.wrongQuestions !== undefined) {
        if (!window.wrongQuestionBook?.validateImportData) throw new Error("错题模块尚未就绪，请刷新后重试");
        wrongQuestions = await window.wrongQuestionBook.validateImportData(backup.wrongQuestions);
      }
      let aiExplanations;
      if (backup.aiExplanations !== undefined) {
        if (!window.AIExplanation?.validateImportCache || !window.AIExplanation?.importCache || !window.AIExplanation?.exportCache) throw new Error("AI 解析缓存模块尚未就绪，请刷新后重试");
        aiExplanations = await window.AIExplanation.validateImportCache(backup.aiExplanations);
      }
      let shenlun;
      if (backup.shenlun !== undefined) {
        if (!window.ShenlunApp?.validateImportData) throw new Error("申论评分模块尚未就绪，请刷新后重试");
        shenlun = await window.ShenlunApp.validateImportData(backup.shenlun);
      }
      const summary = backup.summary || {};
      const completedItems = Number.isFinite(summary.completedItems) ? summary.completedItems : parseStoredJSON(data.progress, []).length;
      const studySessions = Number.isFinite(summary.studySessions) ? summary.studySessions : parseStoredJSON(data.sessions, []).length;
      const practicePages = Object.keys(parseStoredJSON(data.practiceAnswers, {})).length;
      const courseGroups = Object.keys(parseStoredJSON(data.courseProgress, {})?.groups || {}).length;
      const drillSessions = Object.keys(parseStoredJSON(data.drillProgress, {})?.sessions || {}).length;
      const wrongCount = wrongQuestions?.records.length || 0;
      const confirmed = await window.AppUI.confirm({ title: "恢复学习备份", message: `将恢复 ${completedItems} 项清单进度、${studySessions} 条计时记录、${practicePages} 页历史做题记录，并合并 ${drillSessions} 次刷题会话、${courseGroups} 组课程进度${wrongQuestions ? `、${wrongCount} 道错题` : ""}${aiExplanations ? `、${aiExplanations.entries.length} 条 AI 解析` : ""}。刷题、课程和错题保留较新记录；清单进度和计时记录会被覆盖。`, confirmLabel: "恢复备份", danger: true });
      if (!confirmed) {
        setStatus("已取消恢复，当前数据没有改变。", false);
        return;
      }
      // The new ordinary-question controller must never merge session data into
      // the historical mind-map key, even if it exposes a similar method name.
      if (window.PracticeStudy?.storageKey === DATA_KEYS.practiceAnswers && window.PracticeStudy.mergeBackupProgress) data.practiceAnswers = window.PracticeStudy.mergeBackupProgress(data.practiceAnswers);
      validatePractice(data.practiceAnswers);
      await window.LearningApp?.flush?.();
      if (window.PracticeStudy?.storageKey === DATA_KEYS.drillProgress) await window.PracticeStudy.flush?.();
      // Re-read after confirmation: another tab or a pending draft may have
      // advanced since an older backup was first validated.
      if (!("courseProgress" in backup.data)) data.courseProgress = localStorage.getItem(DATA_KEYS.courseProgress);
      if (window.LearningApp?.mergeBackupProgress) data.courseProgress = window.LearningApp.mergeBackupProgress(data.courseProgress);
      validateCourseProgress(data.courseProgress);
      if (!("drillProgress" in backup.data)) data.drillProgress = localStorage.getItem(DATA_KEYS.drillProgress);
      data.drillProgress = mergeDrillProgress(data.drillProgress);
      validateDrillProgress(data.drillProgress);
      const previousAICache = aiExplanations ? await window.AIExplanation.exportCache() : null;
      const previousShenlun = shenlun ? await window.ShenlunApp.exportData() : null;
      const previous = Object.fromEntries(Object.entries(DATA_KEYS).map(([name, key]) => [name, localStorage.getItem(key)]));
      let importingAICache = false, importingShenlun = false;
      try {
        Object.entries(DATA_KEYS).forEach(([name, key]) => {
          if (data[name] === null) localStorage.removeItem(key);
          else localStorage.setItem(key, data[name]);
        });
        if (wrongQuestions) await window.wrongQuestionBook.importData(wrongQuestions);
        if (aiExplanations) {
          importingAICache = true;
          await window.AIExplanation.importCache(aiExplanations, { merge: true });
        }
        if (shenlun) { importingShenlun = true; await window.ShenlunApp.importData(shenlun, { merge: true }); }
      } catch (error) {
        Object.entries(DATA_KEYS).forEach(([name, key]) => {
          if (previous[name] === null) localStorage.removeItem(key);
          else localStorage.setItem(key, previous[name]);
        });
        if (importingAICache) {
          try { await window.AIExplanation.importCache(previousAICache, { merge: false }); }
          catch { error = new Error(`${error.message || "恢复失败"}；AI 解析缓存回滚失败，请保留原备份重试`); }
        }
        if (importingShenlun) {
          try { await window.ShenlunApp.importData(previousShenlun, { merge: false }); }
          catch { error = new Error(`${error.message || "恢复失败"}；申论项目回滚失败，请保留原备份重试`); }
        }
        notifyProgressRestored();
        throw error;
      }
      notifyProgressRestored();
      setStatus("恢复成功，正在刷新页面…", false);
      window.setTimeout(() => window.location.reload(), 350);
    } catch (error) {
      setStatus(`恢复失败：${error.message || "文件无法读取"}`, true);
    } finally {
      dom.fileInput.value = "";
      dom.importButton.disabled = false;
    }
  }

  dom.exportButton.addEventListener("click", exportBackup);
  dom.importButton.addEventListener("click", () => dom.fileInput.click());
  dom.fileInput.addEventListener("change", () => importBackup(dom.fileInput.files[0]));
  renderBackupStatus();
})();
