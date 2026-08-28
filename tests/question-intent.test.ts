import test from 'node:test';
import assert from 'node:assert/strict';
import { inferQuestionIntent } from '../src/background/question-intent.ts';
import { planField } from '../src/background/agent.ts';
import { FormField } from '../src/shared/types.ts';

test('inferQuestionIntent: yearsOfExperience', async () => {
  assert.equal(inferQuestionIntent('How many years of professional experience do you have?'), 'yearsOfExperience');
});

test('inferQuestionIntent: currentJobTitle', async () => {
  assert.equal(inferQuestionIntent('What is your current job title?'), 'currentJobTitle');
});

test('inferQuestionIntent: workAuthorization', async () => {
  assert.equal(inferQuestionIntent('Are you legally authorized to work in the US?'), 'workAuthorization');
});

test('inferQuestionIntent: visaSponsorship', async () => {
  assert.equal(inferQuestionIntent('Will you now or in the future require sponsorship?'), 'visaSponsorship');
});

test('inferQuestionIntent: degree', async () => {
  assert.equal(inferQuestionIntent('Highest level of education or degree'), 'degree');
});

test('inferQuestionIntent: school', async () => {
  assert.equal(inferQuestionIntent('What university or college did you attend?'), 'school');
});

test('inferQuestionIntent: salary', async () => {
  assert.equal(inferQuestionIntent('What is your expected salary?'), 'expectedSalary');
});

test('inferQuestionIntent: email', async () => {
  assert.equal(inferQuestionIntent('Email address'), 'email');
});

test('inferQuestionIntent: phone', async () => {
  assert.equal(inferQuestionIntent('Phone number'), 'phone');
});

test('inferQuestionIntent: LinkedIn', async () => {
  assert.equal(inferQuestionIntent('LinkedIn Profile URL'), 'linkedIn');
});

test('inferQuestionIntent: GitHub', async () => {
  assert.equal(inferQuestionIntent('GitHub URL'), 'github');
});

test('inferQuestionIntent: ambiguous text returns null', async () => {
  assert.equal(inferQuestionIntent('What are your thoughts on relocation?'), null);
  assert.equal(inferQuestionIntent('Tell us about yourself'), null);
});

test('existing referrerName vs name specificity still works', async () => {
  const profile = {
    referrerName: 'Jane Smith',
    name: 'John Doe',
  };

  const field = {
    stableId: 'f1',
    controlType: 'input-text',
    label: 'Referrer name',
    semanticContext: 'Referrer name',
    options: [],
    valuePresent: false,
    containsSensitiveValue: false,
    disabled: false,
    readOnly: false,
    required: false,
    name: 'referrerName',
  } as unknown as FormField;

  const result = await planField(field, profile);
  assert.ok(result.ok);
  if (result.ok) {
    assert.equal(result.profileKey, 'referrerName');
  }
});
