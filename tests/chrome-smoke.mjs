import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const html = `<!DOCTYPE html>
<html>
<body>
  <div id="test-container" style="padding: 50px;">
    <span>How many years have you worked professionally?</span>
    <div>
      <input type="text" id="years" />
    </div>
    <div style="display:none;">hidden secret text</div>
  </div>
</body>
</html>`;

const htmlPath = resolve('tests/chrome-smoke.html');
writeFileSync(htmlPath, html);

const port = 9222;
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'; // common windows path, or we can use edge

async function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  const browser = spawn(chromePath, [
    `--remote-debugging-port=${port}`,
    '--headless',
    '--disable-gpu',
    `file:///${htmlPath.replace(/\\/g, '/')}`
  ]);

  try {
    // Wait for chrome to start
    await wait(2000);

    const res = await fetch(`http://127.0.0.1:${port}/json/list`);
    const targets = await res.json();
    const page = targets.find(t => t.type === 'page');
    
    if (!page) {
      console.log('No page found');
      return;
    }

    console.log(`Connected to page: ${page.url}`);
    
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 1;
    const callbacks = new Map();

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (callbacks.has(msg.id)) {
        callbacks.get(msg.id)(msg);
        callbacks.delete(msg.id);
      }
    };

    const send = async (method, params) => {
      return new Promise((resolve) => {
        const msgId = id++;
        callbacks.set(msgId, resolve);
        ws.send(JSON.stringify({ id: msgId, method, params }));
      });
    };

    await new Promise(r => { ws.onopen = r; });

    console.log('Evaluating detector...');
    const detectorSource = readFileSync(resolve('tests/smoke-browser-bundle.js'), 'utf8');
    
    // Inject detector
    await send('Runtime.evaluate', {
      expression: detectorSource,
      returnByValue: true
    });

    await wait(500); 

    // Run getVisualContext
    const evalRes = await send('Runtime.evaluate', {
      expression: `
        (function() {
          const page = window.detectPage();
          if (!page || page.totalFieldCount === 0) return { error: 'no fields' };
          const field = page.forms[0].fields[0];
          const ctx = window.getVisualContext(field.stableId);
          return { field, visualContext: ctx };
        })()
      `,
      returnByValue: true
    });

    console.log(JSON.stringify(evalRes, null, 2));

    ws.close();
  } catch (e) {
    console.error(e);
  } finally {
    browser.kill();
  }
}

run();
