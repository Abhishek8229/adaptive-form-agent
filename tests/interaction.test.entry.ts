import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testPagePath = resolve(__dirname, '..', '..', 'test', 'test-page.html');

const seedHtml = readFileSync(testPagePath, 'utf8');
const seedDom = new JSDOM(seedHtml, { url: 'http://localhost/', pretendToBeVisual: true });
const g = globalThis as unknown as Record<string, unknown>;
g.window = seedDom.window;
g.document = seedDom.window.document;
g.location = seedDom.window.location;
g.HTMLElement = seedDom.window.HTMLElement;
g.HTMLInputElement = seedDom.window.HTMLInputElement;
g.HTMLTextAreaElement = seedDom.window.HTMLTextAreaElement;
g.HTMLSelectElement = seedDom.window.HTMLSelectElement;
g.HTMLButtonElement = seedDom.window.HTMLButtonElement;
g.HTMLOptionElement = seedDom.window.HTMLOptionElement;
g.HTMLFormElement = seedDom.window.HTMLFormElement;
g.HTMLLabelElement = seedDom.window.HTMLLabelElement;
g.HTMLCollection = seedDom.window.HTMLCollection;
g.Element = seedDom.window.Element;
g.Event = seedDom.window.Event;
g.MouseEvent = seedDom.window.MouseEvent;
g.CustomEvent = seedDom.window.CustomEvent;
g.CSS = seedDom.window.CSS || { escape: (s: string) => s.replace(/([!"#$%&'()*+,./:;<=>?@[\]^`{|}~])/g, '\\$1') };
g.Node = seedDom.window.Node;
g.MutationObserver = seedDom.window.MutationObserver;
g.getComputedStyle = seedDom.window.getComputedStyle.bind(seedDom.window);

function installVisibilityShim(dom: JSDOM): void {
  const protoProto = Object.getPrototypeOf(dom.window.HTMLElement.prototype) as { getBoundingClientRect?: () => DOMRect };
  protoProto.getBoundingClientRect = function (this: Element) {
    if (this.classList.contains('display-none')) {
      return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() { return {}; } } as DOMRect;
    }
    if (this.classList.contains('hidden-vis')) {
      return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() { return {}; } } as DOMRect;
    }
    if (this.classList.contains('opacity-zero')) {
      return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() { return {}; } } as DOMRect;
    }
    return { x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 30, width: 100, height: 30, toJSON() { return {}; } } as DOMRect;
  };
}

installVisibilityShim(seedDom);

const { detectPage } = await import('../src/content/detector.ts');
const { runInteraction, setPageSnapshot } = await import('../src/content/interaction/engine.ts');
const typesMod = await import('../src/shared/types.ts');
const interactionMod = await import('../src/shared/interaction.ts');

type FormField = typesMod.FormField;
type FormPage = typesMod.FormPage;
type FormSubmitControl = typesMod.FormSubmitControl;
type InteractionRequest = interactionMod.InteractionRequest;


function initDomGlobals(dom: JSDOM) {
  (globalThis as unknown as { document: Document }).document = dom.window.document;
  (globalThis as unknown as { window: Window }).window = dom.window;
  (globalThis as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement = dom.window.HTMLElement;
  (globalThis as unknown as { HTMLInputElement: typeof HTMLInputElement }).HTMLInputElement = dom.window.HTMLInputElement;
  (globalThis as unknown as { HTMLTextAreaElement: typeof HTMLTextAreaElement }).HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
  (globalThis as unknown as { HTMLSelectElement: typeof HTMLSelectElement }).HTMLSelectElement = dom.window.HTMLSelectElement;
  (globalThis as unknown as { HTMLButtonElement: typeof HTMLButtonElement }).HTMLButtonElement = dom.window.HTMLButtonElement;
  (globalThis as unknown as { HTMLFormElement: typeof HTMLFormElement }).HTMLFormElement = dom.window.HTMLFormElement;
  (globalThis as unknown as { Element: typeof Element }).Element = dom.window.Element;
}

function loadPage(): { page: FormPage; dom: JSDOM; findFieldById(id: string): FormField | null; findFieldByName(name: string): FormField | null; findSubmitByText(text: string): FormSubmitControl | null } {
  const html = readFileSync(testPagePath, 'utf8');
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/' });
  installVisibilityShim(dom);
  initDomGlobals(dom);
  const w = dom.window as unknown as Window & { __AFA_LAST_PAGE: FormPage | null };
  w.__AFA_LAST_PAGE = null;
  setPageSnapshot(null);
  const page = detectPage();
  w.__AFA_LAST_PAGE = page;
  setPageSnapshot(page);

  function findFieldById(id: string): FormField | null {
    for (const g of page.forms) for (const f of g.fields) if (f.id === id) return f;
    return null;
  }
  function findFieldByName(name: string): FormField | null {
    for (const g of page.forms) for (const f of g.fields) if (f.name === name) return f;
    return null;
  }
  function findSubmitByText(text: string): FormSubmitControl | null {
    for (const g of page.forms) for (const s of g.submitControls) if (s.text.trim() === text) return s;
    return null;
  }
  return { page, dom, findFieldById, findFieldByName, findSubmitByText };
}

async function runWith<T>(fn: (s: ReturnType<typeof loadPage>) => T | Promise<T>): Promise<T> {
  const setup = loadPage();
  try {
    return await fn(setup);
  } finally {
    setup.dom.window.close();
  }
}

test('interaction: set-text on #email succeeds and verifies', async () => {
  await runWith(async (s) => {
    const f = s.findFieldById('email');
    assert.ok(f, 'email field should be detected');
    const req: InteractionRequest = { kind: 'set-text', stableId: f.stableId, value: 'foo@example.com' };
    const result = await runInteraction(req);
    assert.equal(result.success, true, JSON.stringify(result));
    const el = s.dom.window.document.getElementById('email') as HTMLInputElement;
    assert.equal(el.value, 'foo@example.com');
  });
});

test('interaction: set-text triggers input/change events', async () => {
  await runWith(async (s) => {
    const f = s.findFieldById('email');
    assert.ok(f);
    const el = s.dom.window.document.getElementById('email') as HTMLInputElement;
    let inputCount = 0;
    let changeCount = 0;
    el.addEventListener('input', () => { inputCount += 1; });
    el.addEventListener('change', () => { changeCount += 1; });
    const req: InteractionRequest = { kind: 'set-text', stableId: f.stableId, value: 'bar@example.com' };
    const result = await runInteraction(req);
    assert.equal(result.success, true);
    assert.ok(inputCount >= 1, 'input event should have fired');
    assert.ok(changeCount >= 1, 'change event should have fired');
  });
});

test('interaction: set-textarea on #bio succeeds', async () => {
  await runWith(async (s) => {
    const f = s.findFieldById('bio');
    assert.ok(f);
    const req: InteractionRequest = { kind: 'set-textarea', stableId: f.stableId, value: 'Hello\nWorld' };
    const result = await runInteraction(req);
    assert.equal(result.success, true, JSON.stringify(result));
    const el = s.dom.window.document.getElementById('bio') as HTMLTextAreaElement;
    assert.equal(el.value, 'Hello\nWorld');
  });
});

test('interaction: check a checkbox', async () => {
  await runWith(async (s) => {
    const f = s.findFieldByName('interests');
    assert.ok(f);
    const req: InteractionRequest = { kind: 'check', stableId: f.stableId };
    const result = await runInteraction(req);
    assert.equal(result.success, true, JSON.stringify(result));
  });
});

test('interaction: uncheck a checkbox', async () => {
  await runWith(async (s) => {
    const page = s.page;
    const checkboxes = page.forms.flatMap((g) => g.fields).filter((x) => x.type === 'checkbox' && x.name === 'interests');
    const checkedOne = checkboxes.find((x) => x.valuePresent === true);
    const f = checkedOne ?? checkboxes[0];
    assert.ok(f);
    const req: InteractionRequest = { kind: 'uncheck', stableId: f.stableId };
    const result = await runInteraction(req);
    assert.equal(result.success, true, JSON.stringify(result));
  });
});

test('interaction: select-radio by value', async () => {
  await runWith(async (s) => {
    const page = s.page;
    const f = page.forms.flatMap((g) => g.fields).find((x) => x.type === 'radio' && x.name === 'tier' && x.options.some((o) => o.value === 'team'));
    assert.ok(f, 'radio for tier=team should be detected');
    if (!f) return;
    const req: InteractionRequest = { kind: 'select-radio', stableId: f.stableId, value: 'team' };
    const result = await runInteraction(req);
    assert.equal(result.success, true, JSON.stringify(result));
  });
});

test('interaction: select-radio rejects unknown value', async () => {
  await runWith(async (s) => {
    const page = s.page;
    const f = page.forms.flatMap((g) => g.fields).find((x) => x.type === 'radio' && x.name === 'tier');
    assert.ok(f);
    const req: InteractionRequest = { kind: 'select-radio', stableId: f.stableId, value: 'nope' };
    const result = await runInteraction(req);
    assert.equal(result.success, false);
    assert.match(result.reason ?? '', /not found/);
  });
});

test('interaction: native select by value', async () => {
  await runWith(async (s) => {
    const f = s.findFieldById('country');
    assert.ok(f);
    const req: InteractionRequest = { kind: 'select-option', stableId: f.stableId, by: 'value', value: 'in' };
    const result = await runInteraction(req);
    assert.equal(result.success, true, JSON.stringify(result));
    const el = s.dom.window.document.getElementById('country') as HTMLSelectElement;
    assert.equal(el.value, 'in');
  });
});

test('interaction: native select by visible text', async () => {
  await runWith(async (s) => {
    const f = s.findFieldById('country');
    assert.ok(f);
    const req: InteractionRequest = { kind: 'select-option', stableId: f.stableId, by: 'text', value: 'India' };
    const result = await runInteraction(req);
    assert.equal(result.success, true, JSON.stringify(result));
    const el = s.dom.window.document.getElementById('country') as HTMLSelectElement;
    assert.equal(el.value, 'in');
  });
});

test('interaction: native select wrong option fails', async () => {
  await runWith(async (s) => {
    const f = s.findFieldById('country');
    assert.ok(f);
    const req: InteractionRequest = { kind: 'select-option', stableId: f.stableId, by: 'value', value: 'xx' };
    const result = await runInteraction(req);
    assert.equal(result.success, false);
    assert.match(result.reason ?? '', /no option/);
  });
});

test('interaction: set-date with valid value', async () => {
  await runWith(async (s) => {
    const f = s.findFieldById('dob');
    assert.ok(f);
    const req: InteractionRequest = { kind: 'set-date', stableId: f.stableId, value: '1990-01-15' };
    const result = await runInteraction(req);
    assert.equal(result.success, true, JSON.stringify(result));
    const el = s.dom.window.document.getElementById('dob') as HTMLInputElement;
    assert.equal(el.value, '1990-01-15');
  });
});

test('interaction: set-time with valid value', async () => {
  await runWith(async (s) => {
    const f = s.findFieldById('appointment-time');
    assert.ok(f);
    const req: InteractionRequest = { kind: 'set-time', stableId: f.stableId, value: '09:30' };
    const result = await runInteraction(req);
    assert.equal(result.success, true, JSON.stringify(result));
    const el = s.dom.window.document.getElementById('appointment-time') as HTMLInputElement;
    assert.equal(el.value, '09:30');
  });
});

test('interaction: validation failure on pattern mismatch', async () => {
  await runWith(async (s) => {
    const f = s.findFieldById('zipcode-pattern');
    assert.ok(f);
    const req: InteractionRequest = { kind: 'set-text', stableId: f.stableId, value: 'abc' };
    const result = await runInteraction(req);
    assert.equal(result.success, true, JSON.stringify(result));
    const el = s.dom.window.document.getElementById('zipcode-pattern') as HTMLInputElement;
    assert.equal(el.value, 'abc');
    assert.equal(el.validity.patternMismatch, true, 'patternMismatch should be true');
  });
});

test('interaction: disabled control blocks interaction', async () => {
  await runWith(async (s) => {
    const f = s.findFieldById('disabled-text');
    assert.ok(f);
    const req: InteractionRequest = { kind: 'set-text', stableId: f.stableId, value: 'nope' };
    const result = await runInteraction(req);
    assert.equal(result.success, false);
    assert.match(result.reason ?? '', /disabled/);
    const el = s.dom.window.document.getElementById('disabled-text') as HTMLInputElement;
    assert.equal(el.value, 'cannot edit');
  });
});

test('interaction: readonly control blocks interaction', async () => {
  await runWith(async (s) => {
    const f = s.findFieldById('age');
    assert.ok(f);
    const req: InteractionRequest = { kind: 'set-text', stableId: f.stableId, value: '99' };
    const result = await runInteraction(req);
    assert.equal(result.success, false);
    assert.match(result.reason ?? '', /readOnly/);
  });
});

test('interaction: missing field returns failure', async () => {
  await runWith(async (_s) => {
    const req: InteractionRequest = { kind: 'set-text', stableId: 'does_not_exist', value: 'x' };
    const result = await runInteraction(req);
    assert.equal(result.success, false);
    assert.match(result.reason ?? '', /not found/);
  });
});

test('interaction: password field is blocked by safety', async () => {
  await runWith(async (s) => {
    const f = s.findFieldById('password');
    assert.ok(f);
    const req: InteractionRequest = { kind: 'set-text', stableId: f.stableId, value: 'secret' };
    const result = await runInteraction(req);
    assert.equal(result.success, false);
    assert.match(result.reason ?? '', /blocked by safety/);
    const el = s.dom.window.document.getElementById('password') as HTMLInputElement;
    assert.equal(el.value, '', 'password value should not have changed');
  });
});

test('interaction: click-button on a non-submit button is allowed', async () => {
  await runWith(async (s) => {
    const sub = s.findSubmitByText('Apply filters');
    assert.ok(sub);
    const req: InteractionRequest = { kind: 'click-button', stableId: sub.stableId };
    const result = await runInteraction(req);
    assert.equal(result.success, true, JSON.stringify(result));
  });
});

test('interaction: click-button on a submit button is blocked', async () => {
  await runWith(async (s) => {
    const sub = s.findSubmitByText('Create account');
    assert.ok(sub);
    const req: InteractionRequest = { kind: 'click-button', stableId: sub.stableId };
    const result = await runInteraction(req);
    assert.equal(result.success, false);
    assert.match(result.reason ?? '', /submit|not interacted/);
  });
});

test('interaction: result has structured shape and no password value', async () => {
  await runWith(async (s) => {
    const f = s.findFieldById('email');
    assert.ok(f);
    const req: InteractionRequest = { kind: 'set-text', stableId: f.stableId, value: 'visible@example.com' };
    const result = await runInteraction(req);
    assert.equal(result.success, true);
    assert.equal(result.stableId, f.stableId);
    assert.equal(result.kind, 'set-text');
    assert.equal(result.attemptedValue, 'visible@example.com');
    assert.equal(typeof result.retried, 'boolean');
    assert.ok(result.observed);
    assert.equal(result.observed?.value, 'visible@example.com');
  });
});

test('interaction: detected fields include a target descriptor for re-resolving', async () => {
  await runWith(async (s) => {
    const f = s.findFieldById('email');
    assert.ok(f);
    assert.ok(f.target, 'field should have target metadata');
    assert.equal(f.target.id, 'email');
    assert.equal(f.target.name, 'email');
    assert.equal(f.target.tag, 'input');
    assert.equal(f.target.type, 'email');
    assert.equal(f.target.formId, 'signup-form');
    assert.ok(f.target.selector.length > 0);
  });
});

test('interaction: re-resolve after DOM mutation still finds the field', async () => {
  await runWith(async (s) => {
    const f = s.findFieldById('email');
    assert.ok(f);
    const el = s.dom.window.document.getElementById('email') as HTMLInputElement;
    const parent = el.parentElement;
    parent?.removeChild(el);
    parent?.appendChild(el);
    const req: InteractionRequest = { kind: 'set-text', stableId: f.stableId, value: 'after-mutation@example.com' };
    const result = await runInteraction(req);
    assert.equal(result.success, true, JSON.stringify(result));
    assert.equal((s.dom.window.document.getElementById('email') as HTMLInputElement).value, 'after-mutation@example.com');
  });
});

test('interaction: captcha-shaped field is blocked by safety', async () => {
  const html = `<!doctype html><html><body><form id="x"><input id="c" name="captcha" type="text" /></form></body></html>`;
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
  installVisibilityShim(dom);
  (globalThis as unknown as { document: Document }).document = dom.window.document;
  (globalThis as unknown as { window: Window }).window = dom.window;
  (globalThis as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement = dom.window.HTMLElement;
  (globalThis as unknown as { HTMLInputElement: typeof HTMLInputElement }).HTMLInputElement = dom.window.HTMLInputElement;
  (globalThis as unknown as { HTMLFormElement: typeof HTMLFormElement }).HTMLFormElement = dom.window.HTMLFormElement;
  (globalThis as unknown as { Element: typeof Element }).Element = dom.window.Element;
  const page = detectPage();
  (dom.window as unknown as { __AFA_LAST_PAGE: FormPage | null }).__AFA_LAST_PAGE = page;
  setPageSnapshot(page);
  const f = page.forms[0]?.fields[0];
  assert.ok(f);
  const req: InteractionRequest = { kind: 'set-text', stableId: f.stableId, value: 'x' };
  const result = await runInteraction(req);
  assert.equal(result.success, false);
  assert.match(result.reason ?? '', /captcha/);
  dom.window.close();
});

test('interaction: payment-shaped field is blocked by safety', async () => {
  const html = `<!doctype html><html><body><form id="x"><input id="c" name="creditCardNumber" type="text" autocomplete="cc-number" /></form></body></html>`;
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
  installVisibilityShim(dom);
  (globalThis as unknown as { document: Document }).document = dom.window.document;
  (globalThis as unknown as { window: Window }).window = dom.window;
  (globalThis as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement = dom.window.HTMLElement;
  (globalThis as unknown as { HTMLInputElement: typeof HTMLInputElement }).HTMLInputElement = dom.window.HTMLInputElement;
  (globalThis as unknown as { HTMLFormElement: typeof HTMLFormElement }).HTMLFormElement = dom.window.HTMLFormElement;
  (globalThis as unknown as { Element: typeof Element }).Element = dom.window.Element;
  const page = detectPage();
  (dom.window as unknown as { __AFA_LAST_PAGE: FormPage | null }).__AFA_LAST_PAGE = page;
  setPageSnapshot(page);
  const f = page.forms[0]?.fields[0];
  assert.ok(f);
  const req: InteractionRequest = { kind: 'set-text', stableId: f.stableId, value: '4111111111111111' };
  const result = await runInteraction(req);
  assert.equal(result.success, false);
  assert.match(result.reason ?? '', /payment|safety/);
  dom.window.close();
});

test('interaction: file input is blocked by safety', async () => {
  const html = `<!doctype html><html><body><form id="x"><input id="f" name="upload" type="file" /></form></body></html>`;
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
  installVisibilityShim(dom);
  (globalThis as unknown as { document: Document }).document = dom.window.document;
  (globalThis as unknown as { window: Window }).window = dom.window;
  (globalThis as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement = dom.window.HTMLElement;
  (globalThis as unknown as { HTMLInputElement: typeof HTMLInputElement }).HTMLInputElement = dom.window.HTMLInputElement;
  (globalThis as unknown as { HTMLFormElement: typeof HTMLFormElement }).HTMLFormElement = dom.window.HTMLFormElement;
  (globalThis as unknown as { Element: typeof Element }).Element = dom.window.Element;
  const page = detectPage();
  (dom.window as unknown as { __AFA_LAST_PAGE: FormPage | null }).__AFA_LAST_PAGE = page;
  setPageSnapshot(page);
  const f = page.forms[0]?.fields[0];
  assert.ok(f);
  const req: InteractionRequest = { kind: 'set-text', stableId: f.stableId, value: 'x' };
  const result = await runInteraction(req);
  assert.equal(result.success, false);
  assert.match(result.reason ?? '', /blocked|safety/);
  dom.window.close();
});

// --- Phase 3 Architectural Review Tests ---

test('interaction: 1. Insert new input before target (position shift)', async () => {
  const html = `<!doctype html><html><body><form id="f"><input id="target" name="email" type="email" value="old" /></form></body></html>`;
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
  installVisibilityShim(dom);
  initDomGlobals(dom);
  
  const page = detectPage();
  setPageSnapshot(page);
  const field = page.forms[0].fields[0];
  
  // Mutate DOM
  const form = dom.window.document.getElementById('f')!;
  const newEl = dom.window.document.createElement('input');
  newEl.name = 'email';
  newEl.type = 'email';
  form.insertBefore(newEl, form.firstChild);
  
  const req: InteractionRequest = { kind: 'set-text', stableId: field.stableId, value: 'new' };
  const res = await runInteraction(req);
  assert.equal(res.success, true);
  
  // The ORIGINAL element should have 'new'. The newly inserted element should be empty.
  const inputs = form.querySelectorAll('input');
  assert.equal(inputs[0].value, '');
  assert.equal(inputs[1].value, 'new');
  dom.window.close();
});

test('interaction: 2. Remove target element, add new element with same ID (SPA replacement)', async () => {
  const html = `<!doctype html><html><body><form id="f"><input id="target" name="email" type="email" value="old" /></form></body></html>`;
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
  installVisibilityShim(dom);
  initDomGlobals(dom);
  
  const page = detectPage();
  setPageSnapshot(page);
  const field = page.forms[0].fields[0];
  
  // Mutate DOM
  const form = dom.window.document.getElementById('f')!;
  form.innerHTML = '<input id="target" name="email" type="email" value="replaced" />';
  
  const req: InteractionRequest = { kind: 'set-text', stableId: field.stableId, value: 'new' };
  const res = await runInteraction(req);
  assert.equal(res.success, true);
  
  assert.equal(form.querySelector('input')!.value, 'new');
  dom.window.close();
});

test('interaction: 3. Change a field ID attribute', async () => {
  const html = `<!doctype html><html><body><form id="f"><input id="target" name="email" type="email" value="old" /></form></body></html>`;
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
  installVisibilityShim(dom);
  initDomGlobals(dom);
  
  const page = detectPage();
  setPageSnapshot(page);
  const field = page.forms[0].fields[0];
  
  // Mutate DOM
  dom.window.document.getElementById('target')!.id = 'changed';
  
  const req: InteractionRequest = { kind: 'set-text', stableId: field.stableId, value: 'new' };
  const res = await runInteraction(req);
  assert.equal(res.success, true);
  
  assert.equal(dom.window.document.querySelector('input')!.value, 'new');
  dom.window.close();
});

test('interaction: 4. Two fields with name=email in different forms', async () => {
  const html = `<!doctype html><html><body>
    <form id="f1"><input name="email" type="email" value="one" /></form>
    <form id="f2"><input name="email" type="email" value="two" /></form>
  </body></html>`;
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
  installVisibilityShim(dom);
  initDomGlobals(dom);
  
  const page = detectPage();
  setPageSnapshot(page);
  
  const field2 = page.forms[1].fields[0];
  const req: InteractionRequest = { kind: 'set-text', stableId: field2.stableId, value: 'new2' };
  const res = await runInteraction(req);
  assert.equal(res.success, true);
  
  const inputs = dom.window.document.querySelectorAll('input');
  assert.equal(inputs[0].value, 'one');
  assert.equal(inputs[1].value, 'new2');
  dom.window.close();
});

test('interaction: 5. Two fields with name=email in same form', async () => {
  const html = `<!doctype html><html><body>
    <form id="f1">
      <input name="email" type="email" value="one" />
      <input name="email" type="email" value="two" />
    </form>
  </body></html>`;
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
  installVisibilityShim(dom);
  initDomGlobals(dom);
  
  const page = detectPage();
  setPageSnapshot(page);
  
  const field2 = page.forms[0].fields[1];
  const req: InteractionRequest = { kind: 'set-text', stableId: field2.stableId, value: 'new2' };
  const res = await runInteraction(req);
  assert.equal(res.success, true);
  
  const inputs = dom.window.document.querySelectorAll('input');
  assert.equal(inputs[0].value, 'one');
  assert.equal(inputs[1].value, 'new2');
  dom.window.close();
});

test('interaction: 6. Field with no id/name, sibling inserted before', async () => {
  const html = `<!doctype html><html><body>
    <form id="f1"><input type="text" value="old" /></form>
  </body></html>`;
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
  installVisibilityShim(dom);
  initDomGlobals(dom);
  
  const page = detectPage();
  setPageSnapshot(page);
  
  const form = dom.window.document.getElementById('f1')!;
  const newEl = dom.window.document.createElement('input');
  newEl.type = 'text';
  form.insertBefore(newEl, form.firstChild);
  
  const field = page.forms[0].fields[0];
  const req: InteractionRequest = { kind: 'set-text', stableId: field.stableId, value: 'new' };
  const res = await runInteraction(req);
  assert.equal(res.success, true);
  
  const inputs = form.querySelectorAll('input');
  assert.equal(inputs[0].value, ''); // The new one shouldn't have changed
  assert.equal(inputs[1].value, 'new'); // The original one should have changed
  
  dom.window.close();
});

test('interaction: 7. Cross-form radio groups', async () => {
  const html = `<!doctype html><html><body>
    <form id="f1"><input type="radio" name="tier" value="free" /><input type="radio" name="tier" value="pro" /></form>
    <form id="f2"><input type="radio" name="tier" value="free" /><input type="radio" name="tier" value="pro" /></form>
  </body></html>`;
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
  installVisibilityShim(dom);
  initDomGlobals(dom);
  
  const page = detectPage();
  setPageSnapshot(page);
  
  const fieldPro2 = page.forms[1].fields[1];
  const req: InteractionRequest = { kind: 'select-radio', stableId: fieldPro2.stableId, value: 'pro' };
  const res = await runInteraction(req);
  assert.equal(res.success, true);
  
  const radios = dom.window.document.querySelectorAll('input');
  assert.equal(radios[0].checked, false);
  assert.equal(radios[1].checked, false);
  assert.equal(radios[2].checked, false);
  assert.equal(radios[3].checked, true);
  dom.window.close();
});

test('interaction: 8. Move a field from one form to another', async () => {
  const html = `<!doctype html><html><body>
    <form id="f1"><input id="target" name="email" type="email" /></form>
    <form id="f2"></form>
  </body></html>`;
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
  installVisibilityShim(dom);
  initDomGlobals(dom);
  
  const page = detectPage();
  setPageSnapshot(page);
  
  const target = dom.window.document.getElementById('target')!;
  dom.window.document.getElementById('f2')!.appendChild(target);
  
  const field = page.forms[0].fields[0];
  const req: InteractionRequest = { kind: 'set-text', stableId: field.stableId, value: 'new' };
  const res = await runInteraction(req);
  assert.equal(res.success, true); 
  assert.equal((dom.window.document.getElementById('target') as HTMLInputElement).value, 'new');
  dom.window.close();
});

test('interaction: 9. Replace entire form innerHTML', async () => {
  const html = `<!doctype html><html><body><form id="f"><input id="target" name="email" type="email" /></form></body></html>`;
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
  installVisibilityShim(dom);
  initDomGlobals(dom);
  
  const page = detectPage();
  setPageSnapshot(page);
  
  dom.window.document.getElementById('f')!.innerHTML = '<input id="target" name="email" type="email" />';
  
  const field = page.forms[0].fields[0];
  const req: InteractionRequest = { kind: 'set-text', stableId: field.stableId, value: 'new' };
  const res = await runInteraction(req);
  assert.equal(res.success, true);
  dom.window.close();
});

test('interaction: 10. Password field with type=text and name=password is blocked', async () => {
  const html = `<!doctype html><html><body><form id="x"><input name="password" type="text" /></form></body></html>`;
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
  installVisibilityShim(dom);
  initDomGlobals(dom);
  
  const page = detectPage();
  setPageSnapshot(page);
  const field = page.forms[0].fields[0];
  const req: InteractionRequest = { kind: 'set-text', stableId: field.stableId, value: 'x' };
  const res = await runInteraction(req);
  assert.equal(res.success, false);
  assert.match(res.reason ?? '', /password|safety/);
  dom.window.close();
});

test('interaction: 11. Password field with autocomplete=current-password and type=text is blocked', async () => {
  const html = `<!doctype html><html><body><form id="x"><input name="foo" type="text" autocomplete="current-password" /></form></body></html>`;
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
  installVisibilityShim(dom);
  initDomGlobals(dom);
  
  const page = detectPage();
  setPageSnapshot(page);
  const field = page.forms[0].fields[0];
  const req: InteractionRequest = { kind: 'set-text', stableId: field.stableId, value: 'x' };
  const res = await runInteraction(req);
  assert.equal(res.success, false);
  assert.match(res.reason ?? '', /blocked/);
  dom.window.close();
});

test('interaction: 12. SSN field is not blocked', async () => {
  const html = `<!doctype html><html><body><form id="x"><input name="ssn" type="text" /></form></body></html>`;
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
  installVisibilityShim(dom);
  initDomGlobals(dom);
  
  const page = detectPage();
  setPageSnapshot(page);
  const field = page.forms[0].fields[0];
  const req: InteractionRequest = { kind: 'set-text', stableId: field.stableId, value: 'x' };
  const res = await runInteraction(req);
  // Assuming SSN is not blocked because we didn't add it, but it should not crash.
  assert.equal(res.success, true);
  dom.window.close();
});

test('interaction: 13. Send 5 set-text interactions simultaneously', async () => {
  const html = `<!doctype html><html><body><form id="x">
    <input id="f1" name="f1" type="text" />
    <input id="f2" name="f2" type="text" />
    <input id="f3" name="f3" type="text" />
    <input id="f4" name="f4" type="text" />
    <input id="f5" name="f5" type="text" />
  </form></body></html>`;
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
  installVisibilityShim(dom);
  initDomGlobals(dom);
  
  const page = detectPage();
  setPageSnapshot(page);
  
  const reqs = page.forms[0].fields.map((f, i) => ({
    kind: 'set-text' as const,
    stableId: f.stableId,
    value: `val${i}`
  }));
  
  const results = await Promise.all(reqs.map(r => runInteraction(r)));
  assert.ok(results.every(r => r.success));
  
  for (let i = 0; i < 5; i++) {
    assert.equal((dom.window.document.getElementById(`f${i+1}`) as HTMLInputElement).value, `val${i}`);
  }
  dom.window.close();
});

test('interaction: 17. Auto-formatting phone input tolerance', async () => {
  const html = `<!doctype html><html><body><form id="x"><input id="phone" name="phone" type="text" /></form></body></html>`;
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
  installVisibilityShim(dom);
  initDomGlobals(dom);
  
  const page = detectPage();
  setPageSnapshot(page);
  const field = page.forms[0].fields[0];
  
  const el = dom.window.document.getElementById('phone') as HTMLInputElement;
  // Simulate auto-formatter
  el.addEventListener('input', () => {
    if (el.value === '1234567890') {
      el.value = '(123) 456-7890';
    }
  });
  
  const req: InteractionRequest = { kind: 'set-text', stableId: field.stableId, value: '1234567890' };
  const res = await runInteraction(req);
  assert.equal(res.success, true); // Should pass thanks to stripFormatting
  dom.window.close();
});

test('interaction: 18. Select with optgroup', async () => {
  const html = `<!doctype html><html><body><form id="x">
    <select name="sel">
      <optgroup label="Group"><option value="a">A</option></optgroup>
    </select>
  </form></body></html>`;
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
  installVisibilityShim(dom);
  initDomGlobals(dom);
  
  const page = detectPage();
  setPageSnapshot(page);
  const field = page.forms[0].fields[0];
  
  const req: InteractionRequest = { kind: 'select-option', stableId: field.stableId, by: 'value', value: 'a' };
  const res = await runInteraction(req);
  assert.equal(res.success, true);
  dom.window.close();
});

test('interaction: 19. Select multiple is allowed (operates as single-select)', async () => {
  const html = `<!doctype html><html><body><form id="x">
    <select name="sel" multiple><option value="a">A</option><option value="b">B</option></select>
  </form></body></html>`;
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
  installVisibilityShim(dom);
  initDomGlobals(dom);
  
  const page = detectPage();
  setPageSnapshot(page);
  const field = page.forms[0].fields[0];
  
  const req: InteractionRequest = { kind: 'select-option', stableId: field.stableId, by: 'value', value: 'a' };
  const res = await runInteraction(req);
  // It should probably pass because our code doesn't explicitly block multiple right now,
  // but let's assert it doesn't crash.
  assert.equal(res.success, true);
  dom.window.close();
});

test('interaction: 21. __AFA_LAST_PAGE is inaccessible from window', async () => {
  const html = `<!doctype html><html><body></body></html>`;
  const dom = new JSDOM(html, { url: 'http://localhost/', pretendToBeVisual: true });
  installVisibilityShim(dom);
  initDomGlobals(dom);
  
  const page = detectPage();
  setPageSnapshot(page);
  // It shouldn't be attached to dom.window
  assert.equal((dom.window as any).__AFA_LAST_PAGE, undefined);
  dom.window.close();
});
