/* Draw once per site visit, without replacement until every fact has appeared. */
(() => {
  "use strict";
  const card = document.querySelector(".daily-knowledge");
  if (!card) return;
  const STORAGE_KEY = "summer-politics-daily-knowledge-v1";
  const LOCK_KEY = "summer-politics-daily-knowledge-lock-v1";
  const statement = document.getElementById("daily-knowledge-statement");
  const notice = document.getElementById("daily-knowledge-notice");
  const retry = document.getElementById("daily-knowledge-retry");
  let library;
  let current;
  let pending;
  let memory;

  function setNotice(message = "") {
    notice.textContent = message;
    notice.hidden = !message;
  }

  function readState() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      return value && typeof value === "object" && Array.isArray(value.seen) ? value : {};
    } catch {
      setNotice("浏览器无法保存阅读记录，重新访问时可能出现重复知识点。");
      return memory || {};
    }
  }

  function draw() {
    const previous = readState();
    const ids = new Set(library.points.map(point => point.id));
    const seen = new Set((previous.seen || []).filter(id => ids.has(id)));
    let cycle = Number.isInteger(previous.cycle) && previous.cycle > 0 ? previous.cycle : 1;
    let remaining = library.points.filter(point => !seen.has(point.id));
    if (!remaining.length) {
      seen.clear();
      cycle++;
      remaining = library.points.filter(point => library.points.length === 1 || point.id !== previous.lastId);
    }
    const random = globalThis.crypto?.getRandomValues
      ? crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296
      : Math.random();
    const point = remaining[Math.floor(random * remaining.length)];
    seen.add(point.id);
    const state = { version: 1, sourceVersion: library.sourceVersion, seen: [...seen], cycle, lastId: point.id, updatedAt: Date.now() };
    memory = state;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch { setNotice("本机存储空间不足，阅读记录暂未保存，重新访问时可能重复。"); }
    return point;
  }

  // A read/write IndexedDB transaction provides a cross-tab mutex on browsers
  // without Web Locks. The actual cycle stays in localStorage for backup.
  function drawWithDatabaseLock() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(LOCK_KEY, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("mutex");
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("阅读记录暂时不可用"));
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("mutex", "readwrite");
        let result;
        const read = transaction.objectStore("mutex").get("draw");
        read.onsuccess = () => {
          try { result = draw(); transaction.objectStore("mutex").put(Date.now(), "draw"); }
          catch (error) { transaction.abort(); reject(error); }
        };
        transaction.oncomplete = () => { database.close(); resolve(result); };
        transaction.onabort = transaction.onerror = () => {
          database.close();
          // draw() has already persisted the cycle synchronously; never consume
          // another fact merely because the auxiliary mutex store could not commit.
          if (result) resolve(result);
          else reject(transaction.error || new Error("阅读记录暂时不可用"));
        };
      };
    });
  }

  function render(point) {
    current = point;
    statement.textContent = point.statement;
    statement.classList.add("is-ready");
    document.getElementById("daily-knowledge-module").textContent = point.module === "politics" ? "政治理论" : "常识判断";
    const source = point.source || {};
    document.getElementById("daily-knowledge-source").textContent = [source.title, point.title, source.page ? `第 ${source.page} 页` : ""].filter(Boolean).join(" · ");
    const original = document.getElementById("daily-knowledge-original");
    const questionId = point.questionIds?.find(id => /^[a-z0-9-]+-p\d+-q\d+$/.test(id));
    if (questionId) {
      const pageId = questionId.replace(/-q\d+$/, "");
      const bookId = pageId.replace(/-p\d+$/, "");
      original.href = `data/knowledge/pages/${bookId}/${pageId}.svg`;
      original.hidden = false;
    }
    card.querySelector(".daily-knowledge-source").hidden = false;
    card.setAttribute("aria-busy", "false");
    retry.hidden = true;
  }

  async function show() {
    if (pending || current) return pending;
    card.setAttribute("aria-busy", "true");
    pending = (async () => {
      if (!library) {
        const response = await fetch("data/knowledge/daily-points.json", { cache: "no-cache" });
        if (!response.ok) throw new Error("知识库暂时未能加载");
        library = await response.json();
        if (!Array.isArray(library.points) || !library.points.length) throw new Error("知识库还没有可展示的知识点");
      }
      let point;
      if (navigator.locks?.request) point = await navigator.locks.request(LOCK_KEY, draw);
      else {
        try { point = await drawWithDatabaseLock(); }
        catch { point = draw(); }
      }
      render(point);
    })().catch(error => {
      statement.textContent = "知识点暂时未能加载。";
      setNotice(error.message || "请稍后重试。");
      retry.hidden = false;
      card.setAttribute("aria-busy", "false");
    }).finally(() => { pending = null; });
    return pending;
  }

  retry.addEventListener("click", () => { setNotice(); library = null; show(); });
  window.addEventListener("summer-politics:tabchange", event => { if (event.detail?.tab === "dashboard") show(); });
  window.addEventListener("pageshow", event => {
    if (event.persisted && document.getElementById("view-dashboard").classList.contains("active")) { current = null; show(); }
  });
  if ((!location.hash || location.hash === "#/dashboard") && document.getElementById("view-dashboard").classList.contains("active")) show();
})();
