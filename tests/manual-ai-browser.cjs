"use strict";
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || "playwright");

(async () => {
  const root = path.resolve(__dirname, "..");
  let server, browser;
  try {
    let base = process.env.TEST_BASE_URL;
    if (!base) {
      server = http.createServer(async (request, response) => {
        try {
          const name = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
          const file = path.resolve(root, "." + (name === "/" ? "/index.html" : name));
          if (!file.startsWith(root + path.sep)) throw new Error("Invalid path");
          response.setHeader("Content-Type", ({".js":"text/javascript", ".css":"text/css", ".json":"application/json", ".html":"text/html", ".svg":"image/svg+xml", ".png":"image/png", ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".webp":"image/webp", ".gif":"image/gif"})[path.extname(file)] || "application/octet-stream");
          response.end(await fs.readFile(file));
        } catch { response.writeHead(404).end(); }
      });
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      base = `http://127.0.0.1:${server.address().port}/`;
    }
    base = base.replace(/\/?$/, "/");
    browser = await chromium.launch(process.env.CHROME_PATH ? {executablePath: process.env.CHROME_PATH} : {});
    const context = await browser.newContext({viewport:{width:1024,height:768}});
    const page = await context.newPage(), errors = [], calls = [];
    page.on("pageerror", error => errors.push(error.message));
    // All model traffic uses a mock provider. This test never spends API credits.
    await context.route("https://manual-ai.invalid/v1/responses", async route => {
      calls.push(route.request().postDataJSON());
      await route.fulfill({status:200, contentType:"application/json", body:JSON.stringify({status:"completed", output_text:"手动生成的解析。答案已核验。"})});
    });
    await context.addInitScript(() => localStorage.setItem("summer-politics-responses-settings-v2",
      JSON.stringify({apiKey:"test-only", baseUrl:"https://manual-ai.invalid/v1", model:"manual-test"})));
    const manifest = JSON.parse(await fs.readFile(path.join(root, "data/question-bank/manifest.json"), "utf8"));
    const routes = [
      ...manifest.subjects.map(subject => `#/study/${subject.id}`),
      `#/study/paper/${manifest.papers[0].id}`,
      ...manifest.practiceSets.map(set => `#/study/focus/${set.id}`),
      `#/study/language?topic=${manifest.subjects.find(subject => subject.id === "language").modules.find(module => module.questionCount >= 2).id}`
    ].filter(route => !process.env.TEST_ROUTE_FILTER || route.includes(process.env.TEST_ROUTE_FILTER));
    async function waitForAIResult() {
      await page.waitForFunction(() => ["已生成","已保存","未完成","待配置"].includes(document.querySelector("#drill-ai-state")?.textContent));
      assert.match(await page.locator("#drill-ai-state").innerText(), /已生成|已保存/, await page.locator("#drill-ai-body").innerText());
    }
    async function submit() {
      const field = page.locator("#drill-question .practice-text-input");
      if (await field.count()) await field.fill("1");
      else await page.locator("#drill-question .practice-option").first().click({position:{x:10,y:10}});
      await page.locator('[data-drill-action="next"]').click();
      await page.locator('[data-drill-action="ai-generate"]').waitFor();
    }
    for (const route of routes) {
      const initialCalls = calls.length;
      await page.goto(base + route, {waitUntil:"domcontentloaded"});
      await page.locator("#drill-count").fill("2");
      await page.locator("#drill-order").selectOption("source", {force:true});
      await page.locator('#drill-start-form button[type="submit"]').click();
      await submit();
      await page.locator(".drill-source-details > summary").first().click().catch(() => {});
      await page.waitForTimeout(120);
      assert.equal(calls.length, initialCalls, route + ": submitting/expanding source never sends AI");
      await page.locator('[data-drill-action="next"]').click();
      await submit();
      await page.locator('[data-drill-action="previous"]').click();
      await page.locator('[data-drill-action="ai-generate"]').waitFor();
      await page.reload({waitUntil:"domcontentloaded"});
      await page.locator('[data-drill-action="ai-generate"]').waitFor();
      await page.evaluate(() => window.dispatchEvent(new Event("summer-politics:ai-settings-changed")));
      await page.waitForTimeout(120);
      assert.equal(calls.length, initialCalls, route + ": next/back/reload/settings stay manual");
      await page.locator('[data-drill-action="ai-generate"]').click();
      await waitForAIResult();
      assert.ok(calls.length <= initialCalls + 1, "one click sends at most one request (or reuses cache)");
      assert.match(await page.locator("#drill-ai-body").innerText(), /手动生成/);
      const generatedCalls = calls.length;
      await page.reload({waitUntil:"domcontentloaded"});
      await page.locator('[data-drill-action="ai-generate"]').click();
      await waitForAIResult();
      assert.equal(calls.length, generatedCalls, "explicit cached view never sends another request");
      console.log("PASS: manual generation and cache reuse " + route);
    }
    for (const viewport of [{width:390,height:844},{width:1024,height:768},{width:1440,height:900}]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => window.dispatchEvent(new Event("summer-politics:ai-settings-changed")));
      const button = page.locator('[data-drill-action="ai-generate"]');
      await button.scrollIntoViewIfNeeded();
      const box = await button.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= viewport.width && box.y >= 0 && box.y + box.height <= viewport.height);
      if (process.env.SCREENSHOT_DIR) {
        await fs.mkdir(process.env.SCREENSHOT_DIR, {recursive:true});
        await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR, `manual-ai-${viewport.width}.png`)});
      }
    }
    assert.deepEqual(errors, []);
    assert.ok(calls.length > 0, "explicit clicks actually exercised the mocked provider");
    console.log("PASS: mobile/tablet/desktop button visibility; no browser exceptions");
  } finally {
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
