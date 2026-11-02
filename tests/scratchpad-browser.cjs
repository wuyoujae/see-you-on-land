"use strict";
// Real browser regression checks. Supply PLAYWRIGHT_MODULE and CHROME_PATH when
// Playwright and Chrome are installed outside this repository.
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || "playwright");

(async () => {
  const root = path.resolve(__dirname, "..");
  const server = http.createServer(async (req, res) => {
    try {
      const name = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      const file = path.resolve(root, "." + (name === "/" ? "/index.html" : name));
      if (!file.startsWith(root + path.sep)) throw new Error("Invalid path");
      const mime = {".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml"};
      res.setHeader("Content-Type", mime[path.extname(file)] || "application/octet-stream");
      res.end(await fs.readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch(process.env.CHROME_PATH ? {executablePath: process.env.CHROME_PATH} : {});
    const context = await browser.newContext({viewport: {width: 1440, height: 900}});
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const learningRoute = "#/learn/language/language-main-idea-basics/language-p1-l01";
    const action = name => page.locator(`[data-scratch-action="${name}"]`);
    const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const snapshot = () => page.evaluate(() => window.Scratchpad.exportBackup());
    const active = value => value.drafts.find(draft => draft.id === value.activeId);
    async function open() {
      await page.locator("[data-scratchpad-open]").click();
      await page.waitForFunction(() => window.Scratchpad?.isOpen && !document.querySelector("#scratchpad-overlay").dataset.loading);
      await frames();
    }
    async function close() {
      await action("close").click();
      await page.locator("#scratchpad-overlay").waitFor({state: "hidden"});
    }
    async function stroke(from, to) {
      await page.mouse.move(...from);
      await page.mouse.down();
      await page.mouse.move(...to, {steps: 8});
      await page.mouse.up();
      await frames();
    }
    async function newDraft() {
      const previous = (await snapshot()).activeId;
      await action("new").click();
      await page.waitForFunction(id => document.querySelector("#scratchpad-list [aria-selected=true]")?.dataset.scratchDraft !== id, previous);
      const value = await snapshot();
      assert.notEqual(value.activeId, previous);
      return active(value);
    }
    async function switchDraft(id) {
      await action("list").click();
      await page.locator(`[data-scratch-draft="${id}"]`).click();
      await page.waitForFunction(id => document.querySelector("#scratchpad-list [aria-selected=true]")?.dataset.scratchDraft === id, id);
    }
    async function synthetic(sequence) {
      await page.evaluate(sequence => {
        const surface = document.querySelector(".scratchpad-surface");
        const capture = surface.setPointerCapture;
        // Synthetic PointerEvents have no OS pointer session. Do not alter
        // native capture for the real mouse interactions elsewhere in this test.
        surface.setPointerCapture = () => {};
        try {
          for (const event of sequence) {
            const {type, ...init} = event;
            surface.dispatchEvent(new PointerEvent(type, {
              bubbles: true, cancelable: true, pointerType: "touch", pointerId: 40,
              button: 0, buttons: type === "pointerup" ? 0 : 1,
              width: 6, height: 6, pressure: .5, isPrimary: true, ...init
            }));
          }
        } finally { surface.setPointerCapture = capture; }
      }, sequence);
      await frames();
    }
    const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < .03, `${message}: ${actual} vs ${expected}`);
    async function paintedPixels() {
      await frames();
      return page.locator(".scratchpad-surface canvas").first().evaluate(canvas => {
        const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
        let count = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i]) count++;
        return count;
      });
    }

    await page.goto(origin + "/" + learningRoute, {waitUntil: "domcontentloaded"});
    await page.locator(".learn-session-header [data-scratchpad-open]").waitFor();
    assert.equal(await page.locator("[data-scratchpad-open]").getAttribute("aria-label"), "打开草稿本");
    await open();
    assert.equal(await page.locator("#app").evaluate(el => el.inert), true);
    assert.equal((await snapshot()).drafts.length, 1);
    await stroke([300, 300], [420, 340]);
    const first = active(await snapshot());
    assert.equal(first.strokes.length, 1);
    assert.ok(first.strokes[0].points.length > 2);
    assert.ok(await paintedPixels() > 100, "mouse handwriting is visibly painted");
    await action("undo").click();
    assert.equal(active(await snapshot()).strokes.length, 0);
    assert.equal(await paintedPixels(), 0);
    await action("redo").click();
    assert.deepEqual(active(await snapshot()).strokes, first.strokes);
    await action("eraser").click();
    await page.mouse.click(360, 320);
    assert.equal(active(await snapshot()).strokes.length, 0, "eraser removes the entire hit stroke");
    await action("undo").click();
    assert.deepEqual(active(await snapshot()).strokes, first.strokes);
    await action("pen").click();
    const second = await newDraft();
    assert.equal(second.strokes.length, 0);
    assert.deepEqual((await snapshot()).drafts.find(draft => draft.id === first.id).strokes, first.strokes);
    await stroke([340, 400], [480, 430]);
    await switchDraft(first.id);
    assert.deepEqual(active(await snapshot()).strokes, first.strokes);
    await close();
    assert.equal(await page.locator("#app").evaluate(el => el.inert), false);
    await open();
    assert.equal((await snapshot()).activeId, first.id);
    assert.deepEqual(active(await snapshot()).strokes, first.strokes);
    assert.equal(await action("undo").isDisabled(), false, "closing and reopening unchanged local ink preserves undo history");
    await page.reload({waitUntil: "domcontentloaded"});
    await open();
    const reloaded = await snapshot();
    assert.equal(reloaded.drafts.length, 2);
    assert.equal(reloaded.activeId, first.id);
    assert.deepEqual(active(reloaded).strokes, first.strokes);
    assert.equal(await page.evaluate(() => localStorage.getItem(window.ScratchpadCore.STORAGE_KEY)), null, "normal browser uses IndexedDB");
    assert.deepEqual(await page.evaluate(id => window.ScratchpadCore.createStore().get(id), first.id), active(reloaded));
    console.log("PASS: learning entry, visible mouse ink, undo/redo/whole-stroke erasing, independent drafts, close/reopen and IndexedDB reload");

    await action("hand").click();
    const viewBefore = active(await snapshot()).viewport;
    await stroke([550, 400], [670, 470]);
    const panned = active(await snapshot());
    near(panned.viewport.x, viewBefore.x + 120, "pan horizontal displacement");
    near(panned.viewport.y, viewBefore.y + 70, "pan vertical displacement");
    assert.deepEqual(panned.strokes, first.strokes, "panning cannot mutate retained strokes");
    const center = {x: 720, y: 450};
    const worldAnchor = {x: (center.x - panned.viewport.x) / panned.viewport.scale, y: (center.y - panned.viewport.y) / panned.viewport.scale};
    await action("zoom-in").click();
    const zoomed = active(await snapshot());
    near(zoomed.viewport.scale, panned.viewport.scale * 1.25, "zoom scale");
    near(worldAnchor.x * zoomed.viewport.scale + zoomed.viewport.x, center.x, "zoom preserves horizontal anchor");
    near(worldAnchor.y * zoomed.viewport.scale + zoomed.viewport.y, center.y, "zoom preserves vertical anchor");
    await page.reload({waitUntil: "domcontentloaded"}); await open();
    assert.deepEqual(active(await snapshot()).viewport, zoomed.viewport, "viewport survives refresh");
    const originalHash = await page.evaluate(() => location.hash);
    await page.keyboard.press("ArrowRight");
    await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true, cancelable: true})));
    await frames();
    assert.equal(await page.evaluate(() => location.hash), originalHash, "scratchpad keys cannot navigate learning cards");
    assert.equal(await page.evaluate(() => window.Scratchpad.isOpen), true);
    console.log("PASS: pan, anchored zoom, saved viewport, and keyboard isolation");

    const gestureDraft = await newDraft();
    await action("pen").click();
    await synthetic([
      {type: "pointerdown", pointerId: 41, clientX: 200, clientY: 300},
      {type: "pointermove", pointerId: 41, clientX: 225, clientY: 310},
      {type: "pointerdown", pointerId: 42, clientX: 425, clientY: 310},
      {type: "pointermove", pointerId: 42, clientX: 625, clientY: 310}
    ]);
    // Snapshot intentionally follows only completed gestures: export finishes
    // in-progress ink, so it is never called halfway through single-finger ink.
    await synthetic([{type: "pointerup", pointerId: 41, clientX: 225, clientY: 310}]);
    const pinched = active(await snapshot());
    assert.equal(pinched.id, gestureDraft.id);
    assert.equal(pinched.strokes.length, 0, "second finger cancels provisional first-finger ink");
    assert.ok(pinched.viewport.scale > 1.5);
    await synthetic([
      {type: "pointermove", pointerId: 42, clientX: 655, clientY: 335},
      {type: "pointerup", pointerId: 42, clientX: 655, clientY: 335}
    ]);
    const continued = active(await snapshot());
    near(continued.viewport.x, pinched.viewport.x + 30, "remaining finger continues horizontal pan");
    near(continued.viewport.y, pinched.viewport.y + 25, "remaining finger continues vertical pan");
    assert.equal(continued.strokes.length, 0);
    await action("home").click();
    await synthetic([
      {type: "pointerdown", pointerId: 43, clientX: 200, clientY: 320},
      {type: "pointermove", pointerId: 43, clientX: 220, clientY: 330},
      {type: "pointerdown", pointerType: "pen", pointerId: 50, clientX: 300, clientY: 350, pressure: .2},
      {type: "pointerdown", pointerId: 44, clientX: 360, clientY: 420, width: 65, height: 65},
      {type: "pointermove", pointerId: 44, clientX: 400, clientY: 450, width: 65, height: 65},
      {type: "pointermove", pointerType: "pen", pointerId: 50, clientX: 420, clientY: 360, pressure: .9},
      {type: "pointerup", pointerType: "pen", pointerId: 50, clientX: 430, clientY: 365, pressure: .6},
      {type: "pointerup", pointerId: 43, clientX: 220, clientY: 330},
      {type: "pointerup", pointerId: 44, clientX: 400, clientY: 450, width: 65, height: 65}
    ]);
    const pen = active(await snapshot());
    assert.equal(pen.strokes.length, 1, "pen cancels preceding touch ink and ignores palm contact");
    near(pen.strokes[0].points[0].pressure, .2, "light pen pressure");
    assert.ok(pen.strokes[0].points.some(point => Math.abs(point.pressure - .9) < .03), "heavy pen pressure retained");
    assert.deepEqual(pen.viewport, {x: 0, y: 0, scale: 1}, "palm contact cannot move canvas during pen writing");
    console.log("PASS: two-finger provisional-ink cancellation, continued one-finger pan, pen pressure and palm rejection");

    for (const {width, height} of [{width: 390, height: 844}, {width: 1024, height: 768}, {width: 1440, height: 900}]) {
      await page.setViewportSize({width, height}); await frames();
      assert.deepEqual(active(await snapshot()).strokes, pen.strokes, "resize retains stroke coordinates");
      assert.ok(await paintedPixels() > 0, "resize redraws ink");
      await action("options").click();
      const overflow = await page.locator("#scratchpad-overlay").evaluate(overlay => [...overlay.querySelectorAll("button")]
        .filter(button => button.getClientRects().length)
        .map(button => ({label: button.getAttribute("aria-label") || button.textContent.trim(), rect: button.getBoundingClientRect()}))
        .filter(({rect}) => rect.left < -.5 || rect.top < -.5 || rect.right > innerWidth + .5 || rect.bottom > innerHeight + .5)
        .map(({label}) => label));
      assert.deepEqual(overflow, [], `${width}x${height}: all controls fit viewport`);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      if (process.env.SCREENSHOT_DIR) {
        await fs.mkdir(process.env.SCREENSHOT_DIR, {recursive: true});
        await page.screenshot({path: path.join(process.env.SCREENSHOT_DIR, `scratchpad-${width}.png`)});
      }
      await action("options").click();
    }
    console.log("PASS: mobile, tablet and desktop control bounds, resize persistence and repaint");

    const timedDraft = await newDraft();
    await action("pen").click();
    await stroke([300, 300], [420, 330]);
    // The previous pen-up scheduled autosave. Hold a second stroke across its
    // deadline, then continue writing; no export/flush runs during that stroke.
    await page.mouse.move(550, 350);
    await page.mouse.down();
    await page.mouse.move(610, 375, {steps: 4});
    await page.waitForTimeout(450);
    await page.mouse.move(780, 430, {steps: 10});
    await page.mouse.up();
    const afterAutosave = active(await snapshot());
    assert.equal(afterAutosave.id, timedDraft.id);
    assert.equal(afterAutosave.strokes.length, 2, "autosave cannot split or discard the next stroke");
    near(afterAutosave.strokes[1].points.at(-1).x, 780, "long stroke retains horizontal tail after autosave deadline");
    near(afterAutosave.strokes[1].points.at(-1).y, 430, "long stroke retains vertical tail after autosave deadline");
    console.log("PASS: previous-stroke autosave deadline cannot truncate an active long stroke");

    const secondary = await page.context().newPage();
    secondary.on("pageerror", error => errors.push(error.message));
    try {
      await secondary.goto(origin + "/" + learningRoute, {waitUntil: "domcontentloaded"});
      await secondary.locator("[data-scratchpad-open]").click();
      await secondary.waitForFunction(() => document.querySelector(".scratchpad-status")?.textContent.includes("另一个页面"));
      assert.equal(await secondary.locator("#scratchpad-overlay").getAttribute("data-loading"), "true", "competing editor stays locked");
      await secondary.mouse.move(500, 380);
      await secondary.mouse.down();
      await secondary.mouse.move(690, 430, {steps: 8});
      await secondary.mouse.up();
      assert.deepEqual(await secondary.evaluate(id => window.ScratchpadCore.createStore().get(id), timedDraft.id), afterAutosave,
        "drawing in the locked second page cannot change the saved draft");
      const blockedImport = await secondary.evaluate(async payload => {
        try {await window.Scratchpad.importBackup(payload); return "";} catch (error) {return error.message;}
      }, await snapshot());
      assert.match(blockedImport, /另一个页面/, "import cannot bypass the active editor lock");
      await secondary.locator('[data-scratch-action="close"]').click();
      await secondary.locator("#scratchpad-overlay").waitFor({state: "hidden"});
      await close();
      await secondary.locator("[data-scratchpad-open]").click();
      await secondary.waitForFunction(() => window.Scratchpad?.isOpen && !document.querySelector("#scratchpad-overlay").dataset.loading);
      await secondary.mouse.move(340, 460);
      await secondary.mouse.down();
      await secondary.mouse.move(490, 500, {steps: 8});
      await secondary.mouse.up();
      const fromSecondary = active(await secondary.evaluate(() => window.Scratchpad.exportBackup()));
      assert.equal(fromSecondary.id, timedDraft.id);
      assert.equal(fromSecondary.strokes.length, 3, "second page can write after the first releases its lock");
      await secondary.locator('[data-scratch-action="close"]').click();
      await secondary.locator("#scratchpad-overlay").waitFor({state: "hidden"});
      await secondary.reload({waitUntil: "domcontentloaded"});
      await secondary.locator("[data-scratchpad-open]").click();
      await secondary.waitForFunction(() => window.Scratchpad?.isOpen && !document.querySelector("#scratchpad-overlay").dataset.loading);
      assert.deepEqual(active(await secondary.evaluate(() => window.Scratchpad.exportBackup())), fromSecondary,
        "second-page handwriting survives its own refresh");
      await secondary.locator('[data-scratch-action="close"]').click();
      await secondary.locator("#scratchpad-overlay").waitFor({state: "hidden"});
      await open();
      assert.deepEqual(active(await snapshot()), fromSecondary, "first page reloads newer ink on reopening instead of overwriting it");
      assert.equal(await action("undo").isDisabled(), true, "externally updated draft discards stale local undo history");
      // This denied editor already has a cached document from its successful
      // session. Keyboard/wheel input must stay locked even with that cache.
      await secondary.locator("[data-scratchpad-open]").click();
      await secondary.waitForFunction(() => document.querySelector(".scratchpad-status")?.textContent.includes("另一个页面"));
      await secondary.keyboard.press("ArrowRight");
      await secondary.mouse.move(600, 400);
      await secondary.mouse.wheel(90, 160);
      await secondary.waitForTimeout(400);
      assert.deepEqual(await secondary.evaluate(id => window.ScratchpadCore.createStore().get(id), timedDraft.id), fromSecondary,
        "locked cached editor cannot mutate the owning page's saved viewport or strokes through keyboard/wheel");
      await secondary.locator('[data-scratch-action="close"]').click();
      await secondary.locator("#scratchpad-overlay").waitFor({state: "hidden"});
      assert.deepEqual(await page.evaluate(id => window.ScratchpadCore.createStore().get(id), timedDraft.id), fromSecondary,
        "closing a rejected cached editor cannot overwrite the owning page's latest draft");
    } finally {await secondary.close();}
    console.log("PASS: cross-page editing/import lock, lock release, second-page refresh and stale first-page resynchronization");

    const beforeImport = await snapshot();
    const older = structuredClone(beforeImport);
    const olderActive = active(older); olderActive.strokes = []; olderActive.updatedAt = olderActive.createdAt;
    const importedId = "scratch-browser-import";
    older.drafts.push({...structuredClone(olderActive), id: importedId, title: "导入的草稿"});
    await page.evaluate(payload => window.Scratchpad.importBackup(payload), older);
    const merged = await snapshot();
    assert.deepEqual(active(merged).strokes, active(beforeImport).strokes, "older backup cannot erase newer local handwriting");
    assert.ok(merged.drafts.some(draft => draft.id === importedId));
    const damaged = structuredClone(merged); damaged.drafts[0].strokes = [{id: "bad", color: "#202b23", width: 2, points: [{x: "bad", y: 0, pressure: .5}]}];
    const rejected = await page.evaluate(async payload => {try {await window.Scratchpad.importBackup(payload); return false;} catch {return true;}}, damaged);
    assert.equal(rejected, true);
    assert.deepEqual(await snapshot(), merged, "invalid import cannot change any saved draft");
    console.log("PASS: backup imports merge new drafts, preserve newer ink and reject invalid data without mutation");

    await close();
    await page.goto(origin + "/#/study/language", {waitUntil: "domcontentloaded"});
    await page.locator("#drill-start-form").waitFor();
    await page.locator("#drill-count").fill("2");
    await page.locator("#drill-start-form button[type=submit]").click();
    await page.locator(".drill-session [data-scratchpad-open], .drill-workspace [data-scratchpad-open]").waitFor();
    await open();
    assert.ok((await snapshot()).drafts.some(draft => draft.id === first.id), "learning and practice share the same scratchbooks");
    const practiceHash = await page.evaluate(() => location.hash);
    await page.keyboard.press("ArrowRight");
    await page.evaluate(() => document.body.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true, cancelable: true})));
    await frames();
    assert.equal(await page.evaluate(() => location.hash), practiceHash, "scratchpad keys cannot navigate practice questions");
    await page.evaluate(() => {location.hash = "#/learn";});
    await page.locator("#scratchpad-overlay").waitFor({state: "hidden"});
    assert.equal(await page.locator("#app").evaluate(el => el.inert), false);
    assert.deepEqual(errors, [], "no uncaught browser exceptions");
    console.log("PASS: practice entry, shared drafts, keyboard isolation and route cleanup");
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
