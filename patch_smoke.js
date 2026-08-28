const fs = require('fs');
let code = fs.readFileSync('tests/chrome-extension-smoke.mjs', 'utf8');

const targetHTML = `    <div id="test-container" style="padding: 50px;">
      <span>How many years have you worked professionally?</span>
      <input type="text" id="target-field">
    </div>`;

const newHTML = `    <div id="test-container" style="padding: 50px;">
      <!-- Intentionally weak DOM semantics -->
      <div style="font-size: 16px;">What is your current</div>
      <div style="font-size: 16px;">annual salary?</div>
      <input type="text" id="target-field" style="margin-top: 10px;">
    </div>`;
// Replace the old HTML inside the code
code = code.replace(
  /    <div id="test-container" style="padding: 50px;">[\s\S]*?<\/div>/,
  newHTML
);

// We need to also change the profile we pass in the smoke test
code = code.replace(
  /yearsExperience: "5"/,
  'expectedSalary: "100000"'
);

// We need to change the mocked OCR regions
const targetOCR = `        regions: [
          { text: 'Irrelevant text way off', confidence: 0.9, x: 800, y: 800, width: 100, height: 20 },
          { text: 'How many years of experience do you have?', confidence: 0.99, x: 140, y: 140, width: 200, height: 30 }
        ]`;

// In the cropped image, the field is at 150,150. So regions above it should be roughly x: 150, y: 100.
// Let's pass regions that look exactly like the split text.
const newOCR = `        regions: [
          { text: 'What is your current', confidence: 0.99, x: 150, y: 100, width: 150, height: 20 },
          { text: 'annual salary?', confidence: 0.99, x: 150, y: 120, width: 120, height: 20 }
        ]`;
code = code.replace(targetOCR, newOCR);

fs.writeFileSync('tests/chrome-extension-smoke.mjs', code);
