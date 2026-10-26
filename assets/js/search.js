(() => {
  "use strict";

  const SETTINGS_KEY = "summer-politics-responses-settings-v2";
  const LEGACY_SETTINGS_KEY = "summer-politics-openrouter-settings-v1";
  const ACTIVE_SESSION_KEY = "summer-politics-ai-active-session-v1";
  const QUESTION_TYPE_KEY = "summer-politics-ai-question-type-v1";
  const QUESTION_TYPES = window.solverQuestionTypes || [{ id: "general", label: "通用解题", prompt: "" }];
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

  const dom = {
    view: document.getElementById("view-search"),
    workspace: document.getElementById("solver-workspace"),
    welcome: document.getElementById("solver-welcome"),
    messages: document.getElementById("solver-messages"),
    composer: document.getElementById("solver-composer"),
    prompt: document.getElementById("solver-prompt"),
    questionType: document.getElementById("solver-question-type"),
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
  let processingImages = false;
  let sessions = [];
  let activeSessionId = "";
  let sessionNavigation = 0;
  let conversation = [];
  let requestController = null;
  let requestPromise = null;
  let sending = false;
  let sessionsReady = false;
  let persistenceTimer = 0;
  let reasoningTimer = 0;
  let databasePromise = null;

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
    window.AppUI.dialogOpen(dom.settingsModal, { onEscape: closeSettings });
    refreshIcons(dom.settingsModal);
    if (document.documentElement.dataset.inputModality === "keyboard") {
      requestAnimationFrame(() => {
        if (!dom.settingsModal.hidden && !dom.settingsModal.classList.contains("ui-is-closing")) {
          (settings.apiKey ? dom.baseUrl : dom.apiKey).focus({ preventScroll: true });
        }
      });
    }
  }

  function closeSettings() {
    window.AppUI.dialogClose(dom.settingsModal);
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
      // Keep archived metadata, including former tool results, without rendering or executing it.
      ...message,
      id: String(message?.id || `${message?.role || "message"}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
      role: message?.role === "assistant" ? "assistant" : "user",
      text: typeof message?.text === "string" ? message.text : "",
      questionType: QUESTION_TYPES.some(type => type.id === message?.questionType) ? message.questionType : "general",
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
      createdAt: Number(message?.createdAt) || Date.now()
    })) : [];
    return {
      ...value,
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
    window.PageTransitions?.enter(dom.workspace, { key: `session:${activeSessionId}`, focus: false });
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
    window.AppUI.dialogOpen(dom.sessionsModal, { onEscape: closeSessions });
    refreshIcons(dom.sessionsModal);
  }

  function closeSessions() {
    return window.AppUI.dialogClose(dom.sessionsModal);
  }

  function revealSession(token, { focusPrompt = false } = {}) {
    const sessionId = activeSessionId;
    // Keep the sheet exit independent from the conversation entering behind it.
    Promise.resolve(closeSessions()).then(() => {
      if (token !== sessionNavigation || activeSessionId !== sessionId || !dom.view.classList.contains("active") || !dom.settingsModal.hidden || !dom.sessionsModal.hidden) return;
      window.PageTransitions?.enter(dom.workspace, { key: `session:${sessionId}`, focus: false, force: true });
      if (focusPrompt && document.documentElement.dataset.inputModality === "keyboard") dom.prompt.focus({ preventScroll: true });
    });
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
    const navigation = ++sessionNavigation;
    await waitForActiveRequest();
    if (navigation !== sessionNavigation) return;
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
    revealSession(navigation, { focusPrompt: true });
  }

  async function switchSession(id) {
    const navigation = ++sessionNavigation;
    if (id === activeSessionId) {
      closeSessions();
      return;
    }
    await waitForActiveRequest();
    if (navigation !== sessionNavigation) return;
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
    revealSession(navigation);
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
    if (!session || !await window.AppUI.confirm({ title: "删除对话", message: `确定删除“${session.title}”吗？此操作无法撤销。`, confirmLabel: "删除", danger: true })) return;
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

  async function addFiles(fileList, cropAfterCapture = false) {
    if (processingImages || sending) return;
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const available = Math.max(0, MAX_IMAGES - attachments.length);
    if (!available) {
      setStatus(`每次最多添加 ${MAX_IMAGES} 张图片。`, true);
      return;
    }
    setStatus("正在处理图片…");
    processingImages = true;
    setSending(sending);
    try {
      for (const file of files.slice(0, available)) {
        let dataUrl = await prepareImage(file);
        if (cropAfterCapture) dataUrl = await window.cropSolverImage(dataUrl);
        if (!dataUrl) continue;
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
    } finally {
      processingImages = false;
      renderAttachments();
      setSending(sending);
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
      const crop = document.createElement("button");
      crop.type = "button";
      crop.className = "solver-preview-crop";
      crop.dataset.cropImage = image.id;
      crop.title = "裁剪图片";
      crop.setAttribute("aria-label", `裁剪${image.name}`);
      crop.innerHTML = '<i data-lucide="crop" aria-hidden="true"></i>';
      item.append(preview, remove, crop);
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
    window.AIExplanation.renderMarkdown(element, source);
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
      if (message.status === "stopped") {
        const stopped = document.createElement("span");
        stopped.textContent = "已停止生成";
        footer.appendChild(stopped);
      }
      article.appendChild(footer);
    }
    return article;
  }

  function renderConversation(scroll = true) {
    const scrollTop = dom.workspace.scrollTop;
    const visibleMessages = conversation.filter(message => message.role === "user" || message.text || message.reasoning || message.status === "streaming");
    const hasMessages = visibleMessages.length > 0;
    dom.welcome.hidden = hasMessages;
    dom.messages.hidden = !hasMessages;
    dom.messages.innerHTML = "";
    visibleMessages.forEach(message => dom.messages.appendChild(createMessageElement(message)));
    refreshIcons(dom.messages);
    if (scroll) scrollToLatest(false);
    else dom.workspace.scrollTop = scrollTop;
  }

  function updateAssistantMessage(message) {
    const article = dom.messages.querySelector(`[data-message-id="${message.id}"]`);
    if (!article) {
      renderConversation(false);
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
  }

  function rerenderAssistantMessage(message, smooth = false) {
    const article = Array.from(dom.messages.querySelectorAll("[data-message-id]")).find(item => item.dataset.messageId === message.id);
    if (!article) {
      renderConversation(false);
      return;
    }
    article.replaceWith(createMessageElement(message));
    refreshIcons(dom.messages);
    if (smooth) scrollToLatest(true);
  }

  function scrollToLatest(smooth = false) {
    requestAnimationFrame(() => {
      dom.workspace.scrollTo({ top: dom.workspace.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    });
  }

  function responsesInput(messages) {
    return messages.filter(message => message.status !== "error" && message.status !== "streaming" && (message.role === "user" || message.text)).map(message => {
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
    return window.AIExplanation.consumeResponse(response, onChunk, requestController?.signal);
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
    dom.cameraButton.disabled = value || processingImages;
    dom.uploadButton.disabled = value || processingImages;
    dom.prompt.disabled = value;
    dom.questionType.disabled = value;
    dom.sendButton.classList.toggle("stop", value);
    dom.sendButton.title = value ? "停止生成" : "发送";
    dom.sendButton.setAttribute("aria-label", value ? "停止生成" : "发送问题");
    dom.sendButton.innerHTML = `<i data-lucide="${value ? "square" : "arrow-up"}" aria-hidden="true"></i>`;
    updateSendButton();
    refreshIcons(dom.sendButton);
  }

  function updateSendButton() {
    dom.sendButton.disabled = processingImages || !sessionsReady || (!sending && !dom.prompt.value.trim() && attachments.length === 0);
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
    if (processingImages) return;
    if (!sessionsReady) return;
    if (!settings.apiKey || !settings.baseUrl || !settings.model) {
      setStatus("请先配置 API Key、Base URL 和模型。", true);
      openSettings("完成设置后即可开始搜题。");
      return;
    }
    const text = dom.prompt.value.trim();
    const questionType = QUESTION_TYPES.find(type => type.id === dom.questionType.value) || QUESTION_TYPES[0];
    if (!text && !attachments.length) return;
    const session = activeSession();
    if (!session) return;
    const sessionMessages = session.messages;
    const userMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text,
      questionType: questionType.id,
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
        instructions: await window.SolverPrompts.instructions(questionType.id, {question: {stem: text, images: userMessage.images}, history}),
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
        renderConversation(false);
        renderSessionList();
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
    const rootSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const maxHeight = parseFloat(getComputedStyle(dom.prompt).maxHeight);
    dom.prompt.style.height = `${Math.min(dom.prompt.scrollHeight, maxHeight) / rootSize}rem`;
    updateSendButton();
  }

  dom.cameraButton.addEventListener("click", () => dom.cameraInput.click());
  dom.uploadButton.addEventListener("click", () => dom.uploadInput.click());
  dom.cameraInput.addEventListener("change", async () => {
    await addFiles(dom.cameraInput.files, true);
    dom.cameraInput.value = "";
  });
  dom.uploadInput.addEventListener("change", async () => {
    await addFiles(dom.uploadInput.files);
    dom.uploadInput.value = "";
  });
  dom.preview.addEventListener("click", async event => {
    if (processingImages || sending) return;
    const cropButton = event.target.closest("button[data-crop-image]");
    if (cropButton) {
      const image = attachments.find(item => item.id === cropButton.dataset.cropImage);
      if (!image) return;
      processingImages = true;
      setSending(sending);
      try {
        const result = await window.cropSolverImage(image.dataUrl);
        if (result) image.dataUrl = result;
      } catch { setStatus("无法打开裁剪，请重试。", true); }
      finally {
        processingImages = false;
        renderAttachments();
        setSending(sending);
      }
      return;
    }
    const button = event.target.closest("button[data-remove-image]");
    if (!button) return;
    attachments = attachments.filter(image => image.id !== button.dataset.removeImage);
    renderAttachments();
  });

  dom.prompt.addEventListener("paste", event => {
    const clipboard = event.clipboardData;
    if (!clipboard) return;
    let images = Array.from(clipboard.items || [])
      .filter(item => item.kind === "file" && item.type.startsWith("image/"))
      .map(item => item.getAsFile()).filter(Boolean);
    if (!images.length) images = Array.from(clipboard.files || []).filter(file => file.type.startsWith("image/"));
    if (!images.length) return;
    // Keep native text insertion when the clipboard contains both text and images.
    if (!clipboard.getData("text/plain")) event.preventDefault();
    if (processingImages || sending) {
      setStatus("请等待当前处理完成后再粘贴图片。", true);
      return;
    }
    void addFiles(images);
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
        setStatus("");
      } catch {
        setStatus("复制失败，请长按回答文字复制。", true);
      }
      return;
    }

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
    const previousSettings = settings;
    settings = values;
    try {
      saveSettings();
    } catch {
      settings = previousSettings;
      setSettingsStatus("设置未能保存，请检查浏览器存储空间后重试。", "error");
      return;
    }
    renderConfigurationState();
    closeSettings();
    window.dispatchEvent(new Event("summer-politics:ai-settings-changed"));
    setStatus("");
  });
  dom.clearChat.addEventListener("click", async () => {
    const session = activeSession();
    if (!session?.messages.length) {
      setSettingsStatus("当前没有对话记录。");
      return;
    }
    if (!await window.AppUI.confirm({ title: "清空当前对话", message: "当前对话的消息将被清空，此操作无法撤销。", confirmLabel: "清空", danger: true })) return;
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
  window.addEventListener("pagehide", () => {
    const session = activeSession();
    if (session) scheduleSessionSave(session, true);
  });

  QUESTION_TYPES.forEach(type => dom.questionType.add(new Option(type.label, type.id)));
  try {
    const saved = window.SolverPrompts.normalizeSubject(localStorage.getItem(QUESTION_TYPE_KEY));
    if (QUESTION_TYPES.some(type => type.id === saved)) dom.questionType.value = saved;
  } catch { /* Selection remains usable when browser storage is unavailable. */ }
  dom.questionType.addEventListener("change", () => {
    try {
      localStorage.setItem(QUESTION_TYPE_KEY, dom.questionType.value);
    } catch {
      setStatus("题型已切换，但浏览器未能保存偏好。", true);
    }
  });
  window.AIExplanation.configure({ getSettings: () => ({...loadSettings()}), openSettings: () => openSettings() });
  window.addEventListener("storage", event => { if (event.key === SETTINGS_KEY || event.key === LEGACY_SETTINGS_KEY) { settings = loadSettings(); renderConfigurationState(); window.dispatchEvent(new Event("summer-politics:ai-settings-changed")); } });
  renderConfigurationState();
  dom.view.dataset.markdownReady = window.marked?.parse && window.DOMPurify?.sanitize ? "true" : "fallback";
  renderAttachments();
  renderConversation();
  resizePrompt();
  refreshIcons();
  initializeSessions();
})();
