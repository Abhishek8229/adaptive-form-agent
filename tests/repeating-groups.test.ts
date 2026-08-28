import { test } from 'node:test';
import * as assert from 'node:assert';
import { JSDOM } from 'jsdom';
import { detectPage } from '../src/content/detector';
import { Bot, type ContentBridge } from '../src/background/bot';
import { planField } from '../src/background/agent';
import type { FormPage } from '../src/shared/types';

function setupDom(html: string) {
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
  const w = dom.window as any;
  global.window = w;
  global.document = w.document;
  global.HTMLElement = w.HTMLElement;
  global.HTMLInputElement = w.HTMLInputElement;
  global.HTMLSelectElement = w.HTMLSelectElement;
  global.HTMLTextAreaElement = w.HTMLTextAreaElement;
  global.HTMLButtonElement = w.HTMLButtonElement;
  global.HTMLFormElement = w.HTMLFormElement;
  global.location = w.location;
  const protoProto = Object.getPrototypeOf(w.HTMLElement.prototype);
  protoProto.getBoundingClientRect = function () {
    return { x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 30, width: 100, height: 30, toJSON() { return {}; } };
  };
  return dom;
}

test('1 & 4. Detecting a repeated group by indexed field names', async () => {
  setupDom(`<form>
    <input name="education[0].school" />
    <input name="education[1].school" />
  </form>`);
  const page = detectPage();
  assert.equal(page.forms[0].fields.length, 2);
  assert.equal(page.forms[0].fields[0].repeatingGroup?.baseName, 'education');
  assert.equal(page.forms[0].fields[0].repeatingGroup?.index, 0);
  assert.equal(page.forms[0].fields[1].repeatingGroup?.baseName, 'education');
  assert.equal(page.forms[0].fields[1].repeatingGroup?.index, 1);
});

test('5. Repeated fieldsets/containers', async () => {
  setupDom(`<form>
    <fieldset>
      <legend>Education</legend>
      <input name="school_a" />
    </fieldset>
    <fieldset>
      <legend>Education</legend>
      <input name="school_b" />
    </fieldset>
  </form>`);
  const page = detectPage();
  assert.equal(page.forms[0].fields.length, 2);
  assert.equal(page.forms[0].fields[0].repeatingGroup?.baseName, 'education');
  assert.equal(page.forms[0].fields[0].repeatingGroup?.index, 0);
  assert.equal(page.forms[0].fields[1].repeatingGroup?.baseName, 'education');
  assert.equal(page.forms[0].fields[1].repeatingGroup?.index, 1);
});

test('2 & 3. Mapping instance 0 to array item 0 and instance 1 to item 1', async () => {
  setupDom(`<form>
    <input name="education[0].school" />
    <input name="education[1].school" />
  </form>`);
  const page = detectPage();
  const profile = {
    education: [
      { school: "ABC" },
      { school: "XYZ" }
    ]
  };
  
  const p0 = await planField(page.forms[0].fields[0], profile.education[0]);
  assert.equal(p0.ok, true);
  if (p0.ok) assert.equal(p0.request.value, 'ABC');

  const p1 = await planField(page.forms[0].fields[1], profile.education[1]);
  assert.equal(p1.ok, true);
  if (p1.ok) assert.equal(p1.request.value, 'XYZ');
});

function mockBridge(pageFn: () => FormPage): ContentBridge {
  let interactions = 0;
  return {
    async scan() { return { ok: true, result: pageFn() }; },
    async interact(tabId, req) {
      interactions++;
      if (req.kind === 'click-button') {
        return { ok: true, result: { success: true, updatedValue: 'clicked' } };
      }
      return { ok: true, result: { success: true, updatedValue: 'ok' } };
    }
  };
}

test('6. Profile with fewer records than form instances', async () => {
  setupDom(`<form>
    <input name="education[0].school" />
    <input name="education[1].school" />
  </form>`);
  
  const bot = new Bot({
    tabId: 1,
    profile: { profile: { education: [{ school: 'ABC' }] } } as any,
    bridge: mockBridge(() => detectPage()),
    pushStatus: () => {}
  });
  
  await bot.run();
  assert.equal(bot.counters.completed, 1); // Only fills instance 0
  assert.equal(bot.counters.skipped, 1);   // Skips instance 1
});

test('7, 8, 9. Clearly associated Add another behavior vs ambiguous vs more records', async () => {
  let callCount = 0;
  
  const dom = setupDom(`<form>
    <fieldset>
      <legend>Work Experience</legend>
      <input name="company" />
    </fieldset>
    <button type="button">Add Work Experience</button>
    <button type="button">Add Random</button>
  </form>`);
  
  const bridge = mockBridge(() => {
    // When interact is called, it simulates the page expanding!
    if (callCount > 0) {
      const fs = dom.window.document.createElement('fieldset');
      fs.innerHTML = '<legend>Work Experience</legend><input name="company" />';
      dom.window.document.forms[0].appendChild(fs);
    }
    const page = detectPage();
    return page;
  });
  const originalInteract = bridge.interact;
  let clickedBtn: string | null = null;
  bridge.interact = async (t, r) => {
    if (r.kind === 'click-button') {
      callCount++;
      const p = detectPage();
      const btn = p.forms.flatMap(f => f.submitControls).find(c => c.stableId === r.stableId);
      clickedBtn = btn?.text || null;
    }
    return originalInteract(t, r);
  };
  
  const bot = new Bot({
    tabId: 1,
    profile: { profile: { workExperience: [{ company: 'A' }, { company: 'B' }] } } as any,
    bridge,
    pushStatus: () => {}
  });
  
  await bot.run();
  
  // It should fill A, see it needs B, click "Add Work Experience", then fill B.
  assert.equal(callCount, 1);
  assert.equal(clickedBtn, 'Add Work Experience');
  assert.equal(bot.counters.completed, 2);
});

test('10. Existing normal fields still work unchanged', async () => {
  setupDom(`<form>
    <input name="firstName" />
    <input name="lastName" />
  </form>`);
  
  const bot = new Bot({
    tabId: 1,
    profile: { profile: { firstName: 'Jane', lastName: 'Doe' } } as any,
    bridge: mockBridge(() => detectPage()),
    pushStatus: () => {}
  });
  
  await bot.run();
  assert.equal(bot.counters.completed, 2);
});
