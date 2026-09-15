const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const server = http.createServer(async (req, res) => {
    try {
      const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const file = path.resolve(root, '.' + (name === '/' ? '/index.html' : name));
      if (!file.startsWith(root + path.sep)) throw new Error('Invalid path');
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
      res.setHeader('Content-Type', `${mime[path.extname(file)] || 'application/octet-stream'}; charset=utf-8`);
      res.end(await fs.readFile(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const requests = [];
    await page.route('https://solver-test.invalid/v1/responses', async route => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({ contentType: 'text/event-stream', body: 'data: {"type":"response.output_text.delta","delta":"答案：B。"}\n\ndata: {"type":"response.completed","response":{"status":"completed"}}\n\n' });
    });
    await page.addInitScript(() => localStorage.setItem('summer-politics-responses-settings-v2', JSON.stringify({ apiKey: 'test-only', baseUrl: 'https://solver-test.invalid/v1', model: 'test-model' })));
    const url = `http://127.0.0.1:${server.address().port}`;
    await page.goto(url);
    await page.click('[data-tab="search"]');
    await page.evaluate(() => { window.wrongQuestionBook = null; });
    const photo = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 800; canvas.height = 600;
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff'; context.fillRect(0, 0, 800, 600);
      context.fillStyle = '#123456'; context.fillRect(100, 100, 200, 150);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    const photoFile = { name: 'camera.png', mimeType: 'image/png', buffer: Buffer.from(photo, 'base64') };
    await page.locator('#solver-camera-input').setInputFiles(photoFile);
    await page.waitForFunction(() => document.querySelector('.solver-crop-dialog [data-action="confirm"]')?.disabled === false);
    assert.equal(await page.locator('#solver-send').isDisabled(), true);
    await page.locator('.solver-crop-dialog [data-action="cancel"]').click();
    await page.waitForFunction(() => !document.querySelector('.solver-crop-dialog'));
    assert.equal(await page.locator('[data-crop-image]').count(), 0);
    await page.locator('#solver-camera-input').setInputFiles(photoFile);
    await page.waitForFunction(() => document.querySelector('.solver-crop-dialog [data-action="confirm"]')?.disabled === false);
    await page.evaluate(() => document.querySelector('.solver-crop-stage img').cropper.setData({ x: 100, y: 100, width: 200, height: 150 }));
    await page.locator('.solver-crop-dialog [data-action="confirm"]').click();
    await page.waitForFunction(() => document.querySelector('#solver-image-preview img')?.naturalWidth === 200);
    assert.equal(await page.locator('#solver-image-preview img').evaluate(img => img.naturalHeight), 150);
    const croppedUrl = await page.locator('#solver-image-preview img').getAttribute('src');
    await page.locator('[data-crop-image]').click();
    await page.waitForFunction(() => document.querySelector('.solver-crop-dialog [data-action="confirm"]')?.disabled === false);
    for (const width of [320, 768]) {
      await page.setViewportSize({ width, height: 700 });
      const bounds = await page.locator('.solver-crop-dialog').boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.height <= 700);
      if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `crop-${width}.png`) });
    }
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#solver-image-preview img').getAttribute('src'), croppedUrl);
    await page.locator('[data-remove-image]').click();
    await page.locator('#solver-camera-input').setInputFiles(photoFile);
    await page.waitForFunction(() => document.querySelector('.solver-crop-dialog [data-action="confirm"]')?.disabled === false);
    await page.locator('.solver-crop-dialog [data-action="original"]').click();
    await page.waitForFunction(() => document.querySelector('#solver-image-preview img')?.naturalWidth === 800);
    await page.locator('[data-remove-image]').click();
    assert.equal(requests.length, 0);
    const select = page.locator('#solver-question-type');
    assert.equal(await select.locator('option').count(), 2);
    await select.selectOption('verbal-logical-fill');
    await page.locator('#solver-upload-input').setInputFiles({ name: 'question.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') });
    await page.waitForFunction(() => !document.querySelector('#solver-image-preview').hidden);
    await page.fill('#solver-prompt', '请选择正确词语');
    await page.click('#solver-send');
    await page.waitForFunction(() => !document.querySelector('#solver-question-type').disabled && document.querySelector('#solver-messages').textContent.includes('答案：B'));
    assert.equal(requests.length, 1);
    for (const section of ['正确答案与题型', '简洁解题思路', '逐空分析', '额外补充知识']) assert.ok(requests[0].instructions.includes(section));
    assert.ok(requests[0].instructions.includes('所有选项在该空对应的词语'));
    for (const method of ['成语的拆分', '因果关系', '比喻/形象化表达', '语义对应', '褒贬色彩要一致', '用词一致']) assert.ok(requests[0].instructions.includes(method));
    assert.ok(requests[0].input.some(message => Array.isArray(message.content) && message.content.some(part => part.type === 'input_image')));
    await page.reload();
    await page.click('[data-tab="search"]');
    await page.evaluate(() => { window.wrongQuestionBook = null; });
    assert.equal(await select.inputValue(), 'verbal-logical-fill');
    await select.selectOption('general');
    await page.fill('#solver-prompt', '继续分析');
    await page.click('#solver-send');
    await page.waitForFunction(() => !document.querySelector('#solver-question-type').disabled && document.querySelectorAll('.solver-message').length >= 4);
    assert.equal(requests.length, 2);
    assert.ok(!requests[1].instructions.includes('成语的拆分'));
    assert.equal(requests[1].input.length, 3);
    const stored = await page.evaluate(() => new Promise((resolve, reject) => {
      const open = indexedDB.open('summer-politics-ai-sessions');
      open.onsuccess = () => {
        const request = open.result.transaction('sessions').objectStore('sessions').getAll();
        request.onsuccess = () => { resolve(request.result); open.result.close(); };
        request.onerror = reject;
      };
      open.onerror = reject;
    }));
    assert.equal(stored[0].messages[0].questionType, 'verbal-logical-fill');
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 900 });
      const bounds = await select.boundingBox();
      assert.ok(bounds.width > 180 && bounds.x >= 0 && bounds.x + bounds.width <= width);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      if (process.env.SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR, `solver-type-${width}.png`) });
    }
    await page.evaluate(() => {
      const originalFetch = window.fetch;
      window.fetch = (url, options) => {
        if (String(url).includes('solver-test.invalid/v1/responses')) {
          return Promise.resolve(new Response(new ReadableStream({
            start(controller) { window.testStream = controller; }
          }), { headers: { 'Content-Type': 'text/event-stream' } }));
        }
        return originalFetch(url, options);
      };
    });
    await page.fill('#solver-prompt', '测试流式阅读位置');
    await page.click('#solver-send');
    await page.waitForFunction(() => Boolean(window.testStream));
    // Let the intentional send-time scroll finish before testing streamed updates.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const emit = (type, delta) => page.evaluate(({ type, delta }) => {
      window.testStream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type, delta })}\n\n`));
    }, { type, delta });
    await emit('response.output_text.delta', '正文段落。\n\n'.repeat(150));
    await page.waitForFunction(() => document.querySelector('#solver-messages').textContent.includes('正文段落'));
    await page.evaluate(() => { document.querySelector('#solver-workspace').scrollTop = 100; });
    const position = await page.locator('#solver-workspace').evaluate(el => el.scrollTop);
    await emit('response.reasoning_summary_text.delta', '思考摘要。\n\n'.repeat(30));
    await emit('response.output_text.delta', '更多正文。\n\n'.repeat(50));
    await page.waitForFunction(() => document.querySelector('#solver-messages').textContent.includes('更多正文'));
    assert.equal(await page.locator('#solver-workspace').evaluate(el => el.scrollTop), position);
    await page.evaluate(() => {
      window.testStream.enqueue(new TextEncoder().encode('data: {"type":"response.completed","response":{"status":"completed"}}\n\n'));
      window.testStream.close();
    });
    await page.waitForFunction(() => !document.querySelector('#solver-question-type').disabled);
    assert.equal(await page.locator('#solver-workspace').evaluate(el => el.scrollTop), position);
    assert.deepEqual(errors, []);
    console.log('PASS: camera crop, cancel, original, recrop, responsive dialog, type-specific instructions, image input, SSE, history and persistence');
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
