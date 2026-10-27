/* Shenlun capture, local projects and a shared, source-preserving annotation reader. */
(() => {
  "use strict";
  const root = document.getElementById("view-shenlun");
  const Core = window.ShenlunCore, Service = window.ShenlunService, Prompts = window.ShenlunPrompts;
  if (!root || !Core || !Service || !Prompts) return;
  const store = Service.createStore(), client = Service.createClient();
  const app = document.getElementById("app"), nav = document.querySelector('[data-tab="shenlun"]');
  const jobs = new Map(), ocrJobs = new Map(), uploadJobs = new Set(), pendingOCR = new Map(), objectURLs = new Set();
  const DRAFT_KEY = "summer-politics-shenlun-draft-v1";
  let current = null, editorProjectId = null, routeToken = 0, saveTimer, pollTimer, activating = false, saveSequence = 0;
  let section = "answer", entryTab = "question", mobilePane = "document", selectedMark = null, message = "", historyItems = [], renderedProject = "", renderedSection = "";
  const uid = () => crypto.randomUUID();
  const clone = value => JSON.parse(JSON.stringify(value));
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  const button = (action, label, extra = "", cls = "") => `<button type="button" class="sl-button ${cls}" data-sl-action="${action}" ${extra}>${label}</button>`;
  const labelFor = id => Prompts.subtypes.find(item => item.id === id)?.label || "自动识别";
  const dateLabel = value => new Date(value).toLocaleString("zh-CN", {month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"});
  const statusLabel = p => ({draft:"草稿",running:"评分中",completed:"已评分",error:"生成失败",interrupted:"已中断"}[p.status] || "草稿");
  const isReview = () => /^#\/shenlun\/project\//.test(location.hash);
  const ownRoute = () => /^#\/shenlun(?:\/|$)/.test(location.hash);
  const count = value => Core.countWords(value || "");
  function refresh() { window.AppUI?.refresh(root); window.lucide?.createIcons(); }
  function notify(text) {
    document.querySelector(".sl-toast")?.remove();
    const el = document.createElement("div"); el.className = "sl-toast"; el.role = "status"; el.textContent = text;
    document.body.append(el); setTimeout(() => el.remove(), 4500);
  }
  function releasePreviews() { objectURLs.forEach(url => URL.revokeObjectURL(url)); objectURLs.clear(); }
  function persistenceText() { return store.persistent === false ? "暂存于当前页面，请导出备份" : "已保存在此浏览器"; }
  function saveStatus(text) { const el = root.querySelector("[data-sl-save]"); if (el) el.textContent = text; }
  async function persist(p = current) {
    if (!p) return;
    const seq = ++saveSequence, revision = p.revision;
    p.updatedAt = new Date().toISOString();
    try {
      await store.put(clone(p));
      if (current?.id === p.id && current.revision === revision && seq === saveSequence) saveStatus(persistenceText());
    } catch (error) { saveStatus("保存失败，请导出备份"); throw error; }
  }
  function scheduleSave() {
    saveStatus("正在保存…"); clearTimeout(saveTimer);
    const p = current; saveTimer = setTimeout(() => persist(p).catch(() => notify("本地保存失败，请导出项目保留内容。")), 350);
  }
  const editing = () => current?.status === "draft" && editorProjectId === current.id;
  async function flush() { clearTimeout(saveTimer); if (editing()) await persist(); }
  function createDraft(source) {
    const now = new Date().toISOString();
    return {id:uid(),title:source ? `${source.title} · 复评` : "未命名概括题",type:"summary",subtype:source?.subtype || "auto",
      maxScore:source?.maxScore ?? null,wordLimit:source?.wordLimit ?? null,
      questionText:source?.questionText || "",answerText:source?.answerText || "",
      questionImages:clone(source?.questionImages || []),answerImages:clone(source?.answerImages || []),
      answerProvenance:source?.answerProvenance ? clone(source.answerProvenance) : null,
      revision:1,questionRevision:1,answerRevision:1,status:"draft",reference:null,report:null,
      parentId:source?.id || null,createdAt:now,updatedAt:now};
  }
  async function heldElsewhere(id) {
    if (!navigator.locks?.query) return false;
    try { const state = await navigator.locks.query(); return state.held.some(lock => lock.name === `shenlun:${id}`); } catch { return false; }
  }
  async function recoverProject(p) {
    if (p?.status === "running" && !jobs.has(p.id) && !await heldElsewhere(p.id)) {
      p.status = "interrupted"; p.error = "上次生成因刷新或关闭页面中断。已保留原文与完成的题目分析，可继续评分。";
      await persist(p);
    }
    return p;
  }
  async function showEntry(id) {
    const token = ++routeToken; clearInterval(pollTimer); releasePreviews();
    app.classList.remove("shenlun-review-mode");
    let p = id ? await store.get(id) : null;
    if (!p) { try { p = await store.get(localStorage.getItem(DRAFT_KEY) || ""); } catch {} }
    if (!p || p.status !== "draft") p = createDraft();
    if (token !== routeToken || !ownRoute()) return;
    current = p; editorProjectId = p.id; selectedMark = null; message = "";
    try { localStorage.setItem(DRAFT_KEY, p.id); } catch {}
    await persist(p); historyItems = await store.list();
    if (token === routeToken && ownRoute() && !isReview()) renderEntry();
  }
  function uploadMarkup(kind) {
    const answer = kind === "answer", images = current[kind + "Images"] || [];
    return `<div class="sl-upload-zone" data-sl-drop="${kind}" tabindex="0" role="group" aria-label="${answer ? "答案图片" : "题目与材料图片"}拖放区">
      <div class="sl-upload-actions">${button("upload",icon("image-plus")+"上传图片",`data-kind="${kind}"`)}${button("camera",icon("camera")+"拍照",`data-kind="${kind}"`,"sl-button--quiet")}
      <span class="sl-subtle">${answer ? "单张答案" : "题目、材料可分多张上传"}，支持拖入</span></div>
      <input type="file" accept="image/jpeg,image/png,image/webp" data-sl-file="${kind}" ${answer ? "" : "multiple"} hidden>
      <input type="file" accept="image/*" capture="environment" data-sl-camera="${kind}" hidden>
      <div class="sl-image-list">${images.map((im,i) => `<div class="sl-image-item"><button type="button" class="sl-image-preview" data-sl-action="preview" data-kind="${kind}" data-index="${i}" aria-label="查看${esc(im.name)}"><img data-sl-asset="${esc(im.id)}" alt="${answer ? "答案原图" : `材料第${i+1}页`}"></button><div class="sl-image-caption">${answer ? "答案原图" : `第${i+1}页`} · ${esc(im.name)}</div><div class="sl-image-tools">${!answer ? button("move-image","↑",`data-kind="${kind}" data-index="${i}" data-direction="-1" aria-label="第${i+1}页前移" ${i===0?"disabled":""}`,"sl-button--small sl-button--quiet")+button("move-image","↓",`data-kind="${kind}" data-index="${i}" data-direction="1" aria-label="第${i+1}页后移" ${i===images.length-1?"disabled":""}`,"sl-button--small sl-button--quiet") : ""}${button("remove-image",icon("x"),`data-kind="${kind}" data-index="${i}" aria-label="删除${esc(im.name)}"`,"sl-button--small sl-button--quiet")}</div></div>`).join("")}</div>
      ${images.length ? button("recognize",ocrJobs.has(current.id+kind) ? "正在识别…" : icon("scan-text")+"识别并填入",`data-kind="${kind}" ${ocrJobs.has(current.id+kind)?"disabled":""}`,"sl-button--small") : ""}
      <div class="sl-ocr-status" data-sl-ocr-status="${kind}" role="status">${pendingOCR.has(current.id+kind) ? `识别完成。文字已被修改，${button("adopt-ocr","采用识别结果",`data-kind="${kind}"`,"sl-button--small")}` : ""}</div>
    </div>`;
  }
  function renderEntry() {
    releasePreviews();
    root.innerHTML = `<div class="sl-entry" data-editor="${entryTab}"><header class="sl-page-header"><h1>申论评分</h1><div class="sl-header-actions"><select class="sl-type-select" aria-label="题型"><option value="summary">概括题</option></select>${button("settings",icon("settings-2"), 'aria-label="模型设置"',"sl-button--quiet")}</div></header>
      <p class="sl-model-hint">请配置拥有视觉能力的文本模型。图片识别效果取决于模型能力。${button("settings","配置模型","","sl-link-button")}</p>
      <div class="sl-field-row"><label class="sl-field sl-title-field">项目名称<input class="sl-input" data-sl-field="title" maxlength="100" value="${esc(current.title)}"></label><label class="sl-field">概括类型<select data-sl-field="subtype">${Prompts.subtypes.map(item => `<option value="${esc(item.id)}" ${current.subtype===item.id?"selected":""}>${esc(item.label)}</option>`).join("")}</select></label><label class="sl-field sl-number-field">满分<input class="sl-input" type="number" data-sl-field="maxScore" min="1" max="100" step="0.5" inputmode="decimal" placeholder="必填" value="${current.maxScore ?? ""}"></label><label class="sl-field sl-number-field">字数上限<input class="sl-input" type="number" data-sl-field="wordLimit" min="1" max="10000" step="1" inputmode="numeric" placeholder="按题目" value="${current.wordLimit ?? ""}"></label></div>
      <div class="sl-entry-tabs" role="tablist" aria-label="录入内容"><button type="button" role="tab" id="sl-entry-tab-question" data-sl-entry-tab="question" aria-controls="sl-input-question" aria-selected="${entryTab==='question'}" tabindex="${entryTab==='question'?0:-1}">题目与材料</button><button type="button" role="tab" id="sl-entry-tab-answer" data-sl-entry-tab="answer" aria-controls="sl-input-answer" aria-selected="${entryTab==='answer'}" tabindex="${entryTab==='answer'?0:-1}">我们的答案</button></div>
      <div class="sl-editor-grid"><section class="sl-input-section" id="sl-input-question" data-sl-input-kind="question" role="tabpanel" aria-labelledby="sl-entry-tab-question"><header class="sl-section-heading"><span class="sl-step-number">01</span><h2>题目与材料</h2></header>${uploadMarkup("question")}<label class="sl-text-label" for="sl-question">题目要求、给定材料</label><textarea id="sl-question" class="sl-textarea" data-sl-field="questionText" maxlength="100000" placeholder="粘贴完整题目要求和给定材料，或上传后识别。识别结果可在这里校对。">${esc(current.questionText)}</textarea><p class="sl-subtle" data-sl-count="question">${count(current.questionText)} 字</p></section>
      <section class="sl-input-section" id="sl-input-answer" data-sl-input-kind="answer" role="tabpanel" aria-labelledby="sl-entry-tab-answer"><header class="sl-section-heading"><span class="sl-step-number">02</span><h2>我们的答案</h2></header>${uploadMarkup("answer")}<label class="sl-text-label" for="sl-answer">作答原文</label><textarea id="sl-answer" class="sl-textarea" data-sl-field="answerText" maxlength="20000" placeholder="粘贴我们的作答，或拍下手写答案。保留换行和标点，识别后请核对原文。">${esc(current.answerText)}</textarea><p class="sl-subtle" data-sl-count="answer">${count(current.answerText)} 字${current.answerProvenance ? " · 已绑定本张原图的书写观察" : ""}</p></section></div>
      <div class="sl-notice" role="status" ${message?"":"hidden"}>${esc(message)}</div><footer class="sl-editor-footer sticky"><span class="sl-subtle" data-sl-save>${esc(persistenceText())}</span><div>${button("export",icon("download")+"导出项目","","sl-button--quiet")}${button("start",icon("sparkles")+"开始评分","","sl-button--primary")}</div></footer>
      <section class="sl-history"><header class="sl-history-heading"><h2>评分记录</h2><div>${button("import","导入项目","","sl-button--quiet sl-button--small")}${button("new","新建","","sl-button--quiet sl-button--small")}</div></header><p class="sl-subtle">记录保存在当前浏览器，可导出后在其他设备导入。</p><div class="sl-history-list">${renderHistory()}</div><input type="file" data-sl-import accept="application/json,.json" hidden></section></div>`;
    refresh(); loadPreviews();
  }
  function switchEditor(next, focus = false) {
    if(!["question","answer"].includes(next))return;
    entryTab=next;
    const entry=root.querySelector(".sl-entry");if(entry)entry.dataset.editor=next;
    root.querySelectorAll("[data-sl-entry-tab]").forEach(tab=>{
      const selected=tab.dataset.slEntryTab===next;tab.setAttribute("aria-selected",String(selected));tab.tabIndex=selected?0:-1;
      if(selected&&focus)tab.focus();
    });
  }
  function renderHistory() {
    const list = historyItems.filter(p => p.id !== current?.id).sort((a,b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return list.length ? list.map(p => `<article class="sl-project-row"><button type="button" class="sl-project-open" data-sl-action="open" data-id="${esc(p.id)}"><strong>${esc(p.title)}</strong><span class="sl-subtle">${labelFor(p.subtype)} · ${statusLabel(p)}${p.report?.status === "ready" ? ` · ${p.report.score}/${p.report.maxScore}` : ""} · ${dateLabel(p.updatedAt)}</span></button>${button("delete-project",icon("trash-2"),`data-id="${esc(p.id)}" aria-label="删除${esc(p.title)}"`,"sl-button--quiet sl-button--small")}</article>`).join("") : '<p class="sl-empty">完成的评分和未完成草稿会保存在这里。</p>';
  }
  async function loadPreviews() {
    const id = current?.id;
    for (const img of root.querySelectorAll("img[data-sl-asset]")) {
      const asset = await store.getAsset(img.dataset.slAsset);
      if (current?.id !== id || !img.isConnected) return;
      if (asset?.blob) { const url = URL.createObjectURL(asset.blob); objectURLs.add(url); img.src = url; }
    }
  }
  function invalidate(kind) {
    current.revision++; current[kind+"Revision"] = (current[kind+"Revision"] || 0) + 1;
    current.status = "draft"; current.report = null; current.error = "";
    if (kind === "question") current.reference = null;
    else current.answerProvenance = null;
    pendingOCR.delete(current.id+kind);
  }
  function updateCount(kind) {
    const el = root.querySelector(`[data-sl-count="${kind}"]`);
    if (el) el.textContent = `${count(current[kind+"Text"])} 字${kind === "answer" && current.answerProvenance ? " · 已绑定本张原图的书写观察" : ""}`;
  }
  async function digest(value) {
    const data = typeof value === "string" ? new TextEncoder().encode(value) : value;
    return [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))].map(v => v.toString(16).padStart(2,"0")).join("");
  }
  async function addImages(kind, fileList) {
    const p = current, files = [...fileList]; if (!p || !files.length) return;
    const jobKey=p.id+kind, revision=p[kind+"Revision"];
    if(uploadJobs.has(jobKey))return notify("图片正在读取，请稍候再添加。");
    if (kind === "answer" && files.length !== 1) return notify("答案请一次上传一张图片。");
    if (kind === "question" && p.questionImages.length + files.length > 12) return notify("题目与材料最多12张，请合并部分图片后上传。");
    let total = (kind === "answer" ? [] : p.questionImages).reduce((n,im) => n + im.size,0);
    for (const file of files) {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return notify("请上传 JPG、PNG 或 WebP 图片，手机照片可先转换为 JPG。");
      if (file.size > 12*1024*1024) return notify("单张图片不能超过12 MB，请裁去空白或分段拍摄。");
      total += file.size;
    }
    if (total > 40*1024*1024) return notify("本组图片合计不能超过40 MB，请分段或压缩后上传。");
    const assets = [];
    uploadJobs.add(jobKey);
    try {
      for (const file of files) {
        const bitmap = await createImageBitmap(file); bitmap.close();
        const hash = await digest(await file.arrayBuffer());
        const asset = {id:uid(),blob:file,name:file.name,hash};
        await store.putAsset(asset); assets.push({id:asset.id,name:file.name,hash,type:file.type,size:file.size});
      }
      if (current?.id !== p.id || current[kind+"Revision"]!==revision || !editing() || isReview()) {
        for(const asset of assets)await store.removeAsset(asset.id);
        return notify("图片读取期间内容已更新，当前文字已保留，请重新添加图片。");
      }
      if (kind === "answer") { p.answerImages = assets; p.answerText = ""; }
      else p.questionImages.push(...assets);
      invalidate(kind); await persist(); if(current?.id===p.id&&editing()&&!isReview())renderEntry();
    } catch { notify("图片无法读取或保存，请使用清晰的 JPG、PNG 或 WebP 图片重试。"); }
    finally {uploadJobs.delete(jobKey);}
  }
  function dataURL(blob) { return new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); }); }
  async function runOCR(kind) {
    const p = current, jobKey = p.id + kind;
    if (ocrJobs.has(jobKey)) return;
    const images = clone(p[kind+"Images"]), revision = p[kind+"Revision"], settings = {...window.AIExplanation.getSettings()};
    const ocrClient=Service.createClient({getSettings:()=>settings});
    if (!images.length) return notify("请先上传图片。");
    const job = {controller:new AbortController(),revision}; ocrJobs.set(jobKey,job); renderEntry();
    function status(text) { if (current?.id === p.id && !isReview()) { const el=root.querySelector(`[data-sl-ocr-status="${kind}"]`); if(el) el.textContent=text; } }
    try {
      const key = await digest(JSON.stringify({version:Prompts.version,kind,images:images.map(im=>im.hash),model:settings.model,endpoint:settings.baseUrl}));
      let result = (await store.getOCR(key))?.result;
      if (!result) {
        status("正在识别文字与原图信息…");
        const urls = [];
        for (const im of images) { const asset=await store.getAsset(im.id); if(!asset?.blob) throw new Error("原图已不可读取，请重新上传图片。"); urls.push(await dataURL(asset.blob)); }
        result = await ocrClient.recognize({images:urls,kind,signal:job.controller.signal,onChunk:()=>status("正在逐字识别，请稍候…")});
        await store.putOCR({key,result,createdAt:new Date().toISOString()});
      }
      const payload={result,key,images,revision};
      if (current?.id === p.id && current[kind+"Revision"] === revision && JSON.stringify(current[kind+"Images"].map(im=>im.hash))===JSON.stringify(images.map(im=>im.hash))) {
        await adoptOCR(kind,payload);
        if (!isReview()) renderEntry();
        notify("识别完成，请核对文字、标点和题目分值。");
      } else {
        pendingOCR.set(jobKey,payload);
        if(current?.id===p.id&&!isReview()) {
          const el=root.querySelector(`[data-sl-ocr-status="${kind}"]`);
          const sameImages=JSON.stringify(current[kind+"Images"].map(im=>im.hash))===JSON.stringify(images.map(im=>im.hash));
          if(el){el.innerHTML=sameImages?`识别完成，当前文字有修改。${button("adopt-ocr","采用识别结果",`data-kind="${kind}"`,"sl-button--small")}`:"图片已变更，旧识别结果已缓存。";refresh();}
        }
      }
    } catch(error) { status(error.name === "AbortError" ? "已停止识别。" : error.message || "识别失败，请检查模型是否支持图片。"); notify(error.message || "图片识别失败。"); }
    finally { ocrJobs.delete(jobKey); if(current?.id===p.id&&!isReview()) { const b=root.querySelector(`[data-sl-action="recognize"][data-kind="${kind}"]`); if(b) { b.disabled=false; b.innerHTML=icon("scan-text")+"识别并填入"; refresh(); } } }
  }
  async function adoptOCR(kind,payload) {
    if (!payload) return;
    const p=current, hashes = p[kind+"Images"].map(im=>im.hash);
    if (JSON.stringify(hashes)!==JSON.stringify(payload.images.map(im=>im.hash))) return notify("图片已更换，旧识别结果不会用于新图片。");
    invalidate(kind); p[kind+"Text"] = payload.result.text;
    if (kind === "answer") p.answerProvenance={mode:"image",imageHash:hashes[0],ocrKey:payload.key,textHash:await digest(payload.result.text),observations:payload.result.observations};
    else {
      const meta=payload.result.questionMeta || {};
      if (meta.maxScore && !p.maxScore) p.maxScore=meta.maxScore;
      if (meta.wordLimit && !p.wordLimit) p.wordLimit=meta.wordLimit;
      if (p.subtype === "auto" && Prompts.subtypes.some(it=>it.id===meta.subtype)) p.subtype=meta.subtype;
    }
    await persist(p);
  }
  function notice(text,field) {
    if(field==="questionText"||field==="answerText")switchEditor(field==="answerText"?"answer":"question");
    message=text; const el=root.querySelector(".sl-notice"); if(el) {el.textContent=text;el.hidden=false;el.scrollIntoView({block:"nearest"});}
    root.querySelector(`[data-sl-field="${field}"]`)?.focus();
  }
  async function start() {
    if (!current.questionText.trim()) return notice("请先补齐题目要求和给定材料。","questionText");
    if (!current.answerText.trim()) return notice("请先填写或识别我们的答案。","answerText");
    if (!Number.isFinite(current.maxScore)||current.maxScore<=0||current.maxScore>100) return notice("请按题目确认满分（1至100分）。","maxScore");
    if (current.wordLimit != null && (!Number.isInteger(current.wordLimit)||current.wordLimit<1||current.wordLimit>10000)) return notice("请填写题目要求的字数上限，未规定时可以留空。","wordLimit");
    if (ocrJobs.has(current.id+"answer")||ocrJobs.has(current.id+"question")) return notice("图片还在识别，请完成校对后再开始评分。");
    if (uploadJobs.has(current.id+"answer")||uploadJobs.has(current.id+"question")) return notice("图片正在读取，请完成上传和校对后再开始评分。");
    const settings=window.AIExplanation.getSettings();
    if (!settings.apiKey || !settings.model || !settings.baseUrl) {window.AIExplanation.openSettings();return;}
    if (current.title === "未命名概括题") current.title=current.questionText.replace(/\s+/g," ").slice(0,28);
    await flush(); const id=current.id; await go(`#/shenlun/project/${id}`); await launch(id);
  }
  async function launch(id) {
    if(jobs.has(id)) return;
    const execute=async lock => {
      if (navigator.locks?.request && !lock) return notify("这个项目正在另一个标签页评分，完成后可直接查看。");
      const p=await store.get(id); if(!p || p.status === "completed" && p.report?.status === "ready") return;
      const runId=uid(), revision=p.revision, controller=new AbortController(),settings={...window.AIExplanation.getSettings()};
      const jobClient=Service.createClient({getSettings:()=>settings});
      const job={controller,runId,phase:p.reference?.status === "ready"?"grade":"reference",chars:0}; jobs.set(id,job);
      p.status="running";p.error="";p.run={id:runId,phase:job.phase,startedAt:new Date().toISOString(),model:settings.model,promptVersion:Prompts.version};
      await persist(p); if(current?.id===id){current=p;renderReview();}
      async function update() {
        const latest=await store.get(id); if(!latest || latest.revision!==revision || latest.run?.id!==runId) return false;
        await persist(p); if(current?.id===id&&isReview()){current=p;renderReview();} return true;
      }
      const onChunk=chunk=>{job.chars += (chunk?.text||"").length;const el=current?.id===id?root.querySelector("[data-sl-chunks]"):null;if(el)el.textContent=`已生成 ${job.chars.toLocaleString()} 字符，正在核对结构与依据…`;};
      try {
        if(!p.reference || p.reference.status !== "ready") {
          p.reference=await jobClient.reference({project:clone(p),signal:controller.signal,onChunk});
          if(p.reference.status === "needs_review") {p.status="error";p.error=(p.reference.limitations||[]).join("\n")||"资料不足，请补齐题目与材料后再评分。";await update();return;}
          job.phase="grade";job.chars=0;p.run.phase="grade";if(!await update())return;
        }
        p.report=await jobClient.grade({project:clone(p),reference:clone(p.reference),signal:controller.signal,onChunk});
        p.status=p.report.status === "ready"?"completed":"error";
        if(p.status === "error")p.error="当前答卷或题目有待核实之处，请查看分析并补齐后重试。";
        await update();
      } catch(error) {
        p.status=controller.signal.aborted?"interrupted":"error";
        p.error=controller.signal.aborted?"已停止生成。原文和完成的题目分析已保留，可继续评分。":error.message||"评分生成失败，请重试。";
        await update().catch(()=>notify("结果尚未保存，请导出项目。"));
      } finally {jobs.delete(id);if(current?.id===id&&isReview())renderReview();}
    };
    if(navigator.locks?.request) await navigator.locks.request(`shenlun:${id}`,{ifAvailable:true},execute); else await execute(true);
  }
  async function showReview(id) {
    const token=++routeToken;clearInterval(pollTimer);releasePreviews();
    editorProjectId=null;
    const p=await recoverProject(await store.get(id));
    if(token!==routeToken||!isReview())return;
    app.classList.add("shenlun-review-mode");
    if(!p){current=null;root.innerHTML=`<div class="sl-empty"><h1>项目未找到</h1><p>此记录保存在创建它的浏览器，可从导出的项目文件恢复。</p>${button("back","返回申论评分")}</div>`;refresh();return;}
    current=p;section="answer";selectedMark=null;mobilePane="inspector";renderReview();
    pollTimer=setInterval(async()=>{if(!current||jobs.has(id)||!isReview())return;const fresh=await store.get(id);if(token!==routeToken||current?.id!==id||location.hash!==`#/shenlun/project/${id}`)return;if(!fresh){clearInterval(pollTimer);await go("#/shenlun");notify("这个项目已在另一个标签页删除。");return;}if(fresh.updatedAt!==current.updatedAt){current=fresh;renderReview();}},2000);
  }
  function reviewTabs() {
    return `<div class="sl-review-tabs" role="tablist" aria-label="批改内容"><button type="button" role="tab" data-sl-section="answer" aria-selected="${section==="answer"}">答案批改</button><button type="button" role="tab" data-sl-section="question" aria-selected="${section==="question"}">题目解析</button></div><div class="sl-mobile-tabs" role="group" aria-label="阅读面板"><button type="button" data-sl-mobile="document" aria-pressed="${mobilePane==="document"}">${section==="answer"?"作答原文":"题目材料"}</button><button type="button" data-sl-mobile="inspector" aria-pressed="${mobilePane==="inspector"}">${section==="answer"?"评分与批注":"参考答案与解析"}</button></div>`;
  }
  function renderReview() {
    if(!current||!isReview())return;
    const documentScroll = renderedProject===current.id&&renderedSection===section ? root.querySelector(".sl-document-pane")?.scrollTop || 0 : 0;
    const p=current, running=p.status==="running", reference=section==="question";
    root.innerHTML=`<div class="sl-review" data-mobile="${mobilePane}"><header class="sl-review-header">${button("back",icon("arrow-left"),'aria-label="返回申论评分"',"sl-button--quiet")}<div class="sl-review-title"><h1>${esc(p.title)}</h1><span class="sl-subtle" data-sl-save>${esc(persistenceText())}</span></div><div class="sl-review-header-actions">${button("settings",icon("settings-2"),'aria-label="模型设置"',"sl-button--quiet")}${button("export",icon("download"),'aria-label="导出项目"',"sl-button--quiet")}${button("edit","修改重评","","sl-button--quiet sl-button--small")}</div></header>${reviewTabs()}<div class="sl-workspace"><section class="sl-document-pane" data-mobile-pane="document" aria-label="${reference?"原题材料":"我们的作答"}"><header class="sl-pane-heading"><h2>${reference?"题目与材料":"我们的答案"}</h2><span class="sl-subtle">${reference?labelFor(p.subtype):`${count(p.answerText)} 字${p.wordLimit?` / ${p.wordLimit} 字`:""}`}</span></header><div class="sl-document-text" tabindex="-1"></div><div class="sl-mark-legend">${reference?'<span class="sl-legend-source">材料依据</span>':'<span class="sl-legend-credit">得分</span><span class="sl-legend-issue">待改进</span><span class="sl-legend-deviation">偏离或不准确</span>'}</div></section><section class="sl-inspector-pane" data-mobile-pane="inspector" aria-label="${reference?"参考答案与分析":"评分与批注"}"><div class="sl-inspector-content">${reference?renderReference():selectedMark?renderAnnotation(selectedMark):renderOverview()}</div></section></div></div>`;
    renderDocument();refresh();
    const documentPane=root.querySelector(".sl-document-pane");if(documentPane)documentPane.scrollTop=documentScroll;
    renderedProject=current.id;renderedSection=section;
    if(running) root.querySelector(".sl-inspector-content")?.setAttribute("aria-busy","true");
  }
  function loadingMarkup() {
    const phase=current.run?.phase || "reference", job=jobs.get(current.id);
    return `<div class="sl-loading" role="status"><div class="sl-spinner" aria-hidden="true"></div><h2>${phase==="reference"?"正在分析题目与材料":"正在逐点批改答案"}</h2><div class="sl-loading-steps"><p class="sl-loading-step ${phase==="reference"?"is-active":"is-done"}">01　整理材料依据与参考答案</p><p class="sl-loading-step ${phase==="grade"?"is-active":""}">02　核对得分点与原文批注</p></div><div class="sl-skeleton"></div><p class="sl-subtle" data-sl-chunks>${job?.chars?`已生成 ${job.chars} 字符，正在核对结构与依据…`:"完成后将自动保存，可先查看原文。"}</p>${button("stop","停止生成","","sl-button--quiet")}</div>`;
  }
  function errorMarkup() {
    return `<div class="sl-result-error" role="status"><h2>${current.status==="interrupted"?"生成已中断":"暂未完成评分"}</h2><p class="sl-preserve">${esc(current.error||"请补齐资料后重试。")}</p><div>${button("retry","继续评分","","sl-button--primary")}${button("edit","修改内容","","sl-button--quiet")}${button("settings","模型设置","","sl-button--quiet")}</div></div>`;
  }
  function renderOverview() {
    const p=current,r=p.report;
    if(p.status==="running")return loadingMarkup();
    if(!r||r.status!=="ready")return errorMarkup();
    const writing=p.answerProvenance?.mode==="image";
    return `<div class="sl-overview"><p class="sl-score-label">AI 参考评分</p><div class="sl-score"><strong>${esc(r.score)}</strong><span>/ ${esc(r.maxScore)}</span></div><p class="sl-score-basis">依据当前材料与课程方法估计</p><p class="sl-summary">${esc(r.summary)}</p><div class="sl-metrics"><div class="sl-metric"><span>作答字数</span><strong>${count(p.answerText)}${p.wordLimit?` / ${p.wordLimit}`:""}</strong></div><div class="sl-metric"><span>原图划改</span><strong>${writing ? r.writing?.crossoutsCount ?? "待核实" : "未评估"}</strong></div></div><div class="sl-dimensions">${(r.dimensions||[]).map(d=>`<section><h3>${esc(d.label)}</h3><p>${esc(d.comment)}</p></section>`).join("")}</div><section class="sl-points"><h2>得分与失分</h2>${r.points.map(pt=>{const rb=p.reference.rubric.find(x=>x.id===pt.rubricId);return `<article class="sl-point is-${esc(pt.status)}"><div class="sl-point-title"><span class="sl-status-dot" aria-hidden="true"></span><h3>${esc(rb?.title||pt.rubricId)}</h3><strong>${pt.earned} / ${pt.maxPoints}</strong></div><p>${esc(pt.reason)}</p>${(pt.answerAnchors||[]).map(a=>renderAnchorLink(a,"answer","查看原文")).join("")}</article>`;}).join("")}</section>
      <section class="sl-writing"><h2>文字与书写</h2><p>${esc(r.writing?.comment||"请对照原文核对。")}</p>${(r.writing?.typos||[]).length?`<ul>${r.writing.typos.map(t=>`<li>“${esc(t.quote)}” → “${esc(t.suggestion)}”：${esc(t.reason)}</li>`).join("")}</ul>`:""}<p class="sl-subtle">${writing?"书写信息来自当前原图，识别疑点请结合图片核实。":"粘贴或已修改的文字不评估字迹与划改次数。"}</p></section>${r.nextSteps?.length?`<section class="sl-next"><h2>下一步怎么改</h2><ol>${r.nextSteps.map(t=>`<li>${esc(t)}</li>`).join("")}</ol></section>`:""}${r.annotations?.length?`<section class="sl-annotations-list"><h2>逐句批注</h2>${r.annotations.map((a,i)=>button("annotation",`[${i+1}] ${esc(a.title)}`,`data-id="${esc(a.id)}"`,"sl-link-button")).join("")}</section>`:""}<p class="sl-subtle sl-report-model">${esc(p.run?.model||"")} · ${esc(p.run?.promptVersion||Prompts.version)}</p></div>`;
  }
  function renderAnnotation(id) {
    const a=current.report?.annotations?.find(item=>item.id===id);if(!a){selectedMark=null;return renderOverview();}
    return `<article class="sl-annotation-detail sl-annotation-detail--${esc(a.kind)}">${button("overview",icon("arrow-left")+"综合评价","","sl-link-button")}<h2>${esc(a.title)}</h2><blockquote>${esc(a.answerAnchor?.quote||"")}</blockquote><p>${esc(a.comment)}</p>${a.suggestion?`<h3>我们可以这样改</h3><p>${esc(a.suggestion)}</p>`:""}${a.example?`<h3>示例表达</h3><p class="sl-reference-answer">${esc(a.example)}</p>`:""}<section><h3>对应材料</h3>${(a.relatedRubricIds||[]).map(id=>current.reference?.rubric?.find(r=>r.id===id)).filter(Boolean).map(r=>`<p>${esc(r.title)}：${esc(r.explanation)}</p>${(r.sourceAnchors||[]).map(x=>renderAnchorLink(x,"question","查看材料")).join("")}`).join("")}</section>${!Core.anchor(current.answerText,a.answerAnchor||{})?'<p class="sl-subtle">这条批注未精确定位到原文，保留评价供核对。</p>':""}</article>`;
  }
  function renderReference() {
    const ref=current.reference;
    if(!ref||ref.status!=="ready")return current.status==="running"?loadingMarkup():errorMarkup();
    return `<div class="sl-reference"><header class="sl-pane-heading"><h2>参考答案</h2><span class="sl-subtle">${count(ref.referenceAnswer)} 字</span></header><div class="sl-reference-answer">${referenceAnswerMarkup(ref)}</div><p class="sl-subtle">参考答案为一种作答方式，准确的同义表达也可以得分。</p><section class="sl-analysis-list"><h2>我们怎样从材料写出答案</h2>${(ref.analysis||[]).map((step,i)=>`<article class="sl-analysis-item" id="sl-analysis-${i}" tabindex="-1"><h3><span class="sl-ref-index">${i+1}</span>${esc(step.title)}</h3><p class="sl-preserve">${esc(step.text)}</p>${step.answerQuote?`<blockquote>${esc(step.answerQuote)}</blockquote>`:""}<div>${(step.sourceAnchors||[]).map(a=>renderAnchorLink(a,"question","材料依据")).join("")}</div></article>`).join("")}</section>${ref.limitations?.length?`<div class="sl-notice">${ref.limitations.map(esc).join("<br>")}</div>`:""}</div>`;
  }
  function referenceAnswerMarkup(ref) {
    const marks=(ref.analysis||[]).map((step,i)=>({id:"ref-"+i,kind:"source",quote:step.answerQuote,index:i+1,action:"analysis",target:String(i)})).filter(x=>x.quote&&Core.anchor(ref.referenceAnswer,{quote:x.quote}));
    return annotatedMarkup(ref.referenceAnswer,marks);
  }
  function renderAnchorLink(a,where,label) {
    const text=where==="question"?current.questionText:current.answerText;
    const found=Core.anchor(text,a||{});
    return found?button("source",esc(label),`data-where="${where}" data-start="${found.start}" data-end="${found.end}"`,"sl-link-button") : `<span class="sl-subtle sl-unlocated">${esc(a?.quote||"")}（请核对引用）</span>`;
  }
  function documentMarks() {
    if(section==="answer")return (current.report?.annotations||[]).map((a,i)=>({id:a.id,kind:a.kind,...a.answerAnchor,index:i+1,action:"annotation",target:a.id}));
    return (current.reference?.analysis||[]).flatMap((step,i)=>(step.sourceAnchors||[]).map((a,j)=>({id:`src-${i}-${j}`,kind:"source",...a,index:i+1,action:"analysis",target:String(i)})));
  }
  function annotatedMarkup(text,marks) {
    const located=marks.map(mark=>({...mark,span:Core.anchor(text,mark)})).filter(mark=>mark.span);
    const boundaries=[...new Set([0,text.length,...located.flatMap(mark=>[mark.span.start,mark.span.end])])].sort((a,b)=>a-b);
    let html="";
    for(let i=0;i<boundaries.length-1;i++) {
      const start=boundaries[i],end=boundaries[i+1],active=located.filter(mark=>mark.span.start<=start&&mark.span.end>=end);
      const content=esc(text.slice(start,end));
      if(!active.length){html+=content;continue;}
      const primary=active.find(mark=>mark.id===selectedMark)||active[0];
      html+=`<button type="button" class="sl-mark sl-mark--${esc(primary.kind)} ${primary.id===selectedMark?"is-selected":""}" data-sl-action="${primary.action}" data-id="${esc(primary.target)}" data-mark-id="${esc(primary.id)}" data-start="${start}" data-end="${end}" aria-label="批注${active.map(m=>m.index).join('、')}：${esc(primary.quote)}">${content}</button>`;
      for(const mark of active.filter(m=>m.span.end===end)) html+=`<button type="button" class="sl-ref-index" data-sl-action="${mark.action}" data-id="${esc(mark.target)}" aria-label="查看批注${mark.index}">[${mark.index}]</button>`;
    }
    return html;
  }
  function renderDocument() {
    const host=root.querySelector(".sl-document-text");if(!host)return;
    host.innerHTML=annotatedMarkup(section==="question"?current.questionText:current.answerText,documentMarks());
  }
  function revealPane(pane) {
    mobilePane=pane;const el=root.querySelector(".sl-review");if(el)el.dataset.mobile=pane;
    root.querySelectorAll("[data-sl-mobile]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.slMobile===pane)));
  }
  function showAnnotation(id) {
    section="answer";selectedMark=id;mobilePane="inspector";renderReview();
    root.querySelector(".sl-annotation-detail h2")?.setAttribute("tabindex","-1");
    root.querySelector(".sl-annotation-detail h2")?.focus({preventScroll:true});
    root.querySelector(".sl-inspector-pane")?.scrollTo({top:0,behavior:"auto"});
  }
  function showAnalysis(index) {
    if(section!=="question"){section="question";selectedMark=null;renderReview();}
    revealPane("inspector");
    const el=root.querySelector(`#sl-analysis-${Number(index)}`);el?.scrollIntoView({block:"start",behavior:matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});el?.focus({preventScroll:true});
  }
  function jumpSource(el) {
    const where=el.dataset.where;if(section!==where){section=where;selectedMark=null;renderReview();}
    revealPane("document");const host=root.querySelector(".sl-document-text");
    const start=Number(el.dataset.start),end=Number(el.dataset.end);
    // Add a temporary exact mark without changing or retyping the source text.
    const text=where==="question"?current.questionText:current.answerText;
    host.innerHTML=annotatedMarkup(text,[...documentMarks(),{id:"jump",quote:text.slice(start,end),occurrence:occurrenceAt(text,text.slice(start,end),start),kind:"source",action:where==="question"?"analysis":"overview",target:"0",index:"↗"}]);
    const target=host.querySelector(`[data-mark-id="jump"]`)||host.querySelector(`[data-start="${start}"]`);
    target?.scrollIntoView({block:"center",behavior:"smooth"});target?.focus({preventScroll:true});
  }
  function occurrenceAt(text,quote,start){let n=0,at=-1;while((at=text.indexOf(quote,at+1))!==-1){n++;if(at===start)return n;}return 1;}
  async function go(hash) {
    await flush().catch(()=>{});
    if(!nav.classList.contains("active")){activating=true;nav.click();activating=false;}
    if(location.hash!==hash)history.pushState(null,"",hash);
    return resolveRoute();
  }
  async function resolveRoute() {
    const requestedHash=location.hash;
    await flush().catch(()=>{});
    if(location.hash!==requestedHash)return;
    if(!ownRoute()){++routeToken;clearInterval(pollTimer);app.classList.remove("shenlun-review-mode");return;}
    if(!nav.classList.contains("active")){activating=true;nav.click();activating=false;}
    const match=/^#\/shenlun\/project\/([A-Za-z0-9-]+)$/.exec(location.hash);
    if(match)return showReview(match[1]);
    const draft=/^#\/shenlun\/draft\/([A-Za-z0-9-]+)$/.exec(location.hash);
    return showEntry(draft?.[1]);
  }
  async function editProject() {
    const p=createDraft(current);await store.put(p);await go(`#/shenlun/draft/${p.id}`);
    notify("已创建复评草稿，原评分记录保留。");
  }
  function downloadJSON(value,name) {
    const blob=new Blob([JSON.stringify(value,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function exportCurrent() {
    await flush().catch(()=>{});const p=current;if(!p)return;
    // Only texts, observations and reports leave this browser; no model credentials or images.
    const out=await store.exportData();const projects=(out.projects||out.entries||[]).filter(x=>x.id===p.id);
    downloadJSON({...out,projects,ocr:[],assetsIncluded:false},`申论评分-${p.title.replace(/[<>:"/\\|?*]/g,"_").slice(0,60)}.json`);
    notify("已导出题目、作答与报告；原图不包含在备份中。");
  }
  async function importFile(file) {
    if(!file)return;if(file.size>20*1024*1024)return notify("项目文件超过20 MB，无法导入。");
    try {const value=JSON.parse(await file.text());await store.importData(value,{merge:true});historyItems=await store.list();renderEntry();notify("项目已导入，可从评分记录打开。");}catch(error){notify(error.message||"项目格式不正确，无法导入。");}
  }
  root.addEventListener("input",event=>{
    const field=event.target.dataset.slField;if(!field||!current||isReview())return;
    if(field==="questionText"||field==="answerText"){const kind=field==="questionText"?"question":"answer";invalidate(kind);current[field]=event.target.value;updateCount(kind);}
    else if(field==="maxScore"||field==="wordLimit"){invalidate("question");current[field]=event.target.value===""?null:Number(event.target.value);}
    else if(field==="title"){current.title=event.target.value;current.revision++;}
    scheduleSave();
  });
  root.addEventListener("change",event=>{
    const field=event.target.dataset.slField;
    if(field==="subtype"){invalidate("question");current.subtype=event.target.value;scheduleSave();}
    const kind=event.target.dataset.slFile||event.target.dataset.slCamera;
    if(kind){addImages(kind,event.target.files);event.target.value="";}
    if(event.target.hasAttribute("data-sl-import")){importFile(event.target.files[0]);event.target.value="";}
  });
  root.addEventListener("click",async event=>{
    const editorButton=event.target.closest("[data-sl-entry-tab]");
    if(editorButton){switchEditor(editorButton.dataset.slEntryTab);return;}
    const sectionButton=event.target.closest("[data-sl-section]");
    if(sectionButton){section=sectionButton.dataset.slSection;selectedMark=null;mobilePane="inspector";renderReview();return;}
    const mobile=event.target.closest("[data-sl-mobile]");if(mobile){revealPane(mobile.dataset.slMobile);return;}
    const el=event.target.closest("[data-sl-action]");if(!el||el.disabled)return;
    const action=el.dataset.slAction,kind=el.dataset.kind;
    try {
      if(action==="settings")window.AIExplanation.openSettings();
      if(action==="upload"||action==="camera")root.querySelector(`[data-sl-${action==="camera"?"camera":"file"}="${kind}"]`)?.click();
      if(action==="recognize")runOCR(kind);
      if(action==="adopt-ocr"){await adoptOCR(kind,pendingOCR.get(current.id+kind));renderEntry();}
      if(action==="remove-image"){current[kind+"Images"].splice(Number(el.dataset.index),1);invalidate(kind);if(kind==="answer")current.answerText="";await persist();renderEntry();}
      if(action==="move-image"){const list=current[kind+"Images"],i=Number(el.dataset.index),to=i+Number(el.dataset.direction);if(to>=0&&to<list.length){[list[i],list[to]]=[list[to],list[i]];invalidate(kind);await persist();renderEntry();}}
      if(action==="preview")previewImage(current[kind+"Images"][Number(el.dataset.index)]);
      if(action==="start")await start();
      if(action==="back")await go("#/shenlun");
      if(action==="edit")await editProject();
      if(action==="new"){await flush();const p=createDraft();await store.put(p);await go(`#/shenlun/draft/${p.id}`);}
      if(action==="open"){const p=await store.get(el.dataset.id);await go(p.status==="draft"?`#/shenlun/draft/${p.id}`:`#/shenlun/project/${p.id}`);}
      if(action==="delete-project"&&await window.AppUI.confirm({title:"删除评分记录",message:"此操作只删除当前浏览器中的这个项目。",confirmLabel:"删除",danger:true})){jobs.get(el.dataset.id)?.controller.abort();await store.remove(el.dataset.id);historyItems=await store.list();renderEntry();}
      if(action==="retry")launch(current.id);
      if(action==="stop"){const job=jobs.get(current.id);if(job)job.controller.abort();else notify("此项目在另一个标签页生成，请在该标签页停止。");}
      if(action==="annotation")showAnnotation(el.dataset.id);
      if(action==="analysis")showAnalysis(el.dataset.id);
      if(action==="overview"){selectedMark=null;renderReview();revealPane("inspector");}
      if(action==="source")jumpSource(el);
      if(action==="export")exportCurrent();
      if(action==="import")root.querySelector("[data-sl-import]")?.click();
    } catch(error){notify(error.message||"操作未完成，请重试。");}
  });
  async function previewImage(im) {
    const asset=await store.getAsset(im.id);if(!asset?.blob)return notify("本项目未包含原图，请重新上传。");
    const overlay=document.createElement("div");overlay.className="sl-image-overlay";overlay.hidden=true;
    const panel=document.createElement("section");panel.className="sl-image-dialog";panel.role="dialog";panel.setAttribute("aria-modal","true");panel.setAttribute("aria-label","原图预览");
    const close=document.createElement("button");close.type="button";close.className="sl-button";close.textContent="关闭";
    const img=document.createElement("img"),url=URL.createObjectURL(asset.blob);img.src=url;img.alt=im.name;
    panel.append(close,img);overlay.append(panel);document.body.append(overlay);
    async function finish(){await window.AppUI.dialogClose(overlay);overlay.remove();URL.revokeObjectURL(url);}
    close.onclick=finish;overlay.addEventListener("click",e=>{if(e.target===overlay)finish();});window.AppUI.dialogOpen(overlay,{onEscape:finish});
  }
  root.addEventListener("dragover",event=>{const zone=event.target.closest("[data-sl-drop]");if(zone){event.preventDefault();zone.classList.add("is-dragging");}});
  root.addEventListener("dragleave",event=>{const zone=event.target.closest("[data-sl-drop]");if(zone&&!zone.contains(event.relatedTarget))zone.classList.remove("is-dragging");});
  root.addEventListener("drop",event=>{const zone=event.target.closest("[data-sl-drop]");if(zone){event.preventDefault();zone.classList.remove("is-dragging");addImages(zone.dataset.slDrop,event.dataTransfer.files);}});
  root.addEventListener("keydown",event=>{
    if(event.target.matches("[data-sl-entry-tab]")&&["ArrowLeft","ArrowRight","Home","End"].includes(event.key)){
      event.preventDefault();switchEditor(event.key==="Home"?"question":event.key==="End"?"answer":entryTab==="question"?"answer":"question",true);return;
    }
    const zone=event.target.closest("[data-sl-drop]");if(zone&&event.target===zone&&["Enter"," "].includes(event.key)){event.preventDefault();zone.querySelector('[data-sl-action="upload"]')?.click();}
    if(event.target.matches("[data-sl-section]")&&["ArrowLeft","ArrowRight","Home","End"].includes(event.key)){
      event.preventDefault();const choices=[...root.querySelectorAll("[data-sl-section]")],i=choices.indexOf(event.target);
      const next=event.key==="Home"?0:event.key==="End"?choices.length-1:(i+(event.key==="ArrowRight"?1:-1)+choices.length)%choices.length;
      choices[next]?.click();root.querySelector(`[data-sl-section="${choices[next]?.dataset.slSection}"]`)?.focus();
    }
  });
  root.addEventListener("paste",event=>{const images=[...(event.clipboardData?.files||[])].filter(f=>f.type.startsWith("image/"));if(images.length){const kind=event.target.closest("[data-sl-drop]")?.dataset.slDrop||(event.target.dataset.slField==="answerText"?"answer":"question");event.preventDefault();addImages(kind,images);}});
  window.addEventListener("hashchange",resolveRoute);
  window.addEventListener("summer-politics:tabchange",event=>{
    if(activating)return;
    if(event.detail?.tab==="shenlun"){if(!ownRoute())history.pushState(null,"","#/shenlun");resolveRoute();}
    else {flush().catch(()=>{});editorProjectId=null;app.classList.remove("shenlun-review-mode");clearInterval(pollTimer);if(ownRoute())history.replaceState(null,"",location.pathname+location.search);}
  });
  window.addEventListener("pagehide",()=>flush().catch(()=>{}));
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden")flush().catch(()=>{});});
  window.ShenlunApp={store,client,flush,resolveRoute,exportData:()=>store.exportData(),validateImportData:value=>store.validateImportData(value),importData:(value,options={merge:true})=>store.importData(value,options),get current(){return current;},get pending(){return [...jobs.keys()];}};
  if(ownRoute())resolveRoute();
})();
