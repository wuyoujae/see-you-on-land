/* Shared, framework-free controls. Original fields remain the form's source of truth. */
(() => {
  "use strict";

  const widgets = new WeakMap();
  const liveWidgets = new Set();
  const disclosures = new WeakSet();
  const focusable = 'button:not(:disabled),a[href],input:not(:disabled):not([type="hidden"]):not(.ui-source),textarea:not(:disabled),select:not(:disabled):not(.ui-source),[tabindex]:not([tabindex="-1"])';
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const dialogs = [];
  let nextId = 0;
  let currentPopover = null;
  let messageQueue = Promise.resolve();
  const duration = () => reduceMotion.matches ? 0 : 180;
  const isBottomSheet = element => element.classList.contains("solver-bottom-sheet");
  const uid = prefix => `ui-${prefix}-${++nextId}`;
  const chevron = '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m6 8 4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const visible = el => el && el.isConnected && !el.hidden && el.getClientRects().length > 0;
  const rem = pixels => `${pixels / (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16)}rem`;
  const emit = field => { field.dispatchEvent(new Event("input", { bubbles: true })); field.dispatchEvent(new Event("change", { bubbles: true })); };

  // Touching a control must not leave a desktop focus ring behind. A real
  // navigation keystroke restores visible focus immediately, including on tablets.
  document.documentElement.dataset.inputModality = window.matchMedia("(any-pointer: coarse)").matches ? "touch" : "pointer";
  document.addEventListener("pointerdown", event => {
    document.documentElement.dataset.inputModality = event.pointerType === "touch" || event.pointerType === "pen" ? "touch" : "pointer";
  }, true);
  document.addEventListener("keydown", event => {
    if (["Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown", "Escape"].includes(event.key)) document.documentElement.dataset.inputModality = "keyboard";
  }, true);

  function dialogDuration(element) {
    if (reduceMotion.matches) return 0;
    if (!isBottomSheet(element)) return duration();
    const toMilliseconds = value => parseFloat(value) * (value.trim().endsWith("ms") ? 1 : 1000) || 0;
    return Math.max(0, ...[element, ...element.children].map(surface => {
      const styles = getComputedStyle(surface);
      const durations = styles.transitionDuration.split(",").map(toMilliseconds);
      const delays = styles.transitionDelay.split(",").map(toMilliseconds);
      return Math.max(0, ...durations.map((time, index) => time + delays[index % delays.length]));
    }));
  }

  function trackSheetViewport(record) {
    if (!isBottomSheet(record.element) || record.stopViewport) return;
    const viewport = window.visualViewport;
    const update = () => {
      if (record.element.hidden) return;
      record.element.style.setProperty("--ui-sheet-height", rem(viewport?.height || innerHeight));
      record.element.style.setProperty("--ui-sheet-top", rem(viewport?.offsetTop || 0));
      record.element.style.setProperty("--ui-sheet-left", rem(viewport?.offsetLeft || 0));
      record.element.style.setProperty("--ui-sheet-width", rem(viewport?.width || innerWidth));
    };
    update();
    viewport?.addEventListener("resize", update, { passive: true });
    viewport?.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    record.stopViewport = () => {
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      record.stopViewport = null;
      ["--ui-sheet-height", "--ui-sheet-top", "--ui-sheet-left", "--ui-sheet-width"].forEach(name => record.element.style.removeProperty(name));
    };
  }

  function hookProperty(field, property, callback) {
    let prototype = Object.getPrototypeOf(field);
    let descriptor;
    while (prototype && !descriptor) { descriptor = Object.getOwnPropertyDescriptor(prototype, property); prototype = Object.getPrototypeOf(prototype); }
    if (!descriptor?.set || !descriptor.get || Object.hasOwn(field, property)) return;
    try {
      Object.defineProperty(field, property, {
        configurable: true,
        get() { return descriptor.get.call(this); },
        set(value) { descriptor.set.call(this, value); queueMicrotask(callback); }
      });
    } catch { /* Explicit refresh is still available for unusual host fields. */ }
  }

  function accessibleName(field) {
    const labelledBy = field.getAttribute("aria-labelledby");
    if (labelledBy) return labelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent || "").join(" ").trim();
    if (field.getAttribute("aria-label")) return field.getAttribute("aria-label");
    return Array.from(field.labels || []).map(label => Array.from(label.childNodes).filter(node => node.nodeType === Node.TEXT_NODE || node.nodeType === Node.ELEMENT_NODE && !node.contains(field) && !node.classList?.contains("ui-control")).map(node => node.textContent).join(" ")).join(" ").trim() || field.title || "请选择";
  }

  function makeSource(field, wrapper) {
    field.parentNode.insertBefore(wrapper, field);
    wrapper.append(field);
    field.classList.add("ui-source");
    field.setAttribute("tabindex", "-1");
    field.setAttribute("aria-hidden", "true");
    field.addEventListener("invalid", event => {
      event.preventDefault();
      const widget = widgets.get(field);
      widget?.trigger.focus();
      widget?.trigger.setAttribute("aria-invalid", "true");
      wrapper.classList.add("ui-invalid");
      let error = wrapper.querySelector(".ui-control-error");
      if (!error) { error = document.createElement("span"); error.id = uid("error"); error.className = "ui-control-error"; error.setAttribute("role", "alert"); wrapper.append(error); }
      error.textContent = field.validationMessage || "请完成此项";
      widget?.trigger.setAttribute("aria-describedby", [field.getAttribute("aria-describedby"), error.id].filter(Boolean).join(" "));
    });
    field.addEventListener("change", () => {
      if (!field.validity.valid) return;
      wrapper.classList.remove("ui-invalid");
      wrapper.querySelector(".ui-control-error")?.remove();
      widgets.get(field)?.trigger.removeAttribute("aria-invalid");
      const trigger = widgets.get(field)?.trigger;
      if (field.getAttribute("aria-describedby")) trigger?.setAttribute("aria-describedby", field.getAttribute("aria-describedby"));
      else trigger?.removeAttribute("aria-describedby");
    });
    field.focus = options => widgets.get(field)?.trigger.focus(options);
  }

  function closePopover({ restoreFocus = false } = {}) {
    currentPopover?.close(restoreFocus);
  }

  function createPopover(owner, trigger, element, options = {}) {
    closePopover();
    let closing = false;
    element.classList.add("ui-popover");
    element.style.visibility = "hidden";
    (document.fullscreenElement || document.body).append(element);
    // A manual popover enters the top layer without native menu behavior.
    if (typeof element.showPopover === "function") { element.setAttribute("popover", "manual"); element.showPopover(); }
    function position() {
      if (!visible(trigger)) { close(false); return; }
      const bounds = trigger.getBoundingClientRect();
      const viewport = window.visualViewport;
      const leftEdge = viewport?.offsetLeft || 0;
      const topEdge = viewport?.offsetTop || 0;
      const viewportWidth = viewport?.width || innerWidth;
      const viewportHeight = viewport?.height || innerHeight;
      const gap = 6;
      const gutter = 10;
      const width = Math.min(options.width || Math.max(bounds.width, 220), viewportWidth - gutter * 2);
      element.style.width = rem(width);
      element.style.maxHeight = rem(Math.max(140, viewportHeight - gutter * 2));
      const height = Math.min(element.scrollHeight, options.maxHeight || 330, viewportHeight - gutter * 2);
      const below = topEdge + viewportHeight - bounds.bottom - gap - gutter;
      const above = bounds.top - topEdge - gap - gutter;
      const up = below < Math.min(height, 180) && above > below;
      const available = Math.max(90, up ? above : below);
      element.style.maxHeight = rem(Math.min(height, available));
      const actualHeight = Math.min(height, available);
      element.style.left = rem(Math.max(leftEdge + gutter, Math.min(bounds.left, leftEdge + viewportWidth - width - gutter)));
      element.style.top = rem(up ? Math.max(topEdge + gutter, bounds.top - actualHeight - gap) : bounds.bottom + gap);
      element.dataset.side = up ? "top" : "bottom";
      element.style.visibility = "";
    }
    function handlePosition(event) { if (!element.contains(event?.target)) position(); }
    function close(restoreFocus) {
      if (closing) return;
      closing = true;
      if (currentPopover?.element === element) currentPopover = null;
      trigger.setAttribute("aria-expanded", "false");
      trigger.removeAttribute("aria-activedescendant");
      owner.classList.remove("is-open");
      element.classList.remove("is-open");
      element.style.pointerEvents = "none";
      window.removeEventListener("resize", handlePosition);
      window.removeEventListener("scroll", handlePosition, true);
      window.visualViewport?.removeEventListener("resize", handlePosition);
      window.visualViewport?.removeEventListener("scroll", handlePosition);
      setTimeout(() => { if (typeof element.hidePopover === "function" && element.hasAttribute("popover")) element.hidePopover(); element.remove(); }, duration());
      if (restoreFocus && visible(trigger)) trigger.focus({ preventScroll: true });
    }
    currentPopover = { element, trigger, owner, close, position };
    trigger.setAttribute("aria-expanded", "true");
    owner.classList.add("is-open");
    position();
    requestAnimationFrame(() => { if (!closing) element.classList.add("is-open"); });
    window.addEventListener("resize", handlePosition, { passive: true });
    window.addEventListener("scroll", handlePosition, { passive: true, capture: true });
    window.visualViewport?.addEventListener("resize", handlePosition, { passive: true });
    window.visualViewport?.addEventListener("scroll", handlePosition, { passive: true });
    return { close, position };
  }

  function enhanceSelect(field) {
    if (field.multiple || field.size > 1 || widgets.has(field)) return;
    const wrapper = document.createElement("span");
    wrapper.className = "ui-control ui-select";
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "ui-select-trigger";
    trigger.setAttribute("role", "combobox");
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    const value = document.createElement("span");
    value.className = "ui-select-value";
    trigger.append(value);
    trigger.insertAdjacentHTML("beforeend", chevron);
    makeSource(field, wrapper);
    wrapper.append(trigger);
    let menu = null;
    let activeIndex = -1;
    let options = [];
    let typeahead = "";
    let typeTimer;
    const hookedOptions = new WeakSet();

    function sync() {
      value.textContent = field.selectedOptions[0]?.textContent || field.getAttribute("data-placeholder") || "请选择";
      trigger.disabled = field.disabled;
      trigger.setAttribute("aria-label", `${accessibleName(field)}：${value.textContent}`);
      trigger.setAttribute("aria-required", String(field.required));
      if (field.getAttribute("aria-describedby")) trigger.setAttribute("aria-describedby", field.getAttribute("aria-describedby"));
      wrapper.classList.toggle("is-disabled", field.disabled);
      for (const option of field.options) {
        if (!hookedOptions.has(option)) { hookProperty(option, "selected", sync); hookedOptions.add(option); }
      }
      if (menu?.isConnected && currentPopover?.owner === wrapper) renderOptions();
      if (field.disabled && currentPopover?.owner === wrapper) closePopover();
    }

    function setActive(index, scroll = true) {
      activeIndex = index;
      for (const row of menu?.querySelectorAll("[role='option']") || []) row.classList.toggle("is-highlighted", Number(row.dataset.index) === index);
      const active = menu?.querySelector(`[data-index="${index}"]`);
      if (active) { trigger.setAttribute("aria-activedescendant", active.id); if (scroll) active.scrollIntoView({ block: "nearest" }); }
    }

    function renderOptions() {
      if (!menu) return;
      menu.replaceChildren();
      options = Array.from(field.options);
      if (!options[activeIndex]) activeIndex = field.selectedIndex;
      let lastGroup = null;
      options.forEach((option, index) => {
        if (option.hidden) return;
        const group = option.parentElement.tagName === "OPTGROUP" ? option.parentElement : null;
        if (group && group !== lastGroup) { const title = document.createElement("div"); title.className = "ui-select-group"; title.textContent = group.label; menu.append(title); }
        lastGroup = group;
        const row = document.createElement("div");
        row.className = "ui-select-option";
        row.id = `${menu.id}-${index}`;
        row.setAttribute("role", "option");
        row.setAttribute("aria-selected", String(option.selected));
        row.setAttribute("aria-disabled", String(option.disabled || Boolean(group?.disabled)));
        row.dataset.index = index;
        row.textContent = option.textContent;
        row.addEventListener("pointermove", () => { if (row.getAttribute("aria-disabled") !== "true") setActive(index, false); });
        row.addEventListener("pointerdown", event => event.preventDefault());
        row.addEventListener("click", () => choose(index));
        menu.append(row);
      });
      if (!options.length) { const empty = document.createElement("p"); empty.className = "ui-select-empty"; empty.textContent = "暂无选项"; menu.append(empty); }
      setActive(activeIndex < 0 ? field.selectedIndex : activeIndex, false);
    }

    function eligible(index) { const option = field.options[index]; return option && !option.disabled && !option.hidden && !option.parentElement.disabled; }
    function move(direction) {
      const length = field.options.length;
      for (let offset = 1; offset <= length; offset++) { const index = (activeIndex + direction * offset + length * 2) % length; if (eligible(index)) { setActive(index); return; } }
    }
    function choose(index) {
      if (!eligible(index)) return;
      const changed = field.selectedIndex !== index;
      field.selectedIndex = index;
      closePopover({ restoreFocus: true });
      sync();
      if (changed) emit(field);
    }
    function open() {
      if (field.disabled) return;
      sync();
      activeIndex = field.selectedIndex;
      menu = document.createElement("div");
      menu.id = uid("listbox");
      menu.className = "ui-select-menu";
      menu.setAttribute("role", "listbox");
      menu.setAttribute("aria-label", accessibleName(field));
      trigger.setAttribute("aria-controls", menu.id);
      renderOptions();
      createPopover(wrapper, trigger, menu);
      requestAnimationFrame(() => setActive(activeIndex));
    }
    trigger.addEventListener("click", () => currentPopover?.owner === wrapper ? closePopover() : open());
    trigger.addEventListener("keydown", event => {
      const isOpen = currentPopover?.owner === wrapper;
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        if (!isOpen) open();
        if (event.key === "ArrowDown") move(1);
        if (event.key === "ArrowUp") move(-1);
        if (event.key === "Home") { activeIndex = -1; move(1); }
        if (event.key === "End") { activeIndex = field.options.length; move(-1); }
      } else if ((event.key === "Enter" || event.key === " ") && isOpen) { event.preventDefault(); choose(activeIndex); }
      else if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey && event.key !== " ") {
        event.preventDefault();
        if (!isOpen) open();
        clearTimeout(typeTimer);
        typeahead += event.key.toLocaleLowerCase();
        const index = Array.from(field.options).findIndex((option, i) => eligible(i) && option.textContent.trim().toLocaleLowerCase().startsWith(typeahead));
        if (index >= 0) setActive(index);
        typeTimer = setTimeout(() => { typeahead = ""; }, 700);
      }
    });
    field.addEventListener("change", sync);
    const widget = { field, wrapper, trigger, sync, open };
    widgets.set(field, widget);
    liveWidgets.add(widget);
    ["value", "selectedIndex", "disabled"].forEach(property => hookProperty(field, property, sync));
    sync();
  }

  function enhanceNumber(field) {
    if (widgets.has(field)) return;
    const fieldName = accessibleName(field);
    if (!field.hasAttribute("aria-label") && !field.hasAttribute("aria-labelledby")) field.setAttribute("aria-label", fieldName);
    const wrapper = document.createElement("span");
    wrapper.className = "ui-control ui-number";
    field.parentNode.insertBefore(wrapper, field);
    wrapper.append(field);
    function stepButton(direction, label) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ui-number-step";
      button.setAttribute("aria-label", `${label}${fieldName}`);
      button.textContent = direction < 0 ? "−" : "+";
      button.addEventListener("click", () => {
        try { direction < 0 ? field.stepDown() : field.stepUp(); } catch { return; }
        emit(field);
        sync();
      });
      return button;
    }
    const minus = stepButton(-1, "减少");
    const plus = stepButton(1, "增加");
    wrapper.prepend(minus);
    wrapper.append(plus);
    function sync() {
      minus.disabled = field.disabled || field.readOnly || field.value !== "" && field.min !== "" && Number(field.value) <= Number(field.min);
      plus.disabled = field.disabled || field.readOnly || field.value !== "" && field.max !== "" && Number(field.value) >= Number(field.max);
      wrapper.classList.toggle("is-disabled", field.disabled);
    }
    const widget = { field, wrapper, trigger: field, sync };
    widgets.set(field, widget);
    liveWidgets.add(widget);
    ["value", "disabled", "readOnly", "min", "max"].forEach(property => hookProperty(field, property, sync));
    field.addEventListener("input", sync);
    sync();
  }

  function enhanceDate(field) {
    if (widgets.has(field)) return;
    const withTime = field.type !== "date";
    const onlyTime = field.type === "time";
    const wrapper = document.createElement("span");
    wrapper.className = "ui-control ui-datetime";
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "ui-datetime-trigger";
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-expanded", "false");
    makeSource(field, wrapper);
    wrapper.append(trigger);
    let calendar;
    let chosen;
    let shownMonth;
    let hour;
    let minute;
    let error;
    const pad = number => String(number).padStart(2, "0");
    const dateString = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    function sync() {
      const date = field.value ? new Date(onlyTime ? `2000-01-01T${field.value}` : field.value) : null;
      trigger.textContent = date && !Number.isNaN(date.valueOf()) ? onlyTime ? `${pad(date.getHours())}:${pad(date.getMinutes())}` : `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日${withTime ? `  ${pad(date.getHours())}:${pad(date.getMinutes())}` : ""}` : onlyTime ? "选择时间" : withTime ? "选择日期与时间" : "选择日期";
      trigger.insertAdjacentHTML("beforeend", chevron);
      trigger.setAttribute("aria-label", `${accessibleName(field)}：${trigger.textContent}`);
      trigger.disabled = field.disabled || field.readOnly;
      wrapper.classList.toggle("is-disabled", trigger.disabled);
    }
    function dayAvailable(date) {
      const value = dateString(date);
      return (!field.min || value >= field.min.slice(0, 10)) && (!field.max || value <= field.max.slice(0, 10));
    }
    function renderDays() {
      const title = calendar.querySelector(".ui-calendar-month");
      title.textContent = `${shownMonth.getFullYear()} 年 ${shownMonth.getMonth() + 1} 月`;
      const grid = calendar.querySelector(".ui-calendar-grid");
      grid.replaceChildren();
      const first = new Date(shownMonth.getFullYear(), shownMonth.getMonth(), 1);
      const today = dateString(new Date());
      const offset = (first.getDay() + 6) % 7;
      const total = new Date(shownMonth.getFullYear(), shownMonth.getMonth() + 1, 0).getDate();
      for (let index = 0; index < offset; index++) { const empty = document.createElement("span"); empty.setAttribute("aria-hidden", "true"); grid.append(empty); }
      for (let day = 1; day <= total; day++) {
        const date = new Date(shownMonth.getFullYear(), shownMonth.getMonth(), day);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "ui-calendar-day";
        button.textContent = day;
        button.setAttribute("aria-label", `${date.getFullYear()}年${date.getMonth() + 1}月${day}日`);
        button.setAttribute("aria-pressed", String(dateString(date) === dateString(chosen)));
        button.classList.toggle("is-today", dateString(date) === today);
        button.disabled = !dayAvailable(date);
        button.addEventListener("click", () => { chosen.setFullYear(date.getFullYear(), date.getMonth(), date.getDate()); renderDays(); });
        button.addEventListener("keydown", event => {
          const directions = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
          if (!(event.key in directions)) return;
          event.preventDefault();
          const next = new Date(date); next.setDate(next.getDate() + directions[event.key]);
          if (!dayAvailable(next)) return;
          chosen.setFullYear(next.getFullYear(), next.getMonth(), next.getDate());
          shownMonth = new Date(next.getFullYear(), next.getMonth(), 1);
          renderDays();
          calendar.querySelector('.ui-calendar-day[aria-pressed="true"]')?.focus();
        });
        grid.append(button);
      }
    }
    function open() {
      if (field.disabled || field.readOnly) return;
      chosen = field.value ? new Date(onlyTime ? `2000-01-01T${field.value}` : field.value) : new Date();
      if (Number.isNaN(chosen.valueOf())) chosen = new Date();
      shownMonth = new Date(chosen.getFullYear(), chosen.getMonth(), 1);
      calendar = document.createElement("section");
      calendar.id = uid("calendar");
      calendar.className = "ui-calendar";
      calendar.setAttribute("role", "dialog");
      calendar.setAttribute("aria-label", accessibleName(field));
      trigger.setAttribute("aria-controls", calendar.id);
      if (!onlyTime) {
        calendar.innerHTML = '<header class="ui-calendar-header"><button type="button" data-month="-1" aria-label="上个月">‹</button><strong class="ui-calendar-month" aria-live="polite"></strong><button type="button" data-month="1" aria-label="下个月">›</button></header><div class="ui-calendar-weekdays" aria-hidden="true"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div><div class="ui-calendar-grid"></div>';
        calendar.querySelectorAll("[data-month]").forEach(button => button.addEventListener("click", () => { shownMonth.setMonth(shownMonth.getMonth() + Number(button.dataset.month)); renderDays(); }));
        renderDays();
      }
      if (withTime) {
        const time = document.createElement("div");
        time.className = "ui-calendar-time";
        time.innerHTML = '<span>时间</span><label><span class="ui-visually-hidden">小时</span><input type="number" min="0" max="23" step="1" inputmode="numeric"></label><span>:</span><label><span class="ui-visually-hidden">分钟</span><input type="number" min="0" max="59" step="1" inputmode="numeric"></label>';
        [hour, minute] = time.querySelectorAll("input");
        hour.value = pad(chosen.getHours()); minute.value = pad(chosen.getMinutes());
        calendar.append(time);
      }
      error = document.createElement("p"); error.className = "ui-calendar-error"; error.setAttribute("role", "alert"); error.hidden = true; calendar.append(error);
      const footer = document.createElement("footer");
      footer.className = "ui-calendar-footer";
      footer.innerHTML = '<button type="button" class="ui-button-quiet">取消</button><button type="button" class="ui-button-primary">确定</button>';
      footer.firstElementChild.addEventListener("click", () => closePopover({ restoreFocus: true }));
      footer.lastElementChild.addEventListener("click", () => {
        if (withTime && (!hour.checkValidity() || !minute.checkValidity() || hour.value === "" || minute.value === "")) { error.textContent = "请输入有效的小时和分钟"; error.hidden = false; return; }
        const time = withTime ? `${pad(Number(hour.value))}:${pad(Number(minute.value))}` : "";
        const candidate = onlyTime ? time : `${dateString(chosen)}${withTime ? `T${time}` : ""}`;
        if (field.min && candidate < field.min || field.max && candidate > field.max) { error.textContent = "所选时间超出允许范围"; error.hidden = false; return; }
        field.value = candidate;
        emit(field); sync();
        closePopover({ restoreFocus: true });
      });
      calendar.append(footer);
      createPopover(wrapper, trigger, calendar, { width: 325, maxHeight: 550 });
      requestAnimationFrame(() => (calendar.querySelector('.ui-calendar-day[aria-pressed="true"]:not(:disabled)') || hour || footer.lastElementChild)?.focus());
    }
    trigger.addEventListener("click", () => currentPopover?.owner === wrapper ? closePopover() : open());
    field.addEventListener("input", sync);
    field.addEventListener("change", sync);
    const widget = { field, wrapper, trigger, sync, open };
    widgets.set(field, widget); liveWidgets.add(widget);
    ["value", "disabled", "readOnly"].forEach(property => hookProperty(field, property, sync));
    sync();
  }

  function refresh(root = document) {
    if (root.matches?.("select,input[type='number'],input[type='date'],input[type='datetime-local'],input[type='time']")) enhance(root);
    root.querySelectorAll?.("select,input[type='number'],input[type='date'],input[type='datetime-local'],input[type='time']").forEach(enhance);
    if (root.matches?.("details")) enhanceDisclosure(root);
    root.querySelectorAll?.("details").forEach(enhanceDisclosure);
    for (const widget of liveWidgets) { if (root === document || root === widget.field || root.contains?.(widget.field)) widget.sync(); }
  }
  function enhanceDisclosure(details) {
    if (disclosures.has(details)) return;
    disclosures.add(details);
    const summary = details.querySelector(":scope > summary");
    if (!summary) return;
    let animation;
    let expanded = details.open;
    const previousOverflow = details.style.overflow;
    summary.addEventListener("click", event => {
      if (event.target.closest("button,a,input,textarea,select")) return;
      event.preventDefault();
      const from = details.getBoundingClientRect().height;
      if (animation) { animation.cancel(); animation = null; }
      const opening = !expanded;
      expanded = opening;
      if (opening) details.open = true;
      const styles = getComputedStyle(details);
      const collapsed = summary.getBoundingClientRect().height + parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom) + parseFloat(styles.borderTopWidth) + parseFloat(styles.borderBottomWidth);
      const to = opening ? details.getBoundingClientRect().height : collapsed;
      if (!details.animate || reduceMotion.matches) { details.open = opening; details.style.overflow = previousOverflow; return; }
      details.style.overflow = "hidden";
      animation = details.animate([{ height: rem(from) }, { height: rem(to) }], { duration: 200, easing: "cubic-bezier(.2,.8,.2,1)" });
      animation.onfinish = () => { details.open = opening; details.style.overflow = previousOverflow; animation = null; };
    });
    details.addEventListener("toggle", () => { if (!animation) expanded = details.open; });
  }
  function enhance(field) {
    if (field.closest(".ui-calendar")) return;
    if (widgets.has(field)) return;
    if (field.tagName === "SELECT") enhanceSelect(field);
    else if (field.type === "number") enhanceNumber(field);
    else enhanceDate(field);
  }

  // Existing panels can use these helpers without changing their content or handlers.
  function dialogOpen(element, { focus = true, onEscape = null } = {}) {
    if (!element) return;
    const previousFocus = currentPopover?.element.contains(document.activeElement) ? currentPopover.trigger : document.activeElement;
    closePopover();
    const existing = dialogs.find(item => item.element === element);
    if (existing?.timer) {
      clearTimeout(existing.timer);
      existing.timer = null;
      existing.resolveClose?.();
      existing.resolveClose = null;
    }
    const record = existing || { element, previousFocus };
    record.onEscape = onEscape;
    if (existing) dialogs.splice(dialogs.indexOf(existing), 1);
    dialogs.push(record);
    const wasHidden = element.hidden;
    element.hidden = false;
    element.classList.add("ui-motion-surface");
    element.classList.remove("ui-is-closing");
    const content = element.matches("[role='dialog'],[role='alertdialog'],dialog") ? element : element.querySelector("[role='dialog'],[role='alertdialog']") || element;
    content.setAttribute("tabindex", "-1");
    trackSheetViewport(record);
    refresh(element);
    // Commit the off-screen starting position before the next paint. Reopening
    // a closing sheet instead reverses its current transition without a jump.
    if (wasHidden && isBottomSheet(element)) content.getBoundingClientRect();
    requestAnimationFrame(() => {
      if (element.hidden || element.classList.contains("ui-is-closing")) return;
      element.classList.add("ui-is-open");
      const top = dialogs.filter(item => !item.element.hidden).at(-1);
      if (focus && top?.element === element) {
        const keyboard = document.documentElement.dataset.inputModality === "keyboard";
        const target = isBottomSheet(element) && !keyboard ? content : Array.from(content.querySelectorAll(focusable)).find(visible) || content;
        target.focus({ preventScroll: true });
      }
    });
  }

  function dialogClose(element, { restoreFocus = true } = {}) {
    if (!element || element.hidden) return Promise.resolve();
    const record = dialogs.find(item => item.element === element);
    if (element.classList.contains("ui-is-closing")) return record?.closing || Promise.resolve();
    // A background panel must not dismiss a menu owned by another dialog.
    if (currentPopover && element.contains(currentPopover.trigger)) closePopover();
    element.classList.remove("ui-is-open"); element.classList.add("ui-is-closing");
    const closing = new Promise(resolve => {
      if (record) record.resolveClose = resolve;
      const timer = setTimeout(() => {
        element.hidden = true;
        element.classList.remove("ui-is-closing");
        record?.stopViewport?.();
        if (record) { record.timer = null; record.resolveClose = null; }
        const index = dialogs.findIndex(item => item.element === element);
        if (index >= 0) dialogs.splice(index, 1);
        const nextModal = dialogs.filter(item => !item.element.hidden && !item.element.classList.contains("ui-is-closing")).at(-1);
        if (restoreFocus && visible(record?.previousFocus) && (!nextModal || nextModal.element.contains(record.previousFocus))) record.previousFocus.focus({ preventScroll: true });
        resolve();
      }, dialogDuration(element));
      if (record) record.timer = timer;
    });
    if (record) record.closing = closing;
    return closing;
  }

  function messageDialog(options, isAlert) {
    const config = typeof options === "string" ? { message: options } : options || {};
    return new Promise(resolve => {
      const overlay = document.createElement("div");
      overlay.className = "ui-message-overlay"; overlay.hidden = true;
      const panel = document.createElement("section");
      panel.className = "ui-message-dialog";
      panel.setAttribute("role", "alertdialog"); panel.setAttribute("aria-modal", "true");
      const heading = document.createElement("h2"); heading.id = uid("heading"); heading.textContent = config.title || (isAlert ? "提示" : "确认操作");
      const message = document.createElement("p"); message.id = uid("message"); message.textContent = config.message || "";
      panel.setAttribute("aria-labelledby", heading.id); panel.setAttribute("aria-describedby", message.id);
      panel.append(heading, message);
      const actions = document.createElement("div"); actions.className = "ui-message-actions";
      const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "ui-button-quiet"; cancel.textContent = config.cancelLabel || config.cancelText || "取消";
      const confirm = document.createElement("button"); confirm.type = "button"; confirm.className = config.danger ? "ui-button-danger" : "ui-button-primary"; confirm.textContent = config.confirmLabel || config.confirmText || "确定";
      let settled = false;
      async function finish(value) { if (settled) return; settled = true; await dialogClose(overlay); overlay.remove(); resolve(value); }
      if (!isAlert) { actions.append(cancel); cancel.addEventListener("click", () => finish(false)); }
      actions.append(confirm); confirm.addEventListener("click", () => finish(true)); panel.append(actions); overlay.append(panel); (document.fullscreenElement || document.body).append(overlay);
      overlay.addEventListener("click", event => { if (event.target === overlay) finish(Boolean(isAlert)); });
      overlay.addEventListener("keydown", event => { if (event.key === "Escape") { event.stopPropagation(); finish(Boolean(isAlert)); } });
      dialogOpen(overlay, { focus: false, onEscape: () => finish(Boolean(isAlert)) });
      requestAnimationFrame(() => (isAlert ? confirm : cancel).focus());
    });
  }
  function queueMessage(options, alert) {
    const result = messageQueue.then(() => messageDialog(options, alert));
    messageQueue = result.catch(() => {});
    return result;
  }

  document.addEventListener("pointerdown", event => {
    if (currentPopover && !currentPopover.element.contains(event.target) && !currentPopover.owner.contains(event.target)) closePopover();
  }, true);
  document.addEventListener("keydown", event => {
    if (currentPopover && event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); closePopover({ restoreFocus: true }); return; }
    if (currentPopover && event.key === "Tab" && !currentPopover.element.classList.contains("ui-calendar")) closePopover();
    const frontDialog = dialogs.filter(item => !item.element.hidden).at(-1);
    // Keep a dismissing top surface from leaking the same keystroke to its parent.
    if ((event.key === "Escape" || event.key === "Tab") && frontDialog?.element.classList.contains("ui-is-closing")) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    const modal = dialogs.filter(item => !item.element.hidden && !item.element.classList.contains("ui-is-closing")).at(-1);
    if (event.key === "Escape" && modal?.onEscape) { event.preventDefault(); event.stopImmediatePropagation(); modal.onEscape(); return; }
    const datePopover = currentPopover?.element.classList.contains("ui-calendar") ? currentPopover : null;
    if (event.key !== "Tab" || !modal && !datePopover) return;
    const scope = datePopover?.element || modal.element;
    const elements = Array.from(scope.querySelectorAll(focusable)).filter(visible);
    if (!elements.length) { event.preventDefault(); scope.focus(); return; }
    const first = elements[0]; const last = elements.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === scope || !scope.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || !scope.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
  }, true);
  document.addEventListener("click", event => {
    const label = event.target.closest("label");
    if (!label || event.target.closest("button,input,.ui-control")) return;
    const field = widgets.has(label.control) ? label.control : label.querySelector(".ui-number input[type='number']") || label.control;
    const widget = widgets.get(field);
    if (widget?.open) { event.preventDefault(); widget.trigger.focus(); widget.open(); }
    else if (widget?.field.type === "number") { event.preventDefault(); widget.field.focus(); }
  });
  document.addEventListener("reset", event => setTimeout(() => refresh(event.target), 0));
  window.addEventListener("summer-politics:tabchange", () => closePopover());
  document.addEventListener("fullscreenchange", () => closePopover());

  window.AppUI = { refresh, confirm: options => queueMessage(options, false), alert: options => queueMessage(options, true), dialogOpen, dialogClose, closePopover };

  function start() {
    refresh();
    const observer = new MutationObserver(records => {
      const dirtyFields = new Set();
      for (const record of records) {
        const target = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
        const field = target?.matches?.("select,input") ? target : target?.closest("select");
        if (field) dirtyFields.add(field);
        for (const added of record.addedNodes || []) if (added.nodeType === Node.ELEMENT_NODE && !added.closest(".ui-popover,.ui-control")) refresh(added);
      }
      dirtyFields.forEach(field => widgets.get(field)?.sync());
      for (const widget of liveWidgets) if (!widget.field.isConnected) { if (currentPopover?.owner === widget.wrapper) closePopover(); liveWidgets.delete(widget); }
      if (currentPopover && !visible(currentPopover.trigger)) closePopover();
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["disabled", "readonly", "selected", "label", "value", "required", "min", "max", "hidden"] });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true }); else start();
})();
