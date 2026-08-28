const fs = require('fs');
let code = fs.readFileSync('tests/ocr-fallback.test.ts', 'utf8');

code = code.replace(
  "import { selectBestOCRRegion } from '../src/background/ocr-provider';",
  "import { associateVisualQuestion } from '../src/background/visual-association';"
);

const oldTestStart = "test('selectBestOCRRegion: valid regions', () => {";
const oldTestEnd = "});"; // Need to replace accurately

// Just string-replace the entire test block.
code = code.replace(/test\('selectBestOCRRegion: valid regions'[\s\S]*?\n\}\);\n/m, '');

const newTests = `
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
`;

code = code.replace("test('local OCR provider: plain-text backward compatibility'", newTests + "\ntest('local OCR provider: plain-text backward compatibility'");

fs.writeFileSync('tests/ocr-fallback.test.ts', code);
