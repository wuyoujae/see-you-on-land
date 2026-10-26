/* Rich study content. Raw HTML is deliberately never accepted.
 * Load assets/vendor/katex/katex.min.js before this file for immediate math.
 * render() returns safe HTML; hydrate(host) upgrades pending math and image links.
 *   host.innerHTML = RichContent.render(q.stemBlocks || q.stem);
 *   RichContent.hydrate(host);
 * The only HTML inserted is this renderer's escaped output and KaTeX's trusted
 * implementation with trust:false; do not concatenate unescaped HTML around it.
 * Options: inline (string wrapper only), dollarMath (default true), imageZoom
 * (default true), tableCaption (fallback caption). Lists also accept ordered:true;
 * tables accept caption; list items/table cells may themselves be block arrays.
 * hydrate() returns {rendered,pending,errors,images}; calling it again is safe.
 */
(function (scope, factory) {
  const api = factory(scope);
  if (typeof module === "object" && module.exports) module.exports = api;
  else scope.RichContent = api;
})(typeof window !== "undefined" ? window : globalThis, function (scope) {
  "use strict";

  const MAX_DEPTH = 12;
  const MAX_FORMULA_LENGTH = 12000;
  const boundRoots = new WeakSet();
  const boundImages = new WeakSet();
  const viewers = new WeakMap();
  const text = value => typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
  const escapeHTML = value => text(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);

  function safeImageURL(value) {
    const source = text(value).trim();
    // Backslashes and controls can change how a browser interprets a URL scheme.
    if (!source || /[\u0000-\u001f\u007f-\u009f\\]/.test(source) || source.startsWith("//")) return "";
    if (/^data:/i.test(source)) {
      return /^data:image\/(?:png|jpe?g|gif|webp|avif);base64,[A-Za-z0-9+/]+={0,2}$/i.test(source) ? source : "";
    }
    try {
      const parsed = new URL(source, "https://rich-content.invalid/");
      if (parsed.protocol === "http:" || parsed.protocol === "https:") return source;
      if (parsed.protocol === "blob:" && /^blob:(?:https?:\/\/|null\/)/i.test(source)) return source;
    } catch (_) { /* A bad source is shown as a missing image, never executed. */ }
    return "";
  }

  function mathOptions(display) {
    return {
      displayMode: display, output: "htmlAndMathml", throwOnError: true,
      trust: false, strict: "ignore", maxSize: 20, maxExpand: 1000,
      // Each expression owns its macros. A definition cannot affect another card.
      macros: Object.create(null)
    };
  }

  function mathResult(source, display) {
    if (!source.trim() || source.length > MAX_FORMULA_LENGTH ||
        /\\(?:href|url|includegraphics|html[A-Za-z]*)\b/.test(source)) {
      return { state: "error", html: "公式暂时无法显示" };
    }
    if (!scope.katex || typeof scope.katex.renderToString !== "function") {
      return { state: "pending", html: "公式正在加载…" };
    }
    try {
      return { state: "rendered", html: scope.katex.renderToString(source, mathOptions(display)) };
    } catch (_) {
      // KaTeX error strings contain source text: do not insert them in HTML.
      return { state: "error", html: "公式暂时无法显示" };
    }
  }

  function mathHTML(value, display, invalid) {
    const source = text(value);
    const result = invalid ? {state: "error", html: "公式暂时无法显示"} : mathResult(source, display);
    const mode = display ? "display" : "inline";
    const label = result.state === "error" ? ' role="img" aria-label="公式暂时无法显示"' : "";
    return '<span class="rich-content__math rich-content__math--' + mode + (display ? '" tabindex="0' : '') +
      '" data-rich-math="' + escapeHTML(source) + '" data-rich-display="' + display +
      '" data-rich-math-state="' + result.state + '"' + (invalid ? ' data-rich-invalid="true"' : '') + label + ">" + result.html + "</span>";
  }

  function escapedAt(source, index) {
    let backslashes = 0;
    while (index > 0 && source[--index] === "\\") backslashes++;
    return backslashes % 2 === 1;
  }

  function closingDelimiter(source, start, delimiter, dollar) {
    let at = source.indexOf(delimiter, start);
    while (at !== -1) {
      if (!escapedAt(source, at) && (!dollar ||
          (!/\s/.test(source[at - 1] || " ") && !/\d/.test(source[at + 1] || "") && source[at + 1] !== "$"))) return at;
      at = source.indexOf(delimiter, at + delimiter.length);
    }
    return -1;
  }

  function inlineHTML(value, options, depth) {
    const source = text(value).replace(/\r\n?/g, "\n");
    if (depth > MAX_DEPTH) return escapeHTML(source).replace(/\n/g, "<br>");
    let result = "", plain = "", at = 0;
    const flush = () => { result += escapeHTML(plain); plain = ""; };
    while (at < source.length) {
      const rest = source.slice(at);
      if (source[at] === "\n") { flush(); result += "<br>"; at++; continue; }
      if (source[at] === "`" && !escapedAt(source, at)) {
        const end = source.indexOf("`", at + 1);
        if (end > at + 1) {
          flush(); result += "<code>" + escapeHTML(source.slice(at + 1, end)) + "</code>";
          at = end + 1; continue;
        }
      }
      let opener = "", closer = "", display = false;
      if (!escapedAt(source, at)) {
        if (rest.startsWith("\\[")) { opener = "\\["; closer = "\\]"; display = true; }
        else if (rest.startsWith("\\(")) { opener = "\\("; closer = "\\)"; }
        else if (options.dollarMath !== false && rest.startsWith("$$")) { opener = closer = "$$"; display = true; }
        else if (options.dollarMath !== false && rest[0] === "$" && !/\s|\$/.test(rest[1] || " ")) opener = closer = "$";
      }
      if (opener) {
        const end = closingDelimiter(source, at + opener.length, closer, opener === "$");
        if (end !== -1) {
          flush(); result += mathHTML(source.slice(at + opener.length, end), display);
          at = end + closer.length; continue;
        }
        if (opener !== "$") {
          // An unfinished explicit math block is an error, not visible TeX code.
          flush(); result += mathHTML(source.slice(at + opener.length), display, true);
          at = source.length; continue;
        }
      }
      const marker = rest.startsWith("**") ? "**" : rest.startsWith("__") ? "__" :
        rest[0] === "*" ? "*" : rest[0] === "_" ? "_" : "";
      const inWord = marker.includes("_") && /[\p{L}\p{N}]/u.test(source[at - 1] || "");
      if (marker && !inWord && !escapedAt(source, at) && !/\s/.test(source[at + marker.length] || " ")) {
        const end = closingDelimiter(source, at + marker.length, marker, false);
        if (end > at + marker.length && !/\s/.test(source[end - 1])) {
          flush();
          const tag = marker.length === 2 ? "strong" : "em";
          result += "<" + tag + ">" + inlineHTML(source.slice(at + marker.length, end), options, depth + 1) + "</" + tag + ">";
          at = end + marker.length; continue;
        }
      }
      if (source[at] === "\\" && /[\\`*_\$]/.test(source[at + 1] || "")) {
        plain += source[at + 1]; at += 2; continue;
      }
      plain += source[at++];
    }
    flush();
    return result;
  }

  function imageHTML(block, options) {
    const source = safeImageURL(block.src);
    const alt = text(block.alt).trim() || "题目配图";
    const inline = block.inline === true;
    if (inline) {
      const note = block.caption ? '<span class="rich-content__sr-only">' + escapeHTML(block.caption) + "</span>" : "";
      if (!source) return '<span class="rich-content__inline-image"><span class="rich-content__image-error" role="img" aria-label="' +
        escapeHTML(alt + "（图片地址不可用）") + '">图片暂时无法显示</span>' + note + "</span>";
      const image = '<img class="rich-content__image rich-content__image--inline" src="' + escapeHTML(source) + '" alt="' + escapeHTML(alt) + '" loading="lazy" decoding="async">';
      const link = options.imageZoom === false ? image : '<a class="rich-content__image-link rich-content__image-link--inline" data-rich-image href="' + escapeHTML(source) +
        '" target="_blank" rel="noopener noreferrer" aria-label="' + escapeHTML("查看大图：" + alt) + '">' + image + "</a>";
      return '<span class="rich-content__inline-image">' + link + note + "</span>";
    }
    const caption = block.caption ? '<figcaption>' + inlineHTML(block.caption, options, 0) + "</figcaption>" : "";
    if (!source) return '<figure class="rich-content__figure"><span class="rich-content__image-error" role="img" aria-label="' +
      escapeHTML(alt + "（图片地址不可用）") + '">图片暂时无法显示</span>' + caption + "</figure>";
    const image = '<img class="rich-content__image" src="' + escapeHTML(source) + '" alt="' + escapeHTML(alt) +
      '" loading="lazy" decoding="async">';
    const link = options.imageZoom === false ? image : '<a class="rich-content__image-link" data-rich-image href="' + escapeHTML(source) +
      '" target="_blank" rel="noopener noreferrer" aria-label="' + escapeHTML("查看大图：" + alt) + '">' + image + "</a>";
    return '<figure class="rich-content__figure">' + link + caption + "</figure>";
  }

  function bodyHTML(value, options, depth) {
    if (depth > MAX_DEPTH) return "";
    if (value && typeof value === "object" && !Array.isArray(value)) return blockHTML(value, options, depth + 1);
    if (!Array.isArray(value)) return inlineHTML(value, options, 0);
    return value.map(block => blockHTML(block, options, depth + 1)).join("");
  }

  function partsHTML(parts, options, depth) {
    if (depth > MAX_DEPTH) return "";
    return parts.map(part => {
      if (typeof part === "string" || typeof part === "number") return inlineHTML(part, options, 0);
      if (!part || typeof part !== "object") return "";
      if (part.type === "text") {
        const rendered = inlineHTML(part.text, options, 0);
        return part.underline === true ? '<span class="rich-content__underline">' + rendered + "</span>" : rendered;
      }
      if (part.type === "formula") return mathHTML(part.latex, part.display === true);
      return blockHTML(part, options, depth + 1);
    }).join("");
  }

  function tableHTML(block, options, depth) {
    const headers = Array.isArray(block.headers) ? block.headers : [];
    const rows = Array.isArray(block.rows) ? block.rows.filter(Array.isArray) : [];
    const columns = rows.reduce((count, row) => Math.max(count, row.length), headers.length);
    if (!columns) return "";
    const caption = text(block.caption || options.tableCaption).trim();
    const head = headers.length ? "<thead><tr>" + Array.from({length: columns}, (_, i) =>
      '<th scope="col">' + bodyHTML(headers[i], options, depth + 1) + "</th>").join("") + "</tr></thead>" : "";
    const body = rows.map(row => "<tr>" + Array.from({length: columns}, (_, i) =>
      "<td>" + bodyHTML(row[i], options, depth + 1) + "</td>").join("") + "</tr>").join("");
    return '<div class="rich-content__table-scroll" tabindex="0" role="region" aria-label="' + escapeHTML(caption || "数据表，可横向滚动") +
      '"><table class="rich-content__table"><caption' + (caption ? "" : ' class="rich-content__sr-only"') + ">" +
      escapeHTML(caption || "数据表") + "</caption>" + head + "<tbody>" + body + "</tbody></table></div>";
  }

  function blockHTML(block, options, depth) {
    if (typeof block === "string" || typeof block === "number") return '<div class="rich-content__paragraph">' + inlineHTML(block, options, 0) + "</div>";
    if (!block || typeof block !== "object") return "";
    switch (block.type) {
      case "text": return inlineHTML(block.text, options, 0);
      case "paragraph": return '<div class="rich-content__paragraph">' + (Array.isArray(block.parts) ? partsHTML(block.parts, options, depth + 1) : inlineHTML(block.text, options, 0)) + "</div>";
      case "heading": {
        const level = Number.isInteger(block.level) ? Math.min(6, Math.max(1, block.level)) : 3;
        return '<h' + level + ' class="rich-content__heading">' + inlineHTML(block.text, options, 0) + "</h" + level + ">";
      }
      case "list": {
        const tag = block.ordered === true ? "ol" : "ul";
        return '<' + tag + ' class="rich-content__list">' + (Array.isArray(block.items) ? block.items : []).map(item =>
          "<li>" + bodyHTML(item, options, depth + 1) + "</li>").join("") + "</" + tag + ">";
      }
      case "formula": return mathHTML(block.latex, block.display !== false);
      case "image": return imageHTML(block, options);
      case "table": return tableHTML(block, options, depth);
      default: return "";
    }
  }

  function render(value, options) {
    const settings = options && typeof options === "object" ? options : {};
    const inline = settings.inline === true && !Array.isArray(value);
    const tag = inline ? "span" : "div";
    return '<' + tag + ' class="rich-content' + (inline ? " rich-content--inline" : "") + '">' + bodyHTML(value, settings, 0) + "</" + tag + ">";
  }

  function elementsIn(root, selector) {
    const elements = root && typeof root.querySelectorAll === "function" ? Array.from(root.querySelectorAll(selector)) : [];
    if (root && typeof root.matches === "function" && root.matches(selector)) elements.unshift(root);
    return elements;
  }

  function showImage(link) {
    const doc = link.ownerDocument;
    if (!doc || !doc.body) return false;
    let viewer = viewers.get(doc);
    if (!viewer) {
      const dialog = doc.createElement("dialog");
      if (typeof dialog.showModal !== "function") return false; // The real link remains a no-JS/older-browser fallback.
      dialog.className = "rich-content__viewer";
      dialog.setAttribute("aria-label", "查看题目原图");
      const toolbar = doc.createElement("div");
      toolbar.className = "rich-content__viewer-toolbar";
      const original = doc.createElement("a");
      original.textContent = "打开原图";
      original.target = "_blank"; original.rel = "noopener noreferrer";
      const close = doc.createElement("button");
      close.type = "button"; close.textContent = "关闭";
      close.setAttribute("aria-label", "关闭大图");
      const image = doc.createElement("img");
      image.className = "rich-content__viewer-image";
      const caption = doc.createElement("p");
      caption.className = "rich-content__viewer-caption";
      toolbar.append(original, close);
      dialog.append(toolbar, image, caption); doc.body.append(dialog);
      viewer = {dialog, original, image, caption, opener: null};
      close.addEventListener("click", () => dialog.close());
      dialog.addEventListener("click", event => { if (event.target === dialog) {
        const rect = dialog.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
      } });
      dialog.addEventListener("close", () => {
        image.removeAttribute("src");
        if (viewer.opener && viewer.opener.isConnected) viewer.opener.focus({preventScroll: true});
      });
      viewers.set(doc, viewer);
    }
    const source = safeImageURL(link.getAttribute("href"));
    if (!source) return false;
    const sourceImage = link.querySelector("img");
    viewer.image.src = source; viewer.image.alt = link.getAttribute("data-rich-alt") || sourceImage?.alt || "题目配图";
    viewer.original.href = source;
    viewer.caption.textContent = viewer.image.alt;
    viewer.opener = link;
    if (!viewer.dialog.open) viewer.dialog.showModal();
    return true;
  }

  function hydrate(root) {
    const host = root || scope.document;
    const result = {rendered: 0, pending: 0, errors: 0, images: 0};
    if (!host) return result;
    elementsIn(host, "[data-rich-math]").forEach(node => {
      if (node.getAttribute("data-rich-math-state") === "rendered") return;
      const source = node.getAttribute("data-rich-math") || "";
      const math = node.getAttribute("data-rich-invalid") === "true" ? {state: "error", html: "公式暂时无法显示"} :
        mathResult(source, node.getAttribute("data-rich-display") === "true");
      // Only escaped fixed messages or KaTeX's trust:false output reach innerHTML.
      node.innerHTML = math.html;
      node.setAttribute("data-rich-math-state", math.state);
      if (math.state === "error") {
        node.setAttribute("role", "img"); node.setAttribute("aria-label", "公式暂时无法显示");
      } else {
        node.removeAttribute("role"); node.removeAttribute("aria-label");
      }
      result[math.state === "error" ? "errors" : math.state]++;
    });
    elementsIn(host, ".rich-content__image").forEach(image => {
      result.images++;
      if (boundImages.has(image)) return;
      boundImages.add(image);
      image.addEventListener("error", () => {
        image.classList.add("is-unavailable");
        image.setAttribute("aria-label", (image.alt || "题目配图") + "（图片暂时无法显示）");
      });
      image.addEventListener("load", () => {
        image.classList.remove("is-unavailable"); image.removeAttribute("aria-label");
      });
    });
    if (typeof host.addEventListener === "function" && !boundRoots.has(host)) {
      boundRoots.add(host);
      host.addEventListener("click", event => {
        const link = event.target?.closest?.("a[data-rich-image]");
        if (!link || (host.contains && !host.contains(link))) return;
        // Viewing a diagram should not select the surrounding answer option.
        event.stopPropagation();
        if (!safeImageURL(link.getAttribute("href"))) { event.preventDefault(); return; }
        if (event.defaultPrevented || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (showImage(link)) event.preventDefault();
      }, true);
    }
    return result;
  }

  return Object.freeze({render, hydrate, escapeHTML, safeImageURL, version: "1.0.0", katexVersion: "0.19.1"});
});
