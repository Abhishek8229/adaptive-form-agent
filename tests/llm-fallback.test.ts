import test from 'node:test';
import assert from 'node:assert/strict';
import { planField } from '../src/background/agent.ts';
import { FormField } from '../src/shared/types.ts';
import { LLMProviderInput, LLMMatchResult, LocalLLMProvider } from '../src/background/llm-provider.ts';

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

test('llm fallback: deterministic matcher wins before LLM', async () => {
  const field = createMockField('First Name', 'firstName');
  const profile = { firstName: 'John' };
  
  let llmCalled = false;
  const llm: LocalLLMProvider = {
    async matchProfileKey(input) {
      llmCalled = true;
      return { profileKey: 'firstName', confidence: 0.99 };
    }
  };

  const result = await planField(field, profile, llm);
  assert.equal(llmCalled, false, 'LLM should not be called if deterministic matches');
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.profileKey, 'firstName');
});

test('llm fallback: LLM is called only when deterministic matching fails', async () => {
  const field = createMockField('What do people call you?', 'unknownField');
  const profile = { nickname: 'Johnny' };
  
  let llmCalled = false;
  const llm: LocalLLMProvider = {
    async matchProfileKey(input) {
      llmCalled = true;
      return { profileKey: 'nickname', confidence: 0.95 };
    }
  };

  const result = await planField(field, profile, llm);
  assert.equal(llmCalled, true, 'LLM should be called when deterministic fails');
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.profileKey, 'nickname');
});

test('llm fallback: invalid/non-candidate LLM key is rejected', async () => {
  const field = createMockField('Complex question', 'unknownField');
  const profile = { nickname: 'Johnny' };
  
  const llm: LocalLLMProvider = {
    async matchProfileKey(input) {
      return { profileKey: 'madeUpKey', confidence: 0.99 };
    }
  };

  const result = await planField(field, profile, llm);
  assert.equal(result.ok, false, 'Invalid LLM key should be rejected');
});

test('llm fallback: low-confidence LLM result abstains', async () => {
  const field = createMockField('Another complex question', 'unknownField');
  const profile = { nickname: 'Johnny' };
  
  const llm: LocalLLMProvider = {
    async matchProfileKey(input) {
      return { profileKey: 'nickname', confidence: 0.5 };
    }
  };

  const result = await planField(field, profile, llm);
  assert.equal(result.ok, false, 'Low confidence LLM key should be rejected');
});

test('llm fallback: provider unavailable gracefully falls back', async () => {
  const field = createMockField('Unrecognized field', 'unknownField');
  const profile = { nickname: 'Johnny' };
  
  const result = await planField(field, profile, undefined); // No provider
  assert.equal(result.ok, false, 'Should gracefully fallback without throwing');
});
