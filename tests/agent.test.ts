/**
 * Tests for the deterministic planner (agent.ts).
 *
 * The planner is pure: no DOM, no chrome.* APIs. We construct FormField
 * objects directly and assert what InteractionRequest it produces.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeKey,
  fuzzyContains,
  hintFromAutocomplete,
  planField,
  valueToInteraction,
} from '../src/background/agent.ts';
import type { FormField, FieldTarget } from '../src/shared/types.ts';
import type { JsonProfile } from '../src/shared/profile.ts';

function makeField(overrides: Partial<FormField> & { target?: Partial<FieldTarget> }): FormField {
  const target: FieldTarget = {
    id: '',
    name: '',
    tag: 'input',
    type: 'text',
    formId: '',
    formName: '',
    label: '',
    ariaLabel: '',
    placeholder: '',
    autocomplete: '',
    radioName: undefined,
    pathIndex: 0,
    selector: 'input',
    ...(overrides.target ?? {}),
  };
  return {
    stableId: 'g.f0',
    tag: 'input',
    type: 'text',
    controlType: 'input-text',
    name: target.name,
    id: target.id,
    label: target.label,
    placeholder: target.placeholder,
    ariaLabel: target.ariaLabel,
    required: false,
    visible: true,
    disabled: false,
    readOnly: false,
    autocomplete: target.autocomplete,
    semanticHint: 'unknown',
    semanticSources: [],
    options: [],
    valuePresent: false,
    containsSensitiveValue: false,
    target,
    ...overrides,
  };
}

// ---------- normalizeKey ----------

test('agent: normalizeKey lowercases and splits camelCase', () => {
  assert.equal(normalizeKey('firstName'), 'first name');
  assert.equal(normalizeKey('first_name'), 'first name');
  assert.equal(normalizeKey('first-name'), 'first name');
  assert.equal(normalizeKey('FirstName'), 'first name');
  assert.equal(normalizeKey('FIRST_NAME'), 'first name');
});

test('agent: normalizeKey collapses repeated separators', () => {
  assert.equal(normalizeKey('a__b  c'), 'a b c');
  assert.equal(normalizeKey('a.b.c'), 'a b c');
});

// ---------- fuzzyContains ----------

test('agent: fuzzyContains exact substring', () => {
  assert.equal(fuzzyContains('What is your first name?', 'first name'), true);
  assert.equal(fuzzyContains('What is your first name?', 'last name'), false);
});

test('agent: fuzzyContains token-order match', () => {
  // "telephone country code" tokens must appear in order in the haystack
  assert.equal(fuzzyContains('Telephone country code', 'telephone country code'), true);
  // reversed order in the haystack should NOT match
  assert.equal(fuzzyContains('Country telephone code', 'telephone country code'), false);
  // unmatched
  assert.equal(fuzzyContains('email address', 'telephone country code'), false);
});

// ---------- hintFromAutocomplete ----------

test('agent: hintFromAutocomplete maps known tokens', () => {
  assert.equal(hintFromAutocomplete('email'), 'email');
  assert.equal(hintFromAutocomplete('given-name'), 'first_name');
  assert.equal(hintFromAutocomplete('family-name'), 'last_name');
  assert.equal(hintFromAutocomplete('postal-code'), 'postal_code');
  assert.equal(hintFromAutocomplete('street-address'), 'address');
  assert.equal(hintFromAutocomplete('bday'), 'date_of_birth');
});

test('agent: hintFromAutocomplete returns null for off/on/empty', () => {
  assert.equal(hintFromAutocomplete(''), null);
  assert.equal(hintFromAutocomplete('off'), null);
  assert.equal(hintFromAutocomplete('on'), null);
});

test('agent: hintFromAutocomplete returns null for cc-* sensitive tokens', () => {
  // We don't have a hint for cc-number on purpose: it would map to
  // 'unknown' which the planner would not act on, but we still want
  // the token surface to NOT be silently mapped to a writable hint.
  // Either null or 'unknown' is acceptable as a "not a writable target"
  // result; here we lock in the current behavior.
  const r = hintFromAutocomplete('cc-number');
  assert.ok(r === null || r === 'unknown');
});

// ---------- planField: matching priority ----------

test('agent: planField uses autocomplete hint first', () => {
  const field = makeField({
    target: { label: 'foo', autocomplete: 'email' },
    semanticHint: 'phone', // would normally pick phone, but autocomplete wins
  });
  const profile: JsonProfile = { email: 'jane@example.com', phone: '555-1234' };
  const r = planField(field, profile);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.match, 'autocomplete');
    assert.equal(r.profileKey, 'email');
    assert.equal(r.request.kind, 'set-text');
  }
});

test('agent: planField falls back to semanticHint when no autocomplete match', () => {
  const field = makeField({
    target: { label: 'foo' },
    semanticHint: 'email',
    autocomplete: 'off',
  });
  const profile: JsonProfile = { email: 'jane@example.com' };
  const r = planField(field, profile);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.match, 'semantic');
    assert.equal(r.profileKey, 'email');
  }
});

test('agent: planField falls back to label/aria/placeholder/name/id', () => {
  const field = makeField({
    target: { label: 'What is your first name?' },
    semanticHint: 'unknown',
  });
  const profile: JsonProfile = { firstName: 'Jane' };
  const r = planField(field, profile);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.match, 'label');
    assert.equal(r.profileKey, 'firstName');
  }
});

test('agent: planField matches snake_case profile key against label phrase', () => {
  const field = makeField({
    target: { name: 'first_name', label: 'First name' },
    semanticHint: 'unknown',
  });
  const profile: JsonProfile = { first_name: 'Jane' };
  const r = planField(field, profile);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.profileKey, 'first_name');
  }
});

test('agent: planField matches by ariaLabel', () => {
  const field = makeField({
    target: { ariaLabel: 'Email address' },
    semanticHint: 'unknown',
  });
  const profile: JsonProfile = { email: 'x@y' };
  const r = planField(field, profile);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.profileKey, 'email');
  }
});

test('agent: planField matches by placeholder', () => {
  const field = makeField({
    target: { placeholder: 'Search here' },
    semanticHint: 'unknown',
  });
  const profile: JsonProfile = { search: 'hello' };
  const r = planField(field, profile);
  assert.equal(r.ok, true);
});

test('agent: planField returns skip when no profile key matches', () => {
  const field = makeField({
    target: { label: 'Referred by' },
    semanticHint: 'unknown',
  });
  const profile: JsonProfile = { email: 'x@y' };
  const r = planField(field, profile);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, 'no_profile_match');
  }
});

test('agent: planField skips disabled fields', () => {
  const field = makeField({ disabled: true });
  const profile: JsonProfile = { firstName: 'Jane' };
  const r = planField(field, profile);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, 'no_reliable_label');
  }
});

test('agent: planField skips readonly fields', () => {
  const field = makeField({ readOnly: true });
  const profile: JsonProfile = { firstName: 'Jane' };
  const r = planField(field, profile);
  assert.equal(r.ok, false);
});

test('agent: planField skips sensitive fields even when a profile key matches', () => {
  const field = makeField({
    containsSensitiveValue: true,
    controlType: 'input-password',
    target: { autocomplete: 'current-password' },
  });
  const profile: JsonProfile = { currentPassword: 'x' };
  const r = planField(field, profile);
  assert.equal(r.ok, false);
});

test('agent: planField case-insensitive label match', () => {
  const field = makeField({
    target: { label: 'EMAIL' },
    semanticHint: 'unknown',
  });
  const profile: JsonProfile = { email: 'x@y' };
  const r = planField(field, profile);
  assert.equal(r.ok, true);
});

// ---------- valueToInteraction: control-type mapping ----------

test('agent: text input maps to set-text with the string value', () => {
  const field = makeField({ controlType: 'input-text' });
  const r = valueToInteraction(field, 'name', 'Jane', 'semantic');
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.request.kind, 'set-text');
    assert.equal((r.request as { value: string }).value, 'Jane');
    assert.equal(r.request.stableId, field.stableId);
  }
});

test('agent: email input maps to set-text with the email value', () => {
  const field = makeField({ controlType: 'input-email' });
  const r = valueToInteraction(field, 'email', 'jane@example.com', 'autocomplete');
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.request.kind, 'set-text');
  }
});

test('agent: date input maps to set-date', () => {
  const field = makeField({ controlType: 'input-date' });
  const r = valueToInteraction(field, 'dob', '1990-01-15', 'semantic');
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.request.kind, 'set-date');
  }
});

test('agent: time input maps to set-time', () => {
  const field = makeField({ controlType: 'input-time' });
  const r = valueToInteraction(field, 'time', '14:30', 'semantic');
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.request.kind, 'set-time');
  }
});

test('agent: textarea maps to set-textarea', () => {
  const field = makeField({ controlType: 'textarea' });
  const r = valueToInteraction(field, 'message', 'hello world', 'label');
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.request.kind, 'set-textarea');
  }
});

test('agent: checkbox true maps to check', () => {
  const field = makeField({ controlType: 'input-checkbox' });
  const r = valueToInteraction(field, 'agree', true, 'label');
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.request.kind, 'check');
  }
});

test('agent: checkbox false maps to uncheck', () => {
  const field = makeField({ controlType: 'input-checkbox' });
  const r = valueToInteraction(field, 'agree', false, 'label');
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.request.kind, 'uncheck');
  }
});

test('agent: checkbox non-boolean value is skipped', () => {
  const field = makeField({ controlType: 'input-checkbox' });
  const r = valueToInteraction(field, 'agree', 42, 'label');
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, 'checkbox_value_not_boolean');
  }
});

test('agent: select maps to select-option by value', () => {
  const field = makeField({
    controlType: 'select',
    options: [
      { value: 'us', text: 'United States', selected: false, disabled: false },
      { value: 'ca', text: 'Canada', selected: false, disabled: false },
    ],
  });
  const r = valueToInteraction(field, 'country', 'Canada', 'semantic');
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.request.kind, 'select-option');
    const req = r.request as { by: 'value' | 'text'; value: string };
    assert.equal(req.by, 'value');
    assert.equal(req.value, 'ca');
  }
});

test('agent: select unknown value is skipped', () => {
  const field = makeField({
    controlType: 'select',
    options: [{ value: 'us', text: 'United States', selected: false, disabled: false }],
  });
  const r = valueToInteraction(field, 'country', 'Atlantis', 'semantic');
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, 'select_option_not_found');
  }
});

test('agent: select value-object shape uses .value field', () => {
  const field = makeField({
    controlType: 'select',
    options: [
      { value: 'red', text: 'Red', selected: false, disabled: false },
      { value: 'blue', text: 'Blue', selected: false, disabled: false },
    ],
  });
  const r = valueToInteraction(field, 'color', { label: 'Blue', value: 'blue' }, 'semantic');
  assert.equal(r.ok, true);
  if (r.ok) {
    const req = r.request as { value: string };
    assert.equal(req.value, 'blue');
  }
});

test('agent: radio maps to select-radio', () => {
  const field = makeField({
    controlType: 'input-radio',
    options: [
      { value: 'm', text: 'Male', selected: false, disabled: false },
      { value: 'f', text: 'Female', selected: false, disabled: false },
    ],
  });
  const r = valueToInteraction(field, 'gender', 'f', 'label');
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.request.kind, 'select-radio');
  }
});

test('agent: radio unknown value is skipped', () => {
  const field = makeField({
    controlType: 'input-radio',
    options: [{ value: 'm', text: 'Male', selected: false, disabled: false }],
  });
  const r = valueToInteraction(field, 'gender', 'other', 'label');
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, 'radio_value_not_found');
  }
});

test('agent: number value is coerced to string', () => {
  const field = makeField({ controlType: 'input-number' });
  const r = valueToInteraction(field, 'age', 42, 'semantic');
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal((r.request as { value: string }).value, '42');
  }
});

test('agent: unsupported control type is skipped', () => {
  const field = makeField({ controlType: 'input-color' });
  // input-color is in our supported set so it maps to set-text. Use a
  // truly unsupported control for the negative case.
  const field2 = makeField({ controlType: 'button' as FormField['controlType'] });
  const r = valueToInteraction(field2, 'submit', 'x', 'label');
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.reason, 'value_unsupported');
  }
});
test('agent: fuzzy key shadowing fallback avoids radio_value_not_found', () => {
  const profile: JsonProfile = {
    email: 'jane.doe@example.com',
    contactMethod: 'email',
  };
  const field = makeField({
    controlType: 'input-radio',
    semanticHint: 'unknown',
    options: [{ value: 'email', text: 'Email', selected: false, disabled: false }],
    target: { label: 'Email', name: 'contactMethod', tag: 'input', type: 'radio', id: '', formId: '', formName: '', ariaLabel: '', placeholder: '', autocomplete: '', pathIndex: 0, selector: '' },
  });
  
  const r = planField(field, profile);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.profileKey, 'contactMethod');
    assert.equal(r.request.kind, 'select-radio');
  }
});
