import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverNextAction } from '../src/background/field-discovery';
import type { FormPage, FormSubmitControl } from '../src/shared/types';

function btn(id: string, text: string, type: string = 'button'): FormSubmitControl {
  return {
    stableId: id,
    tag: 'button',
    type,
    text,
    ariaLabel: '',
    disabled: false,
    visible: true,
    target: {
      id: '',
      name: '',
      tag: 'button',
      type,
      text,
      ariaLabel: '',
      formId: '',
      formName: '',
      pathIndex: 0,
      selector: 'button',
    },
  };
}

function group(label: string, fields: any[] = [], submits: FormSubmitControl[] = []) {
  return {
    metadata: {
      stableId: 'g0',
      kind: 'form' as const,
      name: 'form',
      action: '',
      method: 'get',
      autocomplete: '',
      enctype: '',
      target: '',
      fieldCount: fields.length,
      submitCount: submits.length,
      labelText: label,
    },
    fields,
    submitControls: submits,
  };
}

test('field-discovery: returns null on empty page', () => {
  const page: FormPage = { url: 'http://x', title: 't', detectedAt: '', formCount: 0, totalFieldCount: 0, forms: [] };
  const out = discoverNextAction(page, {}, new Set());
  assert.equal(out, null);
});

test('field-discovery: returns null when no advance actions are visible', () => {
  const page: FormPage = {
    url: 'http://x', title: 't', detectedAt: '', formCount: 1, totalFieldCount: 1, forms: [
      group('Step 1 of 3', [{ stableId: 'f1', name: 'firstName' }], [btn('s1', 'Save and Continue')]),
    ],
  };
  // "Save and Continue" is explicitly not a pagination click.
  const out = discoverNextAction(page, { firstName: 'Jane' }, new Set());
  assert.equal(out, null);
});

test('field-discovery: finds "Next" button in multi-step form with unfilled fields', () => {
  const page: FormPage = {
    url: 'http://x', title: 't', detectedAt: '', formCount: 1, totalFieldCount: 1, forms: [
      group('Step 1 of 3', [
        { stableId: 'f1', name: 'firstName', valuePresent: false },
      ], [btn('nextBtn', 'Next'), btn('saveBtn', 'Save and Continue')]),
    ],
  };
  const out = discoverNextAction(page, { firstName: 'Jane' }, new Set());
  assert.ok(out);
  assert.equal(out?.kind, 'click-button');
  assert.equal(out?.stableId, 'nextBtn');
  assert.match(out?.reason ?? '', /next step/);
});

test('field-discovery: "Continue" button is also recognised', () => {
  const page: FormPage = {
    url: 'http://x', title: 't', detectedAt: '', formCount: 1, totalFieldCount: 1, forms: [
      group('Page 1 of 4', [
        { stableId: 'f1', name: 'firstName', valuePresent: false },
      ], [btn('c1', 'Continue')]),
    ],
  };
  const out = discoverNextAction(page, { firstName: 'Jane' }, new Set());
  assert.ok(out);
  assert.equal(out?.stableId, 'c1');
});

test('field-discovery: skips already-clicked actions', () => {
  const page: FormPage = {
    url: 'http://x', title: 't', detectedAt: '', formCount: 1, totalFieldCount: 1, forms: [
      group('Step 1 of 3', [
        { stableId: 'f1', name: 'firstName', valuePresent: false },
      ], [btn('nextBtn', 'Next')]),
    ],
  };
  const out = discoverNextAction(page, { firstName: 'Jane' }, new Set(['nextBtn']));
  assert.equal(out, null);
});

test('field-discovery: NEVER clicks submit/reset buttons', () => {
  const page: FormPage = {
    url: 'http://x', title: 't', detectedAt: '', formCount: 1, totalFieldCount: 1, forms: [
      group('Step 1 of 1', [
        { stableId: 'f1', name: 'firstName', valuePresent: false },
      ], [
        btn('sub', 'Submit application', 'submit'),
        btn('rst', 'Reset', 'reset'),
        btn('nxt', 'Next'),
      ]),
    ],
  };
  const out = discoverNextAction(page, { firstName: 'Jane' }, new Set());
  assert.equal(out?.stableId, 'nxt');
});

test('field-discovery: "Add education" matches the education profile key', () => {
  const page: FormPage = {
    url: 'http://x', title: 't', detectedAt: '', formCount: 1, totalFieldCount: 3, forms: [
      group('Profile', [
        { stableId: 'f0', name: 'education[0].school', repeatingGroup: { baseName: 'education', index: 0 } },
        { stableId: 'f1', name: 'education[0].degree', repeatingGroup: { baseName: 'education', index: 0 } },
        { stableId: 'f2', name: 'education[0].startDate', repeatingGroup: { baseName: 'education', index: 0 } },
      ], [btn('addEdu', 'Add education')]),
    ],
  };
  const profile = { education: [{ school: 'A' }, { school: 'B' }] };
  const out = discoverNextAction(page, profile, new Set());
  assert.ok(out);
  assert.equal(out?.stableId, 'addEdu');
  assert.match(out?.reason ?? '', /education/);
});

test('field-discovery: "Add another" without a subject picks the only candidate', () => {
  const page: FormPage = {
    url: 'http://x', title: 't', detectedAt: '', formCount: 1, totalFieldCount: 1, forms: [
      group('Profile', [
        { stableId: 'f0', name: 'experience[0].company', repeatingGroup: { baseName: 'experience', index: 0 } },
      ], [btn('addGen', 'Add another')]),
    ],
  };
  const profile = { experience: [{ company: 'A' }, { company: 'B' }] };
  const out = discoverNextAction(page, profile, new Set());
  assert.ok(out);
  assert.equal(out?.stableId, 'addGen');
});

test('field-discovery: when profile has FEWER records than the page, no Add is suggested', () => {
  const page: FormPage = {
    url: 'http://x', title: 't', detectedAt: '', formCount: 1, totalFieldCount: 3, forms: [
      group('Profile', [
        { stableId: 'f0', name: 'education[0].school', repeatingGroup: { baseName: 'education', index: 0 } },
        { stableId: 'f1', name: 'education[1].school', repeatingGroup: { baseName: 'education', index: 1 } },
      ], [btn('addEdu', 'Add education')]),
    ],
  };
  const profile = { education: [{ school: 'A' }] };
  const out = discoverNextAction(page, profile, new Set());
  assert.equal(out, null);
});

test('field-discovery: "Add" with mismatched subject is rejected', () => {
  const page: FormPage = {
    url: 'http://x', title: 't', detectedAt: '', formCount: 1, totalFieldCount: 1, forms: [
      group('Profile', [
        { stableId: 'f0', name: 'education[0].school', repeatingGroup: { baseName: 'education', index: 0 } },
      ], [btn('addLanguage', 'Add language')]),
    ],
  };
  const profile = { education: [{ school: 'A' }, { school: 'B' }] };
  const out = discoverNextAction(page, profile, new Set());
  assert.equal(out, null);
});

test('field-discovery: prioritises multi-step pagination over adding sections', () => {
  const page: FormPage = {
    url: 'http://x', title: 't', detectedAt: '', formCount: 1, totalFieldCount: 1, forms: [
      group('Step 1 of 3', [
        { stableId: 'f0', name: 'education[0].school', repeatingGroup: { baseName: 'education', index: 0 } },
      ], [
        btn('nextBtn', 'Next'),
        btn('addEdu', 'Add education'),
      ]),
    ],
  };
  const profile = { education: [{ school: 'A' }, { school: 'B' }] };
  const out = discoverNextAction(page, profile, new Set());
  assert.equal(out?.stableId, 'nextBtn');
});

test('field-discovery: ignores "Upload resume" (cannot fill file inputs)', () => {
  const page: FormPage = {
    url: 'http://x', title: 't', detectedAt: '', formCount: 1, totalFieldCount: 1, forms: [
      group('Profile', [
        { stableId: 'f0', name: 'firstName', valuePresent: false },
      ], [btn('up', 'Upload resume')]),
    ],
  };
  const out = discoverNextAction(page, { firstName: 'Jane' }, new Set());
  assert.equal(out, null);
});
