import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';

const html = `<!DOCTYPE html>
<html>
<body>
  <div id="test-container" style="padding: 50px;">
    <span>How many years have you worked professionally?</span>
    <div>
      <input type="text" id="years" />
    </div>
  </div>
</body>
</html>`;

const port = 9222;
const chromePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'; 
const extPath = resolve('dist');

let capturedImage = null;
let capturedPayload = null;
let ollamaRequests = 0;

const ollamaServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => body += chunk.toString());
  req.on('end', () => {
    if (req.url.includes('/api/ocr') && req.method === 'POST') {
      ollamaRequests++;
      const payload = JSON.parse(body);
      console.log('[Fake OCR] Received Vision request with image!');
      capturedPayload = payload;
      capturedImage = payload.image;
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        text: 'Multiple regions found',
        confidence: 0.99,
        regions: [
          { text: 'What is your current', confidence: 0.99, x: 150, y: 100, width: 150, height: 20 },
          { text: 'annual salary?', confidence: 0.99, x: 150, y: 120, width: 120, height: 20 }
        ]
      }));
      return;
    }

    if (req.url.includes('/api/generate') && req.method === 'POST') {
      ollamaRequests++;
      const payload = JSON.parse(body);
      
      if (!payload.images || payload.images.length === 0) {
        console.log('[Fake Ollama] Received LLM request, rejecting to trigger Vision/OCR.');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ response: '{"profileKey":null,"confidence":0}' }));
        return;
      }
      
      console.log('[Fake Ollama] Received Vision request with image!');
      capturedPayload = payload;
      capturedImage = payload.images[0];
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ response: '{"profileKey":"yearsExperience","confidence":0.99}' }));
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

async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  ollamaServer.listen(11434, '127.0.0.1');
  pageServer.listen(8080, '127.0.0.1');

  const browser = spawn(chromePath, [
    `--remote-debugging-port=${port}`,
    '--headless=new',
    '--disable-gpu',
    `--user-data-dir=${resolve('tests/.edge-profile')}`,
    `--load-extension=${extPath}`,
    `http://127.0.0.1:8080/chrome-extension-smoke.html`
  ]);

  try {
    await wait(3000); // Wait for Chrome and extension to initialize

    let page = null;
    for (let i = 0; i < 20; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/list`);
        const targets = await res.json();
        page = targets.find(t => t.type === 'page' && t.url.includes('chrome-extension-smoke.html'));
        if (page) break;
      } catch(e) {}
      await wait(1000);
    }
    if (!page) throw new Error('No page found');

    const pageWs = new WebSocket(page.webSocketDebuggerUrl);
    let pageId = 1;
    const pageCallbacks = new Map();
    pageWs.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === 'Runtime.consoleAPICalled') {
        console.log('PAGE CONSOLE:', msg.params.args.map(a => a.value).join(' '));
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        console.log('PAGE EXCEPTION:', msg.params.exceptionDetails);
      }
      if (pageCallbacks.has(msg.id)) {
        pageCallbacks.get(msg.id)(msg);
        pageCallbacks.delete(msg.id);
      }
    };
    const sendPage = async (method, params) => {
      return new Promise((resolve) => {
        const msgId = pageId++;
        pageCallbacks.set(msgId, resolve);
        pageWs.send(JSON.stringify({ id: msgId, method, params }));
      });
    };
    await new Promise(r => { pageWs.onopen = r; });
    await sendPage('Runtime.enable', {});
    await sendPage('Page.enable', {});
    await wait(2000); // Wait for page to reload and content script to inject

    console.log('Finding extension ID via content script context...');
    
    await sendPage('Runtime.evaluate', {
      expression: `
        window.addEventListener('AFA_TEST_ID_RESPONSE', (e) => window.afaExtId = e.detail);
        window.dispatchEvent(new CustomEvent('AFA_TEST_GET_ID'));
      `
    });
    
    await wait(1000);
    
    const idRes = await sendPage('Runtime.evaluate', {
      expression: `window.afaExtId`,
      returnByValue: true
    });
    
    const extId = idRes.result?.value;
    console.log('EXT ID:', extId);
    
    if (extId) {
      // Connect to the background or popup by opening it
      console.log('Opening popup to wake up background...');
      const targetRes = await fetch(`http://127.0.0.1:${port}/json/new?chrome-extension://${extId}/popup/popup.html`, { method: 'PUT' });
      const popupTarget = await targetRes.json();
      const popupWs = new WebSocket(popupTarget.webSocketDebuggerUrl);
      // Wait for it to connect
      await new Promise(r => { popupWs.onopen = r; });
      let pId = 1;
      const sendPopup = (method, params) => new Promise(resolve => {
         const i = pId++;
         popupWs.addEventListener('message', function l(e) {
             const m = JSON.parse(e.data);
             if (m.id === i) { popupWs.removeEventListener('message', l); resolve(m); }
         });
         popupWs.send(JSON.stringify({id: i, method, params}));
      });
      await sendPopup('Runtime.enable', {});
      await wait(1000);
      console.log('Triggering bot from popup context...');
      await sendPopup('Runtime.evaluate', {
        expression: `
          (async () => {
            const tabs = await chrome.tabs.query({url: "*://127.0.0.1/*"});
            const tabId = tabs[0].id;
            await chrome.runtime.sendMessage({
              type: 'AFA_PROFILE_SAVE',
              id: 'test-profile',
              name: 'test',
              profile: { expectedSalary: "100000" }
            });
            await chrome.runtime.sendMessage({
              type: 'AFA_BOT_START',
              tabId,
              profileId: 'test-profile'
            });
          })();
        `,
        awaitPromise: true
      });
      console.log('Bot triggered from popup!');
    } else {
       console.error('Failed to get extension ID, falling back to window events...');
       console.log('Triggering profile save...');
       await sendPage('Runtime.evaluate', {
         expression: `window.dispatchEvent(new CustomEvent('AFA_TEST_SAVE_PROFILE'))`
       });
       await wait(1000);
       console.log('Triggering bot start...');
       await sendPage('Runtime.evaluate', {
         expression: `window.dispatchEvent(new CustomEvent('AFA_TEST_START_BOT', { detail: { tabId: undefined } }))`
       });
    }
    
    console.log('Waiting for Vision Request...');
    for (let i = 0; i < 20; i++) {
      if (capturedImage) break;
      await wait(1000);
    }

    if (!capturedImage) {
      throw new Error('Timeout: Did not receive image payload on Fake Ollama server. Total requests: ' + ollamaRequests);
    }

    console.log('Successfully captured image!');
    const buf = Buffer.from(capturedImage, 'base64');
    writeFileSync(resolve('tests/captured-crop.jpg'), buf);
    console.log('Saved captured crop to tests/captured-crop.jpg (Size:', buf.length, 'bytes)');

  } finally {
    browser.kill();
    ollamaServer.close();
    pageServer.close();
  }
}
run();
