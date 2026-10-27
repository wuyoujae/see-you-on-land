/* Pure validation and exact text anchors for Shenlun review. */
(function (scope, factory) {
  const api = factory(scope);
  if (typeof module === "object" && module.exports) module.exports = api;
  else scope.ShenlunCore = api;
})(typeof window !== "undefined" ? window : globalThis, function (scope) {
  "use strict";
  const MAX_TEXT = 200000, MAX_JSON = 2 * 1024 * 1024;
  const SUBTYPES = ["countermeasure", "cause", "problem", "effect", "comprehensive"];
  const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
  const error = message => Object.assign(new Error(message), {code: "VALIDATION"});
  function object(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw error(`${label}格式不正确。`);
    return value;
  }
  function text(value, label, maximum = MAX_TEXT, allowEmpty = true) {
    if (typeof value !== "string" || value.length > maximum || (!allowEmpty && !value.trim())) throw error(`${label}缺失或过长。`);
    return value;
  }
  function list(value, label, maximum = 500) {
    if (!Array.isArray(value) || value.length > maximum) throw error(`${label}格式不正确或条目过多。`);
    return value;
  }
  function number(value, label, maximum = 1000) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > maximum) throw error(`${label}数值不正确。`);
    return value;
  }
  function integer(value, label, maximum = 200000) {
    if (!Number.isInteger(value) || value < 0 || value > maximum) throw error(`${label}数值不正确。`);
    return value;
  }
  function choice(value, allowed, label) {
    if (!allowed.includes(value)) throw error(`${label}不受支持。`);
    return value;
  }
  function unique(values, label) {
    if (new Set(values).size !== values.length) throw error(`${label}存在重复标识。`);
  }
  function close(a, b) { return Math.abs(a - b) < 0.000001; }
  function boundary(source, offset) {
    if (offset <= 0 || offset >= source.length) return true;
    const before = source.charCodeAt(offset - 1), after = source.charCodeAt(offset);
    return !(before >= 0xD800 && before <= 0xDBFF && after >= 0xDC00 && after <= 0xDFFF);
  }
  function anchor(source, value = {}) {
    if (typeof source !== "string" || typeof value?.quote !== "string" || !value.quote.trim() || value.quote.length > source.length) return null;
    const {quote, occurrence} = value;
    if (occurrence !== undefined && (!Number.isInteger(occurrence) || occurrence < 1)) return null;
    let cursor = 0, found = 0, result = null;
    while (cursor <= source.length - quote.length) {
      const start = source.indexOf(quote, cursor);
      if (start === -1) break;
      const end = start + quote.length;
      if (boundary(source, start) && boundary(source, end)) {
        found++;
        if (occurrence === found) return {start, end, quote};
        if (occurrence === undefined) {
          if (result) return null; // A repeated quote without an occurrence is ambiguous.
          result = {start, end, quote};
        }
      }
      cursor = start + 1; // Overlapping occurrences count, too.
    }
    return occurrence === undefined ? result : null;
  }
  function countWords(value) { return [...String(value ?? "")].filter(character => !/\s/u.test(character)).length; }
  function parseJSON(value) {
    if (typeof value !== "string" || value.length > MAX_JSON) throw error("模型结果为空或超过允许的长度。");
    let source = value.replace(/^\uFEFF/, "").trim();
    const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(source);
    if (fenced) source = fenced[1].trim();
    let parsed;
    try { parsed = JSON.parse(source); } catch (_) { throw error("模型未返回完整的 JSON 结果，请重新生成。"); }
    object(parsed, "模型结果");
    let entries = 0;
    function inspect(current, depth) {
      if (depth > 30 || ++entries > 50000) throw error("模型结果结构过于复杂。");
      if (!current || typeof current !== "object") return;
      for (const [key, child] of Object.entries(current)) {
        if (["__proto__", "prototype", "constructor"].includes(key)) throw error("模型结果包含不允许的字段。");
        inspect(child, depth + 1);
      }
    }
    inspect(parsed, 0);
    return parsed;
  }
  function status(value) { return choice(value, ["ready", "needs_review"], "结果状态"); }
  function strings(value, label, maximum = 100) { return list(value, label, maximum).map(item => text(item, label, 20000)); }
  function sourceText(project) { return String(project?.questionText ?? project?.question?.text ?? ""); }
  function answerText(project) { return String(project?.answerText ?? project?.answer?.text ?? ""); }
  function projectScore(project) {
    const score = number(project?.maxScore, "题目满分");
    if (!score) throw error("请先确认题目满分。");
    return score;
  }
  function anchors(values, source, label) {
    return list(values, label, 100).map(value => {
      object(value, label);
      const quote = text(value.quote, `${label}引文`, 10000, false);
      const occurrence = integer(value.occurrence, `${label}位置`);
      if (!occurrence) throw error(`${label}位置需要从 1 开始。`);
      return {quote, occurrence, resolvedAnchor: anchor(source, {quote, occurrence})};
    });
  }
  function validateReference(raw, project) {
    object(raw, "参考解答"); object(project, "题目");
    const state = status(raw.status), maxScore = projectScore(project), q = object(raw.question, "题目信息");
    const question = {
      subtype: choice(q.subtype, SUBTYPES, "概括题类型"),
      maxScore: number(q.maxScore, "参考解答满分"),
      wordLimit: q.wordLimit === null ? null : integer(q.wordLimit, "字数要求"),
      task: text(q.task, "作答任务", 10000), scope: text(q.scope, "作答范围", 10000)
    };
    if (!close(question.maxScore, maxScore)) throw error("参考解答满分与已确认的题目分值不一致。");
    if (project.subtype && project.subtype !== "auto" && question.subtype !== project.subtype) throw error("参考解答题型与已选择的题型不一致。");
    if (project.wordLimit != null && question.wordLimit !== project.wordLimit) throw error("参考解答字数要求与已确认的题目要求不一致。");
    const material = sourceText(project), referenceAnswer = text(raw.referenceAnswer, "参考答案");
    const rubric = list(raw.rubric, "评分要点", 100).map(item => {
      object(item, "评分要点");
      return {id: text(item.id, "要点标识", 120, false), title: text(item.title, "要点名称", 1000, false),
        maxPoints: number(item.maxPoints, "要点分值", maxScore), explanation: text(item.explanation, "要点说明", 20000),
        sourceAnchors: anchors(item.sourceAnchors, material, "材料依据"), acceptedExpressions: strings(item.acceptedExpressions, "可接受表达", 50)};
    });
    unique(rubric.map(item => item.id), "评分要点");
    const analysis = list(raw.analysis, "分析过程", 100).map(item => {
      object(item, "分析过程");
      const answerQuote = text(item.answerQuote, "答案关联片段", 10000);
      return {id: text(item.id, "分析标识", 120, false), title: text(item.title, "分析标题", 1000), text: text(item.text, "分析正文", 30000),
        sourceAnchors: anchors(item.sourceAnchors, material, "分析材料依据"), answerQuote,
        resolvedAnswerAnchor: answerQuote ? anchor(referenceAnswer, {quote: answerQuote}) : null};
    });
    unique(analysis.map(item => item.id), "分析步骤");
    const limitations = strings(raw.limitations, "参考解答限制", 50);
    if (state === "ready") {
      if (!material.trim() || !referenceAnswer.trim() || !rubric.length || !analysis.length) throw error("参考解答缺少题目、答案、要点或分析过程。");
      if (rubric.some(item => item.maxPoints <= 0) || !close(rubric.reduce((sum, item) => sum + item.maxPoints, 0), maxScore)) throw error("评分要点分值之和与题目满分不一致。");
      if (rubric.some(item => !item.sourceAnchors.some(value => value.resolvedAnchor))) throw error("评分要点缺少可精确定位的材料依据，请核对题目后重新生成。");
    } else if (!limitations.length) throw error("待核对的参考解答需要说明缺失或不确定的信息。");
    return {status: state, limitations, question, rubric, referenceAnswer, analysis};
  }
  function validateReport(raw, project, reference) {
    object(raw, "批改报告"); object(project, "题目"); object(reference, "参考解答");
    const state = status(raw.status), maxScore = projectScore(project), material = sourceText(project), answer = answerText(project);
    if (!close(number(raw.maxScore, "批改满分"), maxScore)) throw error("批改满分与已确认的题目分值不一致。");
    let score = raw.score;
    if (state === "needs_review") {
      if (score !== null) throw error("尚需核对的报告不能给出有效分数。");
    } else {
      score = number(score, "得分", maxScore);
      if (reference.status !== "ready") throw error("参考解答尚待核对，当前不能给出有效评分。");
    }
    const rubric = new Map(list(reference.rubric, "参考评分要点", 100).map(item => [item.id, item]));
    const points = list(raw.points, "要点评分", 100).map(item => {
      object(item, "要点评分");
      const rubricId = text(item.rubricId, "评分要点标识", 120, false), target = rubric.get(rubricId);
      if (!target) throw error("批改包含参考评分标准中不存在的要点。");
      const maxPoints = number(item.maxPoints, "要点满分", maxScore), earned = number(item.earned, "要点得分", maxPoints);
      if (!close(maxPoints, target.maxPoints)) throw error("批改改变了已确定的评分要点分值。");
      const pointStatus = choice(item.status, ["earned", "partial", "missing"], "要点评分状态");
      if ((pointStatus === "earned" && !close(earned, maxPoints)) || (pointStatus === "missing" && earned !== 0) || (pointStatus === "partial" && !(earned > 0 && earned < maxPoints))) throw error("要点状态与实际得分不一致。");
      return {rubricId, earned, maxPoints, status: pointStatus, reason: text(item.reason, "要点评语", 20000),
        answerAnchors: anchors(item.answerAnchors, answer, "答卷依据"), sourceAnchors: anchors(item.sourceAnchors, material, "原题依据")};
    });
    unique(points.map(item => item.rubricId), "要点评分");
    if (state === "ready") {
      if (!answer.trim()) throw error("答卷为空，不能评分。");
      if (!points.length || points.length !== rubric.size || !close(points.reduce((sum, item) => sum + item.maxPoints, 0), maxScore) || !close(points.reduce((sum, item) => sum + item.earned, 0), score)) throw error("要点分值、得分合计与报告总分不一致。");
      if (points.some(item => item.earned > 0 && !item.answerAnchors.some(value => value.resolvedAnchor))) throw error("已得分的要点缺少可精确定位的答卷依据，不能作为有效评分保存。");
    }
    const dimensions = list(raw.dimensions, "综合评价", 30).map(item => {
      object(item, "综合评价");
      return {id: text(item.id, "评价标识", 120, false), label: text(item.label, "评价维度", 1000), comment: text(item.comment, "评价说明", 20000)};
    });
    unique(dimensions.map(item => item.id), "综合评价");
    const annotations = list(raw.annotations, "答卷批注", 300).map(item => {
      object(item, "答卷批注");
      const [answerAnchor] = anchors([item.answerAnchor], answer, "批注原文");
      const relatedRubricIds = strings(item.relatedRubricIds, "关联要点", 100);
      if (relatedRubricIds.some(id => !rubric.has(id))) throw error("批注关联了不存在的评分要点。");
      return {id: text(item.id, "批注标识", 120, false), kind: choice(item.kind, ["credit", "issue", "deviation"], "批注类型"),
        answerAnchor, resolvedAnchor: answerAnchor.resolvedAnchor, title: text(item.title, "批注标题", 1000), comment: text(item.comment, "批注说明", 20000),
        suggestion: text(item.suggestion, "修改建议", 20000), example: text(item.example, "示例表达", 20000), relatedRubricIds};
    });
    unique(annotations.map(item => item.id), "答卷批注");
    const writing = object(raw.writing, "文字与书写评价");
    const normalizedWriting = {typos: list(writing.typos, "疑似错别字", 200).map(item => {
      object(item, "疑似错别字");
      const quote = text(item.quote, "错字原文", 1000, false);
      return {quote, suggestion: text(item.suggestion, "错字建议", 2000), reason: text(item.reason, "错字说明", 5000), resolvedAnchor: anchor(answer, {quote})};
    }), crossoutsCount: writing.crossoutsCount === null ? null : integer(writing.crossoutsCount, "涂改数量", 10000), comment: text(writing.comment, "书写评价", 20000)};
    // Typed/pasted text has no handwriting evidence, regardless of model claims.
    if (!project.answerProvenance || project.answerProvenance.mode !== "image") normalizedWriting.crossoutsCount = null;
    return {status: state, score, maxScore, summary: text(raw.summary, "综合评语", 30000, false), dimensions, points, annotations,
      writing: normalizedWriting, nextSteps: strings(raw.nextSteps, "改进建议", 50)};
  }
  function validateOCR(raw) {
    object(raw, "识别结果");
    const resultText = text(raw.text, "识别文字"), meta = object(raw.questionMeta, "题目属性"), observations = object(raw.observations, "图像观察");
    const questionMeta = {
      subtype: meta.subtype === null ? null : choice(meta.subtype, SUBTYPES, "识别题型"),
      maxScore: meta.maxScore === null ? null : number(meta.maxScore, "识别分值"),
      wordLimit: meta.wordLimit === null ? null : integer(meta.wordLimit, "识别字数要求"),
      task: text(meta.task, "识别任务", 10000), scope: text(meta.scope, "识别范围", 10000)
    };
    const crossouts = list(observations.crossouts, "涂改观察", 300).map(item => {
      object(item, "涂改观察");
      return {quote: text(item.quote, "涂改原文", 3000), description: text(item.description, "涂改说明", 3000), confidence: number(item.confidence, "识别置信度", 1)};
    });
    const suspectedTypos = list(observations.suspectedTypos, "疑似错字观察", 300).map(item => {
      object(item, "疑似错字观察");
      return {quote: text(item.quote, "疑似错字原文", 3000), suggestion: text(item.suggestion, "疑似错字建议", 3000), confidence: number(item.confidence, "识别置信度", 1)};
    });
    const uncertain = list(observations.uncertain, "不确定内容", 300).map(item => {
      object(item, "不确定内容");
      return {quote: text(item.quote, "不确定原文", 3000), description: text(item.description, "不确定说明", 5000)};
    });
    if (!resultText.trim() && !uncertain.length) throw error("没有识别到文字，请检查图片是否清晰完整。");
    return {text: resultText, questionMeta, observations: {crossouts, suspectedTypos, uncertain}};
  }
  function canonical(value) {
    if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
    if (value && typeof value === "object") return "{" + Object.keys(value).sort().filter(key => value[key] !== undefined)
      .map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}";
    return JSON.stringify(value ?? null);
  }
  async function fingerprint(value) {
    const crypto = scope.crypto || globalThis.crypto;
    if (!crypto?.subtle) throw error("当前环境需要 HTTPS 或本机地址以生成内容标识。");
    const input = value instanceof ArrayBuffer || ArrayBuffer.isView(value) ? value : new TextEncoder().encode(canonical(value));
    const bytes = await crypto.subtle.digest("SHA-256", input);
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
  }
  return Object.freeze({version: "1.0.0", anchor, countWords, parseJSON, validateReference, validateReport, validateOCR, fingerprint, canonical, subtypes: [...SUBTYPES]});
});
