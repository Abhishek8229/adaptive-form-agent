import type { OCRRegion } from './ocr-provider';

export interface FieldBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropOffset {
  x: number;
  y: number;
  scale: number;
}

const MIN_OCR_CONFIDENCE = 0.5;
const MAX_CANDIDATE_DISTANCE = 800;
const ABOVE_BONUS = 1000;
const LEFT_BONUS = 800;

// Convert an OCR region (relative to crop image) into viewport coordinates
function toViewport(region: OCRRegion, cropOffset: CropOffset): FieldBox {
  return {
    x: cropOffset.x + region.x / cropOffset.scale,
    y: cropOffset.y + region.y / cropOffset.scale,
    width: region.width / cropOffset.scale,
    height: region.height / cropOffset.scale,
  };
}

function computeDistance(box1: FieldBox, box2: FieldBox): number {
  const cx1 = box1.x + box1.width / 2;
  const cy1 = box1.y + box1.height / 2;
  const cx2 = box2.x + box2.width / 2;
  const cy2 = box2.y + box2.height / 2;
  return Math.sqrt(Math.pow(cx1 - cx2, 2) + Math.pow(cy1 - cy2, 2));
}

function horizontalOverlap(box: FieldBox, field: FieldBox): number {
  return Math.max(0, Math.min(box.x + box.width, field.x + field.width) - Math.max(box.x, field.x));
}

function verticalOverlap(box: FieldBox, field: FieldBox): number {
  return Math.max(0, Math.min(box.y + box.height, field.y + field.height) - Math.max(box.y, field.y));
}

// Determine if box is directly above field
function isAbove(box: FieldBox, field: FieldBox): boolean {
  const overlap = horizontalOverlap(box, field);
  const strictlyAbove = box.y + box.height <= field.y + 10;
  return overlap > 0 && strictlyAbove;
}

// Determine if box is directly left of field
function isLeft(box: FieldBox, field: FieldBox): boolean {
  const overlap = verticalOverlap(box, field);
  const strictlyLeft = box.x + box.width <= field.x + 10;
  return overlap > 0 && strictlyLeft;
}

// Determine if box is the same row as the field (no strong above/left signal)
function isNearField(box: FieldBox, field: FieldBox): boolean {
  const dy = Math.max(box.y, field.y) - Math.min(box.y + box.height, field.y + field.height);
  return dy <= Math.max(box.height, field.height);
}

// Words that mark a region as clearly NOT a field question
const NOISE_PATTERNS: RegExp[] = [
  /^\s*(home|about|contact|login|sign in|sign up|menu|nav|footer|copyright|privacy|terms)\b/i,
  /^\s*\d+\s*$/,                          // pure numbers
  /^\s*[\W_]+\s*$/,                       // pure symbols
];

function looksLikeNoise(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return true;
  for (const p of NOISE_PATTERNS) {
    if (p.test(t)) return true;
  }
  return false;
}

export function associateVisualQuestion(
  regions: OCRRegion[],
  fieldBox: FieldBox,
  cropOffset: CropOffset
): string | undefined {
  if (!regions || regions.length === 0) return undefined;
  if (!fieldBox) return undefined;

  // Map all candidates into viewport coordinates and apply minimum gates.
  const mappedRegions = regions
    .filter(r => r && typeof r.confidence === 'number' && r.confidence >= MIN_OCR_CONFIDENCE)
    .filter(r => r.text && r.text.trim().length > 0)
    .filter(r => !looksLikeNoise(r.text))
    .map(r => ({
      original: r,
      viewport: toViewport(r, cropOffset),
    }));

  if (mappedRegions.length === 0) return undefined;

  let bestScore = -Infinity;
  let bestPrimaryRegion: typeof mappedRegions[0] | undefined;

  for (const r of mappedRegions) {
    const box = r.viewport;
    const dist = computeDistance(box, fieldBox);

    // Hard reject candidates that are clearly below the field, or too far.
    if (box.y > fieldBox.y + fieldBox.height + 20) continue; // below field
    if (dist > MAX_CANDIDATE_DISTANCE) continue;            // too far

    let score = 0;

    // Confidence weight: high-confidence regions beat low-confidence ones
    // at the same distance. The multiplier keeps the unit of other terms.
    score += r.original.confidence * 100;

    // Distance penalty (smaller is better)
    score -= dist;

    // Layout bonus with alignment preference.
    if (isAbove(box, fieldBox)) {
      score += ABOVE_BONUS;
      const gap = Math.max(0, fieldBox.y - (box.y + box.height));
      score -= gap * 2;
      // Reward horizontal alignment: overlapping or centered
      const overlap = horizontalOverlap(box, fieldBox);
      const minWidth = Math.min(box.width, fieldBox.width);
      if (minWidth > 0) {
        score += Math.min(150, (overlap / minWidth) * 150);
      }
    } else if (isLeft(box, fieldBox)) {
      score += LEFT_BONUS;
      const gap = Math.max(0, fieldBox.x - (box.x + box.width));
      score -= gap * 2;
      const overlap = verticalOverlap(box, fieldBox);
      const minHeight = Math.min(box.height, fieldBox.height);
      if (minHeight > 0) {
        score += Math.min(150, (overlap / minHeight) * 150);
      }
    } else if (isNearField(box, fieldBox)) {
      // Same-row / nearby but neither clearly above nor left.
      score += 100;
    }

    // Question-like bonus
    const text = r.original.text;
    if (text.includes('?')) score += 150;
    if (/^(what|how|why|where|when|who|select|enter|choose|please)/i.test(text)) score += 100;

    // For multi-line questions, the topmost above-field region is the
    // primary; strongly prefer it so we can combine downward continuations.
    if (isAbove(box, fieldBox)) {
      // Bonus: being the topmost above-field candidate wins ties.
      // Use a large range to outvote question-like bonuses and distance gaps.
      score += (10000 - box.y * 10);
    }

    if (score > bestScore) {
      bestScore = score;
      bestPrimaryRegion = r;
    }
  }

  if (!bestPrimaryRegion) return undefined;

  // Look for a secondary region to combine (e.g. question split across two lines).
  // Condition: directly below the primary region, close, left-aligned, still above
  // the field, and not separated by unrelated text.
  const primaryBox = bestPrimaryRegion.viewport;
  let combinedText = bestPrimaryRegion.original.text;

  const candidatesBelow = mappedRegions
    .filter(r => r !== bestPrimaryRegion)
    .map(r => {
      const box = r.viewport;
      const verticalDiff = box.y - (primaryBox.y + primaryBox.height);
      const leftAlignDiff = Math.abs(box.x - primaryBox.x);
      const stillAboveField = box.y + box.height <= fieldBox.y + 10;
      const closeVertically = verticalDiff >= -5 && verticalDiff <= 40;
      const closeAlign = leftAlignDiff <= 30;
      return { r, ok: closeVertically && closeAlign && stillAboveField };
    })
    .filter(x => x.ok)
    .sort((a, b) => a.r.viewport.y - b.r.viewport.y);

  if (candidatesBelow.length > 0) {
    const nextLine = candidatesBelow[0].r;
    combinedText += ' ' + nextLine.original.text;
  }

  return combinedText.trim();
}

