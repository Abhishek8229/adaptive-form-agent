import test from 'node:test';
import assert from 'node:assert/strict';
import { associateVisualQuestion } from '../src/background/visual-association';
import type { OCRRegion } from '../src/background/ocr-provider';

function r(text: string, x: number, y: number, w: number, h: number, confidence = 0.9): OCRRegion {
  return { text, confidence, x, y, width: w, height: h };
}

test('visual-association: text directly above field', () => {
  const regions = [
    r('What is your current annual salary?', 45, 30, 280, 20),
  ];
  const fieldBox = { x: 50, y: 60, width: 200, height: 30 };
  const cropOffset = { x: 0, y: 0, scale: 1 };
  const out = associateVisualQuestion(regions, fieldBox, cropOffset);
  assert.equal(out, 'What is your current annual salary?');
});

test('visual-association: text directly left of field', () => {
  const regions = [
    r('Salary', 10, 60, 60, 20),
    r('Irrelevant', 10, 400, 60, 20),
  ];
  const fieldBox = { x: 80, y: 55, width: 200, height: 30 };
  const cropOffset = { x: 0, y: 0, scale: 1 };
  const out = associateVisualQuestion(regions, fieldBox, cropOffset);
  assert.equal(out, 'Salary');
});

test('visual-association: multi-region question combination (split across two lines)', () => {
  const regions = [
    r('What is your current', 45, 10, 150, 20),
    r('annual salary?', 45, 32, 120, 20),
  ];
  const fieldBox = { x: 50, y: 60, width: 200, height: 30 };
  const cropOffset = { x: 0, y: 0, scale: 1 };
  const out = associateVisualQuestion(regions, fieldBox, cropOffset);
  assert.equal(out, 'What is your current annual salary?');
});

test('visual-association: distant text is rejected', () => {
  const regions = [
    r('Footer copyright 2024', 10, 950, 200, 20, 0.99),
  ];
  const fieldBox = { x: 50, y: 60, width: 200, height: 30 };
  const cropOffset = { x: 0, y: 0, scale: 1 };
  const out = associateVisualQuestion(regions, fieldBox, cropOffset);
  assert.equal(out, undefined);
});

test('visual-association: text clearly below the field is rejected', () => {
  const regions = [
    r('Unrelated caption under field', 45, 200, 200, 20),
  ];
  const fieldBox = { x: 50, y: 60, width: 200, height: 30 };
  const cropOffset = { x: 0, y: 0, scale: 1 };
  const out = associateVisualQuestion(regions, fieldBox, cropOffset);
  assert.equal(out, undefined);
});

test('visual-association: unrelated nearby question is rejected in favor of aligned one', () => {
  const regions = [
    r('What is your favorite color?', 250, 60, 240, 20), // to the right of the field
    r('What is your current annual salary?', 45, 30, 280, 20), // above
  ];
  const fieldBox = { x: 50, y: 60, width: 200, height: 30 };
  const cropOffset = { x: 0, y: 0, scale: 1 };
  const out = associateVisualQuestion(regions, fieldBox, cropOffset);
  assert.equal(out, 'What is your current annual salary?');
});

test('visual-association: aligned text above beats misaligned text', () => {
  // Aligned, exactly above the field
  const aligned = r('Salary', 50, 30, 200, 20);
  // Also above, but offset to the right and slightly further away
  const offset = r('Salary Expectations Maybe', 320, 35, 220, 20);
  const fieldBox = { x: 50, y: 60, width: 200, height: 30 };
  const cropOffset = { x: 0, y: 0, scale: 1 };
  const out = associateVisualQuestion([offset, aligned], fieldBox, cropOffset);
  assert.equal(out, 'Salary');
});

test('visual-association: crop offset is correctly translated', () => {
  // Crop starts at (200, 100) viewport, with scale 2 (crop image is 2x viewport).
  // OCR coordinates are in crop-image space.
  const regions = [
    r('Annual income', 100, 60, 200, 20), // in crop-image: viewport = (200+100/2, 100+60/2)=(250, 130)
  ];
  const fieldBox = { x: 250, y: 160, width: 200, height: 30 };
  const cropOffset = { x: 200, y: 100, scale: 2 };
  const out = associateVisualQuestion(regions, fieldBox, cropOffset);
  assert.equal(out, 'Annual income');
});

test('visual-association: low-confidence OCR is deprioritized vs high-confidence at same distance', () => {
  // Both are above the field at the same vertical position.
  // High-confidence noise text vs. low-confidence correct question.
  // Confidence multiplier must let the high-confidence question win when
  // the question text is clearly above and the noise text is off to the side.
  const correct = r('Email address', 50, 30, 200, 20, 0.55);
  const noise = r('Subscribe to our newsletter', 400, 30, 220, 20, 0.99);
  const fieldBox = { x: 50, y: 60, width: 200, height: 30 };
  const cropOffset = { x: 0, y: 0, scale: 1 };
  const out = associateVisualQuestion([correct, noise], fieldBox, cropOffset);
  assert.equal(out, 'Email address');
});

test('visual-association: sub-threshold confidence is filtered', () => {
  const regions = [
    r('Email address', 50, 30, 200, 20, 0.4), // below 0.5
  ];
  const fieldBox = { x: 50, y: 60, width: 200, height: 30 };
  const cropOffset = { x: 0, y: 0, scale: 1 };
  const out = associateVisualQuestion(regions, fieldBox, cropOffset);
  assert.equal(out, undefined);
});

test('visual-association: navigation text is rejected as noise', () => {
  const regions = [
    r('Home  About  Contact  Login', 10, 30, 600, 20, 0.99),
  ];
  const fieldBox = { x: 50, y: 60, width: 200, height: 30 };
  const cropOffset = { x: 0, y: 0, scale: 1 };
  const out = associateVisualQuestion(regions, fieldBox, cropOffset);
  assert.equal(out, undefined);
});

test('visual-association: empty input returns undefined', () => {
  const fieldBox = { x: 50, y: 60, width: 200, height: 30 };
  const cropOffset = { x: 0, y: 0, scale: 1 };
  assert.equal(associateVisualQuestion([], fieldBox, cropOffset), undefined);
  assert.equal(associateVisualQuestion(undefined as unknown as OCRRegion[], fieldBox, cropOffset), undefined);
});

test('visual-association: deterministic match still wins (agent pipeline)', async () => {
  // Importing planField here keeps this test self-contained and proves that
  // a successful DOM/semantic match does NOT consult the visual association.
  const { planField } = await import('../src/background/agent');
  const field = {
    id: 'f1', name: '', tag: 'input', type: 'text', controlType: 'input-text',
    label: 'Email address', ariaLabel: '', placeholder: '', autocomplete: '',
    disabled: false, readOnly: false, required: false, visible: true,
    options: [], semanticHint: 'email', semanticSources: [],
    valuePresent: false, containsSensitiveValue: false, stableId: 's1',
    target: { selector: 'input', pathIndex: 0, tag: 'input', type: 'text',
      id: 'f1', name: '', label: '', ariaLabel: '', placeholder: '', autocomplete: '',
      formId: '', formName: '' },
  } as const;
  const profile = { email: 'jane@example.com' };

  let ocrCalled = false;
  let visualCtxCalled = false;
  const ocrProvider = { extractText: async () => { ocrCalled = true; return { text: '', confidence: 0 }; } };
  const getVisualContext = async () => { visualCtxCalled = true; return {} as any; };

  const res = await planField(field as any, profile, undefined, undefined, ocrProvider as any, getVisualContext as any);
  assert.equal(res.ok, true);
  if (res.ok) assert.equal(res.profileKey, 'email');
  assert.equal(ocrCalled, false, 'OCR must NOT be called when deterministic match succeeds');
  assert.equal(visualCtxCalled, false, 'visual context must NOT be fetched when deterministic match succeeds');
});

test('visual-association: protected field stays protected (password never reaches OCR)', async () => {
  const { planField } = await import('../src/background/agent');
  const field = {
    id: 'p1', name: 'password', tag: 'input', type: 'password', controlType: 'input-password',
    label: '', ariaLabel: '', placeholder: '', autocomplete: 'current-password',
    disabled: false, readOnly: false, required: false, visible: true,
    options: [], semanticHint: 'password', semanticSources: [],
    valuePresent: false, containsSensitiveValue: true, stableId: 's1',
    target: { selector: 'input', pathIndex: 0, tag: 'input', type: 'password',
      id: 'p1', name: 'password', label: '', ariaLabel: '', placeholder: '',
      autocomplete: 'current-password', formId: '', formName: '' },
  } as const;
  const profile = { password: 'hunter2' };

  let ocrCalled = false;
  const ocrProvider = { extractText: async () => { ocrCalled = true; return { text: 'Password', confidence: 1, regions: [] }; } };
  const getVisualContext = async () => ({
    screenshot: { dataUrl: 'data:,', width: 100, height: 100, cropOffset: { x: 0, y: 0, scale: 1 } },
    nearbyText: '', boundingBox: { x: 0, y: 0, width: 100, height: 30 },
    visibility: 'visible' as const,
  });

  const res = await planField(field as any, profile, undefined, undefined, ocrProvider as any, getVisualContext as any);
  assert.equal(res.ok, false, 'password must not be filled by agent planner');
  assert.equal(ocrCalled, false, 'OCR must not be called for a protected field');
});
