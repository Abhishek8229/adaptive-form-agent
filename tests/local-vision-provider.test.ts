import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalVisionProvider } from '../src/background/vision-provider.ts';

const mockInput = {
  controlType: 'input-text',
  semanticContext: 'Email',
  candidateKeys: ['emailAddress', 'firstName'],
  screenshot: { dataUrl: 'data:image/png;base64,mockbase64', width: 100, height: 100 }
};

test('local vision provider: valid JSON response', async () => {
  const provider = new LocalVisionProvider({ endpoint: 'http://mock' });
  (globalThis as any).fetch = async (url: string, opts: any) => {
    return {
      ok: true,
      json: async () => ({ response: '{"profileKey":"emailAddress","confidence":0.95}' })
    };
  };

  const res = await provider.analyzeField(mockInput);
  assert.equal(res.profileKey, 'emailAddress');
  assert.equal(res.confidence, 0.95);
});

test('local vision provider: invalid profile key rejected', async () => {
  const provider = new LocalVisionProvider({ endpoint: 'http://mock' });
  (globalThis as any).fetch = async () => ({
    ok: true,
    json: async () => ({ response: '{"profileKey":"hallucinatedKey","confidence":0.95}' })
  });

  const res = await provider.analyzeField(mockInput);
  assert.equal(res.profileKey, null);
  assert.equal(res.reason, 'hallucinated_key');
});

test('local vision provider: low confidence rejected', async () => {
  const provider = new LocalVisionProvider({ endpoint: 'http://mock' });
  (globalThis as any).fetch = async () => ({
    ok: true,
    json: async () => ({ response: '{"profileKey":"emailAddress","confidence":0.50}' })
  });

  const res = await provider.analyzeField(mockInput);
  assert.equal(res.profileKey, null);
  assert.equal(res.reason, 'low_confidence');
});

test('local vision provider: markdown-wrapped JSON safely parsed', async () => {
  const provider = new LocalVisionProvider({ endpoint: 'http://mock' });
  (globalThis as any).fetch = async () => ({
    ok: true,
    json: async () => ({ response: '```json\n{"profileKey":"emailAddress","confidence":0.90}\n```' })
  });

  const res = await provider.analyzeField(mockInput);
  assert.equal(res.profileKey, 'emailAddress');
  assert.equal(res.confidence, 0.9);
});

test('local vision provider: missing image abstains', async () => {
  const provider = new LocalVisionProvider({ endpoint: 'http://mock' });
  const res = await provider.analyzeField({ ...mockInput, screenshot: undefined });
  assert.equal(res.profileKey, null);
  assert.equal(res.reason, 'no_image_provided');
});

test('local vision provider: HTTP error abstains', async () => {
  const provider = new LocalVisionProvider({ endpoint: 'http://mock' });
  (globalThis as any).fetch = async () => ({
    ok: false,
    status: 500
  });

  const res = await provider.analyzeField(mockInput);
  assert.equal(res.profileKey, null);
  assert.equal(res.reason, 'http_error_500');
});

test('local vision provider: network error abstains', async () => {
  const provider = new LocalVisionProvider({ endpoint: 'http://mock' });
  (globalThis as any).fetch = async () => { throw new Error('network error'); };

  const res = await provider.analyzeField(mockInput);
  assert.equal(res.profileKey, null);
  assert.equal(res.reason, 'network_error');
});
