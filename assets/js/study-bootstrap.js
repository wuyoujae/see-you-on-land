// Apply a direct study route before the app shell paints or its data loads.
if (/^#\/(?:study(?:\/[a-zA-Z0-9_-]+){0,3}|learn(?:\/[a-zA-Z0-9_-]+){0,3})(?:\?[^#]*)?$/.test(location.hash)) {
  document.documentElement.classList.add("study-route-loading");
}
