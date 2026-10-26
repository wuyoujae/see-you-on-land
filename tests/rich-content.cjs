"use strict";
// Run with: node --test tests/rich-content.cjs (no npm dependencies).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const katex = require("../assets/vendor/katex/katex.min.js");
const RichContent = require("../assets/js/rich-content.js");

test("plain content is escaped, with line breaks and safe basic emphasis", () => {
  const html = RichContent.render('第一行\n**重点**与*提示*\n<img src=x onerror=alert(1)>');
  assert.match(html, /第一行<br><strong>重点<\/strong>与<em>提示<\/em><br>/);
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
  assert.doesNotMatch(html, /<img/);
  assert.match(RichContent.render("内联", {inline: true}), /^<span class="rich-content rich-content--inline">/);
  assert.doesNotMatch(RichContent.render({html: "<script>"}), /script/);
});

test("all block types accept mixed text, images and formula content without raw HTML", () => {
  global.katex = katex;
  const html = RichContent.render([
    {type: "heading", text: "**比例**", level: 1},
    {type: "paragraph", text: String.raw`比较 \(\frac{A}{B}\) 与 \(\frac{C}{D}\)。`},
    {type: "list", items: ["<第一项>", [{type: "formula", latex: "x^2", display: false}]]},
    {type: "formula", latex: String.raw`\frac{265^2}{230}\approx305.33`},
    {type: "image", src: "assets/source diagram.png", alt: '图形题 "A"', caption: "原题配图"},
    {type: "table", caption: "2025年数据", headers: ["年份", "收入"], rows: [[2025, String.raw`\(x\)`], [2026]]}
  ]);
  assert.match(html, /<h1 class="rich-content__heading"><strong>比例/);
  assert.match(html, /class="katex"/);
  assert.match(html, /<math xmlns=/);
  assert.doesNotMatch(html, /公式暂时无法显示|公式正在加载/);
  assert.match(html, /alt="图形题 &quot;A&quot;"/);
  assert.match(html, /src="assets\/source diagram.png"/);
  assert.match(html, /<figcaption>原题配图<\/figcaption>/);
  assert.match(html, /<caption>2025年数据<\/caption>/);
  assert.match(html, /<th scope="col">年份/);
  assert.match(html, /<tr><td>2026<\/td><td><\/td><\/tr>/);
});

test("all supported math delimiters render, currency and escaped delimiters stay text", () => {
  global.katex = katex;
  const html = RichContent.render(String.raw`\(a_1^2\)；\[\sqrt{x}\]；$x+y$；$$\sum_{i=1}^n i$$`);
  assert.equal((html.match(/data-rich-math-state="rendered"/g) || []).length, 4);
  assert.equal((html.match(/rich-content__math--display/g) || []).length, 2);
  assert.equal((RichContent.render(String.raw`\$5 and \$10; $5 and $10`).match(/data-rich-math=/g) || []).length, 0);
  assert.doesNotMatch(RichContent.render("$x$", {dollarMath: false}), /data-rich-math/);
  assert.doesNotMatch(RichContent.render('`$x$`'), /data-rich-math/);
  const strong = RichContent.render(String.raw`**结论 \(x>0\)**`);
  assert.match(strong, /<strong>结论 <span class="rich-content__math/);
});

test("paragraph parts keep text, formula images and text in one paragraph without duplicate fallback", () => {
  const html = RichContent.render([{type: "paragraph", text: "fallback should not repeat", parts: [
    {type: "text", text: "我们将"}, {type: "image", src: "assets/formula.png", alt: "分式", inline: true},
    {type: "text", text: "代回原式。", underline: true}, {type: "formula", latex: "x^2", display: false}
  ]}]);
  assert.equal((html.match(/rich-content__paragraph/g) || []).length, 1);
  assert.doesNotMatch(html, /<figure|<figcaption|fallback should not repeat/);
  assert.match(html, /我们将<span class="rich-content__inline-image">/);
  assert.match(html, /rich-content__image--inline/);
  assert.match(html, /data-rich-image/);
  assert.match(html, /代回原式。/);
  assert.match(html, /class="rich-content__underline">代回原式。<\/span>/);
  assert.match(html, /class="katex"/);
  const bad = RichContent.render([{type: "paragraph", parts: [{type: "image", src: "javascript:alert(1)", alt: '"><script>', inline: true}]}]);
  assert.doesNotMatch(bad, /<img|<script|<a /);
});

test("malformed or unsafe formulas display a neutral error, without visible LaTeX or injected HTML", () => {
  global.katex = katex;
  for (const latex of [String.raw`\frac{1}`, String.raw`\href{javascript:alert(1)}{点击}`, String.raw`\htmlClass{x}{a}`, "x".repeat(12001)]) {
    const html = RichContent.render([{type: "formula", latex}]);
    assert.match(html, /data-rich-math-state="error"/);
    assert.match(html, />公式暂时无法显示<\/span>/);
    assert.doesNotMatch(html, /<a |<script|class="katex-error"/);
  }
  const html = RichContent.render([{type: "formula", latex: '<img src=x onerror=alert(1)>'}]);
  assert.doesNotMatch(html, /<img/);
  assert.ok(!html.includes('data-rich-math="<'));
  assert.match(RichContent.render(String.raw`未闭合 \(\frac{1}{2}`), />公式暂时无法显示<\/span>/);
  // Macro definitions must not leak from one question into the next.
  RichContent.render([{type: "formula", latex: String.raw`\gdef\leaked{123}\leaked`}]);
  assert.match(RichContent.render([{type: "formula", latex: String.raw`\leaked`}]), /data-rich-math-state="error"/);
});

test("image URLs reject executable sources, preserve source images and escape every attribute", () => {
  for (const url of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "\tjavascript:alert(1)", "java\nscript:alert(1)", "vbscript:msgbox(1)", "data:text/html,<script>alert(1)</script>", "data:image/svg+xml;base64,PHN2Zz4=", "//evil.test/a.png", "\\\\evil.test\\a.png", "file:///c:/secret.png"]) {
    assert.equal(RichContent.safeImageURL(url), "", url);
    const html = RichContent.render([{type: "image", src: url, alt: "原图"}]);
    assert.doesNotMatch(html, /<img|<a /);
  }
  for (const url of ["assets/a.png", "../a.png", "/images/原题.png", "https://source.test/q.png", "blob:https://source.test/123", "data:image/png;base64,aGVsbG8="]) {
    assert.equal(RichContent.safeImageURL(url), url);
  }
  const html = RichContent.render([{type: "image", src: 'https://source.test/" onerror="alert(1)', alt: '"><script>alert(1)</script>'}]);
  assert.doesNotMatch(html, /<script| onerror="alert/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /&quot; onerror=&quot;/);
  assert.doesNotMatch(RichContent.render([{type: "image", src: "a.png", alt: "图"}], {imageZoom: false}), /<a /);
});

function fakeNode(attributes = {}) {
  const attrs = new Map(Object.entries(attributes));
  return {innerHTML: "", getAttribute: name => attrs.get(name) ?? null,
    setAttribute: (name, value) => attrs.set(name, String(value)), removeAttribute: name => attrs.delete(name)};
}

test("hydrate retries pending formulas and binds events only once", () => {
  delete global.katex;
  const pending = RichContent.render(String.raw`结果为 \(\frac{1}{2}\)。`);
  assert.match(pending, /data-rich-math-state="pending"/);
  assert.doesNotMatch(pending, />\\frac/);
  const math = fakeNode({"data-rich-math": String.raw`\frac{1}{2}`, "data-rich-display": "false", "data-rich-math-state": "pending"});
  const imageEvents = [], rootEvents = [];
  const image = {addEventListener: name => imageEvents.push(name)};
  const root = {querySelectorAll: selector => selector === "[data-rich-math]" ? [math] : [image], addEventListener: (name, _fn, capture) => rootEvents.push({name, capture})};
  assert.deepEqual(RichContent.hydrate(root), {rendered: 0, pending: 1, errors: 0, images: 1});
  global.katex = katex;
  assert.deepEqual(RichContent.hydrate(root), {rendered: 1, pending: 0, errors: 0, images: 1});
  assert.match(math.innerHTML, /class="katex"/);
  assert.equal(math.getAttribute("data-rich-math-state"), "rendered");
  assert.deepEqual(RichContent.hydrate(root), {rendered: 0, pending: 0, errors: 0, images: 1});
  assert.deepEqual(rootEvents, [{name: "click", capture: true}]);
  assert.deepEqual(imageEvents, ["error", "load"]);
});

test("math trust and resource limits cannot be supplied by content or render options", () => {
  let passed;
  global.katex = {renderToString: (_source, options) => { passed = options; return '<span class="katex">safe</span>'; }};
  RichContent.render([{type: "formula", latex: "x", trust: true}], {trust: true, maxExpand: Infinity, macros: {"\\x": "bad"}});
  assert.equal(passed.trust, false);
  assert.equal(passed.throwOnError, true);
  assert.equal(passed.maxExpand, 1000);
  assert.equal(passed.maxSize, 20);
  assert.equal(passed.output, "htmlAndMathml");
  assert.deepEqual(Object.keys(passed.macros), []);
  global.katex = katex;
});

test("image viewing intercepts option clicks, preserves alt/source, and returns focus on close", () => {
  const created = [];
  const document = {body: {append: node => created.push(node)}, createElement(tag) {
    const handlers = {};
    const node = {tagName: tag, children: [], attributes: {}, open: false,
      append(...children) { this.children.push(...children); },
      setAttribute(name, value) { this.attributes[name] = value; },
      removeAttribute(name) { delete this[name]; delete this.attributes[name]; },
      addEventListener(name, handler) { handlers[name] = handler; }, handlers};
    if (tag === "dialog") {
      node.showModal = () => { node.open = true; };
      node.close = () => { node.open = false; handlers.close(); };
    }
    return node;
  }};
  let focused = false, clickHandler;
  const link = {ownerDocument: document, isConnected: true,
    getAttribute: name => name === "href" ? "assets/原题.png" : null,
    querySelector: () => ({alt: "四个图形的选项"}), focus: () => { focused = true; }};
  const root = {querySelectorAll: () => [], contains: node => node === link,
    addEventListener: (_name, handler) => { clickHandler = handler; }};
  RichContent.hydrate(root);
  const event = {target: {closest: () => link}, button: 0, defaultPrevented: false,
    stopPropagation() { this.stopped = true; }, preventDefault() { this.defaultPrevented = true; }};
  clickHandler(event);
  assert.equal(event.stopped, true);
  assert.equal(event.defaultPrevented, true);
  assert.equal(created.length, 1);
  const dialog = created[0];
  assert.equal(dialog.open, true);
  assert.equal(dialog.children[1].src, "assets/原题.png");
  assert.equal(dialog.children[1].alt, "四个图形的选项");
  assert.equal(dialog.children[0].children[0].href, "assets/原题.png");
  assert.equal(dialog.children[0].children[1].attributes["aria-label"], "关闭大图");
  dialog.children[0].children[1].handlers.click();
  assert.equal(dialog.open, false);
  assert.equal(focused, true);
  assert.equal(dialog.children[1].src, undefined);
  // Reopening uses the same dialog, avoiding leaked overlays on repeated mounts.
  event.defaultPrevented = false;
  clickHandler(event);
  assert.equal(created.length, 1);
  // A progressive-disclosure text link opens the same viewer without an
  // invisible/preloaded source <img> in the learning card.
  link.getAttribute = name => name === "href" ? "assets/讲义原题.png" : name === "data-rich-alt" ? "讲义第2页原题" : null;
  link.querySelector = () => null;
  event.defaultPrevented = false;
  clickHandler(event);
  assert.equal(created.length, 1);
  assert.equal(dialog.children[1].src, "assets/讲义原题.png");
  assert.equal(dialog.children[1].alt, "讲义第2页原题");
});

test("vendored KaTeX is pinned, MIT-licensed, local and has every referenced WOFF2 font", () => {
  assert.equal(katex.version, "0.19.1");
  const vendor = path.join(__dirname, "../assets/vendor/katex");
  assert.match(fs.readFileSync(path.join(vendor, "LICENSE"), "utf8"), /MIT|Permission is hereby granted/);
  const css = fs.readFileSync(path.join(vendor, "katex.min.css"), "utf8");
  for (const match of css.matchAll(/url\(([^)]+)\)/g)) {
    const font = match[1].replace(/["']/g, "");
    assert.match(font, /^fonts\/[^/]+\.woff2$/);
    assert.ok(fs.existsSync(path.join(vendor, font)), font);
  }
  assert.doesNotMatch(css, /url\(https?:/);
});
