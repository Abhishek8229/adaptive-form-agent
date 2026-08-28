import test from 'node:test';
import assert from 'node:assert/strict';
import { OllamaLLMProvider, LLMProviderInput } from '../src/background/llm-provider.ts';

const mockInput: LLMProviderInput = {
  semanticContext: 'What is your current job title?',
  controlType: 'input-text',
  candidateKeys: ['name', 'company', 'currentJobTitle', 'city'],
};

test('ollama provider: valid JSON response', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ response: '{"profileKey": "currentJobTitle", "confidence": 0.94}' })
  }) as any;

  try {
    const provider = new OllamaLLMProvider();
    const result = await provider.matchProfileKey(mockInput);
    assert.equal(result.profileKey, 'currentJobTitle');
    assert.equal(result.confidence, 0.94);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ollama provider: invalid profile key rejected', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ response: '{"profileKey": "hallucinatedKey", "confidence": 0.94}' })
  }) as any;

  try {
    const provider = new OllamaLLMProvider();
    const result = await provider.matchProfileKey(mockInput);
    assert.equal(result.profileKey, null);
    assert.match(result.reason || '', /hallucinated/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ollama provider: low confidence rejected', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ response: '{"profileKey": "currentJobTitle", "confidence": 0.5}' })
  }) as any;

  try {
    const provider = new OllamaLLMProvider();
    const result = await provider.matchProfileKey(mockInput);
    assert.equal(result.profileKey, null);
    assert.match(result.reason || '', /Low confidence/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ollama provider: malformed JSON -> abstain', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ response: '{ broken JSON }' })
  }) as any;

  try {
    const provider = new OllamaLLMProvider();
    const result = await provider.matchProfileKey(mockInput);
    assert.equal(result.profileKey, null);
    assert.match(result.reason || '', /Error/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ollama provider: markdown-wrapped JSON safely parsed', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ response: '```json\n{"profileKey": "currentJobTitle", "confidence": 0.9}\n```' })
  }) as any;

  try {
    const provider = new OllamaLLMProvider();
    const result = await provider.matchProfileKey(mockInput);
    assert.equal(result.profileKey, 'currentJobTitle');
    assert.equal(result.confidence, 0.9);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ollama provider: HTTP error -> abstain', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 500
  }) as any;

  try {
    const provider = new OllamaLLMProvider();
    const result = await provider.matchProfileKey(mockInput);
    assert.equal(result.profileKey, null);
    assert.match(result.reason || '', /HTTP error/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ollama provider: network error -> abstain', async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('fetch failed');
  };

  try {
    const provider = new OllamaLLMProvider();
    const result = await provider.matchProfileKey(mockInput);
    assert.equal(result.profileKey, null);
    assert.match(result.reason || '', /fetch failed/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
