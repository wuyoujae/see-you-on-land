(function (scope, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (scope) scope.LearningCore = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";
  const validId = id => typeof id === "string" && /^[a-zA-Z0-9_-]{1,160}$/.test(id) && !["__proto__", "constructor", "prototype"].includes(id);
  const plain = value => Boolean(value && typeof value === "object" && !Array.isArray(value));
  const time = value => Number.isFinite(value) && value > 0 ? value : 0;
  const copyAnswer = value => Array.isArray(value) ? [...value] : value;
  function isAnswered(value) {
    return value !== null && value !== undefined && (Array.isArray(value) ? value.length > 0 : String(value).trim().length > 0);
  }
  function parseRoute(hash) {
    const [path, query = ""] = String(hash || "").split("?");
    const match = /^#\/learn(?:\/([a-zA-Z0-9_-]+))?(?:\/([a-zA-Z0-9_-]+))?(?:\/([a-zA-Z0-9_-]+))?\/?$/.exec(path);
    if (!match || match.slice(1).some(id => id && !validId(id))) return null;
    const raw = new URLSearchParams(query).get("card");
    const card = raw !== null && /^\d+$/.test(raw) ? Math.min(Number(raw), 100000) : 0;
    return { subjectId: match[1] || null, groupId: match[2] || null, lessonId: match[3] || null, card };
  }
  function flattenLessons(lessons) {
    let index = 0;
    return (lessons || []).flatMap((lesson, lessonIndex) => (lesson.cards || []).map((card, cardIndex) => ({
      ...card, source: card.source ?? lesson.source, lessonId: lesson.id, lessonTitle: lesson.title, lessonIndex, cardIndex, index: index++
    })));
  }
  function sourceReference(source) {
    if (!source || typeof source !== "object") return null;
    const cleanPages = value => Array.isArray(value) ? [...new Set(value.filter(page => Number.isInteger(page) && page > 0))].sort((a, b) => a - b) : [];
    const pages = cleanPages(source.pages), printed = cleanPages(source.printedPages);
    if (source.type !== "pdf" && !pages.length && !printed.length) return null;
    function ranges(values) {
      const result = [];
      for (let i = 0; i < values.length; i++) {
        const first = values[i]; let last = first;
        while (values[i + 1] === last + 1) last = values[++i];
        result.push(first === last ? String(first) : `${first}–${last}`);
      }
      return result.join("、");
    }
    const displayed = printed.length ? printed : pages;
    if (!displayed.length) return null;
    return { label: `${printed.length ? "讲义" : "PDF"} 第${ranges(displayed)}页`,
      title: [typeof source.title === "string" ? source.title.trim() : "", pages.length ? `PDF 第${ranges(pages)}页` : ""].filter(Boolean).join(" · ") };
  }
  function createRecord() {
    return { lastCardId: null, updatedAt: 0, completed: {}, answers: {}, drafts: {} };
  }
  const isExplanation = card => card?.role === "explanation" && Boolean(card.questionId);
  function navigationCards(cards) { return (cards || []).filter(card => !isExplanation(card)); }
  function ownerCard(cards, card) {
    const item = typeof card === "string" ? (cards || []).find(item => item.id === card) : card;
    if (!item || !isExplanation(item)) return item || null;
    return (cards || []).find(candidate => candidate.type === "question" && candidate.question?.id === item.questionId) || null;
  }
  function explanationsFor(cards, card) {
    const owner = ownerCard(cards, card);
    return owner?.type === "question" ? (cards || []).filter(item => isExplanation(item) && item.questionId === owner.question?.id) : [];
  }
  function submittedAnswer(card, record) {
    const id = typeof card === "string" ? card : card?.question?.id || card?.questionId;
    const answer = record?.answers?.[id];
    return answer && time(answer.submittedAt) && isAnswered(answer.answer) && ["correct", "incorrect", "ungraded"].includes(answer.status) ? answer : null;
  }
  function completeQuestion(cards, card, record = createRecord(), now = Date.now()) {
    const owner = ownerCard(cards, card);
    if (owner?.type !== "question" || !submittedAnswer(owner, record)) return record;
    return [owner, ...explanationsFor(cards, owner)].reduce((result, item) => markComplete(item, result, now), record);
  }
  function stepComplete(cards, card, record) {
    const owner = ownerCard(cards, card);
    return Boolean(owner && progress([owner, ...explanationsFor(cards, owner)], record).complete);
  }
  function sanitizeRecord(value) {
    const result = createRecord();
    if (!plain(value)) return result;
    result.lastCardId = validId(value.lastCardId) ? value.lastCardId : null;
    result.updatedAt = time(value.updatedAt);
    for (const [id, at] of Object.entries(plain(value.completed) ? value.completed : {}).slice(0, 15000)) {
      if (validId(id) && time(at)) result.completed[id] = at;
    }
    for (const [id, item] of Object.entries(plain(value.answers) ? value.answers : {}).slice(0, 5000)) {
      if (!validId(id) || !plain(item) || !["correct", "incorrect", "ungraded"].includes(item.status) || !time(item.submittedAt) || !isAnswered(item.answer)) continue;
      if (!["string", "boolean", "number"].includes(typeof item.answer) && !Array.isArray(item.answer)) continue;
      result.answers[id] = { answer: copyAnswer(item.answer), status: item.status, submittedAt: item.submittedAt };
    }
    for (const [id, item] of Object.entries(plain(value.drafts) ? value.drafts : {}).slice(0, 5000)) {
      if (!validId(id) || !plain(item) || !time(item.updatedAt)) continue;
      if (!["string", "boolean", "number"].includes(typeof item.value) && !Array.isArray(item.value)) continue;
      result.drafts[id] = { value: copyAnswer(item.value), updatedAt: item.updatedAt };
    }
    return result;
  }
  function canVisit(card, record) {
    if (!card) return false;
    return !isExplanation(card) || Boolean(submittedAnswer(card, record));
  }
  function progress(cards, record) {
    const items = cards || [];
    const done = items.filter(card => {
      if (!time(record?.completed?.[card.id]) || !canVisit(card, record)) return false;
      return card.type !== "question" || Boolean(submittedAnswer(card, record));
    });
    const questions = items.filter(card => card.type === "question");
    const answered = questions.filter(card => submittedAnswer(card, record));
    const scored = questions.filter(card => card.question?.grading !== "unverified" && isAnswered(card.question?.answer));
    const gradedAnswered = answered.filter(card => scored.includes(card) && ["correct", "incorrect"].includes(record.answers[card.question.id].status));
    return { completed: done.length, total: items.length, percentage: items.length ? Math.round(done.length / items.length * 100) : 0,
      complete: items.length > 0 && done.length === items.length, questions: questions.length, answered: answered.length,
      scoredQuestions: scored.length, gradedAnswered: gradedAnswered.length, ungraded: answered.length - gradedAnswered.length,
      correct: gradedAnswered.filter(card => record.answers[card.question.id].status === "correct").length };
  }
  function markComplete(card, record = createRecord(), now = Date.now()) {
    if (!card || !validId(card.id) || !canVisit(card, record) || (card.type === "question" && !submittedAnswer(card, record))) return record;
    if (record.completed?.[card.id]) return record;
    return { ...record, updatedAt: now, completed: { ...record.completed, [card.id]: now } };
  }
  function submit(card, answer, record = createRecord(), gradeFn, now = Date.now()) {
    if (card?.type !== "question" || !validId(card.question?.id) || !isAnswered(answer) || typeof gradeFn !== "function") return record;
    const status = card.question.grading === "unverified" ? "ungraded" : gradeFn(card.question, answer);
    if (!["correct", "incorrect", "ungraded"].includes(status)) return record;
    const id = card.question.id;
    const previous = record.answers?.[id];
    if (previous?.status === status && JSON.stringify(previous.answer) === JSON.stringify(answer) && record.completed?.[card.id]) return record;
    return { ...record, updatedAt: now, answers: { ...record.answers, [id]: { answer: copyAnswer(answer), status, submittedAt: now } },
      drafts: { ...record.drafts, [id]: { value: copyAnswer(answer), updatedAt: now } }, completed: { ...record.completed, [card.id]: record.completed?.[card.id] || now } };
  }
  function mergeRecord(local, incoming) {
    const a = sanitizeRecord(local), b = sanitizeRecord(incoming);
    const latest = b.updatedAt > a.updatedAt ? b : a;
    const merged = { ...latest, updatedAt: Math.max(a.updatedAt, b.updatedAt), completed: { ...a.completed }, answers: { ...a.answers }, drafts: { ...a.drafts } };
    for (const [id, at] of Object.entries(b.completed)) merged.completed[id] = Math.max(at, merged.completed[id] || 0);
    for (const [id, answer] of Object.entries(b.answers)) if (!merged.answers[id] || answer.submittedAt > merged.answers[id].submittedAt) merged.answers[id] = answer;
    for (const [id, draft] of Object.entries(b.drafts)) if (!merged.drafts[id] || draft.updatedAt > merged.drafts[id].updatedAt) merged.drafts[id] = draft;
    return merged;
  }
  function mergeProgress(local, incoming) {
    const a = plain(local) ? local : {}, b = plain(incoming) ? incoming : {};
    const left = plain(a.groups) ? a.groups : {}, right = plain(b.groups) ? b.groups : {};
    const groups = {};
    for (const id of [...new Set([...Object.keys(left), ...Object.keys(right)])].slice(0, 1000)) {
      if (validId(id)) groups[id] = mergeRecord(left[id], right[id]);
    }
    return { version: 1, updatedAt: Math.max(time(a.updatedAt), time(b.updatedAt)), groups };
  }
  return { parseRoute, flattenLessons, sourceReference, isExplanation, navigationCards, ownerCard, explanationsFor, submittedAnswer, completeQuestion, stepComplete,
    isAnswered, canVisit, progress, markComplete, submit, mergeProgress, mergeRecord, createRecord, sanitizeRecord, validId };
});
