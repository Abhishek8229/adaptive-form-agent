import test from 'node:test';
import assert from 'node:assert';
import { LocalOCRProvider } from '../src/background/ocr-provider';
import { planField } from '../src/background/agent';
import type { FormField, FieldVisualContext } from '../src/shared/types';
import type { JsonProfile } from '../src/shared/profile';
import http from 'node:http';
import { associateVisualQuestion } from '../src/background/visual-association';



test('associateVisualQuestion: directly above field', () => {
  const regions = [
    { text: 'Irrelevant', confidence: 0.9, x: 500, y: 500, width: 50, height: 20 },
    { text: 'First Name', confidence: 0.9, x: 45, y: 30, width: 60, height: 20 }, // in crop
  ];
  const fieldBox = { x: 50, y: 60, width: 100, height: 30 };
  const cropOffset = { x: 0, y: 0, scale: 1 };
  
  const best = associateVisualQuestion(regions, fieldBox, cropOffset);
  assert.strictEqual(best, 'First Name');
});

test('associateVisualQuestion: multi-region question combination', () => {
  const regions = [
    { text: 'What is your current', confidence: 0.9, x: 45, y: 10, width: 100, height: 20 },
    { text: 'annual salary?', confidence: 0.9, x: 45, y: 32, width: 80, height: 20 },
  ];
  const fieldBox = { x: 50, y: 60, width: 100, height: 30 };
  const cropOffset = { x: 0, y: 0, scale: 1 };
  
  const best = associateVisualQuestion(regions, fieldBox, cropOffset);
  assert.strictEqual(best, 'What is your current annual salary?');
});

test('associateVisualQuestion: distant text rejected', () => {
  const regions = [
    { text: 'Footer text', confidence: 0.9, x: 10, y: 900, width: 100, height: 20 },
  ];
  const fieldBox = { x: 50, y: 60, width: 100, height: 30 };
  const cropOffset = { x: 0, y: 0, scale: 1 };
  
  const best = associateVisualQuestion(regions, fieldBox, cropOffset);
  assert.strictEqual(best, undefined);
});

test('local OCR provider: plain-text backward compatibility', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ text: 'No regions here', confidence: 0.9 }));
  });
  await new Promise<void>(r => server.listen(11438, '127.0.0.1', r));

  const provider = new LocalOCRProvider({ endpoint: 'http://127.0.0.1:11438' });
  const res = await provider.extractText({ screenshot: 'base64' });
  assert.strictEqual(res.text, 'No regions here');
  assert.strictEqual(res.regions, undefined);

  server.close();
});

test('local OCR provider: malformed regions ignored safely', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      text: 'Has regions',
      confidence: 0.9,
      regions: [
        { text: 'Bad coords', confidence: 0.9, x: -5, y: 10, width: 10, height: 10 },
        { text: 'Bad conf', confidence: 2.5, x: 10, y: 10, width: 10, height: 10 },
        { text: 'Good region', confidence: 0.9, x: 10, y: 10, width: 10, height: 10 }
      ]
    }));
  });
  await new Promise<void>(r => server.listen(11439, '127.0.0.1', r));

  const provider = new LocalOCRProvider({ endpoint: 'http://127.0.0.1:11439' });
  const res = await provider.extractText({ screenshot: 'base64' });
  assert.strictEqual(res.text, 'Has regions');
  assert.strictEqual(res.regions?.length, 1);
  assert.strictEqual(res.regions?.[0].text, 'Good region');

  server.close();
});

test('local OCR provider: valid response', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ text: 'Enter your nickname here', confidence: 0.95 }));
  });
  await new Promise<void>(r => server.listen(11435, '127.0.0.1', r));

  const provider = new LocalOCRProvider({ endpoint: 'http://127.0.0.1:11435' });
  const res = await provider.extractText({ screenshot: 'base64' });
  assert.strictEqual(res.text, 'Enter your nickname here');
  assert.strictEqual(res.confidence, 0.95);

  server.close();
});

test('local OCR provider: malformed response abstains', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('not json');
  });
  await new Promise<void>(r => server.listen(11435, '127.0.0.1', r));

  const provider = new LocalOCRProvider({ endpoint: 'http://127.0.0.1:11435' });
  const res = await provider.extractText({ screenshot: 'base64' });
  assert.strictEqual(res.text, '');
  assert.strictEqual(res.confidence, 0);

  server.close();
});

test('local OCR provider: HTTP error abstains', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(500);
    res.end();
  });
  await new Promise<void>(r => server.listen(11435, '127.0.0.1', r));

  const provider = new LocalOCRProvider({ endpoint: 'http://127.0.0.1:11435' });
  const res = await provider.extractText({ screenshot: 'base64' });
  assert.strictEqual(res.text, '');

  server.close();
});

test('local OCR provider: network error abstains', async () => {
  const provider = new LocalOCRProvider({ endpoint: 'http://127.0.0.1:11436' }); // nothing listening
  const res = await provider.extractText({ screenshot: 'base64' });
  assert.strictEqual(res.text, '');
});

test('local OCR provider: low confidence abstains', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ text: 'nickname', confidence: 0.2 }));
  });
  await new Promise<void>(r => server.listen(11435, '127.0.0.1', r));

  const provider = new LocalOCRProvider({ endpoint: 'http://127.0.0.1:11435' });
  const res = await provider.extractText({ screenshot: 'base64' });
  assert.strictEqual(res.text, '');
  assert.strictEqual(res.confidence, 0);

  server.close();
});

// Fallback Tests
const dummyField: FormField = {
  id: 'f1',
  name: '',
  tag: 'input',
  type: 'text',
  controlType: 'input-text',
  label: '',
  ariaLabel: '',
  placeholder: '',
  autocomplete: '',
  disabled: false,
  readOnly: false,
  required: false,
  visible: true,
  options: [],
  semanticHint: 'unknown',
  semanticSources: [],
  valuePresent: false,
  containsSensitiveValue: false,
  stableId: 's1',
  target: {
    selector: 'input',
    pathIndex: 0,
    tag: 'input',
    type: 'text',
    id: 'f1',
    name: '',
    label: '',
    ariaLabel: '',
    placeholder: '',
    autocomplete: '',
    formId: '',
    formName: ''
  }
};

test('ocr fallback: deterministic match prevents OCR call', async () => {
  const field = { ...dummyField, label: 'Nickname' };
  const profile: JsonProfile = { nickname: 'Johnny' };

  let ocrCalled = false;
  const ocrProvider = {
    extractText: async () => {
      ocrCalled = true;
      return { text: 'Nickname', confidence: 1 };
    }
  };

  const res = await planField(field, profile, undefined, undefined, ocrProvider);
  assert.strictEqual(res.ok, true);
  if (res.ok) assert.strictEqual(res.profileKey, 'nickname');
  assert.strictEqual(ocrCalled, false);
});

test('ocr fallback: unresolved field reaches OCR', async () => {
  const profile: JsonProfile = { nickname: 'Johnny' };

  let ocrCalled = false;
  const ocrProvider = {
    extractText: async () => {
      ocrCalled = true;
      return { text: 'Nickname', confidence: 1 };
    }
  };

  let visualContextCalled = false;
  const getVisualContext = async (): Promise<FieldVisualContext> => {
    visualContextCalled = true;
    return {
      screenshot: 'base64',
      nearbyText: '',
      boundingBox: { x: 0, y: 0, width: 10, height: 10 },
      visibility: { isVisible: true, opacity: 1, zIndex: 1, isCovered: false }
    };
  };

  const res = await planField(dummyField, profile, undefined, undefined, ocrProvider, getVisualContext);
  assert.strictEqual(ocrCalled, true);
  assert.strictEqual(visualContextCalled, true);
  assert.strictEqual(res.ok, true);
  if (res.ok) assert.strictEqual(res.profileKey, 'nickname');
});

test('ocr fallback: protected field never reaches OCR', async () => {
  const field = { ...dummyField, type: 'password', controlType: 'input-password' as const };
  const profile: JsonProfile = { password: '123' };

  let ocrCalled = false;
  const ocrProvider = {
    extractText: async () => {
      ocrCalled = true;
      return { text: 'Password', confidence: 1 };
    }
  };

  const res = await planField(field, profile, undefined, undefined, ocrProvider, async () => ({} as any));
  assert.strictEqual(ocrCalled, false);
  assert.strictEqual(res.ok, false);
});
