const fs = require('fs');

const original = fs.readFileSync('src/background/agent.ts', 'utf8');

const planFieldStart = original.indexOf('export function planField(');
const planFieldEnd = original.indexOf('function findSelectOptionFuzzy');

const before = original.substring(0, planFieldStart);
const after = original.substring(planFieldEnd);

const newImports = `import type { LocalLLMProvider } from './llm-provider';
import type { VisionProvider } from './vision-provider';
import type { OCRProvider } from './ocr-provider';
import { associateVisualQuestion } from './visual-association';
import { inferQuestionIntent } from './question-intent';
import type { FieldVisualContext } from '../shared/types';
`;

let code = newImports + before;

const newPlanField = `
export async function planField(
  field: FormField,
  profile: JsonProfile,
  llmProvider?: LocalLLMProvider,
  visionProvider?: VisionProvider,
  ocrProvider?: OCRProvider,
  getVisualContext?: () => Promise<FieldVisualContext | undefined>,
): Promise<PlanResult> {
  if (field.disabled || field.readOnly) {
    return { ok: false, reason: 'no_reliable_label', detail: 'field is disabled or readonly' };
  }

  const protectedPattern = /\\b(password|passwd|pwd|otp|one-time-code|cvv|cvc|cc-number|credit-?card|iban|captcha|bot challenge|recovery)\\b/i;
  const matchStr = [field.name, field.id, field.label, field.placeholder, field.ariaLabel, field.autocomplete].filter(Boolean).join(' | ');
  if (protectedPattern.test(matchStr) || field.controlType === 'input-password' || field.controlType === 'input-file' || field.containsSensitiveValue) {
    return { ok: false, reason: 'no_reliable_label', detail: 'sensitive or protected field' };
  }

  const candidates: Array<{ key: string, match: FieldPlan['match'] }> = [];
  const addCandidate = (key: string, match: FieldPlan['match']) => {
    if (!candidates.find((c) => c.key === key)) candidates.push({ key, match });
  };

  const acHint = hintFromAutocomplete(field.autocomplete);
  if (acHint) {
    const hints = HINT_TO_PROFILE_HINTS[acHint] ?? [];
    const k = pickKeyByProfileHints(profile, hints);
    if (k) addCandidate(k, 'autocomplete');
  }

  if (field.semanticHint && field.semanticHint !== 'unknown') {
    const hints = HINT_TO_PROFILE_HINTS[field.semanticHint] ?? [];
    const k = pickKeyByProfileHints(profile, hints);
    if (k) addCandidate(k, 'semantic');
  }

  const synKeys = pickKeysByLabelSynonyms(profile, field);
  for (const k of synKeys) addCandidate(k, 'label');

  const fuzzyKeys = pickKeyByLabelFuzzy(profile, field);
  for (const k of fuzzyKeys) addCandidate(k, 'label');

  const intent = inferQuestionIntent(field.semanticContext || field.label);
  if (intent) {
    const k = pickKeyByProfileHints(profile, [intent]);
    if (k) addCandidate(k, 'semantic');
  }

  let lastSkip: FieldSkip | null = null;
  for (const { key, match } of candidates) {
    const value = profile[key];
    const res = valueToInteraction(field, key, value, match);
    if (res.ok) return res;
    lastSkip = res;
  }

  if (llmProvider) {
    const candidateKeys = Object.keys(profile);
    const llmRes = await llmProvider.matchProfileKey({
      semanticContext: field.semanticContext || field.label,
      controlType: field.controlType,
      questionIntent: intent || undefined,
      candidateKeys,
    });
    
    if (llmRes.profileKey && llmRes.confidence >= 0.8 && candidateKeys.includes(llmRes.profileKey)) {
      const value = profile[llmRes.profileKey];
      const res = valueToInteraction(field, llmRes.profileKey, value, 'semantic');
      if (res.ok) return res;
      lastSkip = res;
    }
  }

  let visualCtx: FieldVisualContext | undefined;
  let visualCtxAttempted = false;
  const ensureVisualContext = async () => {
    if (!visualCtxAttempted && getVisualContext) {
      visualCtxAttempted = true;
      visualCtx = await getVisualContext();
    }
  };

  if (ocrProvider) {
    await ensureVisualContext();
    if (visualCtx?.screenshot) {
      const ocrRes = await ocrProvider.extractText({
        screenshot: visualCtx.screenshot.dataUrl,
        nearbyText: visualCtx.nearbyText,
      });

      let targetText = ocrRes.text;
      let targetConfidence = ocrRes.confidence;

      if (ocrRes.regions && ocrRes.regions.length > 0 && visualCtx.boundingBox && visualCtx.screenshot.cropOffset) {
        const visualQuestion = associateVisualQuestion(
          ocrRes.regions,
          visualCtx.boundingBox,
          visualCtx.screenshot.cropOffset
        );
        if (visualQuestion) {
          targetText = visualQuestion;
          targetConfidence = 1;
        }
      }

      if (targetText && targetConfidence >= 0.5) {
        let matchedKey: string | null = null;
        let matchKind: FieldPlan['match'] = 'semantic';
        
        const ocrIntent = inferQuestionIntent(targetText);
        if (ocrIntent) {
          matchedKey = pickKeyByProfileHints(profile, [ocrIntent]);
        }
        
        if (!matchedKey) {
          const pseudoField = { ...field, label: targetText, ariaLabel: '', placeholder: '', name: '', id: '' };
          const fuzzyMatched = pickKeyByLabelFuzzy(profile, pseudoField);
          if (fuzzyMatched.length > 0) {
            matchedKey = fuzzyMatched[0];
            matchKind = 'label';
          }
        }

        if (matchedKey) {
          const value = profile[matchedKey];
          const res = valueToInteraction(field, matchedKey, value, matchKind);
          if (res.ok) return res;
          lastSkip = res;
        }
      }
    }
  }

  if (visionProvider) {
    await ensureVisualContext();
    if (visualCtx?.screenshot) {
      const candidateKeys = Object.keys(profile);
      const visionRes = await visionProvider.matchProfileKey({
        screenshot: visualCtx.screenshot.dataUrl,
        nearbyText: visualCtx.nearbyText,
        candidateKeys,
      });
      if (visionRes.profileKey && visionRes.confidence >= 0.8 && candidateKeys.includes(visionRes.profileKey)) {
        const value = profile[visionRes.profileKey];
        const res = valueToInteraction(field, visionRes.profileKey, value, 'semantic');
        if (res.ok) return res;
        lastSkip = res;
      }
    }
  }

  return lastSkip ?? { ok: false, reason: 'no_reliable_label' };
}
\n`;

code += newPlanField + after;

fs.writeFileSync('src/background/agent.ts', code);
