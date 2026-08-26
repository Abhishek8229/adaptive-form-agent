import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inferSemanticHint, SEMANTIC_HINTS } from '../src/shared/semantics.ts';

test('semantic: email detection from aria-label', () => {
  const r = inferSemanticHint({ ariaLabel: 'Email address' });
  assert.equal(r.hint, 'email');
  assert.ok(r.sources.includes('aria-label'));
});

test('semantic: phone detection from name', () => {
  const r = inferSemanticHint({ name: 'phoneNumber' });
  assert.equal(r.hint, 'phone');
});

test('semantic: first_name from id', () => {
  const r = inferSemanticHint({ id: 'first_name' });
  assert.equal(r.hint, 'first_name');
});

test('semantic: last_name from label', () => {
  const r = inferSemanticHint({ label: 'Last name' });
  assert.equal(r.hint, 'last_name');
});

test('semantic: full_name from placeholder', () => {
  const r = inferSemanticHint({ placeholder: 'Your full name' });
  assert.equal(r.hint, 'full_name');
});

test('semantic: date_of_birth from autocomplete', () => {
  const r = inferSemanticHint({ autocomplete: 'bday' });
  assert.equal(r.hint, 'date_of_birth');
});

test('semantic: address line 2 from autocomplete', () => {
  const r = inferSemanticHint({ autocomplete: 'address-line2' });
  assert.equal(r.hint, 'address_line_2');
});

test('semantic: address from name', () => {
  const r = inferSemanticHint({ name: 'streetAddress' });
  assert.equal(r.hint, 'address');
});

test('semantic: city from label', () => {
  const r = inferSemanticHint({ label: 'City' });
  assert.equal(r.hint, 'city');
});

test('semantic: state from label', () => {
  const r = inferSemanticHint({ label: 'State' });
  assert.equal(r.hint, 'state');
});

test('semantic: country from label', () => {
  const r = inferSemanticHint({ label: 'Country' });
  assert.equal(r.hint, 'country');
});

test('semantic: postal_code from label', () => {
  const r = inferSemanticHint({ label: 'ZIP / Postal code' });
  assert.equal(r.hint, 'postal_code');
});

test('semantic: username from autocomplete', () => {
  const r = inferSemanticHint({ autocomplete: 'username' });
  assert.equal(r.hint, 'username');
});

test('semantic: password from autocomplete current-password', () => {
  const r = inferSemanticHint({ autocomplete: 'current-password' });
  assert.equal(r.hint, 'password');
});

test('semantic: search from name "q"', () => {
  const r = inferSemanticHint({ name: 'q' });
  assert.equal(r.hint, 'search');
});

test('semantic: type=email wins when nothing else matches', () => {
  const r = inferSemanticHint({ type: 'email' });
  assert.equal(r.hint, 'email');
  assert.deepEqual(r.sources, ['type']);
});

test('semantic: type=tel maps to phone', () => {
  const r = inferSemanticHint({ type: 'tel' });
  assert.equal(r.hint, 'phone');
});

test('semantic: type=password maps to password', () => {
  const r = inferSemanticHint({ type: 'password' });
  assert.equal(r.hint, 'password');
});

test('semantic: type=checkbox maps to checkbox_group', () => {
  const r = inferSemanticHint({ type: 'checkbox' });
  assert.equal(r.hint, 'checkbox_group');
});

test('semantic: type=radio maps to radio_group', () => {
  const r = inferSemanticHint({ type: 'radio' });
  assert.equal(r.hint, 'radio_group');
});

test('semantic: unknown when nothing matches', () => {
  const r = inferSemanticHint({ name: 'x', id: 'y', type: 'text' });
  assert.equal(r.hint, 'unknown');
});

test('semantic: text source takes precedence over type fallback', () => {
  const r = inferSemanticHint({ label: 'Email', type: 'text' });
  assert.equal(r.hint, 'email');
  assert.ok(r.sources.includes('label'));
});

test('SEMANTIC_HINTS contains all expected tokens', () => {
  for (const h of [
    'email', 'phone', 'first_name', 'last_name', 'full_name', 'date_of_birth',
    'address', 'address_line_2', 'city', 'state', 'country', 'postal_code',
    'username', 'password', 'search', 'url', 'number', 'date', 'time', 'datetime',
    'color', 'range', 'file', 'checkbox_group', 'radio_group', 'select_choice',
    'textarea', 'unknown',
  ]) {
    assert.ok(SEMANTIC_HINTS.includes(h as never), `missing hint: ${h}`);
  }
});
