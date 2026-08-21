(() => {
  "use strict";

  const SETTINGS_KEY = "summer-politics-openrouter-settings-v1";
  const CHAT_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
  const MODELS_ENDPOINT = "https://openrouter.ai/api/v1/models?input_modalities=image&output_modalities=text&sort=most-popular";
  const CUSTOM_MODEL_VALUE = "__custom__";
  const DEFAULT_MODEL = "google/gemini-3.6-flash";
  const MAX_IMAGES = 4;
  const MAX_FILE_BYTES = 12 * 1024 * 1024;
  const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
  const SYSTEM_PROMPT = [
    "你是一名严谨的公务员考试辅导老师。",
    "请先准确识别图片中的题干、选项、图表和条件，再作答。",
    "回答使用中文，先给出明确答案，再分步骤说明推理过程；涉及计算时写出关键算式。",
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
    modelButton: document.getElementById("solver-model-button"),
    modelLabel: document.getElementById("solver-model-label"),
    sendButton: document.getElementById("solver-send"),
    status: document.getElementById("solver-status"),
    settingsButton: document.getElementById("open-solver-settings"),
    settingsDot: document.getElementById("solver-settings-dot"),
    settingsModal: document.getElementById("solver-settings-modal"),
    settingsForm: document.getElementById("solver-settings-form"),
    apiKey: document.getElementById("solver-api-key"),
    apiKeyToggle: document.getElementById("toggle-solver-api-key"),
    modelSelect: document.getElementById("solver-model-select"),
    customModelWrap: document.getElementById("solver-custom-model-wrap"),
    customModel: document.getElementById("solver-custom-model"),
    settingsStatus: document.getElementById("solver-settings-status"),
    testConnection: document.getElementById("test-solver-connection"),
    clearChat: document.getElementById("clear-solver-chat")
  };

  if (!dom.view || !dom.composer || !dom.settingsModal) return;

  let settings = loadSettings();
  let attachments = [];
  let conversation = [];
  let requestController = null;
  let sending = false;
  let visionModels = [];
  let modelsLoaded = false;

  function loadSettings() {
    try {
      const value = JSON.parse(localStorage.getItem(SETTINGS_KEY));
      return {
        apiKey: typeof value?.apiKey === "string" ? value.apiKey.trim() : "",
        model: typeof value?.model === "string" && value.model.trim() ? value.model.trim() : DEFAULT_MODEL,
        modelName: typeof value?.modelName === "string" ? value.modelName.trim() : ""
      };
    } catch {
      return { apiKey: "", model: DEFAULT_MODEL, modelName: "" };
    }
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  function normalizeModel(value) {
    return String(value ?? "").trim().slice(0, 120);
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
    if (settings.modelName) return settings.modelName;
    const model = visionModels.find(item => item.id === settings.model);
    if (model?.name) return model.name;
    const fallback = Array.from(dom.modelSelect.options).find(option => option.value === settings.model);
    return fallback?.textContent || settings.model.split("/").pop() || "配置模型";
  }

  function renderConfigurationState() {
    dom.settingsDot.classList.toggle("configured", Boolean(settings.apiKey && settings.model));
    dom.modelLabel.textContent = currentModelLabel();
    dom.modelLabel.title = settings.model;
  }

  function selectedModelFromForm() {
    return dom.modelSelect.value === CUSTOM_MODEL_VALUE
      ? normalizeModel(dom.customModel.value)
      : normalizeModel(dom.modelSelect.value);
  }

  function toggleCustomModel(focus = false) {
    const custom = dom.modelSelect.value === CUSTOM_MODEL_VALUE;
    dom.customModelWrap.hidden = !custom;
    dom.customModel.required = custom;
    if (custom && focus) requestAnimationFrame(() => dom.customModel.focus());
  }

  function setModelControls(model) {
    const normalized = normalizeModel(model) || DEFAULT_MODEL;
    const optionExists = Array.from(dom.modelSelect.options).some(option => option.value === normalized);
    if (optionExists) {
      dom.modelSelect.value = normalized;
      dom.customModel.value = "";
    } else {
      dom.modelSelect.value = CUSTOM_MODEL_VALUE;
      dom.customModel.value = normalized;
    }
    toggleCustomModel();
  }

  function priceLabel(model) {
    const promptPrice = Number(model?.pricing?.prompt);
    if (!Number.isFinite(promptPrice) || promptPrice <= 0) return promptPrice === 0 ? " · 免费" : "";
    const perMillion = promptPrice * 1_000_000;
    return ` · $${perMillion < 0.01 ? perMillion.toFixed(3) : perMillion.toFixed(2)}/M`;
  }

  function populateModelOptions(models) {
    const selected = selectedModelFromForm() || settings.model || DEFAULT_MODEL;
    const unique = new Map();
    models.forEach(model => {
      if (model?.id && !unique.has(model.id)) unique.set(model.id, model);
    });

    dom.modelSelect.innerHTML = "";
    Array.from(unique.values()).slice(0, 100).forEach(model => {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = `${model.name || model.id}${priceLabel(model)}`;
      dom.modelSelect.appendChild(option);
    });
    const customOption = document.createElement("option");
    customOption.value = CUSTOM_MODEL_VALUE;
    customOption.textContent = "其他模型 ID";
    dom.modelSelect.appendChild(customOption);
    setModelControls(selected);
  }

  async function loadVisionModels() {
    if (modelsLoaded) return;
    setSettingsStatus("正在获取可用的多模态模型…");
    try {
      const headers = settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {};
      const response = await fetch(MODELS_ENDPOINT, { headers });
      if (!response.ok) throw new Error(`模型列表请求失败（${response.status}）`);
      const payload = await response.json();
      visionModels = Array.isArray(payload.data)
        ? payload.data.filter(model => model?.architecture?.input_modalities?.includes("image") && model?.architecture?.output_modalities?.includes("text"))
        : [];
      if (!visionModels.length) throw new Error("没有获取到可用的图片模型");
      populateModelOptions(visionModels);
      modelsLoaded = true;
      setSettingsStatus(`已获取 ${visionModels.length} 个支持图片输入的模型。`, "success");
    } catch (error) {
      setModelControls(settings.model);
      setSettingsStatus(`${error.message || "模型列表加载失败"}，仍可手动填写模型 ID。`, "error");
    }
  }

  function openSettings(message = "") {
    dom.apiKey.value = settings.apiKey;
    dom.apiKey.type = "password";
    setModelControls(settings.model);
    setSettingsStatus(message);
    dom.settingsModal.hidden = false;
    refreshIcons();
    loadVisionModels();
    requestAnimationFrame(() => (settings.apiKey ? dom.modelSelect : dom.apiKey).focus());
  }

  function closeSettings() {
    dom.settingsModal.hidden = true;
    dom.apiKey.type = "password";
    setSettingsStatus("");
  }

  function validateSettingsForm() {
    const apiKey = dom.apiKey.value.trim();
    const model = selectedModelFromForm();
    dom.apiKey.setCustomValidity("");
    dom.modelSelect.setCustomValidity("");
    dom.customModel.setCustomValidity("");
    if (!apiKey) {
      dom.apiKey.setCustomValidity("请输入 OpenRouter API Key");
      dom.apiKey.reportValidity();
      return null;
    }
    if (!model) {
      const input = dom.modelSelect.value === CUSTOM_MODEL_VALUE ? dom.customModel : dom.modelSelect;
      input.setCustomValidity("请选择或输入模型 ID");
      input.reportValidity();
      return null;
    }
    const selectedOption = dom.modelSelect.selectedOptions[0];
    const modelName = dom.modelSelect.value === CUSTOM_MODEL_VALUE
      ? model.split("/").pop()
      : (selectedOption?.textContent || model).replace(/ · \$.*$/, "").replace(/ · 免费$/, "");
    return { apiKey, model, modelName };
  }

  async function testConnection() {
    const values = validateSettingsForm();
    if (!values) return;
    dom.testConnection.disabled = true;
    setSettingsStatus("正在验证 API Key…");
    try {
      const response = await fetch("https://openrouter.ai/api/v1/key", {
        headers: { Authorization: `Bearer ${values.apiKey}` }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error?.message || `验证失败（${response.status}）`);
      const remaining = Number(payload?.data?.limit_remaining);
      setSettingsStatus(Number.isFinite(remaining) ? `连接成功，可用额度 $${remaining.toFixed(2)}。` : "连接成功，API Key 可用。", "success");
    } catch (error) {
      setSettingsStatus(error.message || "连接失败，请检查 API Key。", "error");
    } finally {
      dom.testConnection.disabled = false;
    }
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
    refreshIcons();
  }

  function createMessageElement(message) {
    const article = document.createElement("article");
    article.className = `solver-message ${message.role}${message.status === "error" ? " error" : ""}`;
    article.dataset.messageId = message.id;

    if (message.role === "user") {
      if (message.images.length) {
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

    const copy = document.createElement("div");
    copy.className = `solver-assistant-copy${message.status === "streaming" ? " solver-stream-cursor" : ""}`;
    copy.textContent = message.text || (message.status === "streaming" ? "正在识别题目…" : "");
    article.append(heading, copy);

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

  function renderConversation() {
    const hasMessages = conversation.length > 0;
    dom.welcome.hidden = hasMessages;
    dom.messages.hidden = !hasMessages;
    dom.messages.innerHTML = "";
    conversation.forEach(message => dom.messages.appendChild(createMessageElement(message)));
    refreshIcons();
    scrollToLatest();
  }

  function updateAssistantMessage(message) {
    const article = dom.messages.querySelector(`[data-message-id="${message.id}"]`);
    if (!article) {
      renderConversation();
      return;
    }
    const copy = article.querySelector(".solver-assistant-copy");
    copy.textContent = message.text || "正在识别题目…";
    copy.classList.toggle("solver-stream-cursor", message.status === "streaming");
    scrollToLatest();
  }

  function scrollToLatest() {
    requestAnimationFrame(() => {
      dom.workspace.scrollTo({ top: dom.workspace.scrollHeight, behavior: "smooth" });
    });
  }

  function apiMessages(messages) {
    return messages.slice(-12).map(message => {
      if (message.role === "assistant") return { role: "assistant", content: message.text };
      const content = [{ type: "text", text: message.text || "请识别并解答图片中的题目。" }];
      message.images.forEach(image => {
        content.push({ type: "image_url", image_url: { url: image.dataUrl } });
      });
      return { role: "user", content };
    });
  }

  function contentDelta(value) {
    if (typeof value === "string") return value;
    if (!Array.isArray(value)) return "";
    return value.map(part => typeof part === "string" ? part : (part?.text || part?.content || "")).join("");
  }

  async function responseError(response) {
    const payload = await response.json().catch(() => null);
    const message = payload?.error?.message || `请求失败（${response.status}）`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  async function consumeStream(response, onDelta) {
    if (!response.body) {
      const payload = await response.json();
      if (payload.error) throw new Error(payload.error.message || "模型返回错误");
      onDelta(contentDelta(payload?.choices?.[0]?.message?.content));
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let streamComplete = false;
    while (!streamComplete) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") {
          if (data === "[DONE]") streamComplete = true;
          continue;
        }
        let chunk;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }
        if (chunk.error) throw new Error(chunk.error.message || "模型生成中断");
        const delta = contentDelta(chunk?.choices?.[0]?.delta?.content);
        if (delta) onDelta(delta);
      }
    }
  }

  function friendlyError(error) {
    if (error?.name === "AbortError") return "已停止生成。";
    if (error?.status === 401) return "API Key 无效，请在设置中重新填写。";
    if (error?.status === 402) return "OpenRouter 账户额度不足，请充值或更换模型。";
    if (error?.status === 429) return "请求过于频繁，请稍后再试。";
    if (error?.status === 503) return "当前模型暂时没有可用服务，请更换模型。";
    if (error instanceof TypeError) return "无法连接 OpenRouter，请检查网络后重试。";
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
    refreshIcons();
  }

  function updateSendButton() {
    dom.sendButton.disabled = !sending && !dom.prompt.value.trim() && attachments.length === 0;
  }

  async function sendQuestion() {
    if (sending) {
      requestController?.abort();
      return;
    }
    if (!settings.apiKey || !settings.model) {
      setStatus("请先配置 OpenRouter API Key 和多模态模型。", true);
      openSettings("完成设置后即可开始搜题。");
      return;
    }

    const text = dom.prompt.value.trim();
    if (!text && !attachments.length) return;
    const userMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text,
      images: attachments.map(image => ({ ...image })),
      status: "done"
    };
    conversation.push(userMessage);
    const history = conversation.filter(message => message.status !== "error");
    const assistant = {
      id: `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: "assistant",
      text: "",
      images: [],
      status: "streaming",
      modelName: currentModelLabel()
    };
    conversation.push(assistant);
    attachments = [];
    dom.prompt.value = "";
    resizePrompt();
    renderAttachments();
    renderConversation();
    setStatus("");
    setSending(true);
    requestController = new AbortController();

    try {
      const response = await fetch(CHAT_ENDPOINT, {
        method: "POST",
        signal: requestController.signal,
        headers: {
          Authorization: `Bearer ${settings.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": `${location.origin}${location.pathname}`,
          "X-OpenRouter-Title": "上岸学习 · 拍题搜题"
        },
        body: JSON.stringify({
          model: settings.model,
          messages: [{ role: "system", content: SYSTEM_PROMPT }, ...apiMessages(history)],
          stream: true
        })
      });
      if (!response.ok) await responseError(response);
      await consumeStream(response, delta => {
        assistant.text += delta;
        updateAssistantMessage(assistant);
      });
      if (!assistant.text.trim()) throw new Error("模型没有返回文字内容，请更换模型后重试。");
      assistant.status = "done";
      renderConversation();
    } catch (error) {
      if (error?.name === "AbortError") {
        if (assistant.text.trim()) {
          assistant.status = "stopped";
        } else {
          conversation = conversation.filter(message => message.id !== assistant.id);
        }
      } else {
        assistant.status = "error";
        assistant.text = friendlyError(error);
      }
      renderConversation();
    } finally {
      requestController = null;
      setSending(false);
    }
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
    sendQuestion();
  });

  dom.messages.addEventListener("click", async event => {
    const button = event.target.closest("button[data-copy-message]");
    if (!button) return;
    const message = conversation.find(item => item.id === button.dataset.copyMessage);
    if (!message?.text) return;
    try {
      await navigator.clipboard.writeText(message.text);
      setStatus("回答已复制。", false);
    } catch {
      setStatus("复制失败，请长按回答文字复制。", true);
    }
  });

  dom.settingsButton.addEventListener("click", () => openSettings());
  dom.modelButton.addEventListener("click", () => openSettings());
  document.querySelectorAll("[data-close-solver-settings]").forEach(element => element.addEventListener("click", closeSettings));
  dom.apiKeyToggle.addEventListener("click", () => {
    const show = dom.apiKey.type === "password";
    dom.apiKey.type = show ? "text" : "password";
    dom.apiKeyToggle.title = show ? "隐藏 API Key" : "显示 API Key";
    dom.apiKeyToggle.setAttribute("aria-label", dom.apiKeyToggle.title);
    dom.apiKeyToggle.innerHTML = `<i data-lucide="${show ? "eye-off" : "eye"}" aria-hidden="true"></i>`;
    refreshIcons();
  });
  dom.modelSelect.addEventListener("change", () => {
    dom.modelSelect.setCustomValidity("");
    toggleCustomModel(true);
  });
  dom.customModel.addEventListener("input", () => dom.customModel.setCustomValidity(""));
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
  dom.clearChat.addEventListener("click", () => {
    if (!conversation.length) {
      setSettingsStatus("当前没有对话记录。");
      return;
    }
    if (!window.confirm("确定清空当前搜题对话吗？")) return;
    requestController?.abort();
    conversation = [];
    renderConversation();
    setSettingsStatus("当前对话已清空。", "success");
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !dom.settingsModal.hidden) closeSettings();
  });
  window.addEventListener("summer-politics:tabchange", event => {
    if (event.detail?.tab === "search") {
      renderConfigurationState();
      scrollToLatest();
    }
  });

  setModelControls(settings.model);
  renderConfigurationState();
  renderAttachments();
  renderConversation();
  resizePrompt();
  refreshIcons();
})();
