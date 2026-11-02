/* Scratchpad geometry and durable local documents. UI and undo history live in
 * scratchpad.js; this module never creates a canvas or starts a network request. */
(function (scope, factory) {
  const api = factory(scope);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (scope) scope.ScratchpadCore = api;
})(typeof window !== "undefined" ? window : globalThis, function (scope) {
  "use strict";
  const VERSION = 1;
  const STORAGE_KEY = "summer-politics-scratchpads-v1";
  const DATABASE_NAME = "summer-politics-scratchpads";
  const LIMITS = Object.freeze({ drafts: 1000, strokes: 20000, strokePoints: 50000, points: 1000000, coordinate: 1e9, jsonBytes: 32 * 1024 * 1024 });
  const plain = value => Boolean(value && typeof value === "object" && !Array.isArray(value));
  const validId = value => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/.test(value) && !["__proto__", "constructor", "prototype"].includes(value);
  const finiteCoordinate = value => Number.isFinite(value) && Math.abs(value) <= LIMITS.coordinate;
  const validTime = value => Number.isFinite(value) && value > 0;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function createId() {
    return scope?.crypto?.randomUUID?.() || `scratch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  }
  function normalizePoint(point) {
    if (!plain(point) || !finiteCoordinate(point.x) || !finiteCoordinate(point.y)) return null;
    return { x: point.x, y: point.y, pressure: Number.isFinite(point.pressure) ? clamp(point.pressure, 0, 1) : .5 };
  }
  function validViewport(viewport) {
    return plain(viewport) && finiteCoordinate(viewport.x) && finiteCoordinate(viewport.y) && Number.isFinite(viewport.scale) && viewport.scale >= .1 && viewport.scale <= 8;
  }
  function createDraft({ id = createId(), title = "草稿", now = Date.now() } = {}) {
    if (!validId(id) || typeof title !== "string" || !title.trim() || title.length > 80 || !validTime(now)) throw new TypeError("草稿信息不正确");
    return { version: VERSION, id, title: title.trim(), createdAt: now, updatedAt: now, strokes: [], viewport: { x: 0, y: 0, scale: 1 } };
  }
  function sanitizeDraft(value) {
    if (!plain(value) || value.version !== VERSION || !validId(value.id) || typeof value.title !== "string" || !value.title.trim() || value.title.length > 80 ||
        !validTime(value.createdAt) || !validTime(value.updatedAt) || value.updatedAt < value.createdAt || !validViewport(value.viewport) ||
        !Array.isArray(value.strokes) || value.strokes.length > LIMITS.strokes) return null;
    const strokes = [], ids = new Set();
    let total = 0;
    for (const stroke of value.strokes) {
      if (!plain(stroke) || !validId(stroke.id) || ids.has(stroke.id) || typeof stroke.color !== "string" || !/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(stroke.color) ||
          !Number.isFinite(stroke.width) || stroke.width < .1 || stroke.width > 100 || !Array.isArray(stroke.points) || !stroke.points.length || stroke.points.length > LIMITS.strokePoints) return null;
      total += stroke.points.length;
      if (total > LIMITS.points) return null;
      const points = [];
      for (const point of stroke.points) {
        if (!plain(point) || (point.pressure !== undefined && (!Number.isFinite(point.pressure) || point.pressure < 0 || point.pressure > 1))) return null;
        const clean = normalizePoint(point);
        if (!clean) return null;
        points.push(clean);
      }
      ids.add(stroke.id);
      strokes.push({ id: stroke.id, color: stroke.color, width: stroke.width, points });
    }
    return { version: VERSION, id: value.id, title: value.title.trim(), createdAt: value.createdAt, updatedAt: value.updatedAt,
      strokes, viewport: { x: value.viewport.x, y: value.viewport.y, scale: value.viewport.scale } };
  }
  function strokeBounds(stroke) {
    if (!stroke?.points?.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const point of stroke.points) {
      minX = Math.min(minX, point.x); minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x); maxY = Math.max(maxY, point.y);
    }
    const radius = (stroke.width || 1) / 2;
    return { minX: minX - radius, minY: minY - radius, maxX: maxX + radius, maxY: maxY + radius };
  }
  function distanceToSegmentSquared(point, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
    const ratio = length ? clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / length, 0, 1) : 0;
    return (point.x - a.x - ratio * dx) ** 2 + (point.y - a.y - ratio * dy) ** 2;
  }
  function hitStroke(stroke, point, radius = 0) {
    if (!stroke?.points?.length || !normalizePoint(point) || !Number.isFinite(radius) || radius < 0) return false;
    const reach = radius + (stroke.width || 1) / 2, bounds = strokeBounds(stroke);
    if (point.x < bounds.minX - radius || point.x > bounds.maxX + radius || point.y < bounds.minY - radius || point.y > bounds.maxY + radius) return false;
    if (stroke.points.length === 1) return distanceToSegmentSquared(point, stroke.points[0], stroke.points[0]) <= reach * reach;
    for (let i = 1; i < stroke.points.length; i++) {
      if (distanceToSegmentSquared(point, stroke.points[i - 1], stroke.points[i]) <= reach * reach) return true;
    }
    return false;
  }
  function screenToWorld(point, viewport) { return { x: (point.x - viewport.x) / viewport.scale, y: (point.y - viewport.y) / viewport.scale }; }
  function worldToScreen(point, viewport) { return { x: point.x * viewport.scale + viewport.x, y: point.y * viewport.scale + viewport.y }; }
  function zoomAt(viewport, factor, anchor) {
    if (!validViewport(viewport) || !Number.isFinite(factor) || factor <= 0 || !normalizePoint(anchor)) throw new TypeError("画布位置不正确");
    const point = screenToWorld(anchor, viewport), scale = clamp(viewport.scale * factor, .1, 8);
    return { x: clamp(anchor.x - point.x * scale, -LIMITS.coordinate, LIMITS.coordinate), y: clamp(anchor.y - point.y * scale, -LIMITS.coordinate, LIMITS.coordinate), scale };
  }
  function metadata(draft) { return { version: VERSION, id: draft.id, title: draft.title, createdAt: draft.createdAt, updatedAt: draft.updatedAt, strokeCount: draft.strokes.length }; }
  const sortMetadata = values => values.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  const storageError = () => new Error("草稿未能保存，请检查浏览器存储空间或权限后重试");
  const corruptError = () => new Error("已保存的草稿数据损坏，未覆盖原有内容");

  function createStore(options = {}) {
    let indexedDB, localStorage;
    try { indexedDB = Object.prototype.hasOwnProperty.call(options, "indexedDB") ? options.indexedDB : scope?.indexedDB; } catch (_) {}
    try { localStorage = Object.prototype.hasOwnProperty.call(options, "localStorage") ? options.localStorage : scope?.localStorage; } catch (_) {}
    let connection, backend = "", queue = Promise.resolve();

    function readFallback() {
      if (!localStorage) throw storageError();
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === null) return { version: VERSION, activeId: null, drafts: [] };
      if (typeof raw !== "string" || raw.length > LIMITS.jsonBytes) throw corruptError();
      let value;
      try { value = JSON.parse(raw); } catch (_) { throw corruptError(); }
      if (!plain(value) || value.version !== VERSION || !Array.isArray(value.drafts) || value.drafts.length > LIMITS.drafts || (value.activeId !== null && !validId(value.activeId))) throw corruptError();
      const drafts = [], ids = new Set();
      for (const draft of value.drafts) {
        const clean = sanitizeDraft(draft);
        if (!clean || ids.has(clean.id)) throw corruptError();
        drafts.push(clean); ids.add(clean.id);
      }
      if (value.activeId !== null && !ids.has(value.activeId)) throw corruptError();
      return { version: VERSION, activeId: value.activeId, drafts };
    }
    function writeFallback(value) {
      const raw = JSON.stringify(value);
      if (raw.length > LIMITS.jsonBytes) throw storageError();
      try { localStorage.setItem(STORAGE_KEY, raw); } catch (_) { throw storageError(); }
    }
    function openDatabase() {
      return new Promise((resolve, reject) => {
        if (!indexedDB?.open) { reject(storageError()); return; }
        let request, finished = false;
        const finish = (error, database) => {
          if (finished) { database?.close(); return; }
          finished = true; clearTimeout(timer);
          if (error) reject(error); else resolve(database);
        };
        const timer = setTimeout(() => finish(storageError()), 4000);
        try { request = indexedDB.open(DATABASE_NAME, VERSION); } catch (error) { finish(error); return; }
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("drafts")) db.createObjectStore("drafts", { keyPath: "id" });
          if (!db.objectStoreNames.contains("settings")) db.createObjectStore("settings");
        };
        request.onerror = () => finish(request.error || storageError());
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => { db.close(); connection = undefined; backend = ""; };
          finish(null, db);
        };
      });
    }
    function transaction(db, names, mode, operation) {
      return new Promise((resolve, reject) => {
        let result, error, tx;
        try { tx = db.transaction(names, mode); } catch (_) { reject(storageError()); return; }
        tx.oncomplete = () => resolve(result);
        tx.onabort = tx.onerror = () => reject(error || tx.error || storageError());
        try { operation(tx, value => { result = value; }, reason => { error = reason; tx.abort(); }); }
        catch (reason) { error = reason; try { tx.abort(); } catch (_) { reject(reason); } }
      });
    }
    async function connect() {
      if (connection) return connection;
      connection = (async () => {
        let db;
        try { db = await openDatabase(); }
        catch (_) {
          // A successful fallback read is required before selecting it. Existing
          // malformed content must never be treated as a new, empty collection.
          readFallback(); backend = "localstorage"; return null;
        }
        // Move documents written while IndexedDB was unavailable into the normal
        // store. A newer IDB document wins; fallback stays intact if migration fails.
        let raw;
        try { raw = localStorage?.getItem(STORAGE_KEY); } catch (_) {}
        if (raw !== null && raw !== undefined) {
          const fallback = readFallback();
          await transaction(db, ["drafts", "settings"], "readwrite", (tx, set, fail) => {
            const store = tx.objectStore("drafts"), keys = store.getAllKeys();
            keys.onsuccess = () => {
              const ids = new Set(keys.result);
              for (const draft of fallback.drafts) ids.add(draft.id);
              if (ids.size > LIMITS.drafts) { fail(new RangeError("草稿数量已达上限")); return; }
              for (const draft of fallback.drafts) {
                const get = store.get(draft.id);
                get.onsuccess = () => {
                  const existing = get.result;
                  if (existing && !sanitizeDraft(existing)) { fail(corruptError()); return; }
                  if (!existing || existing.updatedAt < draft.updatedAt) store.put(draft);
                };
              }
            };
            const active = tx.objectStore("settings").get("activeId");
            active.onsuccess = () => { if (!active.result && fallback.activeId) tx.objectStore("settings").put(fallback.activeId, "activeId"); };
          });
          try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
        }
        backend = "indexeddb";
        return db;
      })();
      // A denied or temporarily unavailable storage permission can be retried.
      connection.catch(() => { connection = undefined; });
      return connection;
    }
    function serial(operation) {
      const next = queue.then(operation);
      queue = next.catch(() => {});
      return next;
    }
    async function list() {
      const db = await connect();
      if (!db) return sortMetadata(readFallback().drafts.map(metadata));
      return transaction(db, ["drafts"], "readonly", (tx, set, fail) => {
        const result = [], request = tx.objectStore("drafts").openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) { set(sortMetadata(result)); return; }
          const value = cursor.value;
          if (!plain(value) || value.version !== VERSION || !validId(value.id) || typeof value.title !== "string" || !value.title.trim() || value.title.length > 80 || !validTime(value.createdAt) || !validTime(value.updatedAt) || !Array.isArray(value.strokes) || value.strokes.length > LIMITS.strokes || result.length >= LIMITS.drafts) { fail(corruptError()); return; }
          result.push(metadata(value)); cursor.continue();
        };
      });
    }
    async function get(id) {
      if (!validId(id)) throw new TypeError("草稿 ID 不正确");
      const db = await connect();
      if (!db) return readFallback().drafts.find(draft => draft.id === id) || null;
      return transaction(db, ["drafts"], "readonly", (tx, set, fail) => {
        const request = tx.objectStore("drafts").get(id);
        request.onsuccess = () => {
          if (request.result === undefined) { set(null); return; }
          const clean = sanitizeDraft(request.result);
          if (!clean) fail(corruptError()); else set(clean);
        };
      });
    }
    function saveMany(values, activeId) {
      if (!Array.isArray(values) || values.length > LIMITS.drafts) return Promise.reject(new TypeError("草稿集合不正确"));
      const clean = values.map(sanitizeDraft), ids = new Set();
      for (const draft of clean) {
        if (!draft || ids.has(draft.id)) return Promise.reject(new TypeError("草稿内容不正确"));
        ids.add(draft.id);
      }
      if (activeId !== undefined && activeId !== null && !validId(activeId)) return Promise.reject(new TypeError("草稿 ID 不正确"));
      return serial(async () => {
        const db = await connect();
        if (!db) {
          const previous = readFallback(), drafts = new Map(previous.drafts.map(draft => [draft.id, draft]));
          for (const draft of clean) drafts.set(draft.id, draft);
          if (drafts.size > LIMITS.drafts) throw new RangeError("草稿数量已达上限");
          const selected = activeId === undefined ? previous.activeId : activeId;
          if (selected !== null && !drafts.has(selected)) throw new TypeError("草稿不存在");
          writeFallback({ version: VERSION, activeId: selected, drafts: [...drafts.values()] });
          return clean;
        }
        await transaction(db, ["drafts", "settings"], "readwrite", (tx, set, fail) => {
          const drafts = tx.objectStore("drafts"), keys = drafts.getAllKeys();
          keys.onsuccess = () => {
            const existing = new Set(keys.result);
            for (const draft of clean) existing.add(draft.id);
            if (existing.size > LIMITS.drafts) { fail(new RangeError("草稿数量已达上限")); return; }
            if (activeId !== undefined && activeId !== null && !existing.has(activeId)) { fail(new TypeError("草稿不存在")); return; }
            for (const draft of clean) drafts.put(draft);
            if (activeId !== undefined) tx.objectStore("settings").put(activeId, "activeId");
          };
        });
        return clean;
      });
    }
    async function getActiveId() {
      const db = await connect();
      if (!db) return readFallback().activeId;
      return transaction(db, ["settings"], "readonly", (tx, set, fail) => {
        const request = tx.objectStore("settings").get("activeId");
        request.onsuccess = () => {
          const value = request.result ?? null;
          if (value !== null && !validId(value)) fail(corruptError()); else set(value);
        };
      });
    }
    return { list, get, save: draft => saveMany([draft]).then(values => values[0]), saveMany, getActiveId,
      setActiveId: id => saveMany([], id).then(() => id), get backend() { return backend; } };
  }
  return Object.freeze({ VERSION, LIMITS, STORAGE_KEY, DATABASE_NAME, createId, createDraft, sanitizeDraft, normalizePoint,
    strokeBounds, hitStroke, screenToWorld, worldToScreen, zoomAt, createStore });
});
