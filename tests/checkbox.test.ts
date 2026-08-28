import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planField } from '../src/background/agent.ts';
import type { FormField } from '../src/shared/types.ts';

function makeCheckbox(overrides: Partial<FormField> = {}): FormField {
  return {
    stableId: 't1', tag: 'input', type: 'checkbox', controlType: 'input-checkbox',
    name: 'test', id: '', label: 'Test Label', placeholder: '', ariaLabel: '',
    required: false, visible: true, disabled: false, readOnly: false, autocomplete: '',
    semanticHint: 'unknown', semanticSources: [], options: [], valuePresent: false, containsSensitiveValue: false,
    target: { id: '', name: 'test', tag: 'input', type: 'checkbox', formId: '', formName: '', label: '', ariaLabel: '', placeholder: '', autocomplete: '', pathIndex: 0, selector: '' },
    ...overrides
  };
}

test('checkbox value boolean mapping from strings', async () => {
  const field = makeCheckbox({ name: 'newsletter', label: 'Newsletter' });
  const pYes = await planField(field, { newsletter: 'yes' });
  assert.equal(pYes.ok, true);
  if (pYes.ok) assert.equal(pYes.request.kind, 'check');

  const pNo = await planField(field, { newsletter: 'no' });
  assert.equal(pNo.ok, true);
  if (pNo.ok) assert.equal(pNo.request.kind, 'uncheck');
});

test('checkbox array matching uses option value', async () => {
  const field = makeCheckbox({
    name: 'frameworks',
    label: 'ReactJS', // Label doesn't exactly match 'react'
    options: [{ value: 'react', text: 'ReactJS', selected: false, disabled: false }]
  });
  const p = await planField(field, { frameworks: ['react', 'vue'] });
  assert.equal(p.ok, true);
  if (p.ok) assert.equal(p.request.kind, 'check', 'Should match by option value');
});

test('required consent checkboxes auto-check', async () => {
  const field = makeCheckbox({
    name: 'terms',
    label: 'I agree to the terms',
    required: true
  });
  const p = await planField(field, { somethingElse: 'value' }); // No matching profile key
  assert.equal(p.ok, true);
  if (p.ok) {
    assert.equal(p.profileKey, '__consent__');
    assert.equal(p.request.kind, 'check');
  }
});
