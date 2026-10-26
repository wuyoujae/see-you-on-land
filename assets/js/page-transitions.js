/* Explicit page navigation motion. Business updates always stay synchronous. */
(() => {
  "use strict";

  const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
  const running = new Map();
  const pageKeys = new WeakMap();
  let serial = 0;

  document.documentElement.classList.add("page-motion-ready");

  function visible(element) {
    return element?.isConnected && !element.closest("[hidden]") && element.getClientRects().length > 0;
  }

  function cancel(element) {
    for (const [surface, entry] of running) {
      if (element && surface !== element && !element.contains(surface)) continue;
      running.delete(surface);
      clearTimeout(entry.timer);
      entry.animation?.cancel();
      surface.classList.remove("page-transition-surface", "page-transition-fallback");
      surface.style.removeProperty("--page-motion-from");
    }
  }

  function restoreFocus(surface, options, origin) {
    if (options.focus === false || !visible(surface)) return;
    const active = document.activeElement;
    // A new interaction, input focus, or open modal always takes priority.
    if (active && active !== document.body && active !== origin) return;
    if (active?.matches("input,textarea,select,[contenteditable=true]")) return;
    const modal = Array.from(document.querySelectorAll("dialog[open], .ui-motion-surface:not([hidden]), [role=dialog][aria-modal=true]:not([hidden]), [role=alertdialog][aria-modal=true]:not([hidden])")).find(visible);
    if (modal && !modal.contains(surface)) return;
    const target = typeof options.focus === "string" ? surface.querySelector(options.focus)
      : options.focus instanceof Element ? options.focus
      : surface.querySelector("h1,h2,[data-page-heading]");
    if (!target || !visible(target)) return;
    if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  }

  function enter(surface, options = {}) {
    if (!(surface instanceof Element)) return;
    const key = options.key;
    if (key !== undefined && !options.force && pageKeys.get(surface) === key) return;
    if (key !== undefined) pageKeys.set(surface, key);
    // Navigation cancels the previous page, including a nested page still entering.
    for (const [other] of running) {
      if (!visible(other) || other === surface || other.contains(surface) || surface.contains(other)) cancel(other);
    }
    if (!visible(surface)) return;
    const origin = document.activeElement;
    const id = ++serial;
    const complete = () => {
      if (running.get(surface)?.id !== id) return;
      running.delete(surface);
      surface.classList.remove("page-transition-surface", "page-transition-fallback");
      surface.style.removeProperty("--page-motion-from");
      restoreFocus(surface, options, origin);
    };
    if (motionPreference.matches) { restoreFocus(surface, options, origin); return; }
    const style = getComputedStyle(document.documentElement);
    const duration = Number.parseFloat(style.getPropertyValue("--page-motion-duration")) || 260;
    const offset = style.getPropertyValue("--page-motion-offset").trim() || ".45rem";
    const from = options.direction === "previous" ? `translateX(calc(-1 * ${offset}))`
      : options.direction === "next" ? `translateX(${offset})` : `translateY(${offset})`;
    const entry = { id, animation: null, timer: 0 };
    running.set(surface, entry);
    surface.classList.add("page-transition-surface");
    if (typeof surface.animate === "function") {
      entry.animation = surface.animate([
        { opacity: .15, transform: from },
        { opacity: 1, transform: "none" }
      ], { duration, easing: "cubic-bezier(.2,.7,.2,1)" });
      entry.animation.finished.then(complete, () => {});
    } else {
      surface.style.setProperty("--page-motion-from", from);
      surface.classList.add("page-transition-fallback");
      entry.timer = setTimeout(complete, duration);
    }
  }

  const onPreferenceChange = event => { if (event.matches) cancel(); };
  if (motionPreference.addEventListener) motionPreference.addEventListener("change", onPreferenceChange);
  else motionPreference.addListener(onPreferenceChange);
  window.addEventListener("pagehide", () => cancel());
  document.addEventListener("visibilitychange", () => { if (document.hidden) cancel(); });
  window.PageTransitions = Object.freeze({ enter, cancel });
})();
