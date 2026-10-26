/* Responsive navigation state is separate from the existing tab and fullscreen features. */
(() => {
  "use strict";

  const storageKey = "summer-politics-sidebar-collapsed-v1";
  const app = document.getElementById("app");
  const toggle = document.getElementById("sidebar-toggle");
  if (!app || !toggle) return;

  let collapsed = false;
  try {
    collapsed = localStorage.getItem(storageKey) === "true";
  } catch {
    // Navigation remains usable when browser storage is unavailable.
  }

  function render() {
    app.classList.toggle("sidebar-collapsed", collapsed);
    const label = collapsed ? "展开导航栏" : "收起导航栏";
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-label", label);
    toggle.title = label;
    toggle.innerHTML = `<i data-lucide="${collapsed ? "panel-left-open" : "panel-left-close"}" aria-hidden="true"></i>`;
    window.lucide?.createIcons();
  }

  toggle.addEventListener("click", () => {
    collapsed = !collapsed;
    render();
    try {
      localStorage.setItem(storageKey, String(collapsed));
    } catch {
      // The current session can still expand and collapse the sidebar.
    }
  });

  render();
})();
