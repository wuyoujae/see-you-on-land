/* Ordinary-question practice state. No DOM, storage or network side effects.
 * A session stores its question ID order once; navigation never samples again.
 * Random selection is deterministic: callers use a fresh session ID as seed.
 */
(function (scope, factory) {
  const api = factory(scope);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (scope) scope.PracticeCore = api;
})(typeof window !== "undefined" ? window : globalThis, function (scope) {
  "use strict";
  const plain = value => Boolean(value && typeof value === "object" && !Array.isArray(value));
  const validId = value => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(value) &&
    !["__proto__", "constructor", "prototype"].includes(value);
  const timestamp = value => Number.isFinite(value) && value > 0 ? value : 0;
  const copyAnswer = value => Array.isArray(value) ? [...value] : value;
  const validAnswer = value => (typeof value === "string" && value.length <= 20000) || typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    (Array.isArray(value) && value.every(item => typeof item === "string" || typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item))));
  function isAnswered(value) {
    return validAnswer(value) && (Array.isArray(value) ? value.length > 0 : String(value).trim().length > 0);
  }
  function stable(value) {
    if (Array.isArray(value)) return "[" + value.map(item => stable(item === undefined ? null : item)).join(",") + "]";
    if (plain(value)) return "{" + Object.keys(value).filter(key => value[key] !== undefined).sort()
      .map(key => JSON.stringify(key) + ":" + stable(value[key])).join(",") + "}";
    return JSON.stringify(value ?? null);
  }
  function seededRandom(seed) {
    const source = String(seed ?? 0);
    let state = 2166136261;
    for (let i = 0; i < source.length; i++) { state ^= source.charCodeAt(i); state = Math.imul(state, 16777619); }
    return function () {
      state += 0x6D2B79F5;
      let value = state;
      value = Math.imul(value ^ value >>> 15, value | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  }
  function selectQuestionIds(questions, options = {}) {
    if (!Array.isArray(questions)) throw new TypeError("题库必须是题目数组");
    const ids = [], seen = new Set();
    for (const question of questions) {
      const id = typeof question === "string" ? question : question?.id;
      if (!validId(id)) throw new TypeError("题目 ID 不正确");
      if (!seen.has(id)) { seen.add(id); ids.push(id); }
    }
    const count = options.count === undefined || options.count === "all" ? ids.length : options.count;
    if (!ids.length && count === 0 && options.count === undefined) return [];
    if (!Number.isInteger(count) || count < 1 || count > ids.length) throw new RangeError(`题量应为 1 至 ${ids.length} 之间的整数`);
    const order = options.order || "random";
    if (!["random", "source", "sequential"].includes(order)) throw new TypeError("题目顺序不正确");
    if (order === "random") {
      const random = seededRandom(options.seed);
      for (let i = ids.length - 1; i > 0; i--) {
        const target = Math.floor(random() * (i + 1));
        [ids[i], ids[target]] = [ids[target], ids[i]];
      }
    }
    return ids.slice(0, count);
  }
  function createSession({ id, subjectId = "", topicId = "", setId = "", questionIds, now = Date.now() } = {}) {
    if (!validId(id) || !Array.isArray(questionIds) || !questionIds.length || questionIds.some(qid => !validId(qid)) ||
        new Set(questionIds).size !== questionIds.length || !timestamp(now)) throw new TypeError("练习会话格式不正确");
    for (const value of [subjectId, topicId, setId]) if (value !== "" && !validId(value)) throw new TypeError("练习来源 ID 不正确");
    return { version: 1, id, subjectId, topicId, setId, questionIds: [...questionIds], current: 0,
      createdAt: now, updatedAt: now, drafts: {}, answers: {} };
  }
  function contains(session, questionId) { return Boolean(session?.questionIds?.includes(questionId)); }
  function setDraft(session, questionId, value, now = Date.now()) {
    if (!contains(session, questionId) || !validAnswer(value) || !timestamp(now)) return session;
    if (session.drafts?.[questionId] && stable(session.drafts[questionId].value) === stable(value)) return session;
    return { ...session, updatedAt: Math.max(session.updatedAt || 0, now),
      drafts: { ...session.drafts, [questionId]: { value: copyAnswer(value), updatedAt: now } } };
  }
  function setCurrent(session, index, now = Date.now()) {
    if (!session || !Number.isInteger(index) || index < 0 || index >= session.questionIds.length || !timestamp(now) || session.current === index) return session;
    return { ...session, current: index, updatedAt: Math.max(session.updatedAt || 0, now) };
  }
  function submit(session, question, answer, gradeFn, now = Date.now()) {
    if (!contains(session, question?.id) || question.type === "text" || !isAnswered(answer) || typeof gradeFn !== "function" || !timestamp(now)) return session;
    const status = gradeFn(question, answer);
    if (!["correct", "incorrect"].includes(status)) return session;
    const previous = session.answers?.[question.id];
    if (previous?.status === status && stable(previous.answer) === stable(answer)) return session;
    return { ...session, updatedAt: Math.max(session.updatedAt || 0, now),
      drafts: { ...session.drafts, [question.id]: { value: copyAnswer(answer), updatedAt: now } },
      answers: { ...session.answers, [question.id]: { answer: copyAnswer(answer), status, submittedAt: now } } };
  }
  function canShow(session, questionId, view = "question") {
    if (!contains(session, questionId)) return false;
    if (view === "question") return true;
    if (!["answer", "source", "ai"].includes(view)) return false;
    const attempt = session.answers?.[questionId];
    return Boolean(attempt && timestamp(attempt.submittedAt) && ["correct", "incorrect"].includes(attempt.status) && isAnswered(attempt.answer));
  }
  function statistics(session) {
    const ids = session?.questionIds || [];
    const attempts = ids.map(id => session.answers?.[id]).filter(item => item && timestamp(item.submittedAt) && ["correct", "incorrect"].includes(item.status) && isAnswered(item.answer));
    const correct = attempts.filter(item => item.status === "correct").length;
    const done = ids.filter(id => canShow(session, id, "answer") || isAnswered(session.drafts?.[id]?.value)).length;
    return { total: ids.length, done, submitted: attempts.length, correct, incorrect: attempts.length - correct,
      unanswered: ids.length - attempts.length, accuracy: attempts.length ? Math.round(correct / attempts.length * 100) : null,
      attempts: attempts.length, pagesDone: done ? 1 : 0, complete: ids.length > 0 && attempts.length === ids.length };
  }
  function sanitizeSession(value) {
    if (!plain(value) || value.version !== 1) return null;
    let result;
    try { result = createSession({ ...value, now: value.createdAt }); } catch { return null; }
    result.current = Number.isInteger(value.current) && value.current >= 0 && value.current < result.questionIds.length ? value.current : 0;
    result.updatedAt = Math.max(result.createdAt, timestamp(value.updatedAt));
    const ids = new Set(result.questionIds);
    for (const [id, item] of Object.entries(plain(value.answers) ? value.answers : {})) {
      if (!ids.has(id) || !plain(item) || !isAnswered(item.answer) || !["correct", "incorrect"].includes(item.status) || !timestamp(item.submittedAt)) continue;
      result.answers[id] = { answer: copyAnswer(item.answer), status: item.status, submittedAt: item.submittedAt };
      result.updatedAt = Math.max(result.updatedAt, item.submittedAt);
    }
    for (const [id, item] of Object.entries(plain(value.drafts) ? value.drafts : {})) {
      if (!ids.has(id) || !plain(item) || !validAnswer(item.value) || !timestamp(item.updatedAt)) continue;
      result.drafts[id] = { value: copyAnswer(item.value), updatedAt: item.updatedAt };
      result.updatedAt = Math.max(result.updatedAt, item.updatedAt);
    }
    return result;
  }
  function latest(a, b, key) {
    if (!a) return b;
    if (!b) return a;
    return b[key] > a[key] || (b[key] === a[key] && stable(b) > stable(a)) ? b : a;
  }
  function mergeSession(local, incoming) {
    const a = sanitizeSession(local), b = sanitizeSession(incoming);
    if (!a) return b;
    if (!b) return a;
    const identity = session => stable([session.id, session.subjectId, session.topicId, session.setId, session.questionIds]);
    if (identity(a) !== identity(b)) throw new Error("同一练习会话的题目或来源不一致");
    const newest = latest(a, b, "updatedAt");
    const merged = { ...newest, questionIds: [...newest.questionIds], createdAt: Math.min(a.createdAt, b.createdAt),
      updatedAt: Math.max(a.updatedAt, b.updatedAt), answers: {}, drafts: {} };
    for (const id of merged.questionIds) {
      const answer = latest(a.answers[id], b.answers[id], "submittedAt");
      const draft = latest(a.drafts[id], b.drafts[id], "updatedAt");
      if (answer) merged.answers[id] = { ...answer, answer: copyAnswer(answer.answer) };
      if (draft) merged.drafts[id] = { ...draft, value: copyAnswer(draft.value) };
    }
    return merged;
  }
  function mergeProgress(local, incoming) {
    const a = plain(local) ? local : {}, b = plain(incoming) ? incoming : {};
    const left = plain(a.sessions) ? a.sessions : {}, right = plain(b.sessions) ? b.sessions : {};
    const sessions = {};
    let updatedAt = Math.max(timestamp(a.updatedAt), timestamp(b.updatedAt));
    for (const id of new Set([...Object.keys(left), ...Object.keys(right)])) {
      if (!validId(id)) continue;
      const record = mergeSession(left[id], right[id]);
      if (!record || record.id !== id) continue;
      sessions[id] = record; updatedAt = Math.max(updatedAt, record.updatedAt);
    }
    return { version: 1, updatedAt, sessions };
  }
  function validateProgress(value) {
    if (!plain(value) || value.version !== 1 || !Number.isFinite(value.updatedAt) || value.updatedAt < 0 || !plain(value.sessions)) throw new Error("刷题会话格式不正确");
    const clean = mergeProgress({}, value);
    // Local reads may sanitize damage, but an import must not silently remove
    // malformed answers, foreign IDs, extra question content or changed fields.
    if (stable(clean) !== stable(value)) throw new Error("刷题会话记录不完整或格式不正确");
    return clean;
  }
  function getStatistics(progress, questions, subjectId) {
    const sessions = Object.values(mergeProgress(progress, {}).sessions);
    const subject = subjectId === "all" ? "" : subjectId;
    const available = Array.isArray(questions) ? questions.filter(question => !subject || question.subjectId === subject) : null;
    // A paper can span all six subjects. When a bank is supplied, its question
    // metadata is authoritative; session-level filters must not hide those IDs.
    const filtered = subject && !available ? sessions.filter(session => session.subjectId === subject || !session.subjectId || session.subjectId === "all") : sessions;
    const eligible = available ? new Set(available.map(question => question.id).filter(validId)) : new Set(filtered.flatMap(session => session.questionIds));
    const done = new Set(), answers = new Map();
    let attempts = 0, pagesDone = 0;
    for (const session of filtered) {
      let started = false;
      for (const id of session.questionIds) {
        if (!eligible.has(id)) continue;
        const submitted = canShow(session, id, "answer");
        if (submitted || isAnswered(session.drafts[id]?.value)) { done.add(id); started = true; }
        if (submitted) { attempts++; answers.set(id, latest(answers.get(id), session.answers[id], "submittedAt")); }
      }
      if (started) pagesDone++;
    }
    const correct = [...answers.values()].filter(answer => answer.status === "correct").length;
    return { total: eligible.size, done: done.size, submitted: answers.size, correct, incorrect: answers.size - correct,
      unanswered: eligible.size - answers.size, accuracy: answers.size ? Math.round(correct / answers.size * 100) : null, attempts, pagesDone };
  }
  function normalizeBaseUrl(value) {
    if (!value) return "";
    try {
      const url = new URL(String(value).trim());
      if (!["https:", "http:"].includes(url.protocol)) throw new Error("unsupported protocol");
      url.username = ""; url.password = ""; url.hash = "";
      for (const name of [...url.searchParams.keys()]) if (/^(?:api[-_]?key|key|token|access[-_]?token|auth(?:orization)?|password|secret|signature)$/i.test(name)) url.searchParams.delete(name);
      url.searchParams.sort();
      url.pathname = url.pathname.replace(/\/+$/, "");
      return url.toString().replace(/\/$/, "");
    } catch { throw new TypeError("AI 服务地址不正确"); }
  }
  function cacheIdentity(question, context = {}) {
    if (!plain(question) || !validId(question.id)) throw new TypeError("AI 解析题目 ID 不正确");
    const sourceAnswer = plain(question.sourceAnswer) ? question.sourceAnswer : {};
    const source = plain(question.source) ? question.source : {};
    return stable({ schema: "practice-ai-v1", subjectId: question.subjectId || "", id: question.id, type: question.type || "single",
      stem: question.stem || "", stemBlocks: question.stemBlocks || [], material: question.material || "", materialBlocks: question.materialBlocks || [],
      options: (question.options || []).map(option => plain(option) ? { value: option.value ?? option.id, label: option.label ?? option.text, blocks: option.blocks || [] } : option),
      answer: question.answer, sourceAnswer: { answer: sourceAnswer.answer, explanation: sourceAnswer.explanation || "", explanationBlocks: sourceAnswer.explanationBlocks || [], url: sourceAnswer.url || "", provider: sourceAnswer.provider || "" },
      source: { paperId: source.paperId || "", year: source.year || "", variant: source.variant || "", questionNumber: source.questionNumber ?? "", url: source.url || "", answerUrl: source.answerUrl || "" },
      contentRevision: context.contentRevision ?? question.revision ?? question.contentRevision ?? "",
      promptVersion: String(context.promptVersion ?? "1"), model: String(context.model || "").trim(), baseUrl: normalizeBaseUrl(context.baseUrl)
    });
  }
  async function aiCacheKey(question, context = {}) {
    const canonical = cacheIdentity(question, context);
    const cryptoAPI = scope.crypto?.subtle ? scope.crypto : typeof require === "function" ? require("node:crypto").webcrypto : null;
    if (!cryptoAPI?.subtle) throw new Error("浏览器不支持安全的解析缓存标识");
    const digest = await cryptoAPI.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
    return "practice-ai-v1:" + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  }
  return { selectQuestionIds, createSession, isAnswered, setDraft, submit, setCurrent, canShow, statistics, getStatistics,
    sanitizeSession, mergeSession, mergeProgress, validateProgress, aiCacheKey, cacheIdentity, normalizeBaseUrl };
});
