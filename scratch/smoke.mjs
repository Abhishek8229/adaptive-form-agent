import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { Bot } from '../tests/.dist/bot.test.mjs'; // Bot class
import { detectPage } from '../tests/.dist/integration.test.mjs'; // detector
import { runInteraction } from '../tests/.dist/integration.test.mjs'; // engine

const htmlPath = resolve('tests/complex-form.html');
const profilePath = resolve('tests/comprehensive-profile.json');

const html = readFileSync(htmlPath, 'utf8');
let profile = JSON.parse(readFileSync(profilePath, 'utf8'));

// Apply user tweaks
profile.referralSource = "other";
profile.referralOther = "A podcast episode";

const dom = new JSDOM(html, { runScripts: "dangerously" });
const win = dom.window;
const doc = win.document;
global.window = win;
global.document = doc;

// Polyfills
win.getComputedStyle = (el) => {
  let display = 'block';
  let visibility = 'visible';
  let opacity = '1';
  if (el.hasAttribute('style')) {
    const style = el.getAttribute('style');
    if (style.includes('display: none') || style.includes('display:none')) display = 'none';
  }
  let curr = el;
  while (curr && curr !== doc.body) {
    if (curr.classList && curr.classList.contains('hidden-section') && curr.style.display !== 'block') {
      display = 'none';
    }
    curr = curr.parentElement;
  }
  return { display, visibility, opacity };
};

const bridge = {
  getFields: async () => {
    return detectPage(doc);
  },
  interact: async (fieldsHash, request) => {
    try {
      const res = runInteraction(doc, fieldsHash, request);
      return res;
    } catch (err) {
      return { ok: false, reason: err.message };
    }
  }
};

const bot = new Bot(bridge, { profile, id: 'test' });
bot.run().then(state => {
  console.log(`Completed: ${state.stats.completed}`);
  console.log(`Skipped: ${state.stats.skipped}`);
  console.log(`Failed: ${state.stats.failed}`);
  console.log(`Total: ${state.stats.total}`);
  if (state.status === 'done_rescan_needed') {
    console.log("Second manual scan required: YES");
  } else {
    console.log("Second manual scan required: NO");
  }
});
