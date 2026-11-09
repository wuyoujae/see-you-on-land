/* Shared, local-first scratchbooks. Canvas pixels are only a viewport: the
 * retained world-coordinate strokes survive panning, resizing and reopening. */
(() => {
  "use strict";
  const Core = window.ScratchpadCore;
  if (!Core) return;
  const store = Core.createStore(), drafts = new Map(), histories = new Map(), bounds = new WeakMap();
  const paths = {
    book: '<path d="M4 3h13a3 3 0 0 1 3 3v15H7a3 3 0 0 1-3-3Zm0 14h16M8 3v10"/>',
    pen: '<path d="m15 5 4 4M4 20l4-1 12-12a2.8 2.8 0 0 0-4-4L4 15Z"/>',
    hand: '<path d="M8 13V6a2 2 0 0 1 4 0v6-8a2 2 0 0 1 4 0v8-6a2 2 0 0 1 4 0v10a6 6 0 0 1-6 6h-2a6 6 0 0 1-5-3l-4-6a2 2 0 0 1 3-2l2 2Z"/>',
    eraser: '<path d="m15 3 6 6a2 2 0 0 1 0 3l-8 8H7l-5-5a2 2 0 0 1 0-3L12 3a2 2 0 0 1 3 0ZM7 8l9 9M13 20h9"/>',
    undo: '<path d="m8 3-5 5 5 5M3 8h11a7 7 0 0 1 0 14"/>',
    redo: '<path d="m16 3 5 5-5 5m5-5H10a7 7 0 0 0 0 14"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>', chevron: '<path d="m6 9 6 6 6-6"/>',
    check: '<path d="m5 12 4 4L19 6"/>', home: '<circle cx="12" cy="12" r="4"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>'
  };
  const svg = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ""}</svg>`;
  const button = (action, label, icon, extra = "") => `<button type="button" class="scratchpad-button" data-scratch-action="${action}" aria-label="${label}" title="${label}" ${extra}>${svg(icon)}</button>`;
  let overlay, surface, canvas, liveCanvas, ctx, liveCtx, current, ready, opening = 0, closeTimer;
  let isOpen = false, opener, inertBefore, tool = "pen", color = "#202b23", width = 2.4, fingerDraw = true;
  let ownsEditLock = false, releaseEditLock, lockPromise;
  let activeStroke = null, activePointer = null, strokeBefore = null, eraseBefore = null, gesture = null, penPointer = null, lastPen = -Infinity, blockedTouchUntil = -Infinity;
  let spaceDown = false, revision = 0, persisted = 0, saveTimer, writeQueue = Promise.resolve(), rendering = false, renderBase = true, strokePointLimit = 0;
  let viewWidth = 0, viewHeight = 0, pixelRatio = 1, gestureWasMulti = false, draftBusy = false, liveStrokeId = null, liveDrawnPoints = 0;
  const pointers = new Map(), interruptedPens = new Set(), pendingInk = [];
  const touchContacts = new Map();
  const history = () => {
    if (!histories.has(current.id)) histories.set(current.id, { undo: [], redo: [] });
    return histories.get(current.id);
  };
  function mount() {
    if (overlay) return;
    overlay = document.createElement("section");
    overlay.id = "scratchpad-overlay"; overlay.className = "scratchpad"; overlay.hidden = true;
    overlay.setAttribute("role", "dialog"); overlay.setAttribute("aria-modal", "true"); overlay.setAttribute("aria-label", "草稿本"); overlay.tabIndex = -1;
    overlay.innerHTML = `<div class="scratchpad-surface" aria-label="草稿画布：画笔书写，双指移动和缩放"><canvas aria-hidden="true"></canvas><canvas aria-hidden="true"></canvas></div>
      <header class="scratchpad-header"><div class="scratchpad-document"><button type="button" class="scratchpad-button scratchpad-title scratchpad-chrome" data-scratch-action="list" aria-label="切换草稿" aria-haspopup="listbox" aria-expanded="false" aria-controls="scratchpad-list">${svg("book")}<span>草稿本</span>${svg("chevron")}</button><div id="scratchpad-list" class="scratchpad-popover scratchpad-list" role="listbox" aria-label="草稿列表" hidden></div></div><button type="button" class="scratchpad-button scratchpad-new scratchpad-chrome" data-scratch-action="new" aria-label="新建草稿">${svg("plus")}<span>新建</span></button>${button("close", "关闭草稿本", "close").replace('scratchpad-button"', 'scratchpad-button scratchpad-close scratchpad-chrome"')}</header>
      <div class="scratchpad-toolbar scratchpad-chrome" role="toolbar" aria-label="草稿工具">${button("pen", "画笔", "pen", 'aria-pressed="true"')}${button("hand", "拖动画布", "hand", 'aria-pressed="false"')}${button("eraser", "整笔橡皮擦", "eraser", 'aria-pressed="false"')}<span class="scratchpad-separator"></span>${button("undo", "撤销", "undo")}${button("redo", "重做", "redo")}<span class="scratchpad-separator"></span><div class="scratchpad-tool-options"><button type="button" class="scratchpad-button" data-scratch-action="options" aria-label="画笔颜色与粗细" title="画笔颜色与粗细" aria-haspopup="true" aria-controls="scratchpad-options" aria-expanded="false"><span class="scratchpad-ink" style="--scratch-color:${color}"></span></button><div id="scratchpad-options" class="scratchpad-popover scratchpad-options" aria-label="画笔设置" hidden><div class="scratchpad-colors" role="group" aria-label="笔迹颜色">${[["#202b23", "墨黑"], ["#2f7a58", "绿色"], ["#285f8f", "蓝色"], ["#bc4745", "红色"]].map(([value, label]) => `<button type="button" class="scratchpad-button" data-scratch-color="${value}" aria-label="${label}" aria-pressed="${value === color}"><span class="scratchpad-ink" style="--scratch-color:${value}"></span></button>`).join("")}</div><div class="scratchpad-widths" role="group" aria-label="笔迹粗细">${[[1.4, "细"], [2.4, "中"], [4.4, "粗"]].map(([value, label]) => `<button type="button" class="scratchpad-button" data-scratch-width="${value}" aria-label="${label}笔迹" aria-pressed="${value === width}"><span style="--scratch-width:${value / 16}rem"></span></button>`).join("")}</div><button type="button" class="scratchpad-button scratchpad-finger" data-scratch-action="finger" aria-pressed="true"><span>手指书写</span><i class="scratchpad-toggle" aria-hidden="true"></i></button></div></div></div>
      <div class="scratchpad-viewport scratchpad-chrome" role="group" aria-label="画布视图">${button("zoom-out", "缩小画布", "minus")}<button type="button" class="scratchpad-button scratchpad-scale" data-scratch-action="reset-zoom" aria-label="恢复原始缩放">100%</button>${button("zoom-in", "放大画布", "plus")}<span class="scratchpad-separator"></span>${button("home", "回到书写起点", "home")}</div><div class="scratchpad-status" role="status" aria-live="polite" hidden></div>`;
    document.body.append(overlay);
    surface = overlay.querySelector(".scratchpad-surface");
    [canvas, liveCanvas] = surface.querySelectorAll("canvas"); ctx = canvas.getContext("2d"); liveCtx = liveCanvas.getContext("2d");
    for (const item of [canvas, liveCanvas]) item.addEventListener("contextrestored", () => requestRender());
    surface.addEventListener("pointerdown", routePointer);
    for (const type of ["touchstart", "touchmove", "touchend", "touchcancel"]) {
      surface.addEventListener(type, routeTouch, { passive: false });
    }
    // Delivery must survive a capture failure/loss, including when the pen
    // crosses the toolbar. Capture loss itself is not a physical pen-up.
    document.addEventListener("pointermove", routePointer, { capture: true, passive: false });
    document.addEventListener("pointerup", routePointer, true);
    document.addEventListener("pointercancel", routePointer, true);
    surface.addEventListener("lostpointercapture", event => { if (pointers.has(event.pointerId)) capturePointer(event.pointerId); });
    overlay.addEventListener("pointerdown", event => {
      const protectingPen = surface.contains(event.target) ? penPointer !== null : penHasPriority();
      if (event.pointerType === "touch" && protectingPen) {
        blockedTouchUntil = performance.now() + 900;
        event.preventDefault(); event.stopImmediatePropagation();
      }
    }, { capture: true, passive: false });
    overlay.addEventListener("click", event => {
      const touchClick = event.pointerType === "touch" || event.sourceCapabilities?.firesTouchEvents || (!event.pointerType && event.detail > 0 && performance.now() < blockedTouchUntil);
      if (touchClick && (penHasPriority() || performance.now() < blockedTouchUntil)) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    overlay.addEventListener("touchstart", event => {
      if (surface.contains(event.target) || !penHasPriority()) return;
      if (Array.from(event.changedTouches).every(touch => touch.touchType === "stylus")) return;
      blockedTouchUntil = performance.now() + 900;
      if (event.cancelable) event.preventDefault();
      event.stopImmediatePropagation();
    }, { capture: true, passive: false });
    surface.addEventListener("contextmenu", event => event.preventDefault());
    surface.addEventListener("wheel", event => {
      if (!current || draftBusy || overlay.dataset.loading) return; event.preventDefault();
      if (activePointer !== null || penPointer !== null) return;
      if (event.ctrlKey || event.metaKey) current.viewport = Core.zoomAt(current.viewport, Math.exp(-event.deltaY * .006), localPoint(event));
      else { current.viewport.x -= event.deltaX; current.viewport.y -= event.deltaY; }
      changed(); requestRender();
    }, { passive: false });
    overlay.addEventListener("click", onClick);
    overlay.addEventListener("keydown", onKeyDown);
    overlay.addEventListener("keyup", event => { if (event.code === "Space") spaceDown = false; event.stopPropagation(); });
    new ResizeObserver(() => { if (isOpen) resize(); }).observe(surface);
  }
  function status(message = "", retry = false) {
    if (!overlay) return;
    const host = overlay.querySelector(".scratchpad-status"); host.textContent = message; host.hidden = !message;
    if (retry) { const action = document.createElement("button"); action.type = "button"; action.textContent = "重试保存"; action.dataset.scratchAction = "retry"; host.append(action); }
  }
  async function claimEditLock() {
    if (ownsEditLock || !navigator.locks?.request) return true;
    if (lockPromise) return lockPromise;
    lockPromise = new Promise((resolve, reject) => {
      navigator.locks.request("summer-politics-scratchpads-edit", { mode: "exclusive", ifAvailable: true }, async lock => {
        if (!lock) { resolve(false); return; }
        ownsEditLock = true;
        await new Promise(release => { releaseEditLock = release; resolve(true); });
        ownsEditLock = false; releaseEditLock = undefined;
      }).catch(reject);
    });
    try { return await lockPromise; } finally { lockPromise = null; }
  }
  function releaseLock() { releaseEditLock?.(); }
  async function initialize({ refresh = false } = {}) {
    if (refresh && revision === persisted) { await ready; ready = null; }
    if (!ready) ready = (async () => {
      const list = await store.list(), loaded = new Map();
      for (const meta of list) { const draft = await store.get(meta.id); if (draft) loaded.set(draft.id, draft); }
      const activeId = await store.getActiveId(); let selected = loaded.get(activeId) || loaded.values().next().value;
      if (!selected) { selected = Core.createDraft({ title: "草稿 1" }); await store.save(selected); loaded.set(selected.id, selected); }
      if (activeId !== selected.id) await store.setActiveId(selected.id);
      for (const [id, draft] of loaded) if (drafts.get(id)?.updatedAt !== draft.updatedAt) histories.delete(id);
      drafts.clear(); for (const [id, draft] of loaded) drafts.set(id, draft);
      current = selected;
    })().catch(error => { ready = null; throw error; });
    return ready;
  }
  async function open(trigger) {
    if (isOpen) return;
    mount(); clearTimeout(closeTimer); overlay.classList.remove("is-closing");
    isOpen = true; const token = ++opening; opener = trigger || document.activeElement;
    const app = document.getElementById("app"); inertBefore = app?.inert; if (app) app.inert = true;
    overlay.hidden = false; overlay.dataset.loading = "true"; overlay.focus({ preventScroll: true });
    try {
      if (!await claimEditLock()) { if (isOpen && token === opening) status("草稿正在另一个页面使用，请先在那个页面保存并关闭草稿本。"); return; }
      if (!isOpen || token !== opening) { if (!isOpen) releaseLock(); return; }
      await initialize({ refresh: true }); if (!isOpen || token !== opening) return;
      delete overlay.dataset.loading;
      if (revision > persisted) { status("草稿尚未保存。", true); void flush().catch(() => {}); } else status();
      sync(); resize(); requestRender();
    } catch { if (isOpen && token === opening) status("无法读取草稿，请关闭后重试。已有草稿未被修改。"); }
  }
  function close({ restoreFocus = true, immediate = false } = {}) {
    if (!isOpen) return;
    resetInput(); ++opening; isOpen = false;
    // Keep ownership on storage failure so another tab cannot overwrite the
    // unsaved ink. Reopening this tab lets the user retry or export it.
    void Promise.resolve(ready).then(flush).then(() => { if (!isOpen) releaseLock(); }).catch(() => {}); closeMenus();
    document.getElementById("app")?.removeAttribute("inert");
    if (inertBefore) document.getElementById("app").inert = true;
    if (restoreFocus && opener?.isConnected) opener.focus({ preventScroll: true });
    overlay.classList.add("is-closing"); overlay.classList.remove("is-panning");
    clearTimeout(closeTimer);
    const hide = () => { if (!isOpen) { overlay.hidden = true; overlay.classList.remove("is-closing"); } };
    if (immediate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) hide(); else closeTimer = setTimeout(hide, 170);
  }
  function changed() {
    if (!current) return;
    current.updatedAt = Math.max(Date.now(), current.updatedAt + 1); ++revision;
    clearTimeout(saveTimer); saveTimer = setTimeout(autoSave, 300);
    syncButtons();
  }
  function inkChanged() {
    current.updatedAt = Math.max(Date.now(), current.updatedAt + 1); ++revision;
  }
  function currentSnapshot() {
    return activeStroke ? { ...current, strokes: [...current.strokes, activeStroke] } : current;
  }
  function autoSave() {
    // A timer from the previous stroke must never cut off the next stroke.
    if (activePointer !== null) { saveTimer = setTimeout(autoSave, 300); return; }
    void flush().catch(() => {});
  }
  function flush() {
    clearTimeout(saveTimer);
    if (!current || revision === persisted) return writeQueue;
    // A backup or explicit save can run while a pen is still down. Snapshot its
    // current points without changing ownership or terminating the live stroke.
    const version = revision;
    // The store validates, copies and serializes writes synchronously at this
    // boundary. Avoid copying every saved point a second time on the UI thread.
    writeQueue = store.save(currentSnapshot()).then(() => {
      persisted = Math.max(persisted, version); if (revision === version) status();
    }, error => { status("草稿暂未保存，请重试或到设置导出备份。", true); throw error; });
    return writeQueue;
  }
  function remember(before, after, redraw = true) {
    if (before.length === after.length && before.every((stroke, index) => stroke === after[index])) return;
    const stack = history(); stack.undo.push({ before, after }); if (stack.undo.length > 60) stack.undo.shift(); stack.redo.length = 0;
    changed(); requestRender(redraw);
  }
  function finishInput({ cancel = false } = {}) {
    if (activeStroke) {
      if (!cancel && current && activeStroke.points.length) {
        current.strokes.push(activeStroke); pendingInk.push(activeStroke);
        remember(strokeBefore || current.strokes.slice(0, -1), current.strokes.slice(), false);
      } else if (cancel && strokeBefore) { current.strokes = strokeBefore; requestRender(); }
      activeStroke = null;
    }
    strokeBefore = null;
    if (eraseBefore && current) { if (cancel) current.strokes = eraseBefore; else remember(eraseBefore, current.strokes.slice()); eraseBefore = null; }
    activePointer = null; requestRender(false);
  }
  function closeMenus() {
    if (!overlay) return;
    overlay.querySelectorAll(".scratchpad-popover").forEach(menu => { menu.hidden = true; });
    overlay.querySelectorAll("[aria-expanded]").forEach(el => el.setAttribute("aria-expanded", "false"));
  }
  function renderList() {
    const host = overlay.querySelector("#scratchpad-list"); host.replaceChildren();
    [...drafts.values()].sort((a, b) => b.createdAt - a.createdAt).forEach(draft => {
      const item = document.createElement("button"); item.type = "button"; item.className = "scratchpad-draft";
      item.dataset.scratchDraft = draft.id; item.setAttribute("role", "option"); item.setAttribute("aria-selected", String(draft.id === current?.id));
      item.innerHTML = `${svg("book")}<span></span>${draft.id === current?.id ? svg("check") : ""}`;
      item.querySelector("span").textContent = draft.title; host.append(item);
    });
  }
  function syncButtons() {
    if (!overlay || !current) return;
    overlay.querySelector('[data-scratch-action="undo"]').disabled = !history().undo.length;
    overlay.querySelector('[data-scratch-action="redo"]').disabled = !history().redo.length;
    overlay.querySelector(".scratchpad-scale").textContent = `${Math.round(current.viewport.scale * 100)}%`;
    overlay.dataset.tool = tool;
    for (const name of ["pen", "hand", "eraser"]) overlay.querySelector(`[data-scratch-action="${name}"]`).setAttribute("aria-pressed", String(tool === name));
    overlay.querySelector('[data-scratch-action="finger"]').setAttribute("aria-pressed", String(fingerDraw));
  }
  function sync() {
    overlay.querySelector(".scratchpad-title > span").textContent = current.title;
    renderList(); syncButtons();
  }
  async function changeDraft(id) {
    if (draftBusy || !current) return; draftBusy = true; overlay.dataset.switching = "true"; resetInput();
    try {
      await flush();
      if (id) { const draft = drafts.get(id); if (!draft) return; await store.setActiveId(id); current = draft; }
      else {
        const next = Math.max(0, ...[...drafts.values()].map(draft => Number(/^草稿 (\d+)$/.exec(draft.title)?.[1]) || 0)) + 1;
        const draft = Core.createDraft({ title: `草稿 ${next}` });
        await store.saveMany([draft], draft.id); drafts.set(draft.id, draft); current = draft;
      }
      revision = persisted = 0; status(); closeMenus(); sync(); requestRender();
    } catch { status("无法保存草稿，已保留当前内容。请重试保存后再切换。", true); }
    finally { draftBusy = false; delete overlay.dataset.switching; }
  }
  function onClick(event) {
    const draft = event.target.closest("[data-scratch-draft]"); if (draft) { void changeDraft(draft.dataset.scratchDraft); return; }
    const swatch = event.target.closest("[data-scratch-color]");
    if (swatch) { color = swatch.dataset.scratchColor; overlay.querySelector('[data-scratch-action="options"] .scratchpad-ink').style.setProperty("--scratch-color", color); overlay.querySelectorAll("[data-scratch-color]").forEach(el => el.setAttribute("aria-pressed", String(el === swatch))); return; }
    const size = event.target.closest("[data-scratch-width]");
    if (size) { width = Number(size.dataset.scratchWidth); overlay.querySelectorAll("[data-scratch-width]").forEach(el => el.setAttribute("aria-pressed", String(el === size))); return; }
    const action = event.target.closest("[data-scratch-action]")?.dataset.scratchAction;
    if (action === "close") { close(); return; }
    if (overlay.dataset.loading || draftBusy || !current) return;
    if (["list", "options"].includes(action)) {
      const host = overlay.querySelector(action === "list" ? "#scratchpad-list" : "#scratchpad-options"), show = host.hidden;
      closeMenus(); host.hidden = !show; overlay.querySelector(`[data-scratch-action="${action}"]`).setAttribute("aria-expanded", String(show));
      if (show && action === "list") { renderList(); host.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" }); }
      return;
    }
    if (!event.target.closest(".scratchpad-popover")) closeMenus();
    if (["pen", "hand", "eraser"].includes(action)) { finishInput(); tool = action; syncButtons(); }
    if (action === "finger") { finishInput(); fingerDraw = !fingerDraw; syncButtons(); }
    if (action === "new") void changeDraft();
    if (action === "retry") void flush().catch(() => {});
    if (action === "undo" || action === "redo") undoRedo(action);
    if (["zoom-in", "zoom-out", "reset-zoom", "home"].includes(action)) {
      finishInput(); current.viewport = action === "home" ? { x: 0, y: 0, scale: 1 } : Core.zoomAt(current.viewport, action === "reset-zoom" ? 1 / current.viewport.scale : action === "zoom-in" ? 1.25 : .8, { x: viewWidth / 2, y: viewHeight / 2 });
      changed(); requestRender();
    }
  }
  function undoRedo(action) {
    finishInput(); const stack = history(), entry = stack[action].pop(); if (!entry) return;
    current.strokes = (action === "undo" ? entry.before : entry.after).slice(); stack[action === "undo" ? "redo" : "undo"].push(entry); changed(); requestRender();
  }
  function onKeyDown(event) {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); const menu = [...overlay.querySelectorAll(".scratchpad-popover")].find(el => !el.hidden); if (menu) { closeMenus(); overlay.focus(); } else close(); return; }
    if (event.key === "Tab") {
      const list = [...overlay.querySelectorAll("button:not(:disabled)")].filter(el => !el.closest("[hidden]"));
      if (list.length && (event.shiftKey ? document.activeElement === list[0] || document.activeElement === overlay : document.activeElement === list[list.length - 1] || document.activeElement === overlay)) { event.preventDefault(); list[event.shiftKey ? list.length - 1 : 0].focus(); }
      return;
    }
    const menu = event.target.closest('[role="listbox"]');
    if (menu && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault(); const items = [...menu.querySelectorAll("button")], index = items.indexOf(document.activeElement);
      items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus(); return;
    }
    if (!current || draftBusy || overlay.dataset.loading) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { event.preventDefault(); undoRedo(event.shiftKey ? "redo" : "undo"); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") { event.preventDefault(); undoRedo("redo"); }
    if (event.code === "Space" && !event.target.closest("button")) { event.preventDefault(); spaceDown = true; }
    if (event.target === overlay && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault(); current.viewport.x += event.key === "ArrowLeft" ? 60 : event.key === "ArrowRight" ? -60 : 0; current.viewport.y += event.key === "ArrowUp" ? 60 : event.key === "ArrowDown" ? -60 : 0; changed(); requestRender();
    }
  }
  function localPoint(event, rect = surface.getBoundingClientRect()) { return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
  function worldPoint(event, rect) { return Core.normalizePoint({ ...Core.screenToWorld(localPoint(event, rect), current.viewport), pressure: event.pointerType === "pen" ? (event.pressure || .15) : .5 }); }
  function penHasPriority() { return penPointer !== null || performance.now() - lastPen < 500; }
  function penInContact(event) { return event.pointerType === "pen" && (Boolean(event.buttons & 33) || (event.buttons === 0 && event.pressure > 0)); }
  function capturePointer(id) { if (id < 0) return; try { if (!liveCanvas.hasPointerCapture(id)) liveCanvas.setPointerCapture(id); } catch { /* Document listeners remain the fallback. */ } }
  function releasePointer(id) { if (id < 0) return; try { if (liveCanvas.hasPointerCapture(id)) liveCanvas.releasePointerCapture(id); } catch { /* The browser may already have canceled it. */ } }
  function resetInput(recoverPen = false) {
    if (recoverPen) { for (const point of pointers.values()) if (point.type === "pen") interruptedPens.add(point.id); }
    else interruptedPens.clear();
    touchContacts.clear();
    finishInput(); const ids = [...pointers.keys()]; pointers.clear();
    gesture = null; gestureWasMulti = false; penPointer = null; spaceDown = false;
    overlay?.classList.remove("is-panning"); for (const id of ids) releasePointer(id);
  }
  function canReceiveInput() { return isOpen && current && !draftBusy && !overlay.dataset.loading && !document.hidden; }
  function beginGesture() {
    const touches = [...pointers.values()].filter(point => point.type === "touch");
    if (touches.length < 2) return;
    finishInput({ cancel: true });
    const [a, b] = touches; gesture = { a: a.id, b: b.id, distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, viewport: { ...current.viewport } };
    gestureWasMulti = true; overlay.classList.add("is-panning");
  }
  // Some tablet engines deliver the same physical contact through two APIs.
  // Bind their starts once and keep one stroke, even if only touchmove continues.
  function routeTouch(event) {
    if (!canReceiveInput()) return;
    if (event.cancelable) event.preventDefault();
    const changed = Array.from(event.changedTouches);
    if (event.type === "touchstart" && event.touches) {
      const live = new Set(Array.from(event.touches, touch => touch.identifier));
      for (const [identifier, old] of touchContacts) {
        if (live.has(identifier) && !changed.some(touch => touch.identifier === identifier)) continue;
        touchContacts.delete(identifier);
        endPointer({ pointerId: old.id }, false);
      }
    }
    for (const touch of changed) {
      let contact = touchContacts.get(touch.identifier);
      if (event.type === "touchstart") {
        if (contact) continue;
        const pos = localPoint(touch);
        const match = [...pointers.values()].find(point =>
          point.type !== "mouse" && point.touchId === undefined &&
          Math.hypot(point.startX - pos.x, point.startY - pos.y) <= 4);
        const type = touch.touchType === "stylus" || match?.type === "pen" ? "pen" : "touch";
        const id = match ? match.id : -2 - touch.identifier;
        contact = { id, type, nativeId: match?.id, x: pos.x, y: pos.y };
        if (!match || match.type !== type) pointerDown(touchSample(touch, contact, event));
        const tracked = pointers.get(id);
        if (!tracked) continue;
        tracked.touchId = touch.identifier;
        touchContacts.set(touch.identifier, contact);
      } else if (contact) {
        const sample = touchSample(touch, contact, event);
        if (event.type === "touchmove") {
          const point = pointers.get(contact.id);
          if (!point) continue;
          const pos = localPoint(sample);
          if (pos.x !== point.x || pos.y !== point.y) {
            pointerMove(sample);
            point.touchMovedAt = event.timeStamp;
          }
        } else {
          touchContacts.delete(touch.identifier);
          if (event.type === "touchend") pointerUp(sample);
          else pointerCancel(sample);
        }
      }
    }
  }
  function touchSample(touch, contact, event) {
    return { pointerId: contact.id, pointerType: contact.type, target: surface, button: 0,
      buttons: event.type === "touchend" || event.type === "touchcancel" ? 0 : 1,
      pressure: touch.force || .5, clientX: touch.clientX, clientY: touch.clientY,
      width: 2 * (touch.radiusX || 1), height: 2 * (touch.radiusY || 1),
      preventDefault() {} };
  }
  function routePointer(event) {
    if (!canReceiveInput()) return;
    let contact;
    for (const candidate of touchContacts.values()) {
      if (candidate.nativeId === event.pointerId) { contact = candidate; break; }
    }
    if (event.type === "pointerdown" && !contact && event.pointerType !== "mouse") {
      // Touch-first dispatch order: adopt the existing contact, not a second pen.
      const pos = localPoint(event);
      for (const candidate of touchContacts.values()) {
        if (candidate.nativeId === undefined &&
            Math.hypot(candidate.x - pos.x, candidate.y - pos.y) <= 4) {
          candidate.nativeId = event.pointerId;
          const point = pointers.get(candidate.id);
          if (event.pointerType === "pen" && point && activePointer === candidate.id && activeStroke) {
            point.type = candidate.type = activeStroke.pointerType = "pen";
            penPointer = candidate.id;
            lastPen = performance.now();
          }
          return;
        }
      }
    }
    let sample = event;
    if (contact && (contact.id !== event.pointerId || contact.type !== event.pointerType)) {
      sample = { pointerId: contact.id, pointerType: contact.type, target: event.target,
        button: event.button, buttons: event.buttons, pressure: event.pressure,
        clientX: event.clientX, clientY: event.clientY, width: event.width, height: event.height,
        getCoalescedEvents: event.getCoalescedEvents?.bind(event), preventDefault: () => event.preventDefault() };
    }
    if (event.type === "pointerdown") pointerDown(sample);
    else if (event.type === "pointermove") {
      if (!contact?.pointerEnded) pointerMove(sample);
    } else if (contact) {
      // The Touch identifier lasts until touchend/cancel. Some engines stop
      // the parallel pointer stream earlier; its final hover must not add ink.
      contact.pointerEnded = true;
    } else {
      const point = pointers.get(sample.pointerId);
      if (point?.touchId !== undefined) touchContacts.delete(point.touchId);
      if (event.type === "pointerup") pointerUp(sample);
      else pointerCancel(sample);
    }
  }
  function pointerDown(event) {
    if (!canReceiveInput() || (event.pointerType === "mouse" && ![0, 1].includes(event.button))) return;
    if (event.pointerType === "pen" && event.button !== 0 && !penInContact(event)) return;
    event.preventDefault(); closeMenus();
    if (event.pointerType === "touch" && (penPointer !== null || event.width > 45 || event.height > 45)) return;
    // A delayed second contact during established handwriting is often a palm.
    // Two contacts placed together still enter the pan/zoom gesture.
    const writing = pointers.get(activePointer);
    if (event.pointerType === "touch" && writing?.type === "touch" && activeStroke &&
        activeStroke.points.length > 1 && performance.now() - writing.started > 150) return;
    if (event.pointerType === "pen") {
      if (pointers.get(activePointer)?.type === "touch") finishInput({ cancel: true });
      // A new contact supersedes a missing pen-up, including reused pointer IDs.
      else if (activePointer !== null) finishInput();
      for (const [id, point] of pointers) if (point.type === "touch" || point.type === "pen") { if (point.touchId !== undefined) touchContacts.delete(point.touchId); pointers.delete(id); releasePointer(id); }
      interruptedPens.delete(event.pointerId);
      penPointer = event.pointerId; lastPen = performance.now(); gesture = null;
      overlay.classList.remove("is-panning");
    }
    const point = localPoint(event); pointers.set(event.pointerId, { ...point, startX: point.x, startY: point.y, type: event.pointerType, id: event.pointerId, started: performance.now() });
    capturePointer(event.pointerId);
    if (event.pointerType === "touch" && [...pointers.values()].filter(item => item.type === "touch").length >= 2) { beginGesture(); return; }
    if (activePointer !== null) return;
    activePointer = event.pointerId; gestureWasMulti = false;
    const pan = tool === "hand" || spaceDown || event.button === 1 || (event.pointerType === "touch" && !fingerDraw);
    if (pan) { gesture = { id: event.pointerId, point, viewport: { ...current.viewport } }; overlay.classList.add("is-panning"); return; }
    if (tool === "eraser" || event.button === 5 || (event.buttons & 32)) { eraseBefore = current.strokes.slice(); eraseAt(event); return; }
    strokePointLimit = Math.min(Core.LIMITS.strokePoints, Core.LIMITS.points - current.strokes.reduce((sum, stroke) => sum + stroke.points.length, 0));
    if (current.strokes.length >= Core.LIMITS.strokes || strokePointLimit <= 0) { activePointer = null; status("这份草稿已达到容量上限，请新建草稿继续书写。"); return; }
    const first = worldPoint(event); if (!first) { activePointer = null; return; }
    strokeBefore = current.strokes.slice();
    activeStroke = { id: Core.createId(), color, width, points: [first], pointerType: event.pointerType };
    inkChanged();
    requestRender(false);
  }
  function eraseAt(event) {
    const point = worldPoint(event), radius = 10 / current.viewport.scale;
    current.strokes = current.strokes.filter(stroke => {
      if (!bounds.has(stroke)) bounds.set(stroke, Core.strokeBounds(stroke));
      const box = bounds.get(stroke);
      if (point.x < box.minX - radius || point.x > box.maxX + radius || point.y < box.minY - radius || point.y > box.maxY + radius) return true;
      return !Core.hitStroke(stroke, point, radius);
    }); requestRender();
  }
  function pointerMove(event) {
    if (!canReceiveInput()) return;
    const contact = penInContact(event);
    // Recover only from confirmed physical contact. Hover and a real pen-up
    // never reconnect across a browser-canceled segment or another page.
    if (!pointers.has(event.pointerId) && contact && (interruptedPens.has(event.pointerId) || event.target === surface || surface.contains(event.target))) pointerDown(event);
    const point = pointers.get(event.pointerId); if (!point) return;
    // Down/up delimit a known pen contact. Missing pressure/buttons on a move
    // must not turn the rest of that physical stroke into hover. Barrel-only
    // movement after tip release is the chorded-button exception.
    if (event.pointerType === "pen" && !contact && event.buttons !== 0) { endPointer(event, false); return; }
    event.preventDefault(); Object.assign(point, localPoint(event));
    if (event.pointerType === "pen") lastPen = performance.now();
    if (gesture?.a !== undefined) {
      const a = pointers.get(gesture.a), b = pointers.get(gesture.b); if (!a || !b) return;
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      current.viewport = Core.zoomAt(gesture.viewport, distance / gesture.distance, gesture.center);
      current.viewport.x += center.x - gesture.center.x; current.viewport.y += center.y - gesture.center.y;
      changed(); requestRender(); return;
    }
    if (gesture?.id === event.pointerId) { current.viewport.x = gesture.viewport.x + point.x - gesture.point.x; current.viewport.y = gesture.viewport.y + point.y - gesture.point.y; changed(); requestRender(); return; }
    if (event.pointerId !== activePointer) return;
    if (eraseBefore) { eraseAt(event); return; }
    if (!activeStroke) return;
    let events; try { events = event.getCoalescedEvents?.(); } catch { /* Fall back to this event. */ }
    const rect = surface.getBoundingClientRect();
    for (const sample of events?.length ? events : [event]) {
      if (point.touchMovedAt && sample.timeStamp < point.touchMovedAt) continue;
      if (!appendInk(sample, rect)) break;
    }
    requestRender(false);
  }
  function appendInk(sample, rect) {
    const next = worldPoint(sample, rect); if (!next || !activeStroke) return true;
    const previous = activeStroke.points[activeStroke.points.length - 1];
    if (Math.hypot(next.x - previous.x, next.y - previous.y) * current.viewport.scale <= .35) return true;
    if (activeStroke.points.length >= strokePointLimit) {
      // Store bounded chunks while keeping one uninterrupted contact and one
      // undo operation. A long pen stroke must not silently stop at 50k points.
      const completed = activeStroke, last = completed.points[completed.points.length - 1];
      const remaining = Core.LIMITS.points - current.strokes.reduce((sum, stroke) => sum + stroke.points.length, 0) - completed.points.length;
      if (remaining < 2 || current.strokes.length + 1 >= Core.LIMITS.strokes) { finishInput(); status("这份草稿已达到容量上限，请新建草稿继续书写。"); return false; }
      current.strokes.push(completed); pendingInk.push(completed);
      activeStroke = { id: Core.createId(), color: completed.color, width: completed.width, pointerType: completed.pointerType, points: [last] };
      strokePointLimit = Math.min(Core.LIMITS.strokePoints, remaining);
    }
    activeStroke.points.push(next); inkChanged(); return true;
  }
  function pointerUp(event) {
    interruptedPens.delete(event.pointerId);
    endPointer(event, true);
  }
  function endPointer(event, append) {
    if (!pointers.has(event.pointerId)) return;
    if (activePointer === event.pointerId) {
      // Pen-up often reports buttons=0: process its final point without treating
      // that final sample as a new hover or recursively ending the contact.
      if (append && activeStroke && !gesture) appendInk(event);
      finishInput();
    }
    pointers.delete(event.pointerId);
    if (penPointer === event.pointerId) { penPointer = null; lastPen = performance.now(); }
    if (gesture && (gesture.id === event.pointerId || gesture.a === event.pointerId || gesture.b === event.pointerId)) {
      gesture = null; activePointer = null;
      // The remaining finger continues panning after a pinch, never drawing.
      const next = [...pointers.values()].find(point => point.type === "touch");
      if (next && gestureWasMulti) { activePointer = next.id; gesture = { id: next.id, point: { ...next }, viewport: { ...current.viewport } }; }
    }
    releasePointer(event.pointerId);
    if (!pointers.size) { overlay.classList.remove("is-panning"); gestureWasMulti = false; }
  }
  function pointerCancel(event) {
    const point = pointers.get(event.pointerId); if (!point) return;
    if (point.type === "pen") interruptedPens.add(event.pointerId);
    endPointer(event, false);
  }
  function resize() {
    const rect = surface.getBoundingClientRect(); viewWidth = rect.width; viewHeight = rect.height;
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2.5, Math.sqrt(8000000 / Math.max(1, viewWidth * viewHeight)));
    if (canvas.width === Math.round(viewWidth * pixelRatio) && canvas.height === Math.round(viewHeight * pixelRatio)) return;
    for (const item of [canvas, liveCanvas]) { item.width = Math.round(viewWidth * pixelRatio); item.height = Math.round(viewHeight * pixelRatio); }
    requestRender();
  }
  function strokeVisible(stroke) {
    if (!bounds.has(stroke)) bounds.set(stroke, Core.strokeBounds(stroke));
    const box = bounds.get(stroke), { x, y, scale } = current.viewport;
    return box.maxX * scale + x >= 0 && box.minX * scale + x <= viewWidth && box.maxY * scale + y >= 0 && box.minY * scale + y <= viewHeight;
  }
  function drawStroke(context, stroke) {
    const points = stroke.points; if (!points.length) return;
    context.strokeStyle = context.fillStyle = stroke.color; context.lineCap = context.lineJoin = "round";
    if (points.length === 1) { context.beginPath(); context.arc(points[0].x, points[0].y, stroke.width * (.45 + points[0].pressure * .9) / 2, 0, Math.PI * 2); context.fill(); return; }
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i]; context.lineWidth = stroke.width * (.45 + (a.pressure + b.pressure) * .45);
      context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y); context.stroke();
    }
  }
  function prepare(context, item) {
    context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, item.width, item.height);
    const { x, y, scale } = current.viewport; context.setTransform(pixelRatio * scale, 0, 0, pixelRatio * scale, pixelRatio * x, pixelRatio * y);
  }
  function requestRender(base = true) {
    renderBase ||= base; if (rendering || !isOpen || !current) return; rendering = true;
    requestAnimationFrame(() => {
      rendering = false; if (!isOpen || !current) return;
      const redraw = renderBase;
      if (redraw) {
        prepare(ctx, canvas); for (const stroke of current.strokes) if (strokeVisible(stroke)) drawStroke(ctx, stroke);
        pendingInk.length = 0;
        const { x, y, scale } = current.viewport, grid = 24 * scale * (scale < .5 ? 4 : 1);
        surface.style.setProperty("--scratch-grid", `${grid / parseFloat(getComputedStyle(document.documentElement).fontSize)}rem`);
        surface.style.setProperty("--scratch-x", `${x / parseFloat(getComputedStyle(document.documentElement).fontSize)}rem`);
        surface.style.setProperty("--scratch-y", `${y / parseFloat(getComputedStyle(document.documentElement).fontSize)}rem`);
        syncButtons(); renderBase = false;
      } else { for (const stroke of pendingInk) if (strokeVisible(stroke)) drawStroke(ctx, stroke); pendingInk.length = 0; }
      if (redraw || !activeStroke || liveStrokeId !== activeStroke.id) {
        prepare(liveCtx, liveCanvas); liveDrawnPoints = 0; liveStrokeId = activeStroke?.id || null;
      }
      if (activeStroke && activeStroke.points.length > liveDrawnPoints) {
        drawStroke(liveCtx, { ...activeStroke, points: activeStroke.points.slice(Math.max(0, liveDrawnPoints - 1)) });
        liveDrawnPoints = activeStroke.points.length;
      }
    });
  }
  async function exportBackup() {
    await initialize({ refresh: !isOpen && revision === persisted && !ownsEditLock });
    // Export memory too: quota failures must not strand the latest ink.
    await flush().catch(() => {});
    const documents = [...drafts.values()].map(draft => Core.sanitizeDraft(draft === current ? currentSnapshot() : draft));
    if (documents.some(draft => !draft)) throw new Error("草稿内容无法完整导出，请保留当前页面并重试");
    return { version: 1, activeId: current?.id || null, drafts: documents };
  }
  async function importBackup(payload) {
    if (!payload || payload.version !== 1 || !Array.isArray(payload.drafts) || payload.drafts.length > Core.LIMITS.drafts) throw new Error("草稿备份格式不正确");
    const incoming = payload.drafts.map(value => Core.sanitizeDraft(value)), ids = new Set(incoming.filter(Boolean).map(draft => draft.id));
    if (incoming.some(draft => !draft) || ids.size !== incoming.length || (payload.activeId !== null && !ids.has(payload.activeId))) throw new Error("草稿备份格式不正确");
    if (draftBusy || !await claimEditLock()) throw new Error("草稿正在另一个页面使用，请保存并关闭草稿本后重试");
    draftBusy = true; if (overlay) overlay.dataset.switching = "true";
    try {
      await initialize({ refresh: !isOpen }); resetInput(); await flush();
      const merged = new Map(drafts);
      for (const draft of incoming) if (!merged.has(draft.id) || merged.get(draft.id).updatedAt < draft.updatedAt) merged.set(draft.id, draft);
      const activeId = merged.has(payload.activeId) ? payload.activeId : current.id;
      await store.saveMany([...merged.values()], activeId);
      drafts.clear(); for (const [id, draft] of merged) drafts.set(id, draft);
      current = drafts.get(activeId); histories.clear(); revision = persisted = 0;
      if (isOpen) { sync(); requestRender(); }
    } finally {
      draftBusy = false; if (overlay) delete overlay.dataset.switching;
      if (!isOpen && revision === persisted) releaseLock();
    }
  }
  document.addEventListener("click", event => { const target = event.target.closest("[data-scratchpad-open]"); if (target) void open(target); });
  window.addEventListener("hashchange", () => close({ restoreFocus: false, immediate: true }));
  window.addEventListener("popstate", () => close({ restoreFocus: false, immediate: true }));
  window.addEventListener("summer-politics:tabchange", () => close({ restoreFocus: false, immediate: true }));
  window.addEventListener("blur", () => { if (isOpen) resetInput(true); });
  window.addEventListener("pagehide", () => { resetInput(); void flush().catch(() => {}); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) { resetInput(true); void flush().catch(() => {}); } });
  window.addEventListener("resize", () => { if (isOpen) resize(); });
  window.Scratchpad = Object.freeze({ open, close, flush, exportBackup, importBackup, get isOpen() { return isOpen; } });
})();
