const fs = require('fs');
let code = fs.readFileSync('src/background/agent.ts', 'utf8');

code = code.replace(
  "import { selectBestOCRRegion } from './ocr-provider';",
  "import { associateVisualQuestion } from './visual-association';"
);

const target = `      if (ocrRes.regions && ocrRes.regions.length > 0 && visualCtx.boundingBox) {
        const bestRegion = selectBestOCRRegion(
          ocrRes.regions,
          visualCtx.screenshot.width,
          visualCtx.screenshot.height,
          visualCtx.boundingBox.x,
          visualCtx.boundingBox.y
        );
        if (bestRegion) {
          targetText = bestRegion.text;
          targetConfidence = bestRegion.confidence;
        }
      }`;

const replacement = `      if (ocrRes.regions && ocrRes.regions.length > 0 && visualCtx.boundingBox && visualCtx.screenshot.cropOffset) {
        const visualQuestion = associateVisualQuestion(
          ocrRes.regions,
          visualCtx.boundingBox,
          visualCtx.screenshot.cropOffset
        );
        if (visualQuestion) {
          targetText = visualQuestion;
          targetConfidence = 1;
        }
      }`;

code = code.replace(target, replacement);
fs.writeFileSync('src/background/agent.ts', code);
