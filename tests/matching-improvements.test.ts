import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planField } from '../src/background/agent.ts';
import type { FormField } from '../src/shared/types.ts';
import type { JsonProfile } from '../src/shared/profile.ts';

function makeField(overrides: Partial<FormField> = {}): FormField {
  return {
    stableId: 'test.f1',
    tag: 'input',
    type: 'text',
    controlType: 'input-text',
    name: 'testName',
    id: 'testId',
    label: 'Test Label',
    placeholder: '',
    ariaLabel: '',
    required: false,
    visible: true,
    disabled: false,
    readOnly: false,
    autocomplete: '',
    semanticHint: 'unknown',
    semanticSources: [],
    options: [],
    valuePresent: false,
    containsSensitiveValue: false,
    target: {
      id: 'testId',
      name: 'testName',
      tag: 'input',
      type: 'text',
      formId: '',
      formName: '',
      label: 'Test Label',
      ariaLabel: '',
      placeholder: '',
      autocomplete: '',
      pathIndex: 0,
      selector: 'input',
    },
    ...overrides,
  };
}

const profile: JsonProfile = {
  addressLine1: '123 Elm St',
  firstName: 'John',
  workLocation: 'remote',
  frameworks: ['react', 'svelte'],
};

test('matching: generic HTML names with meaningful labels via synonyms', async () => {
  const field = makeField({
    name: 'usr_addr_1', // generic name
    id: 'field_99',
    label: 'Where do you live?',
  });
  const plan = await planField(field, profile);
  assert.equal(plan.ok, true);
  if (plan.ok) {
    assert.equal(plan.profileKey, 'addressLine1');
    assert.equal(plan.match, 'label');
  }
});

test('matching: name/label mismatch resolves via synonyms', async () => {
  const field = makeField({
    name: 'usr_nick_99', // mismatch
    id: 'field_88',
    label: 'What should we call you?', // synonym for firstName
  });
  const plan = await planField(field, profile);
  assert.equal(plan.ok, true);
  if (plan.ok) {
    assert.equal(plan.profileKey, 'firstName');
    assert.equal(plan.match, 'label');
  }
});

test('matching: checkbox groups support profile arrays', async () => {
  const fieldReact = makeField({
    controlType: 'input-checkbox',
    name: 'frameworks',
    label: 'React',
  });
  const planReact = await planField(fieldReact, profile);
  assert.equal(planReact.ok, true);
  if (planReact.ok) assert.equal(planReact.request.kind, 'check');

  const fieldVue = makeField({
    controlType: 'input-checkbox',
    name: 'frameworks',
    label: 'Vue',
  });
  const planVue = await planField(fieldVue, profile);
  assert.equal(planVue.ok, true);
  if (planVue.ok) assert.equal(planVue.request.kind, 'uncheck');
});

test('matching: protected fields are blocked even if a profile key could match', async () => {
  const field = makeField({
    name: 'otp', // protected by regex
    label: 'One-time code',
  });
  // even if profile had an 'otp' key, it should be blocked
  const localProfile = { ...profile, otp: '123456' };
  const plan = await planField(field, localProfile);
  assert.equal(plan.ok, false);
  if (!plan.ok) {
    assert.equal(plan.reason, 'no_reliable_label');
    assert.match(plan.detail ?? '', /protected field/);
  }
});

test('matching: ambiguous semantic matches fallback correctly', async () => {
  // If semantic hint points to something useless, the new candidate iteration
  // should allow a fallback to a label match that yields a valid interaction.
  const field = makeField({
    controlType: 'input-radio',
    name: 'workLocation',
    label: 'Remote', // the radio option
    semanticHint: 'url', // fake a bad hint like 'On-site' triggered
    options: [{ value: 'remote', text: 'Remote', selected: false, disabled: false }]
  });
  // The profile has workLocation='remote' AND url='https://example.com'
  const localProfile = { ...profile, url: 'https://example.com' };
  
  const plan = await planField(field, localProfile);
  assert.equal(plan.ok, true);
  if (plan.ok) {
    // Should NOT use 'url' because valueToInteraction for 'https://example.com' fails.
    // It should fall back to matching 'workLocation' from the name and succeed!
    assert.equal(plan.profileKey, 'workLocation');
    assert.equal(plan.match, 'label');
    assert.equal(plan.request.kind, 'select-radio');
  }
});

test('matching: select dropdown fuzzy matching', async () => {
  const profile = {
    country: 'United States',
    role: 'Senior Software Engineer',
    source: 'Search Engine'
  };

  // 1. Profile value in option text ("United States" in "United States of America")
  const field1 = makeField({
    controlType: 'select',
    name: 'country',
    options: [{ value: 'us', text: 'United States of America', selected: false, disabled: false }]
  });
  const plan1 = await planField(field1, profile);
  assert.equal(plan1.ok, true);

  // 2. Option text in profile value ("Software Engineer" in "Senior Software Engineer")
  const field2 = makeField({
    controlType: 'select',
    name: 'role',
    options: [{ value: 'swe', text: 'Software Engineer', selected: false, disabled: false }]
  });
  const plan2 = await planField(field2, profile);
  assert.equal(plan2.ok, true);

  // 3. Substring with punctuation ("Search Engine" in "Search Engine (Google, Bing)")
  const field3 = makeField({
    controlType: 'select',
    name: 'source',
    options: [{ value: 'search', text: 'Search Engine (Google, Bing, etc)', selected: false, disabled: false }]
  });
  const plan3 = await planField(field3, profile);
  assert.equal(plan3.ok, true);
});
