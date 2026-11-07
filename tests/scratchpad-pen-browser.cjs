"use strict";
// Pen-stream regressions run in Chromium, WebKit or Firefox, without a physical
// digitizer. Real pointer capture is separately covered by scratchpad-browser.
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const playwright = require(process.env.PLAYWRIGHT_MODULE || "playwright");

(async () => {
  const root = path.resolve(__dirname, ".."), failures = [];
  const server = http.createServer(async (req, res) => {
    try {
      const name = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      const file = path.resolve(root, "." + (name === "/" ? "/index.html" : name));
      if (!file.startsWith(root + path.sep)) throw new Error("Invalid path");
      res.setHeader("Content-Type", ({".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json"})[path.extname(file)] || "application/octet-stream");
      res.end(await fs.readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const engine = process.env.BROWSER_ENGINE || "chromium";
  let browser;
  try {
    browser = await playwright[engine].launch(engine === "chromium" && process.env.CHROME_PATH ? {executablePath: process.env.CHROME_PATH} : {});
    const context = await browser.newContext({viewport: {width: 1024, height: 768}}), page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, route => route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/#/learn/language/language-main-idea-basics/language-p1-l01`);
    await page.locator("[data-scratchpad-open]").click();
    await page.waitForFunction(() => window.Scratchpad?.isOpen && !document.querySelector("#scratchpad-overlay").dataset.loading);
    const action = name => page.locator(`[data-scratch-action="${name}"]`);
    const snapshot = async () => { const value = await page.evaluate(() => Scratchpad.exportBackup()); return value.drafts.find(draft => draft.id === value.activeId); };
    const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    async function fresh() {
      await action("new").click();
      await page.waitForFunction(() => !document.querySelector("#scratchpad-overlay").dataset.switching);
      await action("pen").click();
    }
    async function input(events, options = {}) {
      await page.evaluate(({events, options}) => {
        const surface = document.querySelector(".scratchpad-surface"), original = surface.setPointerCapture;
        surface.setPointerCapture = () => { if (options.failCapture) throw new DOMException("Pointer is no longer active", "NotFoundError"); };
        try {
          for (const item of events) {
            const {type, target, coalesced, ...init} = item;
            const event = new PointerEvent(type, {bubbles: true, cancelable: true, pointerId: 71, pointerType: "pen", button: type === "pointermove" ? -1 : 0, buttons: type === "pointerup" ? 0 : 1, pressure: .6, clientX: 200, clientY: 300, ...init});
            if (coalesced) Object.defineProperty(event, "getCoalescedEvents", {value: () => coalesced.map(point => ({pointerType: "pen", pressure: .6, clientY: 300, ...point}))});
            (target === "body" ? document.body : target ? document.querySelector(`[data-scratch-action="${target}"]`) : surface).dispatchEvent(event);
          }
        } finally { surface.setPointerCapture = original; }
      }, {events, options});
      await frames();
    }
    const down = {type: "pointerdown"}, move = x => ({type: "pointermove", clientX: x}), up = x => ({type: "pointerup", clientX: x});
    const tail = (draft, x) => assert.ok(draft.strokes.some(stroke => stroke.points.some(point => Math.abs(point.x - x) < .01)), `missing pen sample at x=${x}`);
    async function check(name, run) {
      await fresh();
      try { await run(); console.log(`PASS (${engine}): ${name}`); }
      catch (error) { failures.push(`${name}: ${error.message}`); console.error(`FAIL (${engine}): ${name}: ${error.message}`); }
    }

    await check("capture loss cannot cut off a still-contacting pen", async () => {
      await input([down, move(240), {type: "lostpointercapture"}, move(320), up(360)]);
      const draft = await snapshot(); tail(draft, 360); assert.equal(draft.strokes.length, 1);
    });
    await check("capture failure falls back to document delivery", async () => {
      await input([down, {...move(320), target: "body"}, {...up(360), target: "body"}], {failCapture: true});
      tail(await snapshot(), 360);
    });
    await check("pen resumes in a new segment after pointer cancellation", async () => {
      await input([down, move(240), {type: "pointercancel", buttons: 0}, {...move(270), buttons: 0, pressure: 0}, move(320), up(360)]);
      const draft = await snapshot(); tail(draft, 240); tail(draft, 360);
      assert.ok(!draft.strokes.some(stroke => stroke.points.some(point => point.x === 270)), "hover must not draw");
      assert.ok(!draft.strokes.some(stroke => stroke.points.some(point => point.x === 240) && stroke.points.some(point => point.x === 320)), "canceled gap cannot create a connecting line");
    });
    await check("visible-window blur recovers without losing the rest of a stroke", async () => {
      await input([down, move(240)]); await page.evaluate(() => window.dispatchEvent(new Event("blur")));
      await input([move(320), up(360)]); tail(await snapshot(), 360);
    });
    await check("wheel events cannot terminate or move active pen ink", async () => {
      await input([down, move(240)]);
      await page.locator(".scratchpad-surface").dispatchEvent("wheel", {deltaX: 100, deltaY: 160});
      await input([move(320), up(360)]); const draft = await snapshot(); tail(draft, 360);
      assert.deepEqual(draft.viewport, {x: 0, y: 0, scale: 1}); assert.equal(draft.strokes.length, 1);
    });
    await check("saving and exporting cannot terminate a live pen stream", async () => {
      await input([down, move(240)]); await page.evaluate(() => Scratchpad.flush());
      await input([move(280)]); const partial = await snapshot(); tail(partial, 280);
      await input([move(320), up(360)]); const draft = await snapshot(); tail(draft, 360); assert.equal(draft.strokes.length, 1);
    });
    await check("palm contact on the toolbar cannot create a new draft mid-stroke", async () => {
      await input([down, move(240)]);
      const prevented = await page.evaluate(() => {
        const button = document.querySelector('[data-scratch-action="new"]');
        const event = new PointerEvent("pointerdown", {pointerId: 92, pointerType: "touch", width: 60, height: 60, buttons: 1, bubbles: true, cancelable: true});
        button.dispatchEvent(event);
        button.dispatchEvent(new PointerEvent("pointerup", {pointerId: 92, pointerType: "touch", bubbles: true}));
        button.dispatchEvent(new PointerEvent("click", {pointerId: 92, pointerType: "touch", bubbles: true, cancelable: true}));
        return event.defaultPrevented;
      });
      await input([move(320), up(360)]); assert.ok(prevented, "palm must be intercepted before activating UI");
      tail(await snapshot(), 360);
    });
    await check("non-owner cancellation cannot interrupt an active pan", async () => {
      await action("hand").click();
      await input([down, move(240), {type: "pointercancel", pointerId: 93, pointerType: "touch", buttons: 0}, move(300), up(300)]);
      assert.equal((await snapshot()).viewport.x, 100);
    });
    await check("hover and barrel-button hover never create phantom ink", async () => {
      await input([{...down, buttons: 2, button: 2, pressure: 0}, {...move(260), buttons: 2, pressure: 0}, {...up(260), pressure: 0}]);
      await input([{...move(300), buttons: 0, pressure: 0}]);
      assert.equal((await snapshot()).strokes.length, 0);
      await input([down, move(320), up(360), {...move(600), buttons: 0, pressure: 0}]);
      const draft = await snapshot(); assert.equal(draft.strokes.length, 1);
      assert.ok(!draft.strokes[0].points.some(point => point.x === 600));
    });
    await check("a missing pen-up cannot block the next physical contact", async () => {
      await input([down, move(240), {...down, pointerId: 81, clientX: 320}, {...move(360), pointerId: 81}, {...up(400), pointerId: 81}]);
      const draft = await snapshot(); tail(draft, 240); tail(draft, 400); assert.equal(draft.strokes.length, 2);
    });
    await check("pressure-confirmed contact survives a temporarily missing buttons flag", async () => {
      await input([down, {...move(260), buttons: 0, pressure: .4}, move(320), up(360)]);
      const draft = await snapshot(); tail(draft, 260); tail(draft, 360); assert.equal(draft.strokes.length, 1);
    });
    await check("resize during contact retains and repaints both sides of the stroke", async () => {
      await input([down, move(240)]); await page.setViewportSize({width: 768, height: 1024});
      await input([move(320), up(360)]); const draft = await snapshot(); tail(draft, 240); tail(draft, 360);
      const painted = await page.locator(".scratchpad-surface canvas").first().evaluate(canvas => {
        const context = canvas.getContext("2d"), ratio = canvas.width / canvas.getBoundingClientRect().width;
        return context.getImageData(Math.round(319 * ratio), Math.round(299 * ratio), Math.ceil(4 * ratio), Math.ceil(4 * ratio)).data.some((value, index) => index % 4 === 3 && value > 0);
      });
      assert.ok(painted); await page.setViewportSize({width: 1024, height: 768});
    });
    await check("reopening repaints external updates even at the same viewport size", async () => {
      await input([down, move(240), up(280)]);
      const draft = await snapshot();
      await action("close").click(); await page.locator("#scratchpad-overlay").waitFor({state: "hidden"});
      await page.evaluate(async id => {
        const store = ScratchpadCore.createStore(), draft = await store.get(id);
        draft.strokes.push({id: "external-stroke", color: "#202b23", width: 3, points: [{x: 400, y: 450, pressure: .5}, {x: 500, y: 450, pressure: .5}]});
        draft.updatedAt += 100; await store.save(draft);
      }, draft.id);
      await page.locator("[data-scratchpad-open]").click();
      await page.waitForFunction(() => !document.querySelector("#scratchpad-overlay").dataset.loading); await frames();
      const painted = await page.locator(".scratchpad-surface canvas").first().evaluate(canvas => {
        const ratio = canvas.width / canvas.getBoundingClientRect().width;
        return canvas.getContext("2d").getImageData(Math.round(449 * ratio), Math.round(449 * ratio), Math.ceil(4 * ratio), Math.ceil(4 * ratio)).data.some((value, index) => index % 4 === 3 && value > 0);
      });
      assert.ok(painted, "newly loaded ink must be visible without resizing");
    });
    await check("canvas restoration redraws stored ink and the current pen", async () => {
      await input([down, move(240), up(280), {...down, clientY: 400}, {...move(260), clientY: 400}]);
      await page.locator(".scratchpad-surface").evaluate(surface => {
        for (const canvas of surface.querySelectorAll("canvas")) {
          canvas.getContext("2d").reset(); canvas.dispatchEvent(new Event("contextrestored"));
        }
      });
      await input([{...move(320), clientY: 400}, {...up(360), clientY: 400}]);
      const draft = await snapshot(); assert.equal(draft.strokes.length, 2); tail(draft, 360);
    });
    if (engine === "chromium") await check("trusted browser pen events retain capture, pressure and the complete stroke", async () => {
      const session = await context.newCDPSession(page);
      await page.evaluate(() => {
        window.penEvents = [];
        document.querySelector(".scratchpad-surface").addEventListener("pointermove", event => {
          if (event.pointerType === "pen") window.penEvents.push({trusted: event.isTrusted, pressure: event.pressure, captured: event.currentTarget.hasPointerCapture(event.pointerId)});
        });
      });
      try {
        await session.send("Input.dispatchMouseEvent", {type: "mousePressed", x: 200, y: 300, button: "left", buttons: 1, pointerType: "pen", force: .2});
        for (let i = 1; i <= 20; i++) await session.send("Input.dispatchMouseEvent", {type: "mouseMoved", x: 200 + i * 8, y: 300 + i, button: "none", buttons: 1, pointerType: "pen", force: .2 + i * .03});
        await session.send("Input.dispatchMouseEvent", {type: "mouseReleased", x: 360, y: 320, button: "left", buttons: 0, pointerType: "pen"});
        await frames();
        const events = await page.evaluate(() => window.penEvents);
        assert.ok(events.length >= 10 && events.every(event => event.trusted && event.captured));
        const draft = await snapshot(); tail(draft, 360); assert.equal(draft.strokes.length, 1);
        assert.ok(draft.strokes[0].points.some(point => point.pressure > .7));
      } finally { await session.detach(); }
    });
    await check("long pen strokes roll over instead of stopping at the sample limit", async () => {
      const samples = Array.from({length: 50005}, (_, i) => ({clientX: 200 + (i % 600), clientY: 300 + Math.floor(i / 600)}));
      await input([down, {...move(404), coalesced: samples}, up(860)]);
      const draft = await snapshot(); tail(draft, 860);
      assert.ok(draft.strokes.length >= 2); assert.ok(draft.strokes.every(stroke => stroke.points.length <= 50000));
      await action("undo").click(); assert.equal((await snapshot()).strokes.length, 0, "one undo removes the entire physical stroke");
    });
    await check("the pen-up sample at an exact chunk boundary is retained", async () => {
      const samples = Array.from({length: 49999}, (_, i) => ({clientX: 201 + (i % 600), clientY: 300 + Math.floor(i / 600)}));
      await input([down, {...move(404), coalesced: samples}, up(890)]);
      tail(await snapshot(), 890);
    });
    assert.deepEqual(errors, [], "no uncaught pen-input exceptions");
    if (failures.length) throw new Error(failures.join("\n"));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => {console.error(error.message); process.exitCode = 1;});
