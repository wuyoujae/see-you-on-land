(() => {
  "use strict";
  const root = document.getElementById("view-practice"), Core = window.LearningCore;
  if (!root || !Core) return;
  const STORAGE_KEY = "summer-politics-courses-v1", MODE_KEY = "summer-politics-study-mode-v1";
  const esc = value => window.RichContent.escapeHTML(value);
  const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  let saved = readSaved(), manifest, manifestPromise, current = null, mounted = null;
  let sequence = 0, pendingHash = "", pendingPromise, routeHandling = false, saveTimer, direction = "next", notice = "";
  const groupCache = new Map(), loadedLessonCards = new Map();
  function readSaved() { try { return Core.mergeProgress({}, JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}")); } catch { return Core.mergeProgress({}, {}); } }
  function flush() {
    clearTimeout(saveTimer);
    saved = Core.mergeProgress(saved, readSaved());
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(saved)); }
    catch { notice = "浏览器空间不足，学习记录暂时保存在本次页面中。请导出备份。"; showNotice(); }
  }
  function record(groupId = current?.group.id) { return saved.groups[groupId] || Core.createRecord(); }
  function putRecord(value, groupId = current?.group.id) {
    saved.groups[groupId] = value; saved.updatedAt = Date.now();
    clearTimeout(saveTimer); saveTimer = setTimeout(flush, 180);
  }
  function modeSwitchMarkup(mode) {
    return `<nav class="training-modes" aria-label="学习方式"><a href="#/learn" class="${mode === "learn" ? "active" : ""}" ${mode === "learn" ? 'aria-current="page"' : ""}>${icon("book-open")}学习</a><a href="#/study" class="${mode === "practice" ? "active" : ""}" ${mode === "practice" ? 'aria-current="page"' : ""}>${icon("pencil-line")}做题</a></nav>`;
  }
  function rememberMode(mode) { try { localStorage.setItem(MODE_KEY, mode); } catch { /* Current mode still works. */ } }
  function lastMode() { try { return localStorage.getItem(MODE_KEY) === "practice" ? "practice" : "learn"; } catch { return "learn"; } }
  function refresh() { window.AppUI?.refresh(root); window.lucide?.createIcons({ root }); window.RichContent.hydrate(root); }
  function showNotice(message = notice) { const el = root.querySelector(".learn-notice"); if (el) { el.textContent = message; el.hidden = !message; } }
  async function getManifest() {
    if (manifest) return manifest;
    if (!manifestPromise) manifestPromise = fetch("data/courses/manifest.json").then(response => {
      if (!response.ok) throw new Error("课程目录加载失败"); return response.json();
    }).then(value => {
      if (value.version !== 1 || !Array.isArray(value.subjects)) throw new Error("课程目录格式不正确");
      manifest = value; return value;
    }).catch(error => { manifestPromise = null; throw error; });
    return manifestPromise;
  }
  async function loadGroup(group) {
    if (!groupCache.has(group.id)) groupCache.set(group.id, Promise.all(group.lessons.map(async meta => {
      if (!/^data\/courses\/lessons\/[a-zA-Z0-9_-]+\.json$/.test(meta.path)) throw new Error("课程路径不正确");
      const response = await fetch(meta.path);
      if (!response.ok) throw new Error("知识点加载失败");
      const lesson = await response.json();
      if (lesson.id !== meta.id || lesson.groupId !== group.id || !Array.isArray(lesson.cards)) throw new Error("知识点内容不正确");
      return lesson;
    })).then(lessons => {
      lessons.forEach(lesson => loadedLessonCards.set(lesson.id, lesson.cards));
      return { lessons, cards: Core.flattenLessons(lessons) };
    }).catch(error => { groupCache.delete(group.id); throw error; }));
    return groupCache.get(group.id);
  }
  function routeTo(hash, replace = false) {
    flush(); history[replace || hash === location.hash ? "replaceState" : "pushState"](null, "", hash); return resolveRoute();
  }
  function cardHash(subject, group, card) { return `#/learn/${subject.id}/${group.id}/${card.lessonId}?card=${card.cardIndex}`; }
  function activate(session) {
    routeHandling = true;
    if (!root.classList.contains("active")) document.querySelector('.tab-item[data-tab="practice"]')?.click();
    routeHandling = false;
    root.classList.remove("practice-is-solving", "practice-keyboard-open");
    root.classList.toggle("learning-session", session); root.classList.toggle("learning-catalog", !session);
    document.getElementById("app")?.classList.toggle("study-mode", session);
    document.documentElement.classList.remove("study-route-loading");
  }
  function cleanup() { mounted?.destroy(); mounted = null; root.querySelector(".learn-jump-dialog")?.close(); }
  function lessonStats(meta, rec) {
    const ids = meta.cardIds || [];
    const cards = loadedLessonCards.get(meta.id);
    const done = cards ? Core.progress(cards, rec).completed : ids.filter(id => rec.completed[id]).length;
    return { done, total: meta.cardCount, complete: ids.length > 0 && done === ids.length };
  }
  function groupStats(group) {
    const rec = record(group.id), lessons = group.lessons.map(meta => lessonStats(meta, rec));
    return { done: lessons.reduce((sum, item) => sum + item.done, 0), total: group.lessons.reduce((sum, item) => sum + item.cardCount, 0), lessons: lessons.filter(item => item.complete).length };
  }
  function renderCatalog(route) {
    cleanup(); current = null; activate(false);
    const all = manifest.subjects.flatMap(subject => subject.groups.map(group => ({ subject, group })));
    const resume = all.filter(item => record(item.group.id).lastCardId).sort((a, b) => record(b.group.id).updatedAt - record(a.group.id).updatedAt)[0];
    const totalLessons = all.reduce((sum, item) => sum + item.group.lessons.length, 0);
    const completed = all.reduce((sum, item) => sum + groupStats(item.group).lessons, 0);
    const icons = { language: "messages-square", reasoning: "shapes", quantity: "sigma", analysis: "chart-no-axes-combined" };
    root.innerHTML = `<div class="learn-catalog-shell"><header class="page-header learn-catalog-header"><div class="learn-heading"><h1>做题学习</h1><span>${completed} / ${totalLessons} 知识点</span></div>${modeSwitchMarkup("learn")}</header>
      ${resume ? `<button class="learn-resume" data-learn-resume="${resume.group.id}"><span class="learn-resume-icon">${icon("play")}</span><span><small>继续学习</small><strong>${esc(resume.group.title)}</strong></span>${icon("arrow-right")}</button>` : ""}
      <div class="learn-subjects">${manifest.subjects.map((subject, si) => `<details class="learn-subject" ${route.subjectId === subject.id || (!route.subjectId && si === 0) ? "open" : ""}><summary><span class="learn-subject-icon">${icon(icons[subject.id] || "book-open")}</span><span><strong>${esc(subject.title)}</strong><small>${subject.groups.length} 个题型 · ${subject.groups.reduce((sum, group) => sum + group.lessons.length, 0)} 个知识点</small></span>${icon("chevron-down")}</summary><div class="learn-groups">${subject.groups.map((group, gi) => {
        const stats = groupStats(group);
        return `<details class="learn-group" ${route.groupId === group.id ? "open" : ""}><summary><span class="learn-group-number">${String(gi + 1).padStart(2, "0")}</span><strong>${esc(group.title)}</strong><span class="learn-group-count">${stats.lessons} / ${group.lessons.length}</span>${icon("chevron-down")}</summary><ol class="learn-path">${group.lessons.map((lesson, li) => {
          const progress = lessonStats(lesson, record(group.id));
          return `<li><a class="learn-lesson ${progress.complete ? "is-complete" : progress.done ? "is-started" : ""}" href="#/learn/${subject.id}/${group.id}/${lesson.id}"><span class="learn-path-node">${progress.complete ? icon("check") : li + 1}</span><span class="learn-lesson-copy"><strong>${esc(lesson.title)}</strong><small>${progress.done ? `${progress.done} / ${progress.total} 页` : `${lesson.cardCount} 页${lesson.questionCount ? ` · ${lesson.questionCount} 道例题` : ""}`}</small></span>${icon("chevron-right")}</a></li>`;
        }).join("")}</ol></details>`;
      }).join("")}</div></details>`).join("")}</div><p class="learn-notice" role="status" hidden></p></div>`;
    refresh(); showNotice();
    window.PageTransitions?.enter(root, { key: `learn:${location.hash}`, direction: "previous" });
  }
  async function openResume(groupId) {
    const startHash = location.hash, startSequence = sequence;
    const subject = manifest.subjects.find(item => item.groups.some(group => group.id === groupId));
    const group = subject?.groups.find(item => item.id === groupId); if (!group) return;
    try {
      const pack = await loadGroup(group), rec = record(groupId);
      if (location.hash !== startHash || sequence !== startSequence) return;
      const card = Core.ownerCard(pack.cards, rec.lastCardId) || Core.navigationCards(pack.cards).find(item => !Core.stepComplete(pack.cards, item, rec)) || Core.navigationCards(pack.cards)[0];
      if (!card) throw new Error("这个题型还没有学习内容");
      await routeTo(cardHash(subject, group, card));
    } catch (error) { if (location.hash === startHash && sequence === startSequence) { notice = error.message; showNotice(); } }
  }
  function explanationBanner(card, rec) {
    if (card.type !== "question") return "";
    const attempt = Core.submittedAnswer(card, rec), question = card.question;
    if (!attempt || !question) return "";
    const answerText = value => Array.isArray(value) ? value.join("、") : question.type === "boolean" ? (String(value) === "true" ? "正确" : "错误") : String(value);
    if (question.grading === "unverified" || attempt.status === "ungraded") {
      const reference = typeof question.sourceAnswer === "object" ? question.sourceAnswer?.answer : question.sourceAnswer ?? question.answer;
      return `<div class="learn-result ungraded" role="status"><span class="learn-result-icon">${icon("info")}</span><div><strong>本题条件待核，不计分</strong><span>我们的答案 ${esc(answerText(attempt.answer))}${reference !== undefined && reference !== null ? `　·　来源参考 ${esc(answerText(reference))}` : ""}</span></div></div>`;
    }
    return `<div class="learn-result ${attempt.status}" role="status"><span class="learn-result-icon">${icon(attempt.status === "correct" ? "check" : "lightbulb")}</span><div><strong>${attempt.status === "correct" ? "答对了！" : "一起看看这道题"}</strong><span>我们的答案 ${esc(answerText(attempt.answer))}${attempt.status === "correct" ? "" : `　·　正确答案 ${esc(answerText(question.answer))}`}</span></div></div>`;
  }
  function originalLinks(source) {
    const images = (Array.isArray(source?.originalImages) ? source.originalImages : [])
      .filter(image => image && window.RichContent.safeImageURL(image.src));
    return images.map((image, index) => `<a data-rich-image data-rich-alt="${esc(image.alt || "讲义原题")}" href="${esc(window.RichContent.safeImageURL(image.src))}" target="_blank" rel="noopener noreferrer">${images.length > 1 ? `原题${index + 1}` : "查看原题"}</a>`).join(" · ");
  }
  function renderSession({ inPlace = false } = {}) {
    const previousStage = root.querySelector(".learn-stage"), previousPane = root.querySelector(".study-question-pane");
    const previousScroll = {stage: previousStage?.scrollTop || 0, question: previousPane?.scrollTop || 0};
    const activeAction = document.activeElement?.closest?.("[data-learn-action]")?.dataset.learnAction;
    cleanup(); activate(true);
    const { cards, index, subject, group } = current, card = cards[index];
    let rec = record();
    const attempt = card.type === "question" ? Core.submittedAnswer(card, rec) : null;
    const explanations = attempt ? Core.explanationsFor(cards, card) : [];
    if (attempt) {
      const completed = Core.completeQuestion(cards, card, rec);
      if (completed !== rec) { putRecord(completed); rec = completed; }
    }
    const navigation = Core.navigationCards(cards), position = navigation.findIndex(item => item.id === card.id);
    const stats = Core.progress(cards, rec);
    const source = Core.sourceReference(card.source), originals = originalLinks(card.source);
    const label = card.type === "question" ? "例题" : { intro: "认识题型", knowledge: "基础知识", method: "解题思路" }[card.role] || "知识点";
    const nextText = card.type === "question" && !attempt ? "提交答案" : position === navigation.length - 1 ? "完成学习" : "下一页";
    const solution = attempt ? `<section class="study-explanation-pane" tabindex="0" aria-label="解析"><h2 class="study-pane-title">解析</h2>${explanationBanner(card, rec)}${explanations.length ? explanations.map(part => `<section class="learn-explanation-part" data-learn-explanation-id="${esc(part.id)}" aria-label="${esc(part.title || "解析")}">${window.RichContent.render(part.blocks || [])}</section>`).join("") : '<p>本题暂未提供解析。</p>'}</section>` : "";
    const body = card.type === "question" ? `<div class="study-question-layout${attempt ? " is-submitted" : ""}"><section class="study-question-pane" tabindex="0" aria-label="题目"><div id="learn-question-host"></div></section>${solution}</div>` : window.RichContent.render(card.blocks || []);
    root.innerHTML = `<div class="learn-session-shell"><header class="learn-session-header"><div class="learn-context"><button class="learn-exit" data-learn-action="exit" aria-label="返回课程目录">${icon("x")}</button><div><span>${esc(subject.title)}</span><strong>${esc(group.title)}</strong></div></div><nav class="learn-navigation" aria-label="课程翻页"><button class="learn-back learn-button" data-learn-action="previous" aria-label="上一页" ${position <= 0 ? "disabled" : ""}>${icon("arrow-left")}<span>上一页</span></button><button class="learn-progress-button" data-learn-action="jump" aria-label="打开课程目录，快速跳转"><span><strong>${position + 1} <small>/ ${navigation.length}</small></strong><span>课程目录 ${icon("chevron-down")}</span></span><span class="learn-progress-track" role="progressbar" aria-label="学习进度" aria-valuemin="0" aria-valuemax="${stats.total}" aria-valuenow="${stats.completed}"><span style="width:${stats.percentage}%"></span></span></button><div class="study-submit-actions">${card.type === "question" && !attempt ? '<button class="learn-button learn-back study-skip" data-learn-action="skip" aria-label="跳过本题">跳过本题</button>' : ""}<button class="learn-next learn-button" data-learn-action="next"><span>${nextText}</span>${icon("arrow-right")}</button></div></nav></header>
      <div class="learn-stage"><article class="learn-card ${inPlace ? "" : `learn-flip-${direction}`} ${card.role === "intro" ? "learn-intro-card" : ""}" aria-labelledby="learn-card-title"><div class="learn-card-meta"><span>${label}</span><span>${esc(card.lessonTitle)}${source ? ` · <span class="learn-source" title="${esc(source.title)}">${esc(source.label)}</span>` : ""}${originals ? ` · ${originals}` : ""}</span></div><h1 id="learn-card-title" tabindex="-1">${esc(card.title || card.lessonTitle)}</h1><div class="learn-card-body">${body}</div></article></div><p class="learn-notice" role="status" hidden></p><dialog class="learn-jump-dialog" aria-labelledby="learn-jump-title"><header><div><small>${esc(group.title)}</small><h2 id="learn-jump-title">课程目录</h2></div><button class="learn-exit" data-learn-action="close-jump" aria-label="关闭课程目录">${icon("x")}</button></header><div class="learn-jump-list">${current.lessons.map(lesson => `<section><h3>${esc(lesson.title)}</h3>${navigation.filter(item => item.lessonId === lesson.id).map(item => `<button data-learn-jump="${item.index}" ${item.index === index ? 'aria-current="step"' : ""}><span>${rec.completed[item.id] ? icon("check") : navigation.indexOf(item) + 1}</span><span>${esc(item.title || lesson.title)}</span>${item.index === index ? '<small>当前</small>' : ""}</button>`).join("")}</section>`).join("")}</div></dialog></div>`;
    if (card.type === "question") {
      const answer = attempt ? attempt.answer : rec.drafts[card.question.id]?.value;
      mounted = window.PracticeQuestions.mount(root.querySelector("#learn-question-host"), [card.question], {
        answers: { [card.question.id]: answer }, readonly: Boolean(attempt), submitted: Boolean(attempt), feedback: Boolean(attempt),
        onChange(answers) {
          if (current?.cards[current.index]?.id !== card.id || Core.submittedAnswer(card, record())) return;
          if (notice === "请先选择或填写答案，再提交。") { notice = ""; showNotice(); }
          const now = Date.now(); putRecord({ ...record(), updatedAt: now, drafts: { ...record().drafts, [card.question.id]: { value: answers[card.question.id], updatedAt: now } } });
          updateNext();
        }
      });
    }
    root.querySelector('[data-learn-action="next"]')?.setAttribute("aria-label", nextText);
    refresh(); updateNext(); showNotice();
    if (inPlace) {
      const stage = root.querySelector(".learn-stage"), pane = root.querySelector(".study-question-pane");
      if (stage) stage.scrollTop = previousScroll.stage;
      if (pane) pane.scrollTop = previousScroll.question;
      // Preserve an existing keyboard focus on the surviving navigation action,
      // but never scroll/focus the answer pane after a submission.
      if (activeAction === "next") root.querySelector('[data-learn-action="next"]')?.focus({preventScroll: true});
    } else {
      root.querySelector(".learn-stage")?.scrollTo(0, 0);
      window.PageTransitions?.enter(root, { key: `learn:${location.hash}`, direction, focus: "#learn-card-title" });
    }
  }
  function updateNext() {
    const button = root.querySelector('[data-learn-action="next"]');
    if (button) button.disabled = false;
  }
  async function move(step) {
    if (!current || !root.classList.contains("learning-session") || current.finished) return;
    const card = current.cards[current.index];
    if (step > 0) {
      if (card.type === "question" && !Core.submittedAnswer(card, record())) {
        const answer = mounted?.getAnswers()[card.question.id];
        if (!Core.isAnswered(answer)) {
          notice = "请先选择或填写答案，再提交。"; showNotice();
          root.querySelector("#learn-question-host")?.querySelector("input:not([disabled]),textarea:not([disabled])")?.focus({preventScroll: true});
          return;
        }
        const submitted = Core.submit(card, answer, record(), window.PracticeQuestions.grade);
        if (!Core.submittedAnswer(card, submitted)) return;
        putRecord(submitted);
        renderSession({inPlace: true});
        return;
      }
      if (card.type === "question") putRecord(Core.completeQuestion(current.cards, card, record()));
      else putRecord(Core.markComplete(card, record()));
    }
    direction = step < 0 ? "previous" : "next";
    const navigation = Core.navigationCards(current.cards), position = navigation.findIndex(item => item.id === card.id);
    const target = position + step;
    if (target < 0) return;
    if (target >= navigation.length) { flush(); renderComplete(); return; }
    await routeTo(cardHash(current.subject, current.group, navigation[target]));
  }
  async function skipQuestion() {
    if (!current || !root.classList.contains("learning-session") || current.finished) return;
    const card = current.cards[current.index], rec = record();
    if (card.type !== "question" || Core.submittedAnswer(card, rec)) return;
    // Keep a newer empty draft so merging saved/backup progress cannot restore
    // the abandoned selection. Skipping never creates an answer or completion.
    const now = Math.max(Date.now(), (rec.drafts[card.question.id]?.updatedAt || 0) + 1);
    putRecord({ ...rec, updatedAt: now, drafts: { ...rec.drafts, [card.question.id]: { value: "", updatedAt: now } } });
    direction = "next";
    const navigation = Core.navigationCards(current.cards), position = navigation.findIndex(item => item.id === card.id);
    if (position + 1 >= navigation.length) { flush(); renderComplete(); return; }
    await routeTo(cardHash(current.subject, current.group, navigation[position + 1]));
  }
  function renderComplete() {
    cleanup(); current.finished = true;
    const stats = Core.progress(current.cards, record());
    root.innerHTML = `<div class="learn-completion"><span class="learn-completion-icon">${icon(stats.complete ? "party-popper" : "flag")}</span><span>${esc(current.subject.title)}</span><h1>${stats.complete ? "这一关，学会了！" : "这一轮学习结束"}</h1><p>${esc(current.group.title)}</p><div class="learn-completion-stats"><span><strong>${stats.completed}<small> / ${stats.total}</small></strong>已学页数</span><span><strong>${stats.correct}<small> / ${stats.scoredQuestions}</small></strong>例题答对</span></div>${stats.ungraded ? `<p>${stats.ungraded} 道题条件待核，不计分</p>` : ""}<button class="learn-next learn-button" data-learn-action="exit">返回课程目录 ${icon("arrow-right")}</button>${!stats.complete ? '<button class="learn-back learn-button" data-learn-action="unfinished">继续未学内容</button>' : ""}</div>`; refresh();
    window.PageTransitions?.enter(root, { key: `learn:${location.hash}:complete`, direction: "next" });
  }
  async function doResolve(hash, id) {
    const route = Core.parseRoute(hash); if (!route) return;
    notice = "";
    window.PageTransitions?.cancel(root);
    flush(); rememberMode("learn"); cleanup(); current = null; activate(Boolean(route.lessonId));
    root.innerHTML = '<div class="learn-loading" role="status"><span></span>正在打开课程</div>';
    try {
      await getManifest(); if (id !== sequence || location.hash !== hash) return;
      if (!route.lessonId) { renderCatalog(route); return; }
      const subject = manifest.subjects.find(item => item.id === route.subjectId), group = subject?.groups.find(item => item.id === route.groupId);
      if (!group || !group.lessons.some(item => item.id === route.lessonId)) throw new Error("找不到这个知识点");
      const pack = await loadGroup(group); if (id !== sequence || location.hash !== hash) return;
      const lessonCards = pack.cards.filter(item => item.lessonId === route.lessonId);
      let card = lessonCards[Math.min(route.card, lessonCards.length - 1)];
      if (!card) throw new Error("这个知识点还没有学习内容");
      const rec = record(group.id);
      if (Core.isExplanation(card)) {
        if (!Core.canVisit(card, rec)) notice = "先完成这道例题，再一起看解析。";
        card = Core.ownerCard(pack.cards, card);
        if (!card) throw new Error("这段解析缺少对应例题");
        history.replaceState(null, "", cardHash(subject, group, card));
      }
      current = { ...pack, subject, group, index: card.index };
      putRecord({ ...rec, lastCardId: card.id, updatedAt: Date.now() }, group.id);
      renderSession();
    } catch (error) {
      if (id !== sequence) return;
      root.innerHTML = `<div class="learn-error">${icon("book-open")}<h1>课程暂时没有打开</h1><p>${esc(error.message)}</p><button class="learn-next learn-button" data-learn-action="retry">重新加载</button><a href="#/learn">返回课程目录</a></div>`; refresh();
      window.PageTransitions?.enter(root, { key: `learn:${location.hash}:error` });
    }
  }
  function resolveRoute() {
    const hash = location.hash;
    // A saved link to the retired four-example quantity course opens its
    // replacement. Historical progress keeps its old IDs and is not migrated.
    if (/^#\/learn\/quantity\/quantity-proportion(?:\/|\?|$)/.test(hash)) {
      history.replaceState(null, "", "#/learn/quantity/quantity-wy27-s01/quantity-wy27-s01-t01");
      return resolveRoute();
    }
    if (!Core.parseRoute(hash)) return Promise.resolve();
    if (pendingPromise && pendingHash === hash) return pendingPromise;
    const id = ++sequence; pendingHash = hash;
    pendingPromise = doResolve(hash, id).finally(() => { if (id === sequence) { pendingHash = ""; pendingPromise = null; } });
    return pendingPromise;
  }
  function cancelRoute() { ++sequence; pendingHash = ""; pendingPromise = null; }
  root.addEventListener("click", event => {
    if (!Core.parseRoute(location.hash)) return;
    const action = event.target.closest("[data-learn-action]")?.dataset.learnAction;
    const jump = event.target.closest("[data-learn-jump]");
    const resume = event.target.closest("[data-learn-resume]");
    if (resume) openResume(resume.dataset.learnResume);
    if (jump && current) {
      const card = Core.ownerCard(current.cards, current.cards[Number(jump.dataset.learnJump)]);
      if (card) { direction = card.index < current.index ? "previous" : "next"; routeTo(cardHash(current.subject, current.group, card)); }
    }
    if (action === "previous") move(-1);
    if (action === "next") move(1);
    if (action === "skip") skipQuestion();
    if (action === "exit") routeTo(current ? `#/learn/${current.subject.id}/${current.group.id}` : "#/learn");
    if (action === "retry") { manifestPromise = null; pendingPromise = null; resolveRoute(); }
    if (action === "jump") root.querySelector(".learn-jump-dialog")?.showModal();
    if (action === "close-jump") { root.querySelector(".learn-jump-dialog")?.close(); root.querySelector('[data-learn-action="jump"]')?.focus(); }
    if (action === "unfinished" && current) {
      const rec = record();
      const card = Core.navigationCards(current.cards).find(item => !Core.stepComplete(current.cards, item, rec));
      if (card) routeTo(cardHash(current.subject, current.group, card));
    }
  });
  document.addEventListener("keydown", event => {
    if (!Core.parseRoute(location.hash) || !current || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing || document.querySelector("dialog[open]") || event.target.closest("input,textarea,select,[contenteditable=true],.ui-control,.ui-popover,[role=dialog],[role=alertdialog],.rich-content__math--display,.rich-content__table-scroll")) return;
    if (["ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); move(event.key === "ArrowLeft" ? -1 : 1); }
  });
  let touchStart;
  root.addEventListener("touchstart", event => {
    touchStart = event.touches.length === 1 && !event.target.closest("input,button,a,label,dialog,.rich-content__math--display,.rich-content__table-scroll") ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
  }, { passive: true });
  root.addEventListener("touchend", event => {
    if (!touchStart || !event.changedTouches[0] || window.getSelection()?.toString()) return;
    const dx = event.changedTouches[0].clientX - touchStart.x, dy = event.changedTouches[0].clientY - touchStart.y; touchStart = null;
    if (Math.abs(dx) > 85 && Math.abs(dx) > Math.abs(dy) * 1.8) move(dx > 0 ? -1 : 1);
  }, { passive: true });
  function reloadProgress() {
    const previous = current ? JSON.stringify([record().completed, record().answers, record().drafts]) : "";
    saved = Core.mergeProgress(saved, readSaved());
    if (pendingPromise) return;
    const route = Core.parseRoute(location.hash);
    if (!route || !manifest) return;
    if (current) {
      if (previous === JSON.stringify([record().completed, record().answers, record().drafts])) return;
      if (current.finished) renderComplete(); else renderSession({inPlace: true});
    }
    else renderCatalog(route);
  }
  function mergeBackupProgress(raw) { let incoming = {}; try { incoming = JSON.parse(raw || "{}"); } catch { /* Backup validation handles invalid JSON. */ } flush(); return JSON.stringify(Core.mergeProgress(saved, incoming)); }
  window.LearningApp = { handlesRoute: hash => Boolean(Core.parseRoute(hash ?? location.hash)), resolveRoute, modeSwitchMarkup, lastMode, rememberMode, flush, reloadProgress, mergeBackupProgress, storageKey: STORAGE_KEY, get routeHandling() { return routeHandling; } };
  window.addEventListener("hashchange", () => {
    flush(); cleanup();
    if (Core.parseRoute(location.hash)) resolveRoute();
    else { cancelRoute(); current = null; root.classList.remove("learning-session", "learning-catalog"); }
  });
  window.addEventListener("summer-politics:tabchange", event => {
    if (routeHandling || event.detail?.tab === "practice" || !Core.parseRoute(location.hash)) return;
    flush(); cancelRoute(); cleanup(); current = null; root.classList.remove("learning-session", "learning-catalog");
    document.getElementById("app")?.classList.remove("study-mode"); history.replaceState(null, "", location.pathname + location.search);
  });
  window.addEventListener("summer-politics:courses-restored", reloadProgress);
  window.addEventListener("storage", event => { if (event.key === STORAGE_KEY) reloadProgress(); });
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
})();
