(() => {
  "use strict";

  const payload = window.LEARNING_DATA || { categories: [], resources: [] };
  const resources = payload.resources;
  const categories = payload.categories;
  const newsPayload = window.CURRENT_AFFAIRS_DATA || { startDate: "2026-07-01", sources: [], days: [] };
  const newsDays = newsPayload.days || [];
  const storageKey = "summer-politics-learning-progress-v1";
  const completed = new Set(loadProgress());
  const state = {
    tab: "dashboard",
    todoFilter: "all",
    todoSearch: "",
    selectedCategory: null,
    resourceFilter: "all",
    selectedNewsDate: newsDays.length ? newsDays[newsDays.length - 1].date : null
  };

  const categoryStyles = {
    "“十五五”规划": { short: "十五五规划", icon: "map", theme: "plan" },
    "全国两会": { short: "全国两会", icon: "landmark", theme: "congress" },
    "二十届四中全会": { short: "四中全会", icon: "building-2", theme: "plenum" },
    "新年贺词": { short: "新年贺词", icon: "message-square-quote", theme: "new-year" },
    "中央经济工作会议": { short: "经济工作", icon: "chart-no-axes-combined", theme: "economy" },
    "中央城市工作会议": { short: "城市工作", icon: "map-pinned", theme: "city" },
    "中央一号文件": { short: "中央一号文件", icon: "sprout", theme: "rural" },
    "建党105周年讲话": { short: "建党105周年", icon: "flag", theme: "anniversary" },
    "国家科技奖励大会/两院院士大会": { short: "科技与院士大会", icon: "atom", theme: "science" },
    "近两年《求是》": { short: "近两年《求是》", icon: "book-open", theme: "journal" }
  };

  const dom = {
    todoGroups: document.getElementById("todo-groups"),
    todoSearch: document.getElementById("todo-search"),
    categoryGrid: document.getElementById("category-grid"),
    categoryOverview: document.getElementById("category-overview"),
    categoryDetail: document.getElementById("category-detail"),
    categoryTitle: document.getElementById("category-title"),
    categoryDetailCount: document.getElementById("category-detail-count"),
    resourceList: document.getElementById("resource-list"),
    newsTimeline: document.getElementById("news-timeline"),
    newsDay: document.getElementById("news-day")
  };

  function loadProgress() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
      return Array.isArray(saved) ? saved : [];
    } catch {
      return [];
    }
  }

  function saveProgress() {
    localStorage.setItem(storageKey, JSON.stringify([...completed]));
  }

  function escapeHTML(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function styleFor(category) {
    return categoryStyles[category] || { short: category, icon: "folder", theme: "default" };
  }

  function styleVars(category) {
    const style = styleFor(category);
    return `--category-color:var(--category-${style.theme}-color);--category-tint:var(--category-${style.theme}-tint)`;
  }

  function refreshIcons() {
    if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 2 } });
  }

  function formatDate(date) {
    if (!date) return "";
    return date.replaceAll("-", ".");
  }

  function formatNewsDate(date, short = false) {
    const [, month, day] = date.split("-").map(Number);
    if (short) return `${month}月${day}日`;
    const parsed = new Date(`${date}T12:00:00`);
    const weekday = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][parsed.getDay()];
    return `${parsed.getFullYear()}年${month}月${day}日 · ${weekday}`;
  }

  function updateCurrentDate() {
    const date = new Date();
    const weekday = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][date.getDay()];
    document.getElementById("current-date").textContent = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 · ${weekday}`;
  }

  function scheduleMidnightRefresh() {
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
    window.setTimeout(() => {
      updateCurrentDate();
      window.dispatchEvent(new Event("summer-politics:daychange"));
      scheduleMidnightRefresh();
    }, nextMidnight - now);
  }

  function updateProgress() {
    const total = resources.length;
    const done = resources.reduce((sum, item) => sum + Number(completed.has(item.id)), 0);
    const percent = total ? Math.round(done / total * 100) : 0;
    document.getElementById("progress-percent").textContent = percent;
    document.getElementById("progress-completed").textContent = done;
    document.getElementById("progress-total").textContent = total;
    document.getElementById("progress-remaining").textContent = total - done;
    document.getElementById("progress-fill").style.width = `${percent}%`;
    document.getElementById("progress-track").setAttribute("aria-valuenow", percent);
    document.getElementById("article-count").textContent = resources.filter(item => item.format === "article").length;
    document.getElementById("video-count").textContent = resources.filter(item => item.format === "video").length;
    document.getElementById("category-count").textContent = categories.length;
  }

  function matchesTodo(item) {
    const isDone = completed.has(item.id);
    if (state.todoFilter === "pending" && isDone) return false;
    if (state.todoFilter === "done" && !isDone) return false;
    const query = state.todoSearch.trim().toLowerCase();
    if (!query) return true;
    return `${item.title} ${item.source} ${item.category}`.toLowerCase().includes(query);
  }

  function todoRow(item) {
    const isDone = completed.has(item.id);
    return `
      <div class="todo-row ${isDone ? "done" : ""}" data-resource-id="${escapeHTML(item.id)}">
        <label class="check-control" title="标记学习状态">
          <input type="checkbox" data-action="toggle-complete" data-id="${escapeHTML(item.id)}" ${isDone ? "checked" : ""} aria-label="${isDone ? "取消完成" : "标记完成"}：${escapeHTML(item.title)}">
          <span class="check-box"><i data-lucide="check" aria-hidden="true"></i></span>
        </label>
        <div class="todo-copy">
          <div class="todo-kicker"><span class="format-dot ${item.format}"></span>${item.format === "video" ? "视频" : "文章"} · ${escapeHTML(formatDate(item.date))}</div>
          <a class="todo-title" href="${escapeHTML(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(item.title)}</a>
          <p class="todo-source">${escapeHTML(item.source)}</p>
        </div>
        <a class="open-button" href="${escapeHTML(item.url)}" target="_blank" rel="noopener noreferrer" title="打开原文" aria-label="打开：${escapeHTML(item.title)}"><i data-lucide="external-link" aria-hidden="true"></i></a>
      </div>`;
  }

  function renderTodoGroups() {
    const filtered = resources.filter(matchesTodo);
    if (!filtered.length) {
      dom.todoGroups.innerHTML = '<div class="empty-results">没有符合当前筛选的学习内容</div>';
      return;
    }
    dom.todoGroups.innerHTML = categories.map(category => {
      const items = filtered.filter(item => item.category === category);
      if (!items.length) return "";
      const allInCategory = resources.filter(item => item.category === category);
      const done = allInCategory.filter(item => completed.has(item.id)).length;
      return `
        <section class="todo-group" style="${styleVars(category)}">
          <div class="group-heading">
            <span class="group-mark" aria-hidden="true"></span>
            <h2>${escapeHTML(styleFor(category).short)}</h2>
            <span>${done}/${allInCategory.length}</span>
          </div>
          <div class="todo-list">${items.map(todoRow).join("")}</div>
        </section>`;
    }).join("");
    refreshIcons();
  }

  function renderCategoryGrid() {
    dom.categoryGrid.innerHTML = categories.map(category => {
      const items = resources.filter(item => item.category === category);
      const done = items.filter(item => completed.has(item.id)).length;
      const percent = items.length ? Math.round(done / items.length * 100) : 0;
      const meta = styleFor(category);
      return `
        <button type="button" class="category-card" style="${styleVars(category)}" data-category="${escapeHTML(category)}" aria-label="查看${escapeHTML(meta.short)}，${items.length}项">
          <div>
            <span class="category-icon"><i data-lucide="${meta.icon}" aria-hidden="true"></i></span>
            <h2>${escapeHTML(meta.short)}</h2>
          </div>
          <div>
            <div class="category-card-footer"><span>${items.length} 项</span><span>${done} 已完成</span></div>
            <div class="mini-progress" aria-hidden="true"><span style="width:${percent}%"></span></div>
          </div>
        </button>`;
    }).join("");
    refreshIcons();
  }

  function renderResourceList() {
    if (!state.selectedCategory) return;
    const categoryItems = resources.filter(item => item.category === state.selectedCategory);
    const filtered = categoryItems.filter(item => state.resourceFilter === "all" || item.format === state.resourceFilter);
    const done = categoryItems.filter(item => completed.has(item.id)).length;
    dom.categoryTitle.textContent = styleFor(state.selectedCategory).short;
    dom.categoryDetailCount.textContent = `${categoryItems.length} 项资料 · ${done} 项已完成`;
    if (!filtered.length) {
      dom.resourceList.innerHTML = '<div class="empty-results">该分类暂无此类资料</div>';
      return;
    }
    dom.resourceList.innerHTML = filtered.map(item => {
      const isDone = completed.has(item.id);
      return `
        <article class="resource-row ${isDone ? "done" : ""}" data-resource-id="${escapeHTML(item.id)}">
          <div class="resource-format ${item.format}"><i data-lucide="${item.format === "video" ? "play" : "file-text"}" aria-hidden="true"></i></div>
          <div class="resource-copy">
            <div class="resource-meta"><span class="priority">${escapeHTML(item.priority)}</span><span>${escapeHTML(item.kind)}</span><span>${escapeHTML(formatDate(item.date))}</span></div>
            <a class="resource-title" href="${escapeHTML(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(item.title)}</a>
            <p class="resource-summary">${escapeHTML(item.summary)}</p>
          </div>
          <button type="button" class="icon-button resource-state" data-action="toggle-button" data-id="${escapeHTML(item.id)}" title="${isDone ? "取消完成" : "标记完成"}" aria-label="${isDone ? "取消完成" : "标记完成"}：${escapeHTML(item.title)}"><i data-lucide="${isDone ? "circle-check-big" : "circle"}" aria-hidden="true"></i></button>
        </article>`;
    }).join("");
    refreshIcons();
  }

  function renderNewsTimeline() {
    if (!newsDays.length) {
      dom.newsTimeline.innerHTML = '<div class="news-empty">等待首次采集</div>';
      dom.newsDay.innerHTML = '<div class="news-empty">从 2026 年 7 月 1 日开始记录每日时政。</div>';
      return;
    }
    dom.newsTimeline.innerHTML = newsDays.map(day => `
      <button type="button" class="news-time-node ${day.date === state.selectedNewsDate ? "active" : ""}" data-news-date="${escapeHTML(day.date)}" aria-label="查看${escapeHTML(formatNewsDate(day.date, true))}时政：${escapeHTML(day.keyword)}">
        <span class="news-node-date">${escapeHTML(formatNewsDate(day.date, true))}</span>
        <span class="news-node-keyword">${escapeHTML(day.keyword || "暂无数据")}</span>
      </button>`).join("");
    requestAnimationFrame(() => {
      const active = dom.newsTimeline.querySelector(".news-time-node.active");
      active?.scrollIntoView({ behavior: "auto", block: "nearest", inline: "center" });
    });
  }

  function renderNewsDay() {
    const day = newsDays.find(item => item.date === state.selectedNewsDate);
    if (!day) {
      dom.newsDay.innerHTML = '<div class="news-empty">当天还没有采集到时政内容。</div>';
      return;
    }
    const successfulSources = day.sourceStatus.filter(item => item.status === "ok").length;
    const keywordHTML = day.keywords.map(item => `<span class="keyword-chip">${escapeHTML(item.name)} · ${item.count}</span>`).join("");
    const statusHTML = day.sourceStatus.map(item => {
      const statusTitle = item.status === "ok" ? "采集成功" : item.status === "stale" ? "本轮未取得新数据，保留上一轮结果" : "当次采集失败，稍后自动重试";
      return `<span class="source-chip ${item.status === "ok" ? "" : "error"}" title="${statusTitle}">${escapeHTML(item.source)} ${item.count}</span>`;
    }).join("");
    const articleHTML = day.articles.length ? day.articles.map(item => `
      <article class="news-article">
        <div>
          <div class="news-article-meta"><span class="news-source">${escapeHTML(item.source)}</span><span>${escapeHTML(item.keyword || "综合时政")}</span></div>
          <a class="news-article-title" href="${escapeHTML(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(item.title)}</a>
        </div>
        <a class="open-button" href="${escapeHTML(item.url)}" target="_blank" rel="noopener noreferrer" title="打开原文" aria-label="打开：${escapeHTML(item.title)}"><i data-lucide="external-link" aria-hidden="true"></i></a>
      </article>`).join("") : '<div class="news-empty">当天暂未采集到可核验的官方链接。</div>';
    dom.newsDay.innerHTML = `
      <div class="news-day-heading">
        <h2>${escapeHTML(day.keyword || "今日时政")}</h2>
        <p class="news-day-meta">${escapeHTML(formatNewsDate(day.date))} · ${day.articles.length} 条 · ${successfulSources}/${newsPayload.sources.length} 个来源完成采集</p>
        <div class="keyword-strip" aria-label="高频关键词">${keywordHTML}</div>
        <div class="source-status" aria-label="来源采集状态">${statusHTML}</div>
      </div>
      <div class="news-list">${articleHTML}</div>`;
    refreshIcons();
  }

  function renderNews() {
    renderNewsTimeline();
    renderNewsDay();
  }

  function setComplete(id, checked) {
    if (checked) completed.add(id);
    else completed.delete(id);
    saveProgress();
    updateProgress();
    renderTodoGroups();
    renderCategoryGrid();
    renderResourceList();
  }

  function switchTab(tab) {
    const previousTab = state.tab;
    window.AppUI?.closePopover?.();
    if (previousTab !== tab) window.PageTransitions?.cancel(document.getElementById(`view-${previousTab}`));
    state.tab = tab;
    document.querySelectorAll(".view").forEach(view => view.classList.toggle("active", view.id === `view-${tab}`));
    document.querySelectorAll(".tab-item").forEach(button => {
      const active = button.dataset.tab === tab;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
    if (tab === "list") renderCategoryGrid();
    if (tab === "news") renderNews();
    refreshIcons();
    window.dispatchEvent(new CustomEvent("summer-politics:tabchange", { detail: { tab } }));
    if (previousTab !== tab) window.PageTransitions?.enter(document.getElementById(`view-${tab}`), { force: true });
  }

  document.querySelectorAll(".tab-item").forEach(button => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });

  dom.todoSearch.addEventListener("input", () => {
    state.todoSearch = dom.todoSearch.value;
    renderTodoGroups();
  });

  document.getElementById("todo-filters").addEventListener("click", event => {
    const button = event.target.closest("button[data-filter]");
    if (!button) return;
    state.todoFilter = button.dataset.filter;
    document.querySelectorAll("#todo-filters button").forEach(item => item.classList.toggle("active", item === button));
    renderTodoGroups();
  });

  dom.todoGroups.addEventListener("change", event => {
    const input = event.target.closest('input[data-action="toggle-complete"]');
    if (input) setComplete(input.dataset.id, input.checked);
  });

  dom.categoryGrid.addEventListener("click", event => {
    const button = event.target.closest("button[data-category]");
    if (!button) return;
    state.selectedCategory = button.dataset.category;
    state.resourceFilter = "all";
    document.querySelectorAll("#resource-filters button").forEach(item => item.classList.toggle("active", item.dataset.filter === "all"));
    dom.categoryOverview.style.display = "none";
    dom.categoryDetail.classList.add("active");
    document.getElementById("view-list").scrollTo({ top: 0, behavior: "auto" });
    renderResourceList();
    window.PageTransitions?.enter(dom.categoryDetail, { direction: "next", force: true });
  });

  document.getElementById("category-back").addEventListener("click", () => {
    dom.categoryDetail.classList.remove("active");
    dom.categoryOverview.style.display = "block";
    state.selectedCategory = null;
    document.getElementById("view-list").scrollTo({ top: 0, behavior: "auto" });
    renderCategoryGrid();
    window.PageTransitions?.cancel(dom.categoryDetail);
    window.PageTransitions?.enter(dom.categoryOverview, { direction: "previous", force: true });
  });

  document.getElementById("resource-filters").addEventListener("click", event => {
    const button = event.target.closest("button[data-filter]");
    if (!button) return;
    state.resourceFilter = button.dataset.filter;
    document.querySelectorAll("#resource-filters button").forEach(item => item.classList.toggle("active", item === button));
    renderResourceList();
  });

  dom.resourceList.addEventListener("click", event => {
    const button = event.target.closest('button[data-action="toggle-button"]');
    if (!button) return;
    setComplete(button.dataset.id, !completed.has(button.dataset.id));
  });

  dom.newsTimeline.addEventListener("click", event => {
    const button = event.target.closest("button[data-news-date]");
    if (!button) return;
    if (state.selectedNewsDate === button.dataset.newsDate) return;
    state.selectedNewsDate = button.dataset.newsDate;
    renderNews();
    document.getElementById("view-news").scrollTo({ top: 0, behavior: "auto" });
    window.PageTransitions?.enter(dom.newsDay, { key: state.selectedNewsDate });
  });

  updateCurrentDate();
  scheduleMidnightRefresh();
  updateProgress();
  renderTodoGroups();
  renderCategoryGrid();
  renderNews();
  refreshIcons();
})();
