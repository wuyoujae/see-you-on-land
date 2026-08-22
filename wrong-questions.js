(() => {
  "use strict";

  const DB_NAME = "summer-politics-wrong-questions";
  const DB_VERSION = 1;
  const STORE_NAME = "wrongQuestions";
  const TAXONOMY_URL = "wrong-question-taxonomy.json?v=20260821-1";
  const DAY = 24 * 60 * 60 * 1000;
  const MAX_IMPORT_BYTES = 30 * 1024 * 1024;
  const FALLBACK_SUBJECTS = [
    ["political_theory", "政治理论"],
    ["general_knowledge", "常识判断/常识应用"],
    ["verbal", "言语理解与表达"],
    ["quantitative", "数量关系"],
    ["judgment_reasoning", "判断推理"],
    ["data_analysis", "资料分析"],
    ["essay", "申论"],
    ["administrative_enforcement", "行政执法专业"],
    ["police_professional", "公安专业"]
  ].map(([id, label]) => ({ id, label, types: [] }));

  const dom = {
    book: document.getElementById("wrong-book"),
    open: document.getElementById("open-wrong-book"),
    close: document.getElementById("close-wrong-book"),
    badge: document.getElementById("wrong-book-due-badge"),
    kicker: document.getElementById("wrong-book-kicker"),
    title: document.getElementById("wrong-book-title"),
    transferActions: document.getElementById("wrong-book-transfer-actions"),
    listView: document.getElementById("wrong-book-list-view"),
    reviewView: document.getElementById("wrong-book-review-view"),
    dueCount: document.getElementById("wrong-book-due-count"),
    totalCount: document.getElementById("wrong-book-total-count"),
    startReview: document.getElementById("start-wrong-review"),
    subject: document.getElementById("wrong-book-subject"),
    status: document.getElementById("wrong-book-status"),
    records: document.getElementById("wrong-book-records"),
    importButton: document.getElementById("import-wrong-questions"),
    exportButton: document.getElementById("export-wrong-questions"),
    importInput: document.getElementById("wrong-question-import-input"),
    reviewPosition: document.getElementById("wrong-review-position"),
    reviewSubject: document.getElementById("wrong-review-subject"),
    reviewProgress: document.getElementById("wrong-review-progress-bar"),
    reviewContent: document.getElementById("wrong-review-content"),
    reviewActions: document.querySelector(".wrong-review-actions")
  };

  if (!dom.book || !dom.open || !dom.records) return;

  let databasePromise = null;
  let taxonomy = { subjects: FALLBACK_SUBJECTS };
  let records = [];
  let scope = "due";
  let reviewQueue = [];
  let reviewIndex = 0;
  let grading = false;

  function refreshIcons() {
    if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 2 } });
  }

  function createId(prefix = "wrong") {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  function stringValue(value, maxLength = 500) {
    return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
  }

  function localDate(value) {
    return new Date(value).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
  }

  function startOfTomorrow() {
    const date = new Date();
    date.setHours(24, 0, 0, 0);
    return date.getTime();
  }

  function setStatus(message = "", isError = false) {
    dom.status.textContent = message;
    dom.status.classList.toggle("error", isError);
  }

  function openDatabase() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error("当前浏览器不支持错题存储"));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("createdAt", "createdAt");
          store.createIndex("nextReviewAt", "review.nextReviewAt");
          store.createIndex("subjectId", "subjectId");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("错题数据库打开失败"));
    });
    return databasePromise;
  }

  async function readAllRecords() {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error || new Error("错题读取失败"));
    });
  }

  async function writeRecord(record) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(record);
      request.onsuccess = () => resolve(record);
      request.onerror = () => reject(request.error || new Error("错题保存失败"));
    });
  }

  async function deleteRecordData(id) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error("错题删除失败"));
    });
  }

  function normalizeReview(value) {
    return {
      stage: Math.max(0, Number(value?.stage) || 0),
      intervalDays: Math.max(0, Number(value?.intervalDays) || 0),
      nextReviewAt: Number(value?.nextReviewAt) || Date.now(),
      lastReviewedAt: Number(value?.lastReviewedAt) || 0,
      history: Array.isArray(value?.history) ? value.history.slice(-100) : []
    };
  }

  function normalizeKnowledge(value, index = 0) {
    return {
      id: stringValue(value?.id, 100) || `knowledge-${index}-${Math.random().toString(36).slice(2, 7)}`,
      kind: stringValue(value?.kind, 30) || "knowledge",
      title: stringValue(value?.title, 100) || "待复习知识",
      summary: stringValue(value?.summary, 800),
      details: Array.isArray(value?.details) ? value.details.map(item => stringValue(item, 300)).filter(Boolean).slice(0, 8) : []
    };
  }

  function normalizeRecord(value) {
    const now = Date.now();
    return {
      id: stringValue(value?.id, 120) || createId(),
      version: 1,
      title: stringValue(value?.title, 100) || "未命名错题",
      subjectId: stringValue(value?.subjectId, 80),
      subjectLabel: stringValue(value?.subjectLabel, 80) || "未分类",
      typeId: stringValue(value?.typeId, 100),
      typeLabel: stringValue(value?.typeLabel, 100) || "待分类",
      correctAnswer: stringValue(value?.correctAnswer, 1000),
      questionText: stringValue(value?.questionText, 12000),
      images: Array.isArray(value?.images) ? value.images.map(image => ({
        name: stringValue(image?.name, 200) || "题目图片",
        type: stringValue(image?.type, 100),
        dataUrl: typeof image?.dataUrl === "string" ? image.dataUrl : ""
      })).filter(image => image.dataUrl.startsWith("data:image/")) : [],
      answer: stringValue(value?.answer, 30000),
      knowledge: Array.isArray(value?.knowledge) ? value.knowledge.map(normalizeKnowledge).slice(0, 16) : [],
      recordFields: Array.isArray(value?.recordFields) ? value.recordFields.map(item => stringValue(item, 100)).filter(Boolean).slice(0, 16) : [],
      source: {
        sessionId: stringValue(value?.source?.sessionId, 120),
        userMessageId: stringValue(value?.source?.userMessageId, 120),
        assistantMessageId: stringValue(value?.source?.assistantMessageId, 120)
      },
      review: normalizeReview(value?.review),
      createdAt: Number(value?.createdAt) || now,
      updatedAt: Number(value?.updatedAt) || now
    };
  }

  async function loadTaxonomy() {
    try {
      const response = await fetch(TAXONOMY_URL, { cache: "no-cache" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const value = await response.json();
      if (!Array.isArray(value?.subjects) || !value.subjects.length) throw new Error("分类数据无效");
      taxonomy = value;
    } catch {
      taxonomy = { subjects: FALLBACK_SUBJECTS };
    }
    renderSubjectOptions();
    return taxonomy;
  }

  function findSubject(subjectId, subjectLabel = "") {
    return taxonomy.subjects.find(item => item.id === subjectId)
      || taxonomy.subjects.find(item => item.label === subjectLabel)
      || null;
  }

  function findType(subject, typeId, typeLabel = "") {
    if (!subject) return null;
    return (subject.types || []).find(item => item.id === typeId)
      || (subject.types || []).find(item => item.label === typeLabel)
      || null;
  }

  function compactTaxonomy() {
    return taxonomy.subjects.map(subject => {
      const types = (subject.types || []).map(type => `${type.id}=${type.label}`).join("；");
      return `${subject.id}=${subject.label}${types ? `：[${types}]` : ""}`;
    }).join("\n");
  }

  function renderSubjectOptions() {
    const selected = dom.subject.value;
    dom.subject.innerHTML = '<option value="">全部科目</option>';
    taxonomy.subjects.forEach(subject => {
      const option = document.createElement("option");
      option.value = subject.id;
      option.textContent = subject.label;
      dom.subject.appendChild(option);
    });
    dom.subject.value = taxonomy.subjects.some(item => item.id === selected) ? selected : "";
  }

  function isDue(record) {
    return Number(record.review?.nextReviewAt) <= Date.now();
  }

  function filteredRecords() {
    const subject = dom.subject.value;
    return records
      .filter(record => scope === "all" || isDue(record))
      .filter(record => !subject || record.subjectId === subject)
      .sort((a, b) => {
        if (scope === "due") return a.review.nextReviewAt - b.review.nextReviewAt || b.createdAt - a.createdAt;
        return b.updatedAt - a.updatedAt;
      });
  }

  function dueLabel(record) {
    const next = Number(record.review.nextReviewAt) || Date.now();
    if (next <= Date.now()) return "待复习";
    if (next < startOfTomorrow()) return "今天";
    return `${localDate(next)}复习`;
  }

  function createEmptyState() {
    const empty = document.createElement("div");
    empty.className = "wrong-book-empty";
    empty.innerHTML = '<i data-lucide="book-open" aria-hidden="true"></i>';
    const title = document.createElement("h2");
    const copy = document.createElement("p");
    if (!records.length) {
      title.textContent = "还没有错题";
      copy.textContent = "完成一道拍题搜题后，选择需要复习的知识并保存。";
    } else if (scope === "due") {
      title.textContent = "今天已经复习完了";
      copy.textContent = "可以切换到“全部”查看已经收录的错题。";
    } else {
      title.textContent = "没有符合条件的错题";
      copy.textContent = "更换科目筛选后再查看。";
    }
    empty.append(title, copy);
    return empty;
  }

  function createRecordElement(record) {
    const details = document.createElement("details");
    details.className = "wrong-record";
    details.dataset.recordId = record.id;
    const summary = document.createElement("summary");
    const main = document.createElement("div");
    main.className = "wrong-record-main";
    const meta = document.createElement("div");
    meta.className = "wrong-record-meta";
    [record.subjectLabel, record.typeLabel].filter(Boolean).forEach(value => {
      const span = document.createElement("span");
      span.textContent = value;
      meta.appendChild(span);
    });
    const title = document.createElement("h2");
    title.textContent = record.title;
    const knowledge = document.createElement("p");
    knowledge.className = "wrong-record-knowledge";
    knowledge.textContent = record.knowledge.map(item => item.title).join("、") || "整题复习";
    main.append(meta, title, knowledge);
    const due = document.createElement("span");
    due.className = `wrong-record-due${isDue(record) ? " today" : ""}`;
    due.textContent = dueLabel(record);
    summary.append(main, due);

    const body = document.createElement("div");
    body.className = "wrong-record-body";
    if (record.questionText) {
      const question = document.createElement("p");
      question.className = "wrong-record-question";
      question.textContent = record.questionText;
      body.appendChild(question);
    }
    const items = document.createElement("div");
    items.className = "wrong-record-items";
    record.knowledge.forEach(item => {
      const row = document.createElement("div");
      row.className = "wrong-record-item";
      const itemTitle = document.createElement("strong");
      itemTitle.textContent = item.title;
      const itemCopy = document.createElement("span");
      itemCopy.textContent = [item.summary, ...item.details].filter(Boolean).join("；");
      row.append(itemTitle);
      if (itemCopy.textContent) row.appendChild(itemCopy);
      items.appendChild(row);
    });
    body.appendChild(items);

    const actions = document.createElement("div");
    actions.className = "wrong-record-actions";
    const review = document.createElement("button");
    review.type = "button";
    review.dataset.wrongReview = record.id;
    review.title = "复习这道题";
    review.setAttribute("aria-label", `复习${record.title}`);
    review.innerHTML = '<i data-lucide="play" aria-hidden="true"></i>';
    const remove = document.createElement("button");
    remove.type = "button";
    remove.dataset.wrongDelete = record.id;
    remove.title = "删除错题";
    remove.setAttribute("aria-label", `删除${record.title}`);
    remove.innerHTML = '<i data-lucide="trash-2" aria-hidden="true"></i>';
    actions.append(review, remove);
    body.appendChild(actions);
    details.append(summary, body);
    return details;
  }

  function updateCounts() {
    const due = records.filter(isDue).length;
    dom.dueCount.textContent = String(due);
    dom.totalCount.textContent = String(records.length);
    dom.badge.textContent = due > 99 ? "99+" : String(due);
    dom.badge.hidden = due === 0;
    dom.badge.setAttribute("aria-label", `${due}道待复习`);
    const queue = filteredRecords();
    dom.startReview.disabled = queue.length === 0;
  }

  function renderList() {
    updateCounts();
    dom.records.innerHTML = "";
    const filtered = filteredRecords();
    if (!filtered.length) dom.records.appendChild(createEmptyState());
    else filtered.forEach(record => dom.records.appendChild(createRecordElement(record)));
    refreshIcons();
  }

  async function refreshRecords() {
    try {
      records = (await readAllRecords()).map(normalizeRecord);
      setStatus("");
    } catch (error) {
      records = [];
      setStatus(error.message || "错题读取失败", true);
    }
    renderList();
    return records;
  }

  function setListMode() {
    dom.listView.hidden = false;
    dom.reviewView.hidden = true;
    dom.kicker.textContent = "REVIEW";
    dom.title.textContent = "错题本";
    dom.transferActions.hidden = false;
    refreshIcons();
  }

  async function openBook(recordId = "") {
    dom.book.hidden = false;
    setListMode();
    if (recordId) {
      scope = "all";
      document.querySelectorAll("[data-wrong-scope]").forEach(button => {
        const active = button.dataset.wrongScope === "all";
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", String(active));
      });
    }
    await refreshRecords();
    if (recordId) {
      requestAnimationFrame(() => {
        const row = Array.from(dom.records.querySelectorAll("[data-record-id]")).find(item => item.dataset.recordId === recordId);
        if (!row) return;
        row.open = true;
        row.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }

  function closeBook() {
    if (!dom.reviewView.hidden) {
      setListMode();
      renderList();
      return;
    }
    dom.book.hidden = true;
  }

  function renderSafeMarkdown(element, source) {
    const text = String(source || "");
    if (!window.marked?.parse || !window.DOMPurify?.sanitize) {
      element.textContent = text;
      return;
    }
    element.innerHTML = window.DOMPurify.sanitize(window.marked.parse(text, { gfm: true, breaks: true }), {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["style"],
      FORBID_ATTR: ["style"]
    });
    element.querySelectorAll("a[href]").forEach(link => {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    });
  }

  function renderReview() {
    dom.reviewActions.querySelectorAll("button").forEach(button => {
      button.disabled = false;
    });
    const record = reviewQueue[reviewIndex];
    if (!record) {
      setListMode();
      setStatus("本轮复习完成。");
      refreshRecords();
      return;
    }
    dom.listView.hidden = true;
    dom.reviewView.hidden = false;
    dom.kicker.textContent = "REVIEWING";
    dom.title.textContent = "复习错题";
    dom.transferActions.hidden = true;
    dom.reviewPosition.textContent = `${reviewIndex + 1} / ${reviewQueue.length}`;
    dom.reviewSubject.textContent = `${record.subjectLabel} · ${record.typeLabel}`;
    dom.reviewProgress.style.width = `${((reviewIndex + 1) / reviewQueue.length) * 100}%`;
    dom.reviewContent.innerHTML = "";

    if (record.images.length) {
      const images = document.createElement("div");
      images.className = "wrong-review-source-images";
      record.images.forEach(image => {
        const preview = document.createElement("img");
        preview.src = image.dataUrl;
        preview.alt = image.name;
        images.appendChild(preview);
      });
      dom.reviewContent.appendChild(images);
    }
    const question = document.createElement("p");
    question.className = "wrong-review-question";
    question.textContent = record.questionText || "请回忆原题的判断方法和关键知识。";
    dom.reviewContent.appendChild(question);

    const heading = document.createElement("h2");
    heading.className = "wrong-review-heading";
    heading.textContent = "本题需要掌握";
    dom.reviewContent.appendChild(heading);
    const knowledge = document.createElement("div");
    knowledge.className = "wrong-review-knowledge";
    record.knowledge.forEach(item => {
      const row = document.createElement("section");
      row.className = "wrong-review-knowledge-item";
      const title = document.createElement("strong");
      title.textContent = item.title;
      const copy = document.createElement("p");
      copy.textContent = [item.summary, ...item.details].filter(Boolean).join("；");
      row.append(title);
      if (copy.textContent) row.appendChild(copy);
      knowledge.appendChild(row);
    });
    dom.reviewContent.appendChild(knowledge);

    if (record.answer) {
      const answer = document.createElement("details");
      answer.className = "wrong-review-answer";
      answer.innerHTML = '<summary><i data-lucide="message-square-text" aria-hidden="true"></i><span>查看原解析</span></summary>';
      const copy = document.createElement("div");
      copy.className = "wrong-review-answer-copy solver-markdown";
      renderSafeMarkdown(copy, record.answer);
      answer.appendChild(copy);
      dom.reviewContent.appendChild(answer);
    }
    dom.reviewView.scrollTo({ top: 0, behavior: "auto" });
    refreshIcons();
  }

  function startReview(recordId = "") {
    if (recordId) reviewQueue = records.filter(record => record.id === recordId);
    else reviewQueue = filteredRecords();
    if (!reviewQueue.length) return;
    reviewIndex = 0;
    renderReview();
  }

  function reviewSchedule(record, grade) {
    const previousStage = Math.max(0, Number(record.review.stage) || 0);
    let stage;
    let intervalDays;
    if (grade === "forgot") {
      stage = 0;
      intervalDays = 1;
    } else if (grade === "fuzzy") {
      const intervals = [1, 2, 4, 7, 14, 30, 60];
      stage = Math.max(1, previousStage + 1);
      intervalDays = intervals[Math.min(stage - 1, intervals.length - 1)];
    } else {
      const intervals = [3, 7, 14, 30, 60, 120, 240];
      stage = previousStage + 1;
      intervalDays = intervals[Math.min(previousStage, intervals.length - 1)];
    }
    const reviewedAt = Date.now();
    record.review = {
      stage,
      intervalDays,
      lastReviewedAt: reviewedAt,
      nextReviewAt: reviewedAt + intervalDays * DAY,
      history: [...(record.review.history || []), { reviewedAt, grade, intervalDays }].slice(-100)
    };
    record.updatedAt = reviewedAt;
  }

  async function gradeReview(grade) {
    const record = reviewQueue[reviewIndex];
    if (grading || !record || !["forgot", "fuzzy", "mastered"].includes(grade)) return;
    grading = true;
    dom.reviewActions.querySelectorAll("button").forEach(button => {
      button.disabled = true;
    });
    try {
      reviewSchedule(record, grade);
      await writeRecord(record);
      const index = records.findIndex(item => item.id === record.id);
      if (index >= 0) records[index] = record;
      reviewIndex += 1;
      renderReview();
      updateCounts();
    } finally {
      grading = false;
      if (!dom.reviewView.hidden) {
        dom.reviewActions.querySelectorAll("button").forEach(button => {
          button.disabled = false;
        });
      }
    }
  }

  function responseOutputText(payload) {
    if (typeof payload?.output_text === "string") return payload.output_text;
    return (payload?.output || []).flatMap(item => item?.type === "message" ? (item.content || []) : [])
      .filter(part => part?.type === "output_text" || part?.type === "text")
      .map(part => part.text || "")
      .join("");
  }

  function parseJsonContent(value) {
    const text = String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    try {
      return JSON.parse(text);
    } catch {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
      throw new Error("模型没有返回可识别的错题分类");
    }
  }

  function analysisSchema() {
    return {
      type: "object",
      properties: {
        subjectId: { type: "string", description: "必须使用给定分类中的科目ID" },
        subjectLabel: { type: "string" },
        typeId: { type: "string", description: "必须使用该科目下的题型ID" },
        typeLabel: { type: "string" },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        title: { type: "string", description: "不超过30字的错题标题" },
        correctAnswer: { type: "string" },
        candidates: {
          type: "array",
          minItems: 1,
          maxItems: 10,
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["term", "rule", "formula", "method", "mistake", "material_point", "argument", "fact", "other"] },
              title: { type: "string" },
              summary: { type: "string" },
              details: { type: "array", items: { type: "string" }, maxItems: 8 }
            },
            required: ["kind", "title", "summary", "details"],
            additionalProperties: false
          }
        }
      },
      required: ["subjectId", "subjectLabel", "typeId", "typeLabel", "confidence", "title", "correctAnswer", "candidates"],
      additionalProperties: false
    };
  }

  function analysisRequest(userMessage, assistantText) {
    const instructions = [
      "你是公务员考试错题整理器。请识别题目所属科目和具体题型，并提取值得以后单独复习的最小知识单元。",
      "只能从下面给定的科目ID和题型ID中选择。不要创造新的ID。",
      compactTaxonomy(),
      "提取规则：",
      "1. 选词填空必须把每个有辨析价值的候选词或成语分别作为候选项，并解释词义、侧重点、搭配和易混点。",
      "2. 政治、常识、法律题按可独立记忆的事实、政策、概念或法条拆分。",
      "3. 数量、资料、图形、逻辑和科学题提取可复用的公式、模型、规律、论证方法或实验原则，不要只复述答案。",
      "4. 申论提取遗漏要点、规范表达、分类方式、文种规则、论点或论据。",
      "5. 候选项应有2到8个；每项标题简短，summary可脱离原题独立复习。不要输出整题候选项，页面会另行提供。",
      "6. 如果图片信息不完整，仍需根据可见题干和解析做最稳妥分类，不要编造原题事实。"
    ].join("\n");
    const content = [{
      type: "input_text",
      text: `题目文字：\n${userMessage.text || "（题目主要在图片中）"}\n\n已有解析：\n${assistantText}`
    }];
    (userMessage.images || []).forEach(image => {
      if (image.dataUrl) content.push({ type: "input_image", image_url: image.dataUrl, detail: "auto" });
    });
    return {
      instructions,
      input: [{ type: "message", role: "user", content }]
    };
  }

  async function requestAnalysis(endpoint, body, apiKey, headers, signal) {
    const response = await fetch(endpoint, {
      method: "POST",
      signal,
      headers: typeof headers === "function" ? headers(apiKey) : {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const error = new Error(payload?.error?.message || `错题识别请求失败（${response.status}）`);
      error.status = response.status;
      throw error;
    }
    const payload = await response.json();
    const output = responseOutputText(payload);
    if (!output) throw new Error(payload?.error?.message || "模型没有返回错题分类");
    return parseJsonContent(output);
  }

  function normalizeAnalysis(value) {
    const subject = findSubject(value?.subjectId, value?.subjectLabel);
    const type = findType(subject, value?.typeId, value?.typeLabel);
    const candidates = Array.isArray(value?.candidates) ? value.candidates.map((item, index) => ({
      id: `candidate-${index}-${Math.random().toString(36).slice(2, 7)}`,
      kind: stringValue(item?.kind, 30) || "knowledge",
      title: stringValue(item?.title, 100) || `知识点${index + 1}`,
      summary: stringValue(item?.summary, 800),
      details: Array.isArray(item?.details) ? item.details.map(detail => stringValue(detail, 300)).filter(Boolean).slice(0, 8) : []
    })).filter(item => item.title).slice(0, 10) : [];
    if (!candidates.length) throw new Error("没有识别到可记录的知识点");
    return {
      subjectId: subject?.id || stringValue(value?.subjectId, 80),
      subjectLabel: subject?.label || stringValue(value?.subjectLabel, 80) || "未分类",
      typeId: type?.id || stringValue(value?.typeId, 100),
      typeLabel: type?.label || stringValue(value?.typeLabel, 100) || "待分类",
      confidence: Math.max(0, Math.min(1, Number(value?.confidence) || 0)),
      title: stringValue(value?.title, 100) || "拍题错题",
      correctAnswer: stringValue(value?.correctAnswer, 1000),
      candidates,
      recordFields: Array.isArray(type?.recordFields) ? type.recordFields.slice() : []
    };
  }

  async function analyzeQuestion({ apiKey, endpoint, model, headers, userMessage, assistantText, signal }) {
    await taxonomyReady;
    if (!endpoint) throw new Error("Responses API Base URL 无效");
    const request = analysisRequest(userMessage, assistantText);
    const base = { model, ...request, stream: false, store: false };
    let value;
    try {
      value = await requestAnalysis(endpoint, {
        ...base,
        text: {
          format: { type: "json_schema", name: "wrong_question_analysis", strict: true, schema: analysisSchema() }
        }
      }, apiKey, headers, signal);
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      if (error?.status && ![400, 404, 422].includes(error.status)) throw error;
      value = await requestAnalysis(endpoint, {
        ...base,
        instructions: `${request.instructions}\n仅输出一个合法JSON对象，不要使用Markdown代码块。字段必须为subjectId、subjectLabel、typeId、typeLabel、confidence、title、correctAnswer、candidates；candidates每项包含kind、title、summary、details。`,
        text: { format: { type: "json_object" } }
      }, apiKey, headers, signal).catch(async fallbackError => {
        if (fallbackError?.name === "AbortError") throw fallbackError;
        if (fallbackError?.status && ![400, 404, 422].includes(fallbackError.status)) throw fallbackError;
        return requestAnalysis(endpoint, {
          ...base,
          instructions: `${request.instructions}\n仅输出一个合法JSON对象，不要使用Markdown代码块。`
        }, apiKey, headers, signal);
      });
    }
    return normalizeAnalysis(value);
  }

  async function saveFromConversation({ sessionId, userMessage, assistantMessage, selectedIds, customText }) {
    const analysis = assistantMessage.wrongQuestionAnalysis;
    if (!analysis) throw new Error("请先完成错题识别");
    const selected = new Set(selectedIds || []);
    const knowledge = [];
    if (selected.has("__whole__")) {
      knowledge.push({
        id: "whole-question",
        kind: "whole",
        title: "整道题与解题方法",
        summary: "复习原题条件、正确答案和完整解析。",
        details: []
      });
    }
    analysis.candidates.filter(item => selected.has(item.id)).forEach(item => knowledge.push(normalizeKnowledge(item, knowledge.length)));
    const custom = stringValue(customText, 300);
    if (custom) {
      knowledge.push({ id: createId("custom"), kind: "custom", title: custom, summary: "用户补充的复习内容", details: [] });
    }
    if (!knowledge.length) throw new Error("请至少选择或填写一项需要复习的内容");

    const existing = assistantMessage.wrongQuestionId
      ? records.find(item => item.id === assistantMessage.wrongQuestionId)
      : records.find(item => item.source.assistantMessageId === assistantMessage.id && item.source.sessionId === sessionId);
    const now = Date.now();
    const record = normalizeRecord({
      id: existing?.id || createId(),
      title: analysis.title,
      subjectId: analysis.subjectId,
      subjectLabel: analysis.subjectLabel,
      typeId: analysis.typeId,
      typeLabel: analysis.typeLabel,
      correctAnswer: analysis.correctAnswer,
      questionText: userMessage.text || "请根据原题图片复习。",
      images: userMessage.images || [],
      answer: assistantMessage.text,
      knowledge,
      recordFields: analysis.recordFields || [],
      source: { sessionId, userMessageId: userMessage.id, assistantMessageId: assistantMessage.id },
      review: existing?.review || normalizeReview(),
      createdAt: existing?.createdAt || now,
      updatedAt: now
    });
    await writeRecord(record);
    const index = records.findIndex(item => item.id === record.id);
    if (index >= 0) records[index] = record;
    else records.unshift(record);
    renderList();
    window.dispatchEvent(new CustomEvent("wrong-question:saved", { detail: { record } }));
    return record;
  }

  async function removeRecord(record) {
    if (!record || !window.confirm(`确定删除“${record.title}”吗？此操作无法撤销。`)) return;
    await deleteRecordData(record.id);
    records = records.filter(item => item.id !== record.id);
    renderList();
    window.dispatchEvent(new CustomEvent("wrong-question:deleted", { detail: { record } }));
  }

  function exportRecords() {
    const payload = {
      kind: "summer-politics-wrong-questions",
      version: 1,
      exportedAt: new Date().toISOString(),
      records
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `错题本-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus(`已导出${records.length}道错题。`);
  }

  async function importRecords(file) {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) throw new Error("导入文件不能超过30MB");
    const payload = JSON.parse(await file.text());
    if (payload?.kind !== "summer-politics-wrong-questions" || !Array.isArray(payload.records)) {
      throw new Error("这不是有效的错题本备份文件");
    }
    const incoming = payload.records.map(normalizeRecord);
    const existing = new Map(records.map(record => [record.id, record]));
    let changed = 0;
    for (const record of incoming) {
      const current = existing.get(record.id);
      if (!current || record.updatedAt >= current.updatedAt) {
        await writeRecord(record);
        existing.set(record.id, record);
        changed += 1;
      }
    }
    records = [...existing.values()];
    renderList();
    setStatus(`导入完成，更新${changed}道错题。`);
  }

  dom.open.addEventListener("click", () => openBook());
  dom.close.addEventListener("click", closeBook);
  document.querySelectorAll("[data-wrong-scope]").forEach(button => {
    button.addEventListener("click", () => {
      scope = button.dataset.wrongScope;
      document.querySelectorAll("[data-wrong-scope]").forEach(item => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-selected", String(active));
      });
      renderList();
    });
  });
  dom.subject.addEventListener("change", renderList);
  dom.startReview.addEventListener("click", () => startReview());
  dom.records.addEventListener("click", event => {
    const reviewButton = event.target.closest("button[data-wrong-review]");
    const deleteButton = event.target.closest("button[data-wrong-delete]");
    if (reviewButton) {
      event.preventDefault();
      startReview(reviewButton.dataset.wrongReview);
    }
    if (deleteButton) {
      event.preventDefault();
      removeRecord(records.find(item => item.id === deleteButton.dataset.wrongDelete)).catch(error => setStatus(error.message, true));
    }
  });
  dom.reviewActions.addEventListener("click", event => {
    const button = event.target.closest("button[data-review-grade]");
    if (button) gradeReview(button.dataset.reviewGrade).catch(error => setStatus(error.message, true));
  });
  dom.exportButton.addEventListener("click", exportRecords);
  dom.importButton.addEventListener("click", () => dom.importInput.click());
  dom.importInput.addEventListener("change", async () => {
    try {
      await importRecords(dom.importInput.files?.[0]);
    } catch (error) {
      setStatus(error.message || "错题导入失败", true);
    } finally {
      dom.importInput.value = "";
    }
  });
  window.addEventListener("summer-politics:tabchange", () => {
    if (!dom.book.hidden) dom.book.hidden = true;
  });

  const taxonomyReady = loadTaxonomy();
  const ready = Promise.all([taxonomyReady, refreshRecords()]).then(() => true);

  window.wrongQuestionBook = {
    ready,
    analyzeQuestion,
    saveFromConversation,
    open: openBook,
    refresh: refreshRecords,
    getTypeDefinition(subjectId, typeId) {
      const subject = findSubject(subjectId);
      return findType(subject, typeId);
    }
  };

  refreshIcons();
})();
