/* One question card, followed by its source answer and our AI explanation. */
(() => {
  "use strict";
  const root = document.getElementById("view-practice"), Core = window.PracticeCore;
  if (!root || !Core) return;
  const STORAGE_KEY = "summer-politics-drill-v1";
  const SUBJECTS = [
    { id: "politics", title: "政治理论", icon: "landmark" }, { id: "common", title: "常识判断", icon: "lightbulb" },
    { id: "language", title: "言语理解", icon: "messages-square" }, { id: "quantity", title: "数量关系", icon: "sigma" },
    { id: "reasoning", title: "判断推理", icon: "shapes" }, { id: "analysis", title: "资料分析", icon: "chart-no-axes-combined" }
  ];
  const esc = value => window.RichContent.escapeHTML(value);
  const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  const subjectTitle = id => SUBJECTS.find(item => item.id === id)?.title || "整套试卷";
  let progress = readProgress(), manifest, manifestPromise, current = null, component = null;
  let serial = 0, routeHandling = false, active = false, saving, notice = "", direction = "next";
  let aiSubscription, aiSerial = 0, setup = null, pendingHash = "", pendingPromise;
  const subjectCache = new Map(), paperCache = new Map(), questionMap = new Map();

  function readProgress() { try { return Core.mergeProgress({}, JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}")); } catch { return Core.mergeProgress({}, {}); } }
  function mergeLatest() { progress = Core.mergeProgress(progress, readProgress()); return progress; }
  function flush() {
    clearTimeout(saving);
    try { mergeLatest(); const raw = JSON.stringify(progress); if (localStorage.getItem(STORAGE_KEY) !== raw) localStorage.setItem(STORAGE_KEY, raw); }
    catch { tell("进度暂存在本页，请先导出备份后再关闭页面。"); }
  }
  function updateSession(session) {
    progress.sessions[session.id] = session; progress.updatedAt = Math.max(progress.updatedAt, session.updatedAt);
    if (current?.session.id === session.id) current.session = session;
    clearTimeout(saving); saving = setTimeout(flush, 180);
  }
  function cleanup() { window.AppUI?.closePopover?.(); component?.destroy(); component = null; aiSubscription?.abort(); aiSubscription = null; ++aiSerial; root.querySelector(".drill-jump")?.close(); }
  function refresh(host = root) { window.AppUI?.refresh(host); window.lucide?.createIcons({ root: host }); window.RichContent?.hydrate(host); }
  function tell(message = "") { notice = message; const el = root.querySelector(".drill-notice"); if (el) { el.textContent = message; el.hidden = !message; } }
  async function fetchJSON(path) {
    if (!/^data\/question-bank\/(?:manifest\.json|(?:subjects|papers)\/[a-zA-Z0-9_-]+\.json)$/.test(path)) throw new Error("题库地址不正确");
    const response = await fetch(path, { cache: "no-cache" }); if (!response.ok) throw new Error("题库暂时未能加载"); return response.json();
  }
  async function ensureManifest() {
    if (manifest) return manifest;
    if (!manifestPromise) manifestPromise = fetchJSON("data/question-bank/manifest.json").then(value => {
      if (value.version !== 1 || !Array.isArray(value.subjects) || !Array.isArray(value.papers)) throw new Error("题库目录格式不正确");
      manifest = value; return value;
    }).catch(error => { manifestPromise = null; throw error; });
    return manifestPromise;
  }
  async function loadSubject(id) {
    const meta = manifest.subjects.find(item => item.id === id); if (!meta) return [];
    if (!subjectCache.has(id)) subjectCache.set(id, fetchJSON(meta.path).then(value => {
      const questions = Array.isArray(value) ? value : value.questions;
      if (!Array.isArray(questions) || questions.some(question => !question.id || question.subjectId !== id)) throw new Error("题库科目内容不正确");
      questions.forEach(question => questionMap.set(question.id, question)); return questions;
    }).catch(error => { subjectCache.delete(id); throw error; }));
    return subjectCache.get(id);
  }
  async function loadPaper(id) {
    const meta = manifest.papers.find(item => item.id === id); if (!meta) throw new Error("找不到这套试卷");
    if (!paperCache.has(id)) paperCache.set(id, fetchJSON(meta.path).then(value => {
      if (value.id !== id || !Array.isArray(value.questionIds)) throw new Error("试卷题目索引不正确"); return value;
    }).catch(error => { paperCache.delete(id); throw error; }));
    return paperCache.get(id);
  }
  function parseRoute(hash = location.hash) {
    if (["#/study", "#/study/"].includes(hash)) return { page: "catalog" };
    const [path, query = ""] = hash.split("?"), session = /^#\/study\/session\/([a-zA-Z0-9_-]+)$/.exec(path);
    if (session) { const params = new URLSearchParams(query), raw = params.get("q"); return { page: "session", id: session[1], index: raw !== null && /^\d+$/.test(raw) ? Number(raw) : null, view: params.get("view") === "answer" ? "answer" : "question" }; }
    const paper = /^#\/study\/paper\/([a-zA-Z0-9_-]+)$/.exec(path); if (paper) return { page: "setup", paperId: paper[1] };
    const subject = /^#\/study\/([a-z]+)(?:\/[a-zA-Z0-9-]+)?$/.exec(path);
    return subject && SUBJECTS.some(item => item.id === subject[1]) ? { page: "setup", subjectId: subject[1] } : null;
  }
  function navigate(hash, replace = false) { flush(); history[replace || hash === location.hash ? "replaceState" : "pushState"](null, "", hash); return resolveRoute(); }
  function sessionHash(session, index = session.current, view = "question") { return `#/study/session/${session.id}?q=${index}&view=${view}`; }
  function activate(session) {
    active = true; routeHandling = true;
    if (!root.classList.contains("active")) document.querySelector('.tab-item[data-tab="practice"]')?.click();
    routeHandling = false; root.classList.remove("practice-is-solving", "practice-keyboard-open", "learning-catalog");
    root.classList.toggle("drill-session", session); root.classList.toggle("learning-session", session); root.classList.toggle("drill-catalog", !session);
    document.getElementById("app")?.classList.toggle("study-mode", session); document.documentElement.classList.remove("study-route-loading"); window.LearningApp?.rememberMode("practice");
  }
  function getStatistics(subjectId) {
    const stubs = (manifest?.subjects || []).filter(subject => !subjectId || subject.id === subjectId).flatMap(subject => (subject.questionIds || []).map(id => ({ id, subjectId: subject.id })));
    const stats = Core.getStatistics(progress, stubs.length ? stubs : null, subjectId);
    if (!stubs.length && manifest) stats.total = subjectId ? manifest.subjects.find(item => item.id === subjectId)?.questionCount || 0 : manifest.totals?.questionCount || 0;
    return stats;
  }
  function renderPapers(year = "") {
    return manifest.papers.filter(paper => !year || String(paper.year) === year).sort((a, b) => b.year - a.year || a.title.localeCompare(b.title, "zh-CN"))
      .map(paper => `<a class="drill-paper" href="#/study/paper/${paper.id}"><span class="drill-paper-year">${paper.year}</span><span><strong>${esc(paper.title)}</strong><small>${paper.questionCount} 题${paper.variant ? ` · ${esc(paper.variant)}` : ""}</small></span>${icon("chevron-right")}</a>`).join("");
  }
  function updateCatalogCount(papers) {
    const host = root.querySelector("#drill-bank-count"); if (!host) return;
    const year = root.querySelector("#drill-year")?.value || "";
    const available = manifest.papers.filter(paper => !year || String(paper.year) === year);
    host.textContent = papers ? `${available.length} 套真题 · ${available.reduce((sum, paper) => sum + paper.questionCount, 0).toLocaleString()} 题次` : `${manifest.papers.length} 套真题 · ${getStatistics().total.toLocaleString()} 题`;
  }
  function renderCatalog() {
    cleanup(); current = null; setup = null; activate(false); const stats = getStatistics();
    const latest = Object.values(progress.sessions).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    root.innerHTML = `<div class="drill-catalog-shell"><header class="page-header"><h1>做题学习</h1>${window.LearningApp?.modeSwitchMarkup("practice") || ""}</header><div class="drill-catalog-tools"><div class="drill-catalog-tabs" role="tablist" aria-label="题库浏览方式"><button type="button" role="tab" aria-selected="true" data-drill-list="subjects">按科目</button><button type="button" role="tab" aria-selected="false" data-drill-list="papers">按试卷</button></div><span id="drill-bank-count">${manifest.totals?.paperCount ?? manifest.papers.length} 套真题 · ${stats.total.toLocaleString()} 题</span></div>
      ${latest ? `<a class="learn-resume drill-resume" href="${sessionHash(latest, latest.current, Core.canShow(latest, latest.questionIds[latest.current], "answer") ? "answer" : "question")}"><span class="learn-resume-icon">${icon("play")}</span><span><small>继续练习</small><strong>${esc(titleForSession(latest))}</strong></span><span class="drill-resume-count">${Core.statistics(latest).submitted} / ${latest.questionIds.length}</span>${icon("arrow-right")}</a>` : ""}
      <div class="drill-subject-list">${SUBJECTS.map(subject => {
        const meta = manifest.subjects.find(item => item.id === subject.id), result = getStatistics(subject.id);
        return `<a class="drill-subject" href="#/study/${subject.id}"><span class="practice-module-icon">${icon(subject.icon)}</span><span class="drill-subject-copy"><strong>${subject.title}</strong><span>${(meta?.questionCount || 0).toLocaleString()} 道真题${result.submitted ? ` · 已提交 ${result.submitted} 题 · 正确率 ${result.accuracy}%` : ""}</span></span><span class="drill-subject-progress" aria-hidden="true"><span style="width:${meta?.questionCount ? Math.min(100, result.submitted / meta.questionCount * 100) : 0}%"></span></span>${icon("chevron-right")}</a>`;
      }).join("")}</div><div class="drill-paper-list" hidden><label class="drill-year-filter">年份<select id="drill-year" aria-label="筛选试卷年份"><option value="">全部年份</option>${[...new Set(manifest.papers.map(paper => paper.year))].sort((a, b) => b - a).map(year => `<option value="${year}">${year}</option>`).join("")}</select></label><div id="drill-papers">${renderPapers()}</div></div><p class="drill-notice" role="status" hidden></p></div>`;
    refresh(); tell(notice);
    window.PageTransitions?.enter(root, { key: `drill:${location.hash}`, direction: "previous" });
  }
  async function prepareSetup(route, token) {
    const questions = route.subjectId ? await loadSubject(route.subjectId) : (await Promise.all(manifest.subjects.map(subject => loadSubject(subject.id)))).flat();
    const paper = route.paperId ? await loadPaper(route.paperId) : null; if (token !== serial) return;
    setup = { subjectId: route.subjectId || "", paperId: route.paperId || "", questions, paper }; current = null; activate(false);
    const recent = Object.values(progress.sessions).filter(session => route.paperId ? session.setId === route.paperId : session.subjectId === route.subjectId && !session.setId).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    root.innerHTML = `<div class="drill-catalog-shell"><header class="drill-setup-header"><a class="learn-exit" href="#/study" aria-label="返回题库">${icon("arrow-left")}</a><h1>${esc(paper?.title || subjectTitle(route.subjectId))}</h1></header><section class="drill-setup"><div class="drill-setup-heading">${icon(paper ? "files" : SUBJECTS.find(subject => subject.id === route.subjectId)?.icon || "book-open")}<span>选择本次练习</span></div><form id="drill-start-form"><label>${paper ? "科目" : "试卷"}<select id="drill-filter" aria-label="${paper ? "选择练习科目" : "选择来源试卷"}"><option value="">${paper ? "整套试卷" : "全部国考真题"}</option>${paper ? SUBJECTS.filter(subject => questions.some(question => question.subjectId === subject.id && paper.questionIds.includes(question.id))).map(subject => `<option value="${subject.id}">${subject.title}</option>`).join("") : manifest.papers.filter(item => !item.subjectCounts || item.subjectCounts[route.subjectId] > 0).sort((a, b) => b.year - a.year).map(item => `<option value="${item.id}">${esc(item.title)}</option>`).join("")}</select></label><label>题量<span class="drill-count-control"><input type="number" id="drill-count" min="1" step="1" inputmode="numeric" aria-label="本次练习题量"><button class="drill-all" type="button" data-drill-action="all">全部</button></span><small id="drill-count-hint"></small></label><label>顺序<select id="drill-order" aria-label="练习顺序"><option value="${paper ? "source" : "random"}">${paper ? "来源编排" : "随机抽题"}</option><option value="${paper ? "random" : "source"}">${paper ? "随机抽题" : "题库顺序"}</option></select></label><button class="learn-next learn-button drill-start" type="submit">开始做题 ${icon("arrow-right")}</button></form>${recent ? `<a class="drill-continue" href="${sessionHash(recent, recent.current, Core.canShow(recent, recent.questionIds[recent.current], "answer") ? "answer" : "question")}">继续上次练习 · ${Core.statistics(recent).submitted} / ${recent.questionIds.length} ${icon("arrow-right")}</a>` : ""}</section><p class="drill-notice" role="alert" hidden></p></div>`;
    updateAvailable(); refresh();
    window.PageTransitions?.enter(root, { key: `drill:${location.hash}`, direction: "next" });
  }
  function setupQuestions() {
    if (!setup) return []; const filter = root.querySelector("#drill-filter")?.value || "";
    if (setup.paper) { const map = new Map(setup.questions.map(question => [question.id, question])); return setup.paper.questionIds.map(id => map.get(id)).filter(question => question && (!filter || question.subjectId === filter)); }
    if (!filter) return setup.questions;
    const paper = manifest.papers.find(item => item.id === filter), ids = paper?.questionIds ? new Set(paper.questionIds) : null;
    return setup.questions.filter(question => ids ? ids.has(question.id) : question.source?.paperId === filter || question.paperRefs?.some(ref => ref.paperId === filter));
  }
  function updateAvailable() {
    const items = setupQuestions(), count = root.querySelector("#drill-count"), hint = root.querySelector("#drill-count-hint");
    if (count) { count.max = String(items.length); count.value = String(items.length); count.required = true; }
    if (hint) hint.textContent = `共 ${items.length.toLocaleString()} 题，可选择 1—${items.length.toLocaleString()} 题。`;
    const start = root.querySelector('.drill-start'); if (start) start.disabled = !items.length; tell(items.length ? "" : "这份筛选下暂时没有题目。");
  }
  async function startSession() {
    if (!setup) return; const questions = setupQuestions(), field = root.querySelector("#drill-count"), count = Number(field?.value);
    if (!Number.isInteger(count) || count < 1 || count > questions.length) { tell(`题量请输入 1 到 ${questions.length} 之间的整数。`); field?.focus(); return; }
    const id = `drill-${crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(36).slice(2)}`, filter = root.querySelector("#drill-filter")?.value || "";
    const session = Core.createSession({ id, subjectId: setup.subjectId || filter || "all", setId: setup.paperId || filter, questionIds: Core.selectQuestionIds(questions, { count, seed: id, order: root.querySelector("#drill-order").value }) });
    updateSession(session); await navigate(sessionHash(session, 0));
  }

  async function prepareSession(route, token) {
    const session = progress.sessions[route.id]; if (!session) throw new Error("这次练习未保存在当前浏览器中，可以返回题库重新开始或导入备份。");
    if (SUBJECTS.some(subject => subject.id === session.subjectId)) await loadSubject(session.subjectId);
    else await Promise.all(manifest.subjects.map(subject => loadSubject(subject.id)));
    if (token !== serial) return;
    const index = Math.min(Math.max(0, route.index ?? session.current), session.questionIds.length - 1), question = questionMap.get(session.questionIds[index]);
    if (!question) throw new Error("这道题的来源暂时未能加载，练习进度仍然保留。");
    let view = route.view;
    if (!Core.canShow(session, question.id, view)) { view = "question"; notice = "先完成这道题，再查看答案与解析。"; history.replaceState(null, "", sessionHash(session, index, view)); }
    current = { session, index, view, question }; setup = null; updateSession(Core.setCurrent(session, index)); renderSession();
  }
  function titleForSession(session) { return session.setId ? manifest.papers.find(paper => paper.id === session.setId)?.title || "国考真题" : subjectTitle(session.subjectId); }
  function sourceLabel(question, session = current?.session) {
    const ref = question.paperRefs?.find(item => item.paperId === session?.setId) || question.paperRefs?.[0];
    const paper = manifest.papers.find(item => item.id === (ref?.paperId || question.source?.paperId)), number = ref?.questionNumber ?? question.source?.questionNumber;
    return [paper?.title || (question.source?.year ? `${question.source.year} 国考` : "国考真题"), number ? `第 ${number} 题` : ref?.moduleNumber ? `${subjectTitle(question.subjectId)}第 ${ref.moduleNumber} 题` : ""].filter(Boolean).join(" · ");
  }
  function renderSession() {
    cleanup(); activate(true);
    const { session, index, view, question } = current, stats = Core.statistics(session);
    const nextLabel = view === "question" ? "提交答案" : index === session.questionIds.length - 1 ? "完成练习" : "下一题";
    root.innerHTML = `<div class="learn-session-shell drill-workspace"><header class="learn-session-header"><div class="learn-context"><button class="learn-exit" data-drill-action="exit" aria-label="返回题库">${icon("x")}</button><div>${titleForSession(session) === subjectTitle(question.subjectId) ? "" : `<span>${subjectTitle(question.subjectId)}</span>`}<strong>${esc(titleForSession(session))}</strong></div></div><nav class="learn-navigation" aria-label="练习翻页"><button class="learn-back learn-button" data-drill-action="previous" aria-label="上一页" ${index === 0 && view === "question" ? "disabled" : ""}>${icon("arrow-left")}<span>上一页</span></button><button class="learn-progress-button" data-drill-action="jump" aria-label="打开题号，快速跳转"><span><strong>${index + 1} <small>/ ${session.questionIds.length}</small></strong><span>已提交 ${stats.submitted} 题 ${icon("chevron-down")}</span></span><span class="learn-progress-track" role="progressbar" aria-label="练习进度" aria-valuemin="0" aria-valuemax="${stats.total}" aria-valuenow="${stats.submitted}"><span style="width:${stats.total ? stats.submitted / stats.total * 100 : 0}%"></span></span></button><button class="learn-next learn-button" data-drill-action="next">${nextLabel}${icon("arrow-right")}</button></nav></header><div class="learn-stage"><article class="learn-card learn-flip-${direction} drill-card"><div class="learn-card-meta"><span>${view === "question" ? ({ multiple: "多选题", fill: "填空题", boolean: "判断题" }[question.type] || "单选题") : "答案与解析"}</span><span>${esc(sourceLabel(question))}</span></div>${view === "question" ? '<div id="drill-question"></div>' : renderAnswer(question, session.answers[question.id])}</article></div><p class="drill-notice" role="alert" hidden></p><dialog class="learn-jump-dialog drill-jump" aria-labelledby="drill-jump-title"><header><div><small>${esc(titleForSession(session))}</small><h2 id="drill-jump-title">题号导航</h2></div><button class="learn-exit" data-drill-action="close-jump" aria-label="关闭题号导航">${icon("x")}</button></header><div class="drill-number-grid">${session.questionIds.map((qid, i) => `<button data-drill-jump="${i}" class="${session.answers[qid]?.status || ""}" ${i === index ? 'aria-current="step"' : ""} aria-label="第 ${i + 1} 题${session.answers[qid] ? session.answers[qid].status === "correct" ? "，答对" : "，答错" : "，未提交"}">${i + 1}</button>`).join("")}</div><p class="drill-jump-key"><span>未提交</span><span>答对</span><span>答错</span></p></dialog></div>`;
    if (view === "question") {
      const answer = session.drafts[question.id]?.value ?? session.answers[question.id]?.answer;
      component = window.PracticeQuestions.mount(root.querySelector("#drill-question"), [question], { answers: { [question.id]: answer }, onChange(answers) { updateSession(Core.setDraft(current.session, question.id, answers[question.id])); tell(""); } });
    }
    refresh(); tell(notice); if (view === "answer") loadAI();
    window.PageTransitions?.enter(root, { key: `drill:${location.hash}`, direction, focus: ".drill-card" });
  }
  function safeSourceURL(value) { try { const url = new URL(value); return /^https?:$/.test(url.protocol) ? url.href : ""; } catch { return ""; } }
  function answerText(value, question) { return Array.isArray(value) ? value.join("、") : question.type === "boolean" ? (String(value) === "true" ? "正确" : "错误") : String(value ?? ""); }
  function referenceNotice(question) {
    const message = question.sourceAnswer?.notice;
    if (!message && !question.alternativeReferences?.length) return "";
    return `<aside class="drill-reference-notice" role="note"><p>${icon("circle-alert")}${esc(message || "公开整理来源存在不同参考答案，当前按所列来源判分。")}</p>${question.alternativeReferences?.length ? `<details><summary>其他来源参考 ${icon("chevron-down")}</summary><ul>${question.alternativeReferences.map(reference => { const url = safeSourceURL(reference.url); return `<li>${esc(reference.provider || "其他参考来源")}：${esc(answerText(reference.answer, question))}${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">查看来源 ${icon("arrow-up-right")}</a>` : ""}</li>`; }).join("")}</ul></details>` : ""}</aside>`;
  }
  function renderAnswer(question, attempt) {
    const source = question.sourceAnswer || {}, explanation = source.explanationBlocks || question.explanationBlocks || (source.explanation ? [{ type: "paragraph", text: source.explanation }] : []);
    const url = safeSourceURL(source.url || question.source?.answerUrl || question.source?.url);
    return `<section class="drill-source-answer" aria-labelledby="drill-source-title"><h1 id="drill-source-title">题目来源答案和解析</h1><div class="drill-answer-result ${attempt.status}"><div><span>来源答案</span><strong>${esc(answerText(source.answer ?? question.answer, question))}</strong></div><span>${icon(attempt.status === "correct" ? "check" : "circle-help")}我们的答案 ${esc(answerText(attempt.answer, question))}</span></div>${referenceNotice(question)}${explanation.length ? `<details class="drill-source-details"><summary>来源解析${icon("chevron-down")}</summary><div class="drill-source-explanation">${window.RichContent.render(explanation)}</div></details>` : '<p class="drill-source-unavailable">来源仅提供了参考答案。</p>'}<div class="drill-source-credit"><span>${esc(source.provider || question.source?.answerSource || "题目来源参考答案")}</span>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">查看来源 ${icon("arrow-up-right")}</a>` : ""}</div></section><section class="drill-ai-section" aria-labelledby="drill-ai-title"><header><h2 id="drill-ai-title">${icon("sparkles")}超级思维解析</h2><span id="drill-ai-state"></span></header><div id="drill-ai-body" data-question-id="${esc(question.id)}" aria-live="polite"></div></section>`;
  }
  function aiError(error) {
    if (["IMAGE_LIMIT", "IMAGE", "QUESTION", "PROMPTS", "SETTINGS", "REQUEST_LIMIT"].includes(error?.code)) return error.message;
    if (error?.code === "CONFIG_REQUIRED" || error?.status === 401 || error?.status === 403) return "AI 连接尚未配置好，请检查设置后重试。";
    if (error?.status === 402) return "当前 AI 服务额度不足，请调整连接或稍后重试。";
    if (error?.status === 429) return "AI 服务暂时繁忙，请稍后重试。";
    if (navigator.onLine === false) return "网络已断开，联网后可以继续生成解析。";
    return "解析暂时未能完整生成，来源答案仍可正常查看。";
  }
  async function loadAI() {
    if (!current || current.view !== "answer") return;
    aiSubscription?.abort(); aiSubscription = new AbortController(); const token = ++aiSerial;
    const question = current.question, host = root.querySelector("#drill-ai-body"), state = root.querySelector("#drill-ai-state"); if (!host || !state) return;
    const alive = () => token === aiSerial && current?.view === "answer" && current.question.id === question.id && host.isConnected;
    state.textContent = "生成中"; host.innerHTML = `<div class="drill-ai-loading" role="status"><span class="drill-ai-orbit">${icon("sparkles")}</span><p>正在按我们的思路分析…</p><small>翻页后会继续生成并保存</small><div class="drill-ai-skeleton"><span></span><span></span><span></span></div></div>`; refresh(host);
    let text = "";
    try {
      const result = await window.AIExplanation.explain({ subjectId: question.subjectId, question, signal: aiSubscription.signal, onChunk(chunk) {
        if (!alive()) return; if (chunk.state === "queued") state.textContent = "等待生成"; if (chunk.state === "running") state.textContent = "生成中";
        if (chunk.text) { text += chunk.text; window.AIExplanation.renderMarkdown(host, text); }
      } });
      if (!alive()) return;
      state.textContent = result.memoryOnly ? "本页暂存" : result.cached ? "已保存" : "已生成";
      window.AIExplanation.renderMarkdown(host, result.text);
      if (result.cacheWarning) { const warning = document.createElement("p"); warning.className = "drill-ai-partial-notice"; warning.textContent = result.cacheWarning; host.append(warning); }
      refresh(host);
    } catch (error) {
      if (!alive() || error?.name === "AbortError") return;
      if (error?.code === "SETTINGS" || error?.code === "CONFIG_REQUIRED") {
        state.textContent = "待配置"; host.innerHTML = `<div class="drill-ai-empty">${icon("settings-2")}<p>配置 AI 连接后，按我们的思路生成这道题的解析。</p><button class="learn-back learn-button" data-drill-action="ai-settings">配置 AI</button></div>`; refresh(host); return;
      }
      state.textContent = "未完成"; host.innerHTML = `${text ? '<p class="drill-ai-partial-notice">生成已中断，以下内容尚未完整。</p><div id="drill-ai-partial"></div>' : ""}<div class="drill-ai-error" role="status">${icon("circle-alert")}<p>${aiError(error)}</p><div><button class="learn-next learn-button" data-drill-action="ai-retry">重新生成</button><button class="learn-back learn-button" data-drill-action="ai-settings">调整连接</button></div></div>`;
      if (text) window.AIExplanation.renderMarkdown(host.querySelector("#drill-ai-partial"), text); refresh(host);
    }
  }
  function previous() {
    if (!current) return; direction = "previous";
    if (current.view === "answer") navigate(sessionHash(current.session, current.index, "question"));
    else if (current.index > 0) { const index = current.index - 1; navigate(sessionHash(current.session, index, Core.canShow(current.session, current.session.questionIds[index], "answer") ? "answer" : "question")); }
  }
  function next() {
    if (!current) return; direction = "next"; const { session, index, view, question } = current;
    if (view === "question") {
      const answer = component?.getAnswers()[question.id];
      if (!Core.isAnswered(answer)) { tell(question.type === "fill" ? "先填写答案，再提交。" : "先选择答案，再提交。"); root.querySelector("#drill-question input")?.focus(); return; }
      updateSession(Core.submit(session, question, answer, window.PracticeQuestions.grade)); navigate(sessionHash(current.session, index, "answer"));
    } else if (index + 1 < session.questionIds.length) navigate(sessionHash(session, index + 1)); else renderComplete();
  }
  function renderComplete() {
    if (!current) return; cleanup(); flush(); current.finished = true; const stats = Core.statistics(current.session);
    root.innerHTML = `<div class="learn-completion"><span class="learn-completion-icon">${icon(stats.complete ? "party-popper" : "flag")}</span><span>${esc(titleForSession(current.session))}</span><h1>${stats.complete ? "这一轮，完成了！" : "这一轮练习结束"}</h1><div class="learn-completion-stats"><span><strong>${stats.submitted}<small> / ${stats.total}</small></strong>已提交</span><span><strong>${stats.accuracy ?? 0}<small>%</small></strong>正确率</span></div><button class="learn-next learn-button" data-drill-action="exit">返回题库 ${icon("arrow-right")}</button>${!stats.complete ? '<button class="learn-back learn-button" data-drill-action="unfinished">继续未答题目</button>' : ""}<button class="learn-back learn-button" data-drill-action="review">回看本轮题目</button></div>`; refresh();
    window.PageTransitions?.enter(root, { key: `drill:${location.hash}:complete`, direction: "next" });
  }
  async function doResolve(hash, token) {
    const route = parseRoute(hash); if (!route) return;
    window.PageTransitions?.cancel(root);
    flush(); cleanup(); current = null; setup = null; notice = ""; activate(route.page === "session");
    root.innerHTML = '<div class="learn-loading" role="status"><span></span>正在打开真题</div>';
    try {
      await ensureManifest(); if (token !== serial || location.hash !== hash) return;
      if (route.page === "catalog") renderCatalog(); else if (route.page === "setup") await prepareSetup(route, token); else await prepareSession(route, token);
    } catch (error) {
      if (token !== serial) return;
      root.innerHTML = `<div class="learn-error">${icon("book-open")}<h1>题库暂时没有打开</h1><p>${esc(error.message)}</p><button class="learn-next learn-button" data-drill-action="retry">重新加载</button><a href="#/study">返回题库</a></div>`; refresh();
      window.PageTransitions?.enter(root, { key: `drill:${location.hash}:error` });
    }
  }
  function cancelRoute() { ++serial; pendingHash = ""; pendingPromise = null; cleanup(); }
  function resolveRoute() {
    if (window.LearningApp?.handlesRoute(location.hash)) { cancelRoute(); current = null; active = false; root.classList.remove("drill-session", "drill-catalog"); return window.LearningApp.resolveRoute(); }
    if (location.hash === "#practice") { history.replaceState(null, "", window.LearningApp?.lastMode() === "practice" ? "#/study" : "#/learn"); return resolveRoute(); }
    const route = parseRoute();
    if (!route) {
      if (active) { flush(); cancelRoute(); active = false; current = null; root.classList.remove("drill-session", "drill-catalog", "learning-session"); document.getElementById("app")?.classList.remove("study-mode"); }
      return Promise.resolve();
    }
    const hash = location.hash; if (pendingPromise && hash === pendingHash) return pendingPromise;
    const token = ++serial; pendingHash = hash;
    pendingPromise = doResolve(hash, token).finally(() => { if (token === serial) { pendingHash = ""; pendingPromise = null; } }); return pendingPromise;
  }
  async function openModule(id) { if (SUBJECTS.some(subject => subject.id === id)) return navigate(`#/study/${id}`); }
  async function openDaily() {
    await ensureManifest(); const questions = await loadSubject("common"); if (!questions.length) return openModule("common");
    const id = `drill-${crypto.randomUUID()}`, session = Core.createSession({ id, subjectId: "common", questionIds: Core.selectQuestionIds(questions, { count: 1, seed: id }) });
    updateSession(session); await navigate(sessionHash(session));
  }
  function reloadProgress() {
    const before = current ? JSON.stringify(current.session) : ""; mergeLatest(); if (pendingPromise || !parseRoute()) return;
    if (current) { current.session = progress.sessions[current.session.id] || current.session; if (before === JSON.stringify(current.session)) return; if (current.finished) renderComplete(); else renderSession(); }
    else if (manifest && !setup) renderCatalog();
  }
  function mergeDrillProgress(raw) { const incoming = JSON.parse(raw || "{}"); mergeLatest(); return JSON.stringify(Core.mergeProgress(progress, incoming)); }
  window.PracticeStudy = { openModule, openDaily, openWrongQuestion: record => openModule(record?.module || "common"), showHome: () => navigate("#/study"), getStatistics,
    getProgress: id => { const value = getStatistics(id); return { done: value.done, total: value.total }; }, storageKey: STORAGE_KEY, flush, reloadProgress, mergeDrillProgress,
    exportProgress: () => { mergeLatest(); return JSON.stringify(progress); } };
  root.addEventListener("submit", event => { if (event.target.id === "drill-start-form") { event.preventDefault(); startSession(); } });
  root.addEventListener("change", event => {
    if (event.target.id === "drill-filter") updateAvailable();
    if (event.target.id === "drill-year") { root.querySelector("#drill-papers").innerHTML = renderPapers(event.target.value); updateCatalogCount(true); refresh(root.querySelector("#drill-papers")); }
  });
  root.addEventListener("click", event => {
    if (!parseRoute()) return;
    const tab = event.target.closest("[data-drill-list]");
    if (tab) { const papers = tab.dataset.drillList === "papers", changed = tab.getAttribute("aria-selected") !== "true"; updateCatalogCount(papers); root.querySelector(".drill-subject-list").hidden = papers; root.querySelector(".drill-paper-list").hidden = !papers; root.querySelectorAll("[data-drill-list]").forEach(button => button.setAttribute("aria-selected", String(button === tab))); if (changed) window.PageTransitions?.enter(root.querySelector(papers ? ".drill-paper-list" : ".drill-subject-list"), { direction: papers ? "next" : "previous", focus: false, force: true }); }
    const jump = event.target.closest("[data-drill-jump]"); if (jump && current) { direction = Number(jump.dataset.drillJump) < current.index ? "previous" : "next"; navigate(sessionHash(current.session, Number(jump.dataset.drillJump))); }
    const action = event.target.closest("[data-drill-action]")?.dataset.drillAction;
    if (action === "next") next(); if (action === "previous") previous();
    if (action === "exit") navigate(current?.session.setId ? `#/study/paper/${current.session.setId}` : current?.session.subjectId && current.session.subjectId !== "all" ? `#/study/${current.session.subjectId}` : "#/study");
    if (action === "retry") { manifestPromise = null; pendingPromise = null; resolveRoute(); }
    if (action === "all") updateAvailable(); if (action === "jump") root.querySelector(".drill-jump")?.showModal();
    if (action === "close-jump") { root.querySelector(".drill-jump")?.close(); root.querySelector('[data-drill-action="jump"]')?.focus(); }
    if (action === "ai-settings") window.AIExplanation?.openSettings?.(); if (action === "ai-retry") loadAI();
    if (action === "review" && current) navigate(sessionHash(current.session, 0));
    if (action === "unfinished" && current) { const index = current.session.questionIds.findIndex(id => !Core.canShow(current.session, id, "answer")); if (index >= 0) navigate(sessionHash(current.session, index)); }
  });
  document.addEventListener("keydown", event => {
    if (!parseRoute() || !current || current.finished || document.querySelector("dialog[open]") || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.target.closest("input,textarea,select,[contenteditable=true],.ui-control,.ui-popover,[role=dialog],[role=alertdialog]")) return;
    if (event.key === "ArrowLeft") { event.preventDefault(); previous(); } if (event.key === "ArrowRight") { event.preventDefault(); next(); }
  });
  window.addEventListener("hashchange", resolveRoute);
  window.addEventListener("summer-politics:tabchange", event => {
    if (routeHandling || window.LearningApp?.routeHandling) return;
    if (event.detail?.tab === "practice") {
      if (window.LearningApp?.handlesRoute(location.hash)) return window.LearningApp.resolveRoute();
      if (!parseRoute()) history.replaceState(null, "", window.LearningApp?.lastMode() === "practice" ? "#/study" : "#/learn"); resolveRoute();
    } else if (active) { flush(); cancelRoute(); current = null; active = false; root.classList.remove("drill-session", "drill-catalog", "learning-session"); document.getElementById("app")?.classList.remove("study-mode"); if (parseRoute()) history.replaceState(null, "", location.pathname + location.search); }
  });
  window.addEventListener("summer-politics:drill-restored", reloadProgress);
  window.addEventListener("storage", event => { if (event.key === STORAGE_KEY) reloadProgress(); });
  window.addEventListener("summer-politics:ai-settings-changed", () => { if (current?.view === "answer" && !current.finished) loadAI(); });
  window.addEventListener("pagehide", flush); document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
  resolveRoute();
})();
