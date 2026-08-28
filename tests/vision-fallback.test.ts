import test from 'node:test';
import assert from 'node:assert/strict';
import { planField } from '../src/background/agent.ts';
import { FormField } from '../src/shared/types.ts';
import { LocalLLMProvider } from '../src/background/llm-provider.ts';
import { VisionProvider } from '../src/background/vision-provider.ts';

function createMockField(label: string, name: string): FormField {
  return {
    stableId: 'f1',
    controlType: 'input-text',
    label,
    semanticContext: label,
    options: [],
    valuePresent: false,
    containsSensitiveValue: false,
    disabled: false,
    readOnly: false,
    required: false,
    name,
    semanticHint: 'unknown' as any,
    semanticSources: [],
    target: {} as any,
  };
}

test('vision fallback: deterministic matcher prevents LLM and vision call', async () => {
  const field = createMockField('First Name', 'firstName');
  const profile = { firstName: 'John' };
  
  let llmCalled = false;
  let visionCalled = false;
  
  const llm: LocalLLMProvider = {
    async matchProfileKey(input) {
      llmCalled = true;
      return { profileKey: 'firstName', confidence: 0.99 };
    }
  };
  
  const vision: VisionProvider = {
    async analyzeField(input) {
      visionCalled = true;
      return { profileKey: 'firstName', confidence: 0.99 };
    }
  };

  const result = await planField(field, profile, llm, vision);
  assert.equal(llmCalled, false);
  assert.equal(visionCalled, false);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.profileKey, 'firstName');
});

test('vision fallback: successful LLM prevents vision call', async () => {
  const field = createMockField('What do people call you?', 'unknownField');
  const profile = { nickname: 'Johnny' };
  
  let visionCalled = false;
  const llm: LocalLLMProvider = {
    async matchProfileKey(input) {
      return { profileKey: 'nickname', confidence: 0.95 };
    }
  };
  const vision: VisionProvider = {
    async analyzeField(input) {
      visionCalled = true;
      return { profileKey: 'nickname', confidence: 0.99 };
    }
  };

  const result = await planField(field, profile, llm, vision);
  assert.equal(visionCalled, false, 'Vision should not be called if LLM succeeds');
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.profileKey, 'nickname');
});

test('vision fallback: unresolved field reaches vision', async () => {
  const field = createMockField('Unrecognized field', 'unknownField');
  const profile = { nickname: 'Johnny' };
  
  let visionCalled = false;
  const llm: LocalLLMProvider = {
    async matchProfileKey(input) {
      return { profileKey: null, confidence: 0 }; // LLM fails
    }
  };
  const vision: VisionProvider = {
    async analyzeField(input) {
      visionCalled = true;
      return { profileKey: 'nickname', confidence: 0.99, visualContext: 'Found visually' };
    }
  };

  const result = await planField(field, profile, llm, vision);
  assert.equal(visionCalled, true, 'Vision should be called when LLM fails');
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.profileKey, 'nickname');
});

test('vision fallback: invalid vision profile key rejected', async () => {
  const field = createMockField('Complex vision field', 'unknownField');
  const profile = { nickname: 'Johnny' };
  
  const vision: VisionProvider = {
    async analyzeField(input) {
      return { profileKey: 'madeUpKey', confidence: 0.99 };
    }
  };

  const result = await planField(field, profile, undefined, vision);
  assert.equal(result.ok, false, 'Invalid vision key should be rejected');
});

test('vision fallback: low-confidence vision result abstains', async () => {
  const field = createMockField('Blurry field', 'unknownField');
  const profile = { nickname: 'Johnny' };
  
  const vision: VisionProvider = {
    async analyzeField(input) {
      return { profileKey: 'nickname', confidence: 0.5 };
    }
  };

  const result = await planField(field, profile, undefined, vision);
  assert.equal(result.ok, false, 'Low confidence vision key should be rejected');
});

test('vision fallback: vision provider unavailable -> safe skip', async () => {
  const field = createMockField('Unrecognized field', 'unknownField');
  const profile = { nickname: 'Johnny' };
  
  const result = await planField(field, profile, undefined, undefined);
  assert.equal(result.ok, false, 'Should gracefully fallback to skip');
});

test('vision fallback: protected field never reaches vision', async () => {
  const field = createMockField('password', 'password'); // Matches protected regex
  field.controlType = 'input-password';
  const profile = { password: 'pwd' };
  
  let visionCalled = false;
  const vision: VisionProvider = {
    async analyzeField(input) {
      visionCalled = true;
      return { profileKey: 'password', confidence: 0.99 };
    }
  };

  const result = await planField(field, profile, undefined, vision);
  assert.equal(visionCalled, false, 'Protected field should never reach vision');
  assert.equal(result.ok, false);
});
