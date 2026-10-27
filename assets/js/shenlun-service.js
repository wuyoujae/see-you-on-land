/* Stateless Responses requests and browser-local Shenlun projects. */
(function (scope, factory) {
  const core = typeof module === "object" && module.exports ? require("./shenlun-core.js") : scope.ShenlunCore;
  const api = factory(scope, core);
  if (typeof module === "object" && module.exports) module.exports = api;
  else scope.ShenlunService = api;
})(typeof window !== "undefined" ? window : globalThis, function (scope, Core) {
  "use strict";
  const DB_NAME = "summer-politics-shenlun-v1", MAX_PROJECTS = 1000, MAX_EXPORT_BYTES = 256 * 1024 * 1024;
  const MAX_RESPONSE = 2 * 1024 * 1024, MAX_REQUEST = 64 * 1024 * 1024, MAX_IMAGE = 12 * 1024 * 1024;
  const PROJECT_FIELDS = ["id", "title", "type", "subtype", "maxScore", "wordLimit", "questionText", "answerText", "questionImages", "answerImages",
    "answerProvenance", "revision", "questionRevision", "answerRevision", "status", "run", "reference", "report", "error", "createdAt", "updatedAt", "parentId", "pendingOCR"];
  const makeError = (code, message, extra = {}) => Object.assign(new Error(message), {code, ...extra});
  const cancelled = () => Object.assign(makeError("CANCELLED", "已停止本次生成，原文和已保存的结果仍可查看。"), {name: "AbortError"});
  const clone = value => typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  const bytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;
  const timestamp = value => typeof value === "number" ? value : Date.parse(value) || 0;
  function scrub(value, depth = 0) {
    if (depth > 35) throw makeError("STORAGE", "项目数据结构过于复杂。");
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number") { if (!Number.isFinite(value)) throw makeError("STORAGE", "项目包含无效数值。"); return value; }
    if (typeof value === "string") { if (value.length > MAX_RESPONSE) throw makeError("STORAGE", "项目文字超过允许的长度。"); return value; }
    if (Array.isArray(value)) { if (value.length > 2000) throw makeError("STORAGE", "项目条目数量过多。"); return value.map(item => scrub(item, depth + 1)); }
    if (value && typeof value === "object") {
      const result = {};
      for (const [key, item] of Object.entries(value)) {
        if (/^(?:__proto__|constructor|prototype|api[-_]?key|authorization|access[-_]?token|refresh[-_]?token|secret|headers|credentials|baseUrl|endpoint|dataUrl|blob)$/i.test(key) || item === undefined) continue;
        result[key] = scrub(item, depth + 1);
      }
      return result;
    }
    throw makeError("STORAGE", "项目包含无法保存的内容。");
  }
  function projectRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.id !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(value.id)) throw makeError("STORAGE", "项目标识不正确。");
    const project = scrub(Object.fromEntries(PROJECT_FIELDS.filter(key => value[key] !== undefined).map(key => [key, value[key]])));
    if (project.type !== undefined && project.type !== "summary") throw makeError("STORAGE", "当前只支持概括题项目。");
    if (project.title !== undefined && (typeof project.title !== "string" || project.title.length > 500)) throw makeError("STORAGE", "项目名称格式不正确。");
    if (project.subtype !== undefined && !["auto", ...Core.subtypes].includes(project.subtype)) throw makeError("STORAGE", "项目概括题类型不正确。");
    if (project.maxScore != null && (typeof project.maxScore !== "number" || !Number.isFinite(project.maxScore) || project.maxScore <= 0 || project.maxScore > 1000)) throw makeError("STORAGE", "项目满分格式不正确。");
    if (project.wordLimit != null && (!Number.isInteger(project.wordLimit) || project.wordLimit < 1 || project.wordLimit > 200000)) throw makeError("STORAGE", "项目字数要求格式不正确。");
    if (project.status !== undefined && !["draft", "running", "completed", "error", "interrupted"].includes(project.status)) throw makeError("STORAGE", "项目状态格式不正确。");
    for (const key of ["revision", "questionRevision", "answerRevision"]) if (project[key] !== undefined && (!Number.isInteger(project[key]) || project[key] < 0)) throw makeError("STORAGE", "项目版本格式不正确。");
    for (const key of ["questionImages", "answerImages"]) if (project[key] !== undefined) {
      if (!Array.isArray(project[key]) || project[key].length > (key === "answerImages" ? 1 : 20)) throw makeError("STORAGE", "项目图片列表格式不正确。");
      for (const image of project[key]) if (!image || typeof image.id !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(image.id) || typeof image.hash !== "string" || image.hash.length > 160 || (image.name !== undefined && typeof image.name !== "string")) throw makeError("STORAGE", "项目图片信息格式不正确。");
    }
    for (const key of ["questionText", "answerText"]) if (project[key] !== undefined && (typeof project[key] !== "string" || project[key].length > 200000)) throw makeError("STORAGE", "题目或答案文字过长。");
    if (bytes(project) > 6 * 1024 * 1024) throw makeError("STORAGE", "单个项目超过 6 MiB，请缩短材料后重试。");
    return project;
  }
  function ocrRecord(value) {
    if (!value || typeof value.key !== "string" || !value.key || value.key.length > 300) throw makeError("STORAGE", "识别缓存标识不正确。");
    return {key: value.key, result: Core.validateOCR(value.result), createdAt: Number.isFinite(value.createdAt) || (typeof value.createdAt === "string" && Number.isFinite(Date.parse(value.createdAt))) ? value.createdAt : Date.now()};
  }
  function createStore(options = {}) {
    const idb = options.indexedDB === undefined ? scope.indexedDB : options.indexedDB;
    const memory = {projects: new Map(), assets: new Map(), ocr: new Map()};
    const removed = {projects: new Set(), assets: new Set(), ocr: new Set()};
    const dirty = {projects: new Set(), assets: new Set(), ocr: new Set()};
    const revisions = {projects: new Map(), assets: new Map(), ocr: new Map()};
    let databasePromise, persistent = Boolean(idb), lastError = "";
    let sequence = 0;
    function changed(storeName, key) { const revision = ++sequence; revisions[storeName].set(key, revision); return revision; }
    function unchanged(storeName, key, snapshot) { return (revisions[storeName].get(key) || 0) === (snapshot.get(key) || 0); }
    function fallback(error) { persistent = false; lastError = error?.name === "QuotaExceededError" ? "浏览器存储空间不足，最新内容仅保留在当前页面，请导出项目。" : "浏览器未能保存到本地存储，最新内容仅保留在当前页面，请导出项目。"; }
    async function open() {
      if (!idb) { persistent = false; return null; }
      if (!databasePromise) databasePromise = new Promise((resolve, reject) => {
        let request;
        try { request = idb.open(DB_NAME, 1); } catch (error) { reject(error); return; }
        request.onupgradeneeded = () => {
          for (const [name, keyPath] of [["projects", "id"], ["assets", "id"], ["ocr", "key"]]) {
            if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, {keyPath});
          }
        };
        request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); databasePromise = null; persistent = false; }; resolve(db); };
        request.onerror = () => reject(request.error || makeError("STORAGE", "本地项目数据库暂时不可用。"));
        request.onblocked = () => reject(makeError("STORAGE", "本地项目数据库被旧页面占用。"));
      }).catch(error => { fallback(error); return null; });
      return databasePromise;
    }
    async function readAll(storeName) {
      const started = new Map(revisions[storeName]);
      try {
        const db = await open();
        if (db) {
          const values = await new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, "readonly"), request = tx.objectStore(storeName).getAll();
            request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); tx.onabort = () => reject(tx.error);
          });
          const keys = new Set();
          for (const value of values) {
            const key = storeName === "ocr" ? value.key : value.id;
            keys.add(key);
            if (!removed[storeName].has(key) && !dirty[storeName].has(key) && unchanged(storeName, key, started)) memory[storeName].set(key, value);
          }
          for (const key of memory[storeName].keys()) if (!keys.has(key) && !dirty[storeName].has(key) && !removed[storeName].has(key) && unchanged(storeName, key, started)) memory[storeName].delete(key);
        }
      } catch (error) { fallback(error); }
      return [...memory[storeName].values()].filter(value => !removed[storeName].has(storeName === "ocr" ? value.key : value.id));
    }
    async function read(storeName, key) {
      if (removed[storeName].has(key)) return null;
      if (dirty[storeName].has(key)) return memory[storeName].has(key) ? clone(memory[storeName].get(key)) : null;
      const revision = revisions[storeName].get(key) || 0;
      try {
        const db = await open();
        if (db) {
          const value = await new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, "readonly"), request = tx.objectStore(storeName).get(key);
            request.onsuccess = () => resolve(request.result || null); request.onerror = () => reject(request.error); tx.onabort = () => reject(tx.error);
          });
          if (removed[storeName].has(key)) return null;
          if (!dirty[storeName].has(key) && revision === (revisions[storeName].get(key) || 0)) {
            if (value) memory[storeName].set(key, value); else memory[storeName].delete(key);
          }
        }
      } catch (error) { fallback(error); }
      return memory[storeName].has(key) ? clone(memory[storeName].get(key)) : null;
    }
    async function write(storeName, record) {
      const key = storeName === "ocr" ? record.key : record.id;
      const revision = changed(storeName, key);
      memory[storeName].set(key, clone(record)); removed[storeName].delete(key);
      dirty[storeName].add(key);
      try {
        const db = await open();
        if (db) {
          await new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, "readwrite"); tx.objectStore(storeName).put(record);
            tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error || makeError("STORAGE", "本地保存失败。"));
          });
          if (revision === revisions[storeName].get(key)) dirty[storeName].delete(key);
        }
      } catch (error) { fallback(error); }
      return clone(record);
    }
    async function removeRecord(storeName, key) {
      const revision = changed(storeName, key);
      memory[storeName].delete(key); removed[storeName].add(key);
      dirty[storeName].delete(key);
      try {
        const db = await open();
        if (db) {
          await new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, "readwrite"); tx.objectStore(storeName).delete(key);
            tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error || makeError("STORAGE", "本地删除失败。"));
          });
          if (revision === revisions[storeName].get(key)) removed[storeName].delete(key);
        }
      } catch (error) { fallback(error); }
    }
    function validateImport(payload) {
      if (!payload || payload.schema !== "summer-politics-shenlun" || payload.version !== 1 || !Array.isArray(payload.projects) || payload.projects.length > MAX_PROJECTS || !Array.isArray(payload.ocr || []) || (payload.ocr || []).length > 2000) throw makeError("IMPORT", "申论项目备份格式不正确。");
      if (bytes(payload) > MAX_EXPORT_BYTES) throw makeError("IMPORT", "申论项目备份超过 256 MiB。");
      const projects = payload.projects.map(projectRecord), ocr = (payload.ocr || []).map(ocrRecord);
      if (new Set(projects.map(item => item.id)).size !== projects.length || new Set(ocr.map(item => item.key)).size !== ocr.length) throw makeError("IMPORT", "备份中存在重复的项目或识别缓存。");
      for (const project of projects) {
        if (project.reference) project.reference = Core.validateReference(project.reference, project);
        if (project.report) { if (!project.reference) throw makeError("IMPORT", "批改报告缺少对应的参考解答。"); project.report = Core.validateReport(project.report, project, project.reference); }
        if (project.status === "running") { project.status = "interrupted"; project.error = "导入的任务尚未完成，可以打开项目后重新评分。"; }
      }
      return {schema: "summer-politics-shenlun", version: 1, projects, ocr};
    }
    const store = {
      get persistent() { return persistent; }, isPersistent: () => persistent, get warning() { return lastError; },
      async list() { return (await readAll("projects")).map(clone).sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt)); },
      get: id => read("projects", id),
      async put(value) { return write("projects", projectRecord(value)); },
      remove: id => removeRecord("projects", id),
      async putAsset(value) {
        if (!value || typeof value.id !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(value.id) || !(value.blob instanceof Blob) || value.blob.size > MAX_IMAGE) throw makeError("IMAGE", "图片数据无效或超过 12 MiB。");
        if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(value.blob.type)) throw makeError("IMAGE", "请使用 JPG、PNG、WebP 或 GIF 图片。");
        return write("assets", {id: value.id, blob: value.blob, name: String(value.name || "图片").slice(0, 500), hash: String(value.hash || "").slice(0, 160)});
      },
      getAsset: id => read("assets", id), removeAsset: id => removeRecord("assets", id),
      getOCR: key => read("ocr", key), putOCR: value => write("ocr", ocrRecord(value)),
      async exportData() {
        const projects = (await store.list()).map(projectRecord), ocr = (await readAll("ocr")).map(ocrRecord);
        const result = {schema: "summer-politics-shenlun", version: 1, exportedAt: new Date().toISOString(), assetsIncluded: false, projects, ocr};
        if (projects.length > MAX_PROJECTS || bytes(result) > MAX_EXPORT_BYTES) throw makeError("EXPORT", "申论备份超过允许的大小，请分别导出项目。");
        return result;
      },
      validateImportData: validateImport,
      async importData(payload, settings = {}) {
        const checked = validateImport(payload), merge = settings.merge !== false;
        const projects = new Map(merge ? (await store.list()).map(item => [item.id, item]) : []);
        const ocr = new Map(merge ? (await readAll("ocr")).map(item => [item.key, item]) : []);
        for (const item of checked.projects) if (!projects.has(item.id) || timestamp(projects.get(item.id).updatedAt) <= timestamp(item.updatedAt)) projects.set(item.id, item);
        for (const item of checked.ocr) if (!ocr.has(item.key) || timestamp(ocr.get(item.key).createdAt) <= timestamp(item.createdAt)) ocr.set(item.key, item);
        if (projects.size > MAX_PROJECTS || ocr.size > 2000 || bytes({projects: [...projects.values()], ocr: [...ocr.values()]}) > MAX_EXPORT_BYTES) throw makeError("IMPORT", "合并后的申论备份超过允许的大小。");
        // Commit both stores atomically; quota errors do not leave a partial import.
        const db = await open();
        if (db) {
          try {
            await new Promise((resolve, reject) => {
              const tx = db.transaction(["projects", "ocr"], "readwrite"), ps = tx.objectStore("projects"), os = tx.objectStore("ocr");
              ps.clear(); os.clear(); projects.forEach(value => ps.put(value)); ocr.forEach(value => os.put(value));
              tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error || makeError("IMPORT", "申论项目导入失败。"));
            });
          } catch (error) { fallback(error); throw makeError("IMPORT", "浏览器未能保存导入的项目，原有数据保持不变。请释放存储空间后重试。"); }
        }
        for (const [storeName, values] of [["projects", projects], ["ocr", ocr]]) {
          const affected = new Set([...memory[storeName].keys(), ...values.keys()]);
          affected.forEach(key => changed(storeName, key));
          memory[storeName] = values; removed[storeName].clear(); dirty[storeName].clear();
          if (!db) values.forEach((_, key) => dirty[storeName].add(key));
        }
        return {imported: checked.projects.length, total: projects.size, persisted: persistent, assetsIncluded: false};
      }
    };
    return store;
  }
  function safeMessage(error, secret) {
    let message = String(error?.message || "模型请求失败，请稍后重试。");
    if (secret) message = message.split(secret).join("[密钥已隐藏]");
    return message.replace(/Bearer\s+[^\s,;"']+/gi, "Bearer [已隐藏]").replace(/https?:\/\/[^\s<>"']+/gi, "[模型服务地址]").slice(0, 1000);
  }
  function createClient(options = {}) {
    const ai = options.ai || scope.AIExplanation || (typeof require === "function" ? require("./ai-explanation.js") : null);
    const fetcher = options.fetch || ((...args) => scope.fetch(...args));
    const getSettings = options.getSettings || (() => ai?.getSettings?.());
    const timeoutMs = Math.max(1, options.timeoutMs || 240000);
    async function request({instructions, input, signal, onChunk, maximum = 24000, phase}) {
      if (signal?.aborted) throw cancelled();
      const settings = {...await getSettings()};
      const secret = String(settings.apiKey || "").trim(), model = String(settings.model || "").trim();
      if (!secret || !model || model.length > 120) throw makeError("SETTINGS", "请先配置 API Key、Base URL 和模型；识别图片需要支持视觉的文本模型。");
      if (!ai?.endpointFor || !ai?.consumeResponse) throw makeError("SETTINGS", "共用模型服务尚未加载，请刷新后重试。");
      let endpoint;
      try { endpoint = ai.endpointFor(settings.baseUrl || settings.endpoint); } catch (_) { throw makeError("SETTINGS", "模型服务地址不正确，请检查 Base URL。"); }
      const body = {model, instructions, input: [{role: "user", content: input}], stream: true, store: false, max_output_tokens: maximum};
      const serialized = JSON.stringify(body);
      if (new TextEncoder().encode(serialized).byteLength > MAX_REQUEST) throw makeError("REQUEST_LIMIT", "请求超过 64 MiB，请减少图片或缩小原图后重试。");
      const controller = new AbortController(); let timedOut = false;
      const abort = () => controller.abort(); signal?.addEventListener("abort", abort, {once: true});
      if (signal?.aborted) controller.abort();
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
      let responseText = "";
      let rejectAborted;
      const interruption = new Promise((_, reject) => {
        rejectAborted = () => reject(cancelled());
        if (controller.signal.aborted) rejectAborted();
        else controller.signal.addEventListener("abort", rejectAborted, {once: true});
      });
      try {
        const perform = async () => {
        if (controller.signal.aborted) throw cancelled();
        const response = await fetcher(endpoint, {method: "POST", signal: controller.signal,
          headers: {Authorization: "Bearer " + secret, "Content-Type": "application/json"}, body: serialized});
        if (!response.ok) {
          // Never surface raw gateway errors: they can echo credentials or image payloads.
          const messages = {400: "模型拒绝了当前请求，请确认模型支持 Responses API；图片识别还需要视觉能力。", 401: "API Key 无效，请重新配置。", 402: "模型账户额度不足，请补充额度或更换服务。", 403: "当前 API Key 没有调用此模型的权限。", 413: "模型服务限制了请求大小，请减少图片后重试。", 429: "模型请求过于频繁，请稍后手动重试。", 500: "模型服务暂时异常，请稍后重试。", 502: "模型服务暂时异常，请稍后重试。", 503: "当前模型暂时不可用，请稍后重试或更换模型。"};
          throw makeError("HTTP", messages[response.status] || `模型请求失败（${response.status}），请稍后重试。`, {status: response.status});
        }
        if (Number(response.headers.get("content-length")) > MAX_RESPONSE * 4) throw makeError("RESPONSE_LIMIT", "模型响应超过允许的大小，尚未作为有效结果保存。");
        const output = await ai.consumeResponse(response, delta => {
          if (controller.signal.aborted) return;
          responseText += delta.text || "";
          if (responseText.length > MAX_RESPONSE) { controller.abort(); throw makeError("RESPONSE_LIMIT", "模型输出过长，尚未作为有效结果保存。"); }
          try { onChunk?.({text: delta.text || "", phase, receivedChars: responseText.length}); } catch (_) { /* UI observers cannot invalidate a paid request. */ }
        }, controller.signal);
        if (controller.signal.aborted) throw cancelled();
        return Core.parseJSON(output.text);
        };
        return await Promise.race([perform(), interruption]);
      } catch (error) {
        if (timedOut) throw makeError("TIMEOUT", "等待模型超过 4 分钟，本次任务已停止；可以保留原文后重试。");
        if (signal?.aborted || error?.name === "AbortError") throw cancelled();
        if (error instanceof TypeError) throw makeError("NETWORK", "无法连接模型服务，请检查网络、Base URL 和服务的跨域设置。");
        throw makeError(error?.code || "MODEL", safeMessage(error, secret), Number.isFinite(error?.status) ? {status: error.status} : {});
      } finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); controller.signal.removeEventListener("abort", rejectAborted); }
    }
    function prompts() {
      const value = options.prompts || scope.ShenlunPrompts;
      if (!value) throw makeError("PROMPTS", "申论课程方法尚未加载，请刷新后重试。");
      return value;
    }
    function questionSnapshot(project) {
      if (!project || typeof project.questionText !== "string" || !project.questionText.trim()) throw makeError("INPUT", "请先补充题目和给定材料。");
      if (project.questionText.length > 200000) throw makeError("INPUT", "题目材料过长，请拆分后重试。");
      if (!Number.isFinite(project.maxScore) || project.maxScore <= 0 || project.maxScore > 1000) throw makeError("INPUT", "请先确认题目满分。");
      return {questionText: project.questionText, subtype: project.subtype, maxScore: project.maxScore, wordLimit: project.wordLimit ?? null};
    }
    async function boundProvenance(project) {
      const value = project.answerProvenance, images = project.answerImages;
      if (value?.mode !== "image" || !Array.isArray(images) || images.length !== 1 || typeof images[0]?.hash !== "string" || !images[0].hash ||
          value.imageHash !== images[0].hash || typeof value.textHash !== "string" || typeof value.ocrKey !== "string" || !value.ocrKey) return null;
      const actualHash = await Core.fingerprint(new TextEncoder().encode(project.answerText));
      if (value.textHash !== actualHash) return null;
      try {
        const observed = Core.validateOCR({text: project.answerText, questionMeta: {subtype: null, maxScore: null, wordLimit: null, task: "", scope: ""}, observations: value.observations});
        return {mode: "image", imageHash: value.imageHash, ocrKey: value.ocrKey, textHash: value.textHash, observations: observed.observations};
      } catch (_) { return null; }
    }
    return {
      async recognize({images, kind, signal, onChunk} = {}) {
        if (!["question", "answer"].includes(kind) || !Array.isArray(images) || !images.length || images.length > 20 || (kind === "answer" && images.length !== 1)) throw makeError("INPUT", "请为题目添加 1 至 20 张图片，答卷每次识别 1 张。");
        const pictures = images.map(value => {
          const dataURL = typeof value === "string" ? value : value?.dataURL || value?.dataUrl;
          if (typeof dataURL !== "string" || !/^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/\r\n]+=*$/i.test(dataURL)) throw makeError("IMAGE", "图片数据无效，请重新上传 JPG、PNG、WebP 或 GIF。");
          if ((dataURL.length - dataURL.indexOf(",") - 1) * 0.75 > MAX_IMAGE + 3) throw makeError("IMAGE", "有图片超过 12 MiB，请压缩后重试。");
          return {type: "input_image", image_url: dataURL, detail: "high"};
        });
        const result = await request({instructions: await prompts().ocrInstructions(kind), input: [{type: "input_text", text: JSON.stringify({kind, imageCount: pictures.length, task: "按图片顺序逐字识别，保留原有换行和标点，返回约定的 JSON。"})}, ...pictures], signal, onChunk, maximum: 24000, phase: "ocr"});
        return Core.validateOCR(result);
      },
      async reference({project, signal, onChunk} = {}) {
        const snapshot = questionSnapshot(project);
        // Only this whitelist reaches BOTH instructions and input. Never expose the answer to an independent reference pass.
        const result = await request({instructions: await prompts().referenceInstructions(snapshot), input: [{type: "input_text", text: JSON.stringify(snapshot)}], signal, onChunk, phase: "reference"});
        return Core.validateReference(result, snapshot);
      },
      async grade({project, reference, signal, onChunk} = {}) {
        const snapshot = questionSnapshot(project);
        if (typeof project.answerText !== "string" || !project.answerText.trim() || project.answerText.length > 200000) throw makeError("INPUT", "请先补充有效的作答内容。");
        const checkedReference = Core.validateReference(reference, snapshot);
        if (checkedReference.status !== "ready") throw makeError("NEEDS_REVIEW", "题目或材料尚需核对，请补全后再开始评分。");
        snapshot.answerText = project.answerText;
        snapshot.answerProvenance = await boundProvenance(project);
        const result = await request({instructions: await prompts().gradeInstructions(snapshot, checkedReference), input: [{type: "input_text", text: JSON.stringify({project: snapshot, reference: checkedReference})}], signal, onChunk, phase: "grade"});
        return Core.validateReport(result, snapshot, checkedReference);
      }
    };
  }
  return Object.freeze({version: "1.0.0", createStore, createClient});
});
