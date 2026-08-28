/**
 * Real Chromium smoke test for the FIELD ↔ VISUAL QUESTION ASSOCIATION path.
 *
 * 1. Launch real Chrome with the unpacked dist/ extension loaded.
 * 2. Run a fake OCR server on http://127.0.0.1:11434 that returns positioned
 *    OCR regions (no real OCR model needed). The regions sit directly above
 *    the field's viewport bounding box.
 * 3. Load tests/chrome-visual-smoke.html — a "weak-DOM" form whose input has
 *    no name, id, label, aria, or placeholder. Only the visible question
 *    text sits above the input.
 * 4. Trigger the content-script's test bridge to save a hardcoded
 *    {yearsExperience: "5"} profile and start the bot.
 * 5. Assert that:
 *      - the mock OCR server received a real screenshot, and
 *      - the field received the value "5", proving that
 *        screenshot → crop → OCR regions → visual association →
 *        profile-key matching drove the fill.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const html = readFileSync(resolve('tests/chrome-visual-smoke.html'), 'utf8');
const extPath = resolve('dist');
const port = 9223;
const chromePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const chromePathAlt = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

let ollamaRequests = 0;
let screenshotSeen = false;
let lastRegionText = null;
let finalFieldValue = null;

const ollamaServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c.toString()));
  req.on('end', () => {
    if (req.url.includes('/api/ocr') && req.method === 'POST') {
      ollamaRequests++;
      try {
        const payload = JSON.parse(body);
        if (payload.image && payload.image.length > 100) screenshotSeen = true;
      } catch {}
      // The screenshot crop is whatever the extension captured; the OCR
      // response is positioned in crop-image coordinates. Because the
      // viewport translation in visual-association.ts uses cropOffset to
      // map region (x,y) -> viewport (x + x/scale, y + y/scale), we
      // choose conservative crop coordinates that map into the viewport
      // bounding box of the field. The text content is the question text
      // that visually sits above the input.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          text: 'How many years of professional experience do you have?',
          confidence: 0.99,
          regions: [
            { text: 'How many years of professional experience do you have?',
              confidence: 0.99, x: 60, y: 40, width: 480, height: 28 },
          ],
        }),
      );
      lastRegionText = 'How many years of professional experience do you have?';
      return;
    }
    if (req.url.includes('/api/generate') && req.method === 'POST') {
      ollamaRequests++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ response: '{"profileKey":null,"confidence":0}' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
});

const pageServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(html);
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  ollamaServer.listen(11434, '127.0.0.1');
  pageServer.listen(8081, '127.0.0.1');
  const userDataDir = await mkdtemp(join(tmpdir(), 'afa-visual-'));

  const fs = await import('node:fs');
  const exe = fs.existsSync(chromePath) ? chromePath : chromePathAlt;

  const browser = spawn(exe, [
    `--remote-debugging-port=${port}`,
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    `--user-data-dir=${userDataDir}`,
    `--load-extension=${extPath}`,
    `http://127.0.0.1:8081/chrome-visual-smoke.html`,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  browser.stdout.on('data', (d) => process.stderr.write('[chrome] ' + d));
  browser.stderr.on('data', (d) => process.stderr.write('[chrome-err] ' + d));
  browser.on('exit', (code) => console.error('[chrome exited] code=' + code));

  try {
    await wait(4000);

    let page = null;
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/list`);
        const targets = await res.json();
        page = targets.find((t) => t.type === 'page' && t.url.includes('chrome-visual-smoke.html'));
        if (page) break;
      } catch (_) {}
      await wait(1000);
    }
    if (!page) throw new Error('No page target found');

    const pageWs = new WebSocket(page.webSocketDebuggerUrl);
    const pageCallbacks = new Map();
    let pageId = 1;
    pageWs.addEventListener('message', (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch (e) { return; }
      if (msg.id != null && pageCallbacks.has(msg.id)) {
        pageCallbacks.get(msg.id)(msg);
        pageCallbacks.delete(msg.id);
      }
    });
    const sendPage = (method, params) => new Promise((resolve) => {
      const id = pageId++;
      pageCallbacks.set(id, resolve);
      pageWs.send(JSON.stringify({ id, method, params }));
    });
    await new Promise((r) => { pageWs.onopen = r; });
    await sendPage('Runtime.enable', {});
    await sendPage('Page.enable', {});
    await wait(2500);

    // Confirm the page is alive before we start driving the bot.
    const sanity = await sendPage('Runtime.evaluate', {
      expression: `'ALIVE:' + document.title + ':' + (document.getElementById('years-input') ? 'YES' : 'NO')`,
      returnByValue: true,
    });
    console.log('SANITY result=' + JSON.stringify(sanity.result) + ' exception=' + JSON.stringify(sanity.exceptionDetails));

    // Trigger the content-script's existing test bridge: save profile and
    // start the bot on the current tab.
    await sendPage('Runtime.evaluate', {
      expression: `window.dispatchEvent(new CustomEvent('AFA_TEST_SAVE_PROFILE'))`,
    });
    await wait(500);
    await sendPage('Runtime.evaluate', {
      expression: `window.dispatchEvent(new CustomEvent('AFA_TEST_START_BOT', { detail: { tabId: undefined } }))`,
    });

    // Wait for the OCR request to arrive (screenshot was sent).
    for (let i = 0; i < 30; i++) {
      if (screenshotSeen) break;
      await wait(500);
    }

    // Wait for the field to be filled.
    for (let i = 0; i < 60; i++) {
      const valRes = await sendPage('Runtime.evaluate', {
        expression: `document.getElementById('years-input') ? document.getElementById('years-input').value : 'NO_INPUT'`,
        returnByValue: true,
      });
      finalFieldValue = valRes?.result?.result?.value;
      if (finalFieldValue && finalFieldValue !== 'NO_INPUT') break;
      await wait(500);
    }

    // Capture diagnostics from the page if the field was not filled.
    if (finalFieldValue !== '5') {
      const diag = await sendPage('Runtime.evaluate', {
        expression: `JSON.stringify({url: location.href, hasInput: !!document.getElementById('years-input')})`,
        returnByValue: true,
      });
      console.log('DIAG ' + diag.result?.value);
    }
  } finally {
    browser.kill();
    ollamaServer.close();
    pageServer.close();
    try { await rm(userDataDir, { recursive: true, force: true }); } catch (_) {}
  }

  const summary = {
    ollamaRequests,
    screenshotSeen,
    lastRegionText,
    finalFieldValue,
  };
  console.log('VISUAL_SMOKE_RESULT ' + JSON.stringify(summary));
  if (!screenshotSeen) {
    console.error('FAIL: OCR server never received a screenshot');
    process.exit(1);
  }
  if (finalFieldValue !== '5') {
    console.error(`FAIL: expected field value "5", got "${finalFieldValue}"`);
    process.exit(1);
  }
  console.log('PASS: visual association drove the field to expected value');
}

run().catch((e) => { console.error(e); process.exit(1); });
