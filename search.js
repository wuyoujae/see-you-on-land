(() => {
  "use strict";

  const SETTINGS_KEY = "summer-politics-responses-settings-v2";
  const LEGACY_SETTINGS_KEY = "summer-politics-openrouter-settings-v1";
  const ACTIVE_SESSION_KEY = "summer-politics-ai-active-session-v1";
  const DB_NAME = "summer-politics-ai-sessions";
  const DB_VERSION = 1;
  const SESSION_STORE = "sessions";
  const DEFAULT_BASE_URL = "https://api.openai.com/v1";
  const LEGACY_BASE_URL = "https://openrouter.ai/api/v1";
  const DEFAULT_MODEL = "gpt-5.6";
  const MAX_IMAGES = 4;
  const MAX_FILE_BYTES = 12 * 1024 * 1024;
  const PERSIST_DELAY = 500;
  const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
  const SYSTEM_PROMPT = [
    "你是一名严谨的公务员考试辅导老师。",
    "请先准确识别图片中的题干、选项、图表和条件，再作答。",
    "回答使用中文和规范 Markdown，先给出明确答案，再分步骤说明推理过程；涉及计算时写出关键算式。",
    "如果图片模糊、题目信息不完整或无法确定，请明确指出缺失内容，不要猜测。"
  ].join("");

  const dom = {
    view: document.getElementById("view-search"),
    workspace: document.getElementById("solver-workspace"),
    welcome: document.getElementById("solver-welcome"),
    messages: document.getElementById("solver-messages"),
    composer: document.getElementById("solver-composer"),
    prompt: document.getElementById("solver-prompt"),
    preview: document.getElementById("solver-image-preview"),
    cameraButton: document.getElementById("solver-camera"),
    uploadButton: document.getElementById("solver-upload"),
    cameraInput: document.getElementById("solver-camera-input"),
    uploadInput: document.getElementById("solver-upload-input"),
    sendButton: document.getElementById("solver-send"),
    status: document.getElementById("solver-status"),
    settingsButton: document.getElementById("open-solver-settings"),
    settingsDot: document.getElementById("solver-settings-dot"),
    settingsModal: document.getElementById("solver-settings-modal"),
    settingsForm: document.getElementById("solver-settings-form"),
    apiKey: document.getElementById("solver-api-key"),
    apiKeyToggle: document.getElementById("toggle-solver-api-key"),
    baseUrl: document.getElementById("solver-base-url"),
    modelInput: document.getElementById("solver-model-input"),
    settingsStatus: document.getElementById("solver-settings-status"),
    testConnection: document.getElementById("test-solver-connection"),
    clearChat: document.getElementById("clear-solver-chat"),
    sessionButton: document.getElementById("open-solver-sessions"),
    currentSession: document.getElementById("solver-current-session"),
    sessionsModal: document.getElementById("solver-sessions-modal"),
    sessionList: document.getElementById("solver-session-list"),
    newSession: document.getElementById("solver-new-session")
  };

  if (!dom.view || !dom.composer || !dom.settingsModal || !dom.sessionsModal) return;

  let settings = loadSettings();
  let attachments = [];
  let sessions = [];
  let activeSessionId = "";
  let conversation = [];
  let requestController = null;
  let requestPromise = null;
  let sending = false;
  let sessionsReady = false;
  let persistenceTimer = 0;
  let reasoningTimer = 0;
  let databasePromise = null;
  const wrongAnalysisControllers = new Map();

  function loadSettings() {
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      const value = JSON.parse(saved || localStorage.getItem(LEGACY_SETTINGS_KEY));
      const migrated = !saved && Boolean(value);
      return {
        apiKey: typeof value?.apiKey === "string" ? value.apiKey.trim() : "",
        baseUrl: normalizeBaseUrl(value?.baseUrl || (migrated ? LEGACY_BASE_URL : DEFAULT_BASE_URL)) || DEFAULT_BASE_URL,
        model: typeof value?.model === "string" && value.model.trim() ? value.model.trim() : DEFAULT_MODEL
      };
    } catch {
      return { apiKey: "", baseUrl: DEFAULT_BASE_URL, model: DEFAULT_MODEL };
    }
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  function normalizeModel(value) {
    return String(value ?? "").trim().slice(0, 120);
  }

  function normalizeBaseUrl(value) {
    const text = String(value ?? "").trim().replace(/\/+$/, "").slice(0, 500);
    if (!text) return "";
    try {
      const url = new URL(text);
      if (!/^https?:$/.test(url.protocol)) return "";
      return text;
    } catch {
      return "";
    }
  }

  function responsesEndpoint(baseUrl) {
    const normalized = normalizeBaseUrl(baseUrl);
    if (!normalized) return "";
    const url = new URL(normalized);
    const path = url.pathname.replace(/\/+$/, "");
    if (/\/responses$/i.test(path)) return url.toString().replace(/\/$/, "");
    url.pathname = !path || path === "/" ? "/v1/responses" : `${path}/responses`;
    return url.toString().replace(/\/$/, "");
  }

  function refreshIcons() {
    if (window.lucide) window.lucide.createIcons({ attrs: { "stroke-width": 2 } });
  }

  function setStatus(message = "", isError = false) {
    dom.status.textContent = message;
    dom.status.classList.toggle("error", isError);
    dom.status.hidden = !message;
  }

  function setSettingsStatus(message = "", type = "") {
    dom.settingsStatus.textContent = message;
    dom.settingsStatus.classList.toggle("error", type === "error");
    dom.settingsStatus.classList.toggle("success", type === "success");
  }

  function currentModelLabel() {
    return settings.model.split("/").pop() || "解题助手";
  }

  function renderConfigurationState() {
    dom.settingsDot.classList.toggle("configured", Boolean(settings.apiKey && settings.baseUrl && settings.model));
  }

  function openSettings(message = "") {
    closeSessions();
    dom.apiKey.value = settings.apiKey;
    dom.apiKey.type = "password";
    dom.baseUrl.value = settings.baseUrl;
    dom.modelInput.value = settings.model;
    setSettingsStatus(message);
    dom.settingsModal.hidden = false;
    refreshIcons(dom.settingsModal);
    requestAnimationFrame(() => (settings.apiKey ? dom.baseUrl : dom.apiKey).focus());
  }

  function closeSettings() {
    dom.settingsModal.hidden = true;
    dom.apiKey.type = "password";
    setSettingsStatus("");
  }

  function validateSettingsForm() {
    const apiKey = dom.apiKey.value.trim();
    const baseUrl = normalizeBaseUrl(dom.baseUrl.value);
    const model = normalizeModel(dom.modelInput.value);
    dom.apiKey.setCustomValidity("");
    dom.baseUrl.setCustomValidity("");
    dom.modelInput.setCustomValidity("");
    if (!apiKey) {
      dom.apiKey.setCustomValidity("请输入 API Key");
      dom.apiKey.reportValidity();
      return null;
    }
    if (!baseUrl) {
      dom.baseUrl.setCustomValidity("请输入有效的 HTTP 或 HTTPS Base URL");
      dom.baseUrl.reportValidity();
      return null;
    }
    if (!model) {
      dom.modelInput.setCustomValidity("请输入模型 ID");
      dom.modelInput.reportValidity();
      return null;
    }
    return { apiKey, baseUrl, model };
  }

  function responsesHeaders(apiKey) {
    return {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    };
  }

  async function testConnection() {
    const values = validateSettingsForm();
    if (!values) return;
    dom.testConnection.disabled = true;
    setSettingsStatus("正在验证 API Key 和模型…");
    try {
      const response = await fetch(responsesEndpoint(values.baseUrl), {
        method: "POST",
        headers: responsesHeaders(values.apiKey),
        body: JSON.stringify({
          model: values.model,
          input: "Reply with OK.",
          max_output_tokens: 64,
          stream: false,
          store: false
        })
      });
      if (!response.ok) await responseError(response);
      const payload = await response.json();
      if (!responseOutputText(payload)) throw new Error(payload?.error?.message || "模型没有返回有效响应");
      setSettingsStatus("连接成功，Responses API、API Key 和模型均可用。", "success");
    } catch (error) {
      setSettingsStatus(friendlyError(error), "error");
    } finally {
      dom.testConnection.disabled = false;
    }
  }

  function openDatabase() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error("当前浏览器不支持 IndexedDB"));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(SESSION_STORE)) {
          const store = database.createObjectStore(SESSION_STORE, { keyPath: "id" });
          store.createIndex("updatedAt", "updatedAt");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("对话数据库打开失败"));
    });
    return databasePromise;
  }

  async function readSessions() {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = database.transaction(SESSION_STORE, "readonly").objectStore(SESSION_STORE).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error || new Error("对话读取失败"));
    });
  }

  async function writeSession(session) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = database.transaction(SESSION_STORE, "readwrite").objectStore(SESSION_STORE).put(session);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error("对话保存失败"));
    });
  }

  async function removeSessionRecord(id) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = database.transaction(SESSION_STORE, "readwrite").objectStore(SESSION_STORE).delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error("对话删除失败"));
    });
  }

  function createSessionRecord(title = "新对话") {
    const now = Date.now();
    return {
      id: `session-${now}-${Math.random().toString(36).slice(2, 8)}`,
      title,
      createdAt: now,
      updatedAt: now,
      messages: []
    };
  }

  function normalizeSession(value) {
    const fallback = createSessionRecord();
    const messages = Array.isArray(value?.messages) ? value.messages.map(message => ({
      id: String(message?.id || `${message?.role || "message"}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
      role: message?.role === "assistant" ? "assistant" : "user",
      text: typeof message?.text === "string" ? message.text : "",
      images: Array.isArray(message?.images) ? message.images : [],
      reasoning: typeof message?.reasoning === "string" ? message.reasoning : "",
      reasoningDetails: Array.isArray(message?.reasoningDetails) ? message.reasoningDetails.map(detail => {
        const copy = { ...detail };
        delete copy.__key;
        return copy;
      }) : [],
      reasoningSeconds: Number.isFinite(Number(message?.reasoningSeconds)) ? Number(message.reasoningSeconds) : 0,
      status: message?.status === "streaming" ? "stopped" : (message?.status || "done"),
      modelName: typeof message?.modelName === "string" ? message.modelName : "",
      wrongQuestionStatus: message?.role === "assistant"
        ? (message?.wrongQuestionStatus === "analyzing" ? "error" : (message?.wrongQuestionStatus || "idle"))
        : "idle",
      wrongQuestionAnalysis: message?.role === "assistant" && message?.wrongQuestionAnalysis && typeof message.wrongQuestionAnalysis === "object"
        ? message.wrongQuestionAnalysis
        : null,
      wrongQuestionId: message?.role === "assistant" && typeof message?.wrongQuestionId === "string" ? message.wrongQuestionId : "",
      wrongQuestionError: message?.role === "assistant" && typeof message?.wrongQuestionError === "string" ? message.wrongQuestionError : "",
      createdAt: Number(message?.createdAt) || Date.now()
    })).filter(message => message.role === "user" || message.text || message.reasoning) : [];
    return {
      id: typeof value?.id === "string" ? value.id : fallback.id,
      title: typeof value?.title === "string" && value.title.trim() ? value.title.trim().slice(0, 60) : fallback.title,
      createdAt: Number(value?.createdAt) || fallback.createdAt,
      updatedAt: Number(value?.updatedAt) || fallback.updatedAt,
      messages
    };
  }

  function activeSession() {
    return sessions.find(session => session.id === activeSessionId) || null;
  }

  function sessionTitleFromMessage(message) {
    const text = String(message?.text || "").replace(/\s+/g, " ").trim();
    if (text) return text.slice(0, 26);
    return message?.images?.length ? "图片题目" : "新对话";
  }

  function updateCurrentSessionLabel() {
    dom.currentSession.textContent = activeSession()?.title || "新对话";
  }

  function scheduleSessionSave(session = activeSession(), immediate = false) {
    if (!session) return;
    session.updatedAt = Date.now();
    window.clearTimeout(persistenceTimer);
    const save = async () => {
      persistenceTimer = 0;
      try {
        await writeSession(session);
      } catch (error) {
        setStatus(error.message || "对话记录保存失败。", true);
      }
    };
    if (immediate) save();
    else persistenceTimer = window.setTimeout(save, PERSIST_DELAY);
  }

  async function initializeSessions() {
    try {
      sessions = (await readSessions()).map(normalizeSession).sort((a, b) => b.updatedAt - a.updatedAt);
    } catch (error) {
      sessions = [];
      setStatus(`${error.message || "对话记录读取失败"}，本次对话可能无法保留。`, true);
    }
    if (!sessions.length) {
      const session = createSessionRecord();
      sessions = [session];
      scheduleSessionSave(session, true);
    }
    const remembered = localStorage.getItem(ACTIVE_SESSION_KEY);
    activeSessionId = sessions.some(session => session.id === remembered) ? remembered : sessions[0].id;
    localStorage.setItem(ACTIVE_SESSION_KEY, activeSessionId);
    conversation = activeSession()?.messages || [];
    sessionsReady = true;
    updateCurrentSessionLabel();
    renderConversation();
    renderSessionList();
    updateSendButton();
  }

  function formatSessionTime(timestamp) {
    const date = new Date(timestamp);
    const today = new Date();
    const sameDay = date.toDateString() === today.toDateString();
    return sameDay
      ? date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
      : date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
  }

  function renderSessionList() {
    dom.sessionList.innerHTML = "";
    sessions.slice().sort((a, b) => b.updatedAt - a.updatedAt).forEach(session => {
      const row = document.createElement("div");
      row.className = `solver-session-row${session.id === activeSessionId ? " current" : ""}`;
      row.dataset.sessionId = session.id;
      row.setAttribute("role", "listitem");

      const main = document.createElement("button");
      main.type = "button";
      main.className = "solver-session-main";
      main.dataset.sessionAction = "switch";
      const title = document.createElement("span");
      title.className = "solver-session-title";
      title.textContent = session.title;
      const meta = document.createElement("span");
      meta.className = "solver-session-meta";
      const turns = session.messages.filter(message => message.role === "user").length;
      meta.textContent = `${formatSessionTime(session.updatedAt)} · ${turns} 轮`;
      main.append(title, meta);

      const actions = document.createElement("div");
      actions.className = "solver-session-actions";
      const rename = document.createElement("button");
      rename.type = "button";
      rename.className = "solver-session-action";
      rename.dataset.sessionAction = "rename";
      rename.title = "重命名";
      rename.setAttribute("aria-label", `重命名${session.title}`);
      rename.innerHTML = '<i data-lucide="pencil" aria-hidden="true"></i>';
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "solver-session-action delete";
      remove.dataset.sessionAction = "delete";
      remove.title = "删除对话";
      remove.setAttribute("aria-label", `删除${session.title}`);
      remove.innerHTML = '<i data-lucide="trash-2" aria-hidden="true"></i>';
      actions.append(rename, remove);
      row.append(main, actions);
      dom.sessionList.appendChild(row);
    });
    refreshIcons(dom.sessionList);
  }

  function openSessions() {
    closeSettings();
    renderSessionList();
    dom.sessionsModal.hidden = false;
    refreshIcons(dom.sessionsModal);
  }

  function closeSessions() {
    dom.sessionsModal.hidden = true;
  }

  async function waitForActiveRequest() {
    if (!sending || !requestPromise) return;
    requestController?.abort();
    try {
      await requestPromise;
    } catch {
      // sendQuestion converts request failures into message state.
    }
  }

  async function createNewSession() {
    await waitForActiveRequest();
    const session = createSessionRecord();
    sessions.unshift(session);
    activeSessionId = session.id;
    conversation = session.messages;
    localStorage.setItem(ACTIVE_SESSION_KEY, activeSessionId);
    scheduleSessionSave(session, true);
    attachments = [];
    renderAttachments();
    updateCurrentSessionLabel();
    renderConversation();
    renderSessionList();
    closeSessions();
    requestAnimationFrame(() => dom.prompt.focus());
  }

  async function switchSession(id) {
    if (id === activeSessionId) {
      closeSessions();
      return;
    }
    await waitForActiveRequest();
    const session = sessions.find(item => item.id === id);
    if (!session) return;
    activeSessionId = session.id;
    conversation = session.messages;
    localStorage.setItem(ACTIVE_SESSION_KEY, activeSessionId);
    attachments = [];
    renderAttachments();
    updateCurrentSessionLabel();
    renderConversation();
    renderSessionList();
    closeSessions();
  }

  function beginRenameSession(id) {
    const session = sessions.find(item => item.id === id);
    if (!session) return;
    renderSessionList();
    const row = dom.sessionList.querySelector(`[data-session-id="${id}"]`);
    if (!row) return;
    row.querySelector(".solver-session-main").hidden = true;
    row.querySelector(".solver-session-actions").hidden = true;
    const form = document.createElement("form");
    form.className = "solver-session-rename-form";
    form.dataset.renameSession = id;
    const input = document.createElement("input");
    input.type = "text";
    input.name = "session-title";
    input.required = true;
    input.maxLength = 60;
    input.value = session.title;
    input.setAttribute("aria-label", "对话名称");
    const save = document.createElement("button");
    save.type = "submit";
    save.title = "保存名称";
    save.setAttribute("aria-label", "保存对话名称");
    save.innerHTML = '<i data-lucide="check" aria-hidden="true"></i>';
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.dataset.cancelRename = "";
    cancel.title = "取消重命名";
    cancel.setAttribute("aria-label", "取消重命名");
    cancel.innerHTML = '<i data-lucide="x" aria-hidden="true"></i>';
    form.append(input, save, cancel);
    row.prepend(form);
    refreshIcons();
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }

  function saveSessionTitle(id, value) {
    const session = sessions.find(item => item.id === id);
    if (!session) return;
    const title = String(value || "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (!title) return;
    session.title = title;
    scheduleSessionSave(session, true);
    updateCurrentSessionLabel();
    renderSessionList();
  }

  async function deleteSession(id) {
    const session = sessions.find(item => item.id === id);
    if (!session || !window.confirm(`确定删除“${session.title}”吗？此操作无法撤销。`)) return;
    if (id === activeSessionId) await waitForActiveRequest();
    sessions = sessions.filter(item => item.id !== id);
    try {
      await removeSessionRecord(id);
    } catch (error) {
      setStatus(error.message || "对话删除失败。", true);
      return;
    }
    if (!sessions.length) sessions.push(createSessionRecord());
    if (id === activeSessionId) {
      activeSessionId = sessions[0].id;
      conversation = sessions[0].messages;
      localStorage.setItem(ACTIVE_SESSION_KEY, activeSessionId);
      scheduleSessionSave(sessions[0], true);
      attachments = [];
      renderAttachments();
      renderConversation();
    }
    updateCurrentSessionLabel();
    renderSessionList();
  }

  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("图片读取失败"));
      reader.readAsDataURL(file);
    });
  }

  function canvasToDataURL(canvas, type = "image/jpeg", quality = 0.9) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(async blob => {
        if (!blob) {
          reject(new Error("图片压缩失败"));
          return;
        }
        try {
          resolve(await fileToDataURL(blob));
        } catch (error) {
          reject(error);
        }
      }, type, quality);
    });
  }

  async function prepareImage(file) {
    if (!SUPPORTED_IMAGE_TYPES.has(file.type)) throw new Error(`${file.name} 不是支持的图片格式`);
    if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} 超过 12MB`);
    if (file.type === "image/gif" || file.size <= 2.5 * 1024 * 1024) return fileToDataURL(file);
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close?.();
      return await canvasToDataURL(canvas);
    } catch {
      return fileToDataURL(file);
    }
  }

  async function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const available = Math.max(0, MAX_IMAGES - attachments.length);
    if (!available) {
      setStatus(`每次最多添加 ${MAX_IMAGES} 张图片。`, true);
      return;
    }
    setStatus("正在处理图片…");
    try {
      for (const file of files.slice(0, available)) {
        const dataUrl = await prepareImage(file);
        attachments.push({
          id: `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: file.name || "题目图片",
          dataUrl
        });
      }
      renderAttachments();
      setStatus(files.length > available ? `已添加 ${available} 张，单次最多 ${MAX_IMAGES} 张。` : "");
    } catch (error) {
      setStatus(error.message || "图片处理失败。", true);
    }
  }

  function renderAttachments() {
    dom.preview.innerHTML = "";
    attachments.forEach(image => {
      const item = document.createElement("div");
      item.className = "solver-preview-item";
      const preview = document.createElement("img");
      preview.src = image.dataUrl;
      preview.alt = image.name;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "solver-preview-remove";
      remove.dataset.removeImage = image.id;
      remove.title = "移除图片";
      remove.setAttribute("aria-label", `移除${image.name}`);
      remove.innerHTML = '<i data-lucide="x" aria-hidden="true"></i>';
      item.append(preview, remove);
      dom.preview.appendChild(item);
    });
    dom.preview.hidden = attachments.length === 0;
    updateSendButton();
    refreshIcons(dom.preview);
  }

  function escapeHtml(value) {
    const node = document.createElement("div");
    node.textContent = String(value ?? "");
    return node.innerHTML;
  }

  function renderMarkdown(element, source) {
    const text = String(source || "");
    if (!text) {
      element.textContent = "";
      return;
    }
    if (!window.marked?.parse || !window.DOMPurify?.sanitize) {
      element.innerHTML = escapeHtml(text).replace(/\n/g, "<br>");
      return;
    }
    const parsed = window.marked.parse(text, { gfm: true, breaks: true });
    element.innerHTML = window.DOMPurify.sanitize(parsed, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["style"],
      FORBID_ATTR: ["style"]
    });
    element.querySelectorAll("a[href]").forEach(link => {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    });
  }

  function formatReasoningDuration(message) {
    let seconds = Number(message.reasoningSeconds) || 0;
    if (message.status === "streaming" && message.reasoningStartedAt) {
      const end = message.reasoningEndedAt || Date.now();
      seconds = Math.max(seconds, (end - message.reasoningStartedAt) / 1000);
    }
    const rounded = Math.max(1, Math.round(seconds));
    return message.status === "streaming" && !message.reasoningEndedAt
      ? `深度思考中 · ${rounded} 秒`
      : `深度思考了 ${rounded} 秒`;
  }

  function createReasoningElement(message) {
    const reasoning = document.createElement("details");
    reasoning.className = "solver-reasoning";
    reasoning.hidden = !message.reasoning;
    reasoning.open = message.status === "streaming" && Boolean(message.reasoning);

    const summary = document.createElement("summary");
    summary.innerHTML = '<i data-lucide="brain-circuit" aria-hidden="true"></i>';
    const title = document.createElement("span");
    title.className = "solver-reasoning-title";
    title.textContent = "深度思考";
    const timer = document.createElement("span");
    timer.className = "solver-reasoning-time";
    timer.textContent = formatReasoningDuration(message);
    const chevron = document.createElement("i");
    chevron.className = "solver-reasoning-chevron";
    chevron.setAttribute("data-lucide", "chevron-down");
    chevron.setAttribute("aria-hidden", "true");
    summary.append(title, timer, chevron);

    const copy = document.createElement("div");
    copy.className = "solver-reasoning-copy solver-markdown";
    renderMarkdown(copy, message.reasoning);
    reasoning.append(summary, copy);
    return reasoning;
  }

  function wrongQuestionSource(session, assistantMessage) {
    if (!session || !assistantMessage) return null;
    const index = session.messages.findIndex(message => message.id === assistantMessage.id);
    for (let position = index - 1; position >= 0; position -= 1) {
      if (session.messages[position].role === "user") return session.messages[position];
    }
    return null;
  }

  function wrongQuestionKindLabel(kind) {
    return ({
      term: "词义辨析",
      rule: "规则",
      formula: "公式",
      method: "方法",
      mistake: "易错点",
      material_point: "材料要点",
      argument: "论点论据",
      fact: "知识事实",
      other: "知识点"
    })[kind] || "知识点";
  }

  function createWrongCandidate(id, titleText, description, checked = false, kind = "") {
    const label = document.createElement("label");
    label.className = "solver-wrong-candidate";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.name = "wrong-items";
    input.value = id;
    input.checked = checked;
    const check = document.createElement("span");
    check.className = "solver-wrong-check";
    check.innerHTML = '<i data-lucide="check" aria-hidden="true"></i>';
    const copy = document.createElement("span");
    copy.className = "solver-wrong-candidate-copy";
    const title = document.createElement("strong");
    title.textContent = kind ? `${titleText} · ${wrongQuestionKindLabel(kind)}` : titleText;
    const summary = document.createElement("span");
    summary.textContent = description;
    copy.appendChild(title);
    if (description) copy.appendChild(summary);
    label.append(input, check, copy);
    return label;
  }

  function createWrongCaptureElement(message) {
    const capture = document.createElement("section");
    capture.className = "solver-wrong-capture";
    capture.dataset.wrongCapture = message.id;
    const status = message.wrongQuestionStatus || "idle";

    if (status === "analyzing") {
      const loading = document.createElement("div");
      loading.className = "solver-wrong-loading";
      loading.innerHTML = '<i data-lucide="loader-circle" aria-hidden="true"></i><span>正在识别题型与可复习知识…</span>';
      capture.appendChild(loading);
      return capture;
    }

    if (status === "error") {
      const error = document.createElement("div");
      error.className = "solver-wrong-error";
      const copy = document.createElement("span");
      copy.textContent = message.wrongQuestionError || "未能自动整理错题。";
      const retry = document.createElement("button");
      retry.type = "button";
      retry.dataset.wrongAction = "retry";
      retry.dataset.messageId = message.id;
      retry.textContent = "重新识别";
      error.append(copy, retry);
      capture.appendChild(error);
      return capture;
    }

    if (status !== "ready" || !message.wrongQuestionAnalysis) {
      capture.hidden = true;
      return capture;
    }

    const analysis = message.wrongQuestionAnalysis;
    const header = document.createElement("div");
    header.className = "solver-wrong-capture-header";
    const title = document.createElement("h3");
    title.className = "solver-wrong-capture-title";
    title.textContent = "记录这次不会的内容";
    const type = document.createElement("span");
    type.className = "solver-wrong-type";
    type.textContent = [analysis.subjectLabel, analysis.typeLabel].filter(Boolean).join(" · ");
    header.append(title, type);

    const intro = document.createElement("p");
    intro.className = "solver-wrong-capture-intro";
    intro.textContent = "选择需要以后单独复习的内容，也可以补充自己的易错点。";
    const candidates = document.createElement("div");
    candidates.className = "solver-wrong-candidates";
    candidates.appendChild(createWrongCandidate("__whole__", "整道题与解题方法", "保留原题、答案和完整解析"));
    (analysis.candidates || []).forEach(item => {
      candidates.appendChild(createWrongCandidate(
        item.id,
        item.title,
        [item.summary, ...(item.details || [])].filter(Boolean).join("；"),
        false,
        item.kind
      ));
    });

    const custom = document.createElement("label");
    custom.className = "solver-wrong-custom";
    const customLabel = document.createElement("span");
    customLabel.textContent = "自定义补充";
    const customInput = document.createElement("input");
    customInput.type = "text";
    customInput.maxLength = 300;
    customInput.dataset.wrongCustom = "";
    customInput.placeholder = "例如：容易忽略转折后的核心句";
    custom.append(customLabel, customInput);

    const captureStatus = document.createElement("p");
    captureStatus.className = "solver-wrong-capture-status";
    captureStatus.setAttribute("role", "status");
    const actions = document.createElement("div");
    actions.className = "solver-wrong-capture-actions";
    const skip = document.createElement("button");
    skip.type = "button";
    skip.className = "solver-wrong-skip";
    skip.dataset.wrongAction = "dismiss";
    skip.dataset.messageId = message.id;
    skip.textContent = "稍后记录";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "solver-wrong-save";
    save.dataset.wrongAction = "save";
    save.dataset.messageId = message.id;
    save.disabled = true;
    save.textContent = "保存到错题本";
    actions.append(skip, save);
    capture.append(header, intro, candidates, custom, captureStatus, actions);
    return capture;
  }

  function createMessageElement(message) {
    const article = document.createElement("article");
    article.className = `solver-message ${message.role}${message.status === "error" ? " error" : ""}`;
    article.dataset.messageId = message.id;

    if (message.role === "user") {
      if (message.images?.length) {
        const images = document.createElement("div");
        images.className = "solver-message-images";
        message.images.forEach(image => {
          const preview = document.createElement("img");
          preview.src = image.dataUrl;
          preview.alt = image.name;
          images.appendChild(preview);
        });
        article.appendChild(images);
      }
      const copy = document.createElement("div");
      copy.className = "solver-user-copy";
      copy.textContent = message.text || "请解答这道题。";
      article.appendChild(copy);
      return article;
    }

    const heading = document.createElement("div");
    heading.className = "solver-assistant-heading";
    heading.innerHTML = '<i data-lucide="sparkles" aria-hidden="true"></i>';
    const label = document.createElement("span");
    label.textContent = message.modelName || "解题助手";
    heading.appendChild(label);

    const reasoning = createReasoningElement(message);
    const copy = document.createElement("div");
    copy.className = `solver-assistant-copy solver-markdown${message.status === "streaming" ? " solver-stream-cursor" : ""}`;
    if (message.text) renderMarkdown(copy, message.text);
    else copy.textContent = message.status === "streaming" ? "正在分析题目…" : "";
    article.append(heading, reasoning, copy);

    if (message.status !== "streaming" && message.text) {
      const capture = createWrongCaptureElement(message);
      article.appendChild(capture);
      const footer = document.createElement("div");
      footer.className = "solver-message-footer";
      const copyButton = document.createElement("button");
      copyButton.type = "button";
      copyButton.className = "solver-copy-button";
      copyButton.dataset.copyMessage = message.id;
      copyButton.title = "复制回答";
      copyButton.setAttribute("aria-label", "复制回答");
      copyButton.innerHTML = '<i data-lucide="copy" aria-hidden="true"></i>';
      footer.appendChild(copyButton);
      const wrongButton = document.createElement("button");
      wrongButton.type = "button";
      wrongButton.className = message.wrongQuestionStatus === "saved" ? "solver-wrong-saved-link" : "solver-wrong-trigger";
      wrongButton.dataset.messageId = message.id;
      if (message.wrongQuestionStatus === "saved" && message.wrongQuestionId) {
        wrongButton.dataset.wrongAction = "open-record";
        wrongButton.innerHTML = '<i data-lucide="book-check" aria-hidden="true"></i><span>已加入错题本</span>';
      } else {
        wrongButton.dataset.wrongAction = "open";
        wrongButton.innerHTML = '<i data-lucide="bookmark-plus" aria-hidden="true"></i><span>记录错题</span>';
      }
      footer.appendChild(wrongButton);
      if (message.status === "stopped") {
        const stopped = document.createElement("span");
        stopped.textContent = "已停止生成";
        footer.appendChild(stopped);
      }
      article.appendChild(footer);
    }
    return article;
  }

  function renderConversation() {
    const hasMessages = conversation.length > 0;
    dom.welcome.hidden = hasMessages;
    dom.messages.hidden = !hasMessages;
    dom.messages.innerHTML = "";
    conversation.forEach(message => dom.messages.appendChild(createMessageElement(message)));
    refreshIcons(dom.messages);
    scrollToLatest(false);
  }

  function updateAssistantMessage(message) {
    const article = dom.messages.querySelector(`[data-message-id="${message.id}"]`);
    if (!article) {
      renderConversation();
      return;
    }
    const reasoning = article.querySelector(".solver-reasoning");
    const wasHidden = reasoning.hidden;
    reasoning.hidden = !message.reasoning;
    if (wasHidden && message.reasoning) reasoning.open = true;
    renderMarkdown(reasoning.querySelector(".solver-reasoning-copy"), message.reasoning);
    reasoning.querySelector(".solver-reasoning-time").textContent = formatReasoningDuration(message);

    const copy = article.querySelector(".solver-assistant-copy");
    if (message.text) renderMarkdown(copy, message.text);
    else copy.textContent = "正在分析题目…";
    copy.classList.toggle("solver-stream-cursor", message.status === "streaming");
    scrollToLatest(true);
  }

  function rerenderAssistantMessage(message, smooth = false) {
    const article = Array.from(dom.messages.querySelectorAll("[data-message-id]")).find(item => item.dataset.messageId === message.id);
    if (!article) {
      renderConversation();
      return;
    }
    article.replaceWith(createMessageElement(message));
    refreshIcons(dom.messages);
    if (smooth) scrollToLatest(true);
  }

  function updateWrongSaveButton(capture) {
    if (!capture) return;
    const selected = capture.querySelector('input[name="wrong-items"]:checked');
    const custom = capture.querySelector("[data-wrong-custom]")?.value.trim();
    const save = capture.querySelector('[data-wrong-action="save"]');
    if (save) save.disabled = !selected && !custom;
  }

  async function analyzeWrongQuestion(session, userMessage, assistantMessage) {
    if (!window.wrongQuestionBook || !session || !userMessage || !assistantMessage?.text) return;
    wrongAnalysisControllers.get(assistantMessage.id)?.abort();
    const controller = new AbortController();
    wrongAnalysisControllers.set(assistantMessage.id, controller);
    assistantMessage.wrongQuestionStatus = "analyzing";
    assistantMessage.wrongQuestionError = "";
    scheduleSessionSave(session);
    if (activeSessionId === session.id) rerenderAssistantMessage(assistantMessage, true);
    try {
      await window.wrongQuestionBook.ready;
      const analysis = await window.wrongQuestionBook.analyzeQuestion({
        apiKey: settings.apiKey,
        endpoint: responsesEndpoint(settings.baseUrl),
        model: settings.model,
        headers: responsesHeaders,
        userMessage,
        assistantText: assistantMessage.text,
        signal: controller.signal
      });
      if (wrongAnalysisControllers.get(assistantMessage.id) !== controller) return;
      assistantMessage.wrongQuestionAnalysis = analysis;
      assistantMessage.wrongQuestionStatus = "ready";
      assistantMessage.wrongQuestionError = "";
    } catch (error) {
      if (error?.name === "AbortError") return;
      assistantMessage.wrongQuestionStatus = "error";
      assistantMessage.wrongQuestionError = error?.status === 402
        ? "错题整理需要额外调用一次模型，当前额度不足。"
        : "自动整理失败，可以重新识别。";
    } finally {
      if (wrongAnalysisControllers.get(assistantMessage.id) === controller) {
        wrongAnalysisControllers.delete(assistantMessage.id);
        scheduleSessionSave(session, true);
        if (activeSessionId === session.id) rerenderAssistantMessage(assistantMessage, true);
      }
    }
  }

  function scrollToLatest(smooth = false) {
    requestAnimationFrame(() => {
      dom.workspace.scrollTo({ top: dom.workspace.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    });
  }

  function responsesInput(messages) {
    return messages.filter(message => message.status !== "error" && message.status !== "streaming").map(message => {
      if (message.role === "assistant") {
        return { type: "message", role: "assistant", content: message.text };
      }
      const content = [{ type: "input_text", text: message.text || "请识别并解答图片中的题目。" }];
      (message.images || []).forEach(image => {
        content.push({ type: "input_image", image_url: image.dataUrl, detail: "auto" });
      });
      return { type: "message", role: "user", content };
    });
  }

  function responseOutputText(payload) {
    if (typeof payload?.output_text === "string") return payload.output_text;
    return (payload?.output || []).flatMap(item => item?.type === "message" ? (item.content || []) : [])
      .filter(part => part?.type === "output_text" || part?.type === "text")
      .map(part => part.text || "")
      .join("");
  }

  function responseReasoningText(payload) {
    return (payload?.output || []).filter(item => item?.type === "reasoning").flatMap(item => [
      ...(item.summary || []).map(part => part?.text || ""),
      ...(item.content || []).map(part => part?.text || "")
    ]).filter(Boolean).join("\n\n");
  }

  async function responseError(response) {
    const payload = await response.json().catch(() => null);
    const message = payload?.error?.message || `请求失败（${response.status}）`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  async function createResponseRequest(body, signal, allowReasoningFallback = false) {
    const request = async payload => {
      const response = await fetch(responsesEndpoint(settings.baseUrl), {
        method: "POST",
        signal,
        headers: responsesHeaders(settings.apiKey),
        body: JSON.stringify(payload)
      });
      if (!response.ok) await responseError(response);
      return response;
    };
    try {
      return await request(body);
    } catch (error) {
      const unsupportedReasoning = error?.status === 400
        && body.reasoning
        && /reasoning|summary|unsupported|unknown|unrecognized|extra field|not allowed/i.test(error.message || "");
      if (!allowReasoningFallback || !unsupportedReasoning) throw error;
      const fallback = { ...body };
      delete fallback.reasoning;
      return request(fallback);
    }
  }

  async function consumeResponsesStream(response, onChunk) {
    if (!response.body || !String(response.headers.get("content-type") || "").includes("text/event-stream")) {
      const payload = await response.json();
      if (payload.error) throw new Error(payload.error.message || "模型返回错误");
      onChunk({
        text: responseOutputText(payload),
        reasoning: responseReasoningText(payload)
      });
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let complete = false;
    let sawText = false;
    let sawReasoning = false;
    const processLine = rawLine => {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) return;
      const data = line.slice(5).trim();
      if (!data) return;
      if (data === "[DONE]") {
        complete = true;
        return;
      }
      let event;
      try {
        event = JSON.parse(data);
      } catch {
        return;
      }
      if (event.error || event.type === "error" || event.type === "response.failed") {
        throw new Error(event.error?.message || event.message || event.response?.error?.message || "模型生成中断");
      }
      if (event.type === "response.output_text.delta") {
        sawText = true;
        onChunk({ text: event.delta || "", reasoning: "" });
      } else if (event.type === "response.reasoning_summary_text.delta" || event.type === "response.reasoning_text.delta") {
        sawReasoning = true;
        onChunk({ text: "", reasoning: event.delta || "" });
      } else if (event.type === "response.completed" || event.type === "response.incomplete") {
        if (!sawText || !sawReasoning) {
          const finalResponse = event.response || {};
          onChunk({
            text: sawText ? "" : responseOutputText(finalResponse),
            reasoning: sawReasoning ? "" : responseReasoningText(finalResponse)
          });
        }
        complete = true;
      }
    };

    while (!complete) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) processLine(line);
    }
    buffer += decoder.decode();
    if (buffer.trim() && !complete) processLine(buffer);
  }

  function friendlyError(error) {
    if (error?.name === "AbortError") return "已停止生成。";
    if (error?.status === 400) return error.message || "请求内容或模型 ID 无效。";
    if (error?.status === 401) return "API Key 无效，请在设置中重新填写。";
    if (error?.status === 402) return "API 账户额度不足，请充值或更换服务。";
    if (error?.status === 403) return error.message || "当前 API Key 没有调用该模型的权限。";
    if (error?.status === 429) return "请求过于频繁，请稍后再试。";
    if (error?.status === 502) return "当前模型服务异常，请稍后重试。";
    if (error?.status === 503) return "当前模型暂时没有可用服务，请更换模型。";
    if (error instanceof TypeError) return "无法连接 Responses API，请检查 Base URL、CORS 和网络。";
    return error?.message || "搜题失败，请稍后重试。";
  }

  function setSending(value) {
    sending = value;
    dom.cameraButton.disabled = value;
    dom.uploadButton.disabled = value;
    dom.prompt.disabled = value;
    dom.sendButton.classList.toggle("stop", value);
    dom.sendButton.title = value ? "停止生成" : "发送";
    dom.sendButton.setAttribute("aria-label", value ? "停止生成" : "发送问题");
    dom.sendButton.innerHTML = `<i data-lucide="${value ? "square" : "arrow-up"}" aria-hidden="true"></i>`;
    updateSendButton();
    refreshIcons(dom.sendButton);
  }

  function updateSendButton() {
    dom.sendButton.disabled = !sessionsReady || (!sending && !dom.prompt.value.trim() && attachments.length === 0);
  }

  function startReasoningClock(message) {
    if (!message.reasoningStartedAt) message.reasoningStartedAt = Date.now();
    window.clearInterval(reasoningTimer);
    reasoningTimer = window.setInterval(() => {
      if (message.status !== "streaming" || !message.reasoningStartedAt || message.reasoningEndedAt) {
        window.clearInterval(reasoningTimer);
        reasoningTimer = 0;
        return;
      }
      const article = dom.messages.querySelector(`[data-message-id="${message.id}"]`);
      const timer = article?.querySelector(".solver-reasoning-time");
      if (timer) timer.textContent = formatReasoningDuration(message);
    }, 500);
  }

  async function sendQuestion() {
    if (!sessionsReady) return;
    if (!settings.apiKey || !settings.baseUrl || !settings.model) {
      setStatus("请先配置 API Key、Base URL 和模型。", true);
      openSettings("完成设置后即可开始搜题。");
      return;
    }
    const text = dom.prompt.value.trim();
    if (!text && !attachments.length) return;
    const session = activeSession();
    if (!session) return;
    const sessionMessages = session.messages;
    let shouldAnalyzeWrongQuestion = false;
    const userMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text,
      images: attachments.map(image => ({ ...image })),
      reasoning: "",
      reasoningDetails: [],
      reasoningSeconds: 0,
      status: "done",
      createdAt: Date.now()
    };
    sessionMessages.push(userMessage);
    if (session.title === "新对话") session.title = sessionTitleFromMessage(userMessage);
    const history = sessionMessages.filter(message => message.status !== "error");
    const assistant = {
      id: `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: "assistant",
      text: "",
      images: [],
      reasoning: "",
      reasoningDetails: [],
      reasoningSeconds: 0,
      reasoningStartedAt: 0,
      reasoningEndedAt: 0,
      status: "streaming",
      modelName: currentModelLabel(),
      wrongQuestionStatus: "idle",
      wrongQuestionAnalysis: null,
      wrongQuestionId: "",
      wrongQuestionError: "",
      createdAt: Date.now()
    };
    sessionMessages.push(assistant);
    conversation = sessionMessages;
    attachments = [];
    dom.prompt.value = "";
    resizePrompt();
    renderAttachments();
    updateCurrentSessionLabel();
    renderConversation();
    renderSessionList();
    scheduleSessionSave(session, true);
    setStatus("");
    setSending(true);
    requestController = new AbortController();

    try {
      const response = await createResponseRequest({
        model: settings.model,
        instructions: SYSTEM_PROMPT,
        input: responsesInput(history),
        reasoning: { summary: "auto" },
        truncation: "auto",
        stream: true,
        store: false
      }, requestController.signal, true);
      await consumeResponsesStream(response, chunk => {
        if (chunk.reasoning) {
          if (!assistant.reasoning) startReasoningClock(assistant);
          assistant.reasoning += chunk.reasoning;
        }
        if (chunk.text) {
          if (assistant.reasoning && !assistant.reasoningEndedAt) {
            assistant.reasoningEndedAt = Date.now();
            assistant.reasoningSeconds = (assistant.reasoningEndedAt - assistant.reasoningStartedAt) / 1000;
          }
          assistant.text += chunk.text;
        }
        updateAssistantMessage(assistant);
        scheduleSessionSave(session);
      });
      if (!assistant.text.trim()) throw new Error("模型没有返回正文内容，请更换模型后重试。");
      assistant.status = "done";
      shouldAnalyzeWrongQuestion = true;
    } catch (error) {
      if (error?.name === "AbortError") {
        if (assistant.text.trim() || assistant.reasoning.trim()) {
          assistant.status = "stopped";
        } else {
          const index = sessionMessages.findIndex(message => message.id === assistant.id);
          if (index >= 0) sessionMessages.splice(index, 1);
        }
      } else {
        assistant.status = "error";
        assistant.text = friendlyError(error);
      }
    } finally {
      window.clearInterval(reasoningTimer);
      reasoningTimer = 0;
      if (assistant.reasoning && !assistant.reasoningEndedAt) {
        assistant.reasoningEndedAt = Date.now();
        assistant.reasoningSeconds = (assistant.reasoningEndedAt - assistant.reasoningStartedAt) / 1000;
      }
      requestController = null;
      setSending(false);
      scheduleSessionSave(session, true);
      if (activeSessionId === session.id) {
        conversation = sessionMessages;
        renderConversation();
        renderSessionList();
      }
      if (shouldAnalyzeWrongQuestion) {
        window.setTimeout(() => analyzeWrongQuestion(session, userMessage, assistant), 0);
      }
    }
  }

  function beginSend() {
    if (sending) {
      requestController?.abort();
      return;
    }
    requestPromise = sendQuestion();
    requestPromise.finally(() => {
      requestPromise = null;
    });
  }

  function resizePrompt() {
    dom.prompt.style.height = "auto";
    dom.prompt.style.height = `${Math.min(dom.prompt.scrollHeight, 144)}px`;
    updateSendButton();
  }

  dom.cameraButton.addEventListener("click", () => dom.cameraInput.click());
  dom.uploadButton.addEventListener("click", () => dom.uploadInput.click());
  dom.cameraInput.addEventListener("change", async () => {
    await addFiles(dom.cameraInput.files);
    dom.cameraInput.value = "";
  });
  dom.uploadInput.addEventListener("change", async () => {
    await addFiles(dom.uploadInput.files);
    dom.uploadInput.value = "";
  });
  dom.preview.addEventListener("click", event => {
    const button = event.target.closest("button[data-remove-image]");
    if (!button) return;
    attachments = attachments.filter(image => image.id !== button.dataset.removeImage);
    renderAttachments();
  });

  dom.prompt.addEventListener("input", resizePrompt);
  dom.prompt.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      dom.composer.requestSubmit();
    }
  });
  dom.composer.addEventListener("submit", event => {
    event.preventDefault();
    beginSend();
  });

  dom.messages.addEventListener("click", async event => {
    const copyButton = event.target.closest("button[data-copy-message]");
    if (copyButton) {
      const message = conversation.find(item => item.id === copyButton.dataset.copyMessage);
      if (!message?.text) return;
      try {
        await navigator.clipboard.writeText(message.text);
        setStatus("回答已复制。", false);
      } catch {
        setStatus("复制失败，请长按回答文字复制。", true);
      }
      return;
    }

    const button = event.target.closest("button[data-wrong-action]");
    if (!button) return;
    const session = activeSession();
    const message = session?.messages.find(item => item.id === button.dataset.messageId);
    if (!session || !message) return;
    const userMessage = wrongQuestionSource(session, message);
    const action = button.dataset.wrongAction;

    if (action === "open-record") {
      window.wrongQuestionBook?.open(message.wrongQuestionId);
      return;
    }
    if (action === "open") {
      if (message.wrongQuestionAnalysis) {
        message.wrongQuestionStatus = "ready";
        scheduleSessionSave(session);
        rerenderAssistantMessage(message, true);
      } else {
        analyzeWrongQuestion(session, userMessage, message);
      }
      return;
    }
    if (action === "retry") {
      analyzeWrongQuestion(session, userMessage, message);
      return;
    }
    if (action === "dismiss") {
      message.wrongQuestionStatus = "dismissed";
      scheduleSessionSave(session);
      rerenderAssistantMessage(message);
      return;
    }
    if (action !== "save") return;

    const article = event.target.closest(".solver-message");
    const capture = article?.querySelector("[data-wrong-capture]");
    const captureStatus = capture?.querySelector(".solver-wrong-capture-status");
    const selectedIds = Array.from(capture?.querySelectorAll('input[name="wrong-items"]:checked') || []).map(input => input.value);
    const customText = capture?.querySelector("[data-wrong-custom]")?.value.trim() || "";
    if (!selectedIds.length && !customText) {
      if (captureStatus) {
        captureStatus.textContent = "请至少选择或填写一项需要复习的内容。";
        captureStatus.classList.add("error");
      }
      return;
    }
    button.disabled = true;
    button.textContent = "保存中…";
    if (captureStatus) {
      captureStatus.textContent = "";
      captureStatus.classList.remove("error");
    }
    try {
      const record = await window.wrongQuestionBook.saveFromConversation({
        sessionId: session.id,
        userMessage,
        assistantMessage: message,
        selectedIds,
        customText
      });
      message.wrongQuestionId = record.id;
      message.wrongQuestionStatus = "saved";
      scheduleSessionSave(session, true);
      rerenderAssistantMessage(message);
      setStatus("已保存到错题本，今天即可开始复习。", false);
    } catch (error) {
      button.disabled = false;
      button.textContent = "保存到错题本";
      if (captureStatus) {
        captureStatus.textContent = error?.message || "错题保存失败，请重试。";
        captureStatus.classList.add("error");
      }
    }
  });

  dom.messages.addEventListener("input", event => {
    const capture = event.target.closest("[data-wrong-capture]");
    if (capture) updateWrongSaveButton(capture);
  });
  dom.messages.addEventListener("change", event => {
    const capture = event.target.closest("[data-wrong-capture]");
    if (capture) updateWrongSaveButton(capture);
  });

  dom.settingsButton.addEventListener("click", () => openSettings());
  document.querySelectorAll("[data-close-solver-settings]").forEach(element => element.addEventListener("click", closeSettings));
  dom.apiKeyToggle.addEventListener("click", () => {
    const show = dom.apiKey.type === "password";
    dom.apiKey.type = show ? "text" : "password";
    dom.apiKeyToggle.title = show ? "隐藏 API Key" : "显示 API Key";
    dom.apiKeyToggle.setAttribute("aria-label", dom.apiKeyToggle.title);
    dom.apiKeyToggle.innerHTML = `<i data-lucide="${show ? "eye-off" : "eye"}" aria-hidden="true"></i>`;
    refreshIcons(dom.apiKeyToggle);
  });
  dom.modelInput.addEventListener("input", () => dom.modelInput.setCustomValidity(""));
  dom.baseUrl.addEventListener("input", () => dom.baseUrl.setCustomValidity(""));
  dom.apiKey.addEventListener("input", () => dom.apiKey.setCustomValidity(""));
  dom.testConnection.addEventListener("click", testConnection);
  dom.settingsForm.addEventListener("submit", event => {
    event.preventDefault();
    const values = validateSettingsForm();
    if (!values) return;
    settings = values;
    saveSettings();
    renderConfigurationState();
    closeSettings();
    setStatus("搜题设置已保存。", false);
  });
  dom.clearChat.addEventListener("click", async () => {
    const session = activeSession();
    if (!session?.messages.length) {
      setSettingsStatus("当前没有对话记录。");
      return;
    }
    if (!window.confirm("确定清空当前对话吗？")) return;
    await waitForActiveRequest();
    session.messages = [];
    session.title = "新对话";
    conversation = session.messages;
    scheduleSessionSave(session, true);
    updateCurrentSessionLabel();
    renderConversation();
    renderSessionList();
    setSettingsStatus("当前对话已清空。", "success");
  });

  dom.sessionButton.addEventListener("click", openSessions);
  document.querySelectorAll("[data-close-solver-sessions]").forEach(element => element.addEventListener("click", closeSessions));
  dom.newSession.addEventListener("click", createNewSession);
  dom.sessionList.addEventListener("click", event => {
    const button = event.target.closest("button[data-session-action]");
    const row = event.target.closest("[data-session-id]");
    if (!button || !row) return;
    const id = row.dataset.sessionId;
    if (button.dataset.sessionAction === "switch") switchSession(id);
    if (button.dataset.sessionAction === "rename") beginRenameSession(id);
    if (button.dataset.sessionAction === "delete") deleteSession(id);
  });
  dom.sessionList.addEventListener("submit", event => {
    const form = event.target.closest("form[data-rename-session]");
    if (!form) return;
    event.preventDefault();
    saveSessionTitle(form.dataset.renameSession, new FormData(form).get("session-title"));
  });
  dom.sessionList.addEventListener("click", event => {
    if (!event.target.closest("button[data-cancel-rename]")) return;
    renderSessionList();
  });

  document.addEventListener("keydown", event => {
    if (event.key !== "Escape") return;
    if (!dom.settingsModal.hidden) closeSettings();
    if (!dom.sessionsModal.hidden) closeSessions();
  });
  window.addEventListener("summer-politics:tabchange", event => {
    if (event.detail?.tab === "search") {
      renderConfigurationState();
      updateCurrentSessionLabel();
      scrollToLatest(false);
    }
  });
  window.addEventListener("wrong-question:deleted", event => {
    const recordId = event.detail?.record?.id;
    if (!recordId) return;
    sessions.forEach(session => {
      let changed = false;
      session.messages.forEach(message => {
        if (message.wrongQuestionId !== recordId) return;
        message.wrongQuestionId = "";
        message.wrongQuestionStatus = message.wrongQuestionAnalysis ? "ready" : "idle";
        changed = true;
      });
      if (changed) scheduleSessionSave(session, true);
    });
    renderConversation();
  });
  window.addEventListener("pagehide", () => {
    wrongAnalysisControllers.forEach(controller => controller.abort());
    const session = activeSession();
    if (session) scheduleSessionSave(session, true);
  });

  renderConfigurationState();
  dom.view.dataset.markdownReady = window.marked?.parse && window.DOMPurify?.sanitize ? "true" : "fallback";
  renderAttachments();
  renderConversation();
  resizePrompt();
  refreshIcons();
  initializeSessions();
})();
