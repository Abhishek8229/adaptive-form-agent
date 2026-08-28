import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testPagePath = resolve(__dirname, '..', 'test', 'test-page.html');

function readTestPage(): string {
  return readFileSync(testPagePath, 'utf8');
}

test('test page: contains a real <form> with id signup-form', async () => {
  const html = readTestPage();
  assert.match(html, /<form[^>]+id="signup-form"/);
});

test('test page: uses explicit <label for=...>', async () => {
  const html = readTestPage();
  const explicitLabels = (html.match(/<label\s+for="/g) ?? []).length;
  assert.ok(explicitLabels >= 10, `expected >=10 explicit labels, got ${explicitLabels}`);
});

test('test page: uses aria-label', async () => {
  const html = readTestPage();
  const aria = (html.match(/aria-label="/g) ?? []).length;
  assert.ok(aria >= 4, `expected >=4 aria-labels, got ${aria}`);
});

test('test page: has a <select> with options', async () => {
  const html = readTestPage();
  assert.match(html, /<select[^>]*id="country"/);
  const optionCount = (html.match(/<option\b/g) ?? []).length;
  assert.ok(optionCount >= 3, `expected >=3 options, got ${optionCount}`);
});

test('test page: has a radio group', async () => {
  const html = readTestPage();
  assert.match(html, /<legend>Subscription tier<\/legend>/);
  const radios = (html.match(/type="radio"/g) ?? []).length;
  assert.ok(radios >= 3, `expected >=3 radios, got ${radios}`);
});

test('test page: has a checkbox group', async () => {
  const html = readTestPage();
  assert.match(html, /<legend>Interests<\/legend>/);
  const checkboxes = (html.match(/type="checkbox"/g) ?? []).length;
  assert.ok(checkboxes >= 3, `expected >=3 checkboxes, got ${checkboxes}`);
});

test('test page: includes required fields', async () => {
  const html = readTestPage();
  const required = (html.match(/\brequired\b/g) ?? []).length;
  assert.ok(required >= 4, `expected >=4 required attrs, got ${required}`);
});

test('test page: includes disabled controls', async () => {
  const html = readTestPage();
  assert.match(html, /\bdisabled\b/);
});

test('test page: includes readonly control', async () => {
  const html = readTestPage();
  assert.match(html, /\breadonly\b/);
});

test('test page: uses autocomplete tokens', async () => {
  const html = readTestPage();
  const tokens = ['email', 'name', 'username', 'new-password', 'tel', 'street-address',
    'address-line2', 'address-level2', 'address-level1', 'postal-code', 'country', 'bday', 'url'];
  for (const t of tokens) {
    assert.ok(html.includes(`autocomplete="${t}"`), `missing autocomplete="${t}"`);
  }
});

test('test page: has controls outside the form using form="" attribute', async () => {
  const html = readTestPage();
  assert.match(html, /form="signup-form"/);
});

test('test page: has a no-form region with controls', async () => {
  const html = readTestPage();
  assert.match(html, /id="no-form-region"/);
  assert.match(html, /Search/);
});

test('test page: has buttons to trigger dynamic insertion', async () => {
  const html = readTestPage();
  assert.match(html, /id="add-field-btn"/);
  assert.match(html, /id="add-form-btn"/);
});

test('test page: has inline JS for dynamic control insertion', async () => {
  const html = readTestPage();
  assert.match(html, /addEventListener\(['"]click['"]/);
  assert.match(html, /createElement\(['"]form['"]\)/);
});

test('test page: has time input for set-time tests', async () => {
  const html = readTestPage();
  assert.match(html, /id="appointment-time"/);
  assert.match(html, /type="time"/);
});

test('test page: has pattern-restricted input for validation tests', async () => {
  const html = readTestPage();
  assert.match(html, /id="zipcode-pattern"/);
  assert.match(html, /pattern="\[0-9\]\{5\}"/);
});

test('test page: has non-submit button for click-button tests', async () => {
  const html = readTestPage();
  assert.match(html, /Apply filters/);
});

test('test page: has deterministic test demo API', async () => {
  const html = readTestPage();
  assert.match(html, /afa-demo-text/);
  assert.match(html, /afa-demo-textarea/);
  assert.match(html, /afa-demo-checkbox/);
  assert.match(html, /afa-demo-radio/);
  assert.match(html, /afa-demo-select/);
  assert.match(html, /afa-demo-date/);
  assert.match(html, /afa-demo-time/);
  assert.match(html, /afa-demo-button/);
  assert.match(html, /afa-demo-disabled/);
  assert.match(html, /afa-demo-wrong/);
  assert.match(html, /afa-demo-missing/);
});

test('test page: demo handlers use kind (not type) for interaction requests', async () => {
  const html = readTestPage();
  assert.match(html, /payload: \{ kind: 'set-text'/);
  assert.match(html, /payload: \{ kind: 'set-textarea'/);
  assert.match(html, /payload: \{ kind: 'check'/);
  assert.match(html, /payload: \{ kind: 'select-radio'/);
  assert.match(html, /payload: \{ kind: 'select-option'/);
  assert.match(html, /payload: \{ kind: 'set-date'/);
  assert.match(html, /payload: \{ kind: 'set-time'/);
  assert.match(html, /payload: \{ kind: 'click-button'/);
});
