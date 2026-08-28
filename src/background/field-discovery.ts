/**
 * Pure utility: given the current FormPage and the profile, decide whether a
 * deterministic "advance" action exists that would reveal new fillable
 * fields. The decision is profile-driven and never destructive.
 *
 * Returned actions are restricted to:
 *   - "click-button" with a stableId of a non-submit button whose visible
 *     text matches a known advance pattern.
 *
 * Patterns recognised (case-insensitive, anchored on the whole word):
 *   - "Add <something>" / "Add another <something>" / "Add more <something>"
 *       used to expand a section when the profile has more records than
 *       the page currently shows.
 *   - "Continue" / "Next" / "Next step" / "Step 2 of N"
 *       used for multi-step forms.
 *
 * Explicitly NEVER picked:
 *   - submit/reset buttons
 *   - "Submit application" / "Send" / "Save and finish" (the final step)
 *   - file-upload triggers ("Upload", "Choose file", "Attach") - we cannot
 *     fill file inputs and clicking them would open a native dialog
 *   - "Remove" / "Delete" (destructive)
 *   - anything already clicked in this run (deduped by stableId by caller)
 */

import type { FormPage, FormSubmitControl } from '../shared/types';
import type { JsonProfile } from '../shared/profile';

export type AdvanceAction =
  | { kind: 'click-button'; stableId: string; reason: string }
  | null;

const ADD_RE = /^(add another|add more|add)(?:\s+([a-z][a-z0-9 _/-]{1,40}))?$/i;
// Capture groups:
//   1: optional subject (e.g. "education", "phone number", "language")
//   2: optional trailing whitespace
const ADD_GENERIC_RE = /^\s*add\b.*$/i;

const PAGINATION_RE = /^\s*(continue|next|next step|proceed)\s*$/i;
// Common multi-step indicators shown in the form chrome.
const MULTI_STEP_INDICATOR_RE = /step\s+\d+\s+of\s+\d+|^page\s+\d+\s+of\s+\d+$/i;

const PAGINATION_NEGATIVE_RE = /\b(save and (continue|next)|save & (continue|next))\b/i;

function isSafeNonSubmit(btn: FormSubmitControl): boolean {
  if (!btn || !btn.text) return false;
  // submit / image / reset are already filtered at the engine level for
  // click-button, but we double-check here.
  if (btn.type === 'submit' || btn.type === 'reset' || btn.type === 'image') return false;
  return true;
}

export function discoverNextAction(
  page: FormPage,
  profile: JsonProfile,
  clickedStableIds: Set<string>,
): AdvanceAction {
  if (!page) return null;

  // Gather every non-submit button across the page.
  const buttons: FormSubmitControl[] = [];
  for (const group of page.forms) {
    for (const s of group.submitControls) {
      if (isSafeNonSubmit(s)) buttons.push(s);
    }
  }
  if (buttons.length === 0) return null;

  // -----------------------------------------------------------------
  // 1) Pagination: when the form has explicit multi-step chrome and at
  //    least one visible input is still empty (i.e. there is more on the
  //    next step), find a Next/Continue button.
  // -----------------------------------------------------------------
  const hasUnfilledFields = page.forms.some((g) =>
    g.fields.some((f) => !f.disabled && !f.readOnly && !f.valuePresent),
  );
  const hasMultiStepChrome = page.forms.some((g) =>
    MULTI_STEP_INDICATOR_RE.test(g.metadata?.labelText ?? ''),
  );

  if (hasUnfilledFields && hasMultiStepChrome) {
    for (const b of buttons) {
      if (clickedStableIds.has(b.stableId)) continue;
      if (PAGINATION_NEGATIVE_RE.test(b.text)) continue;
      if (PAGINATION_RE.test(b.text)) {
        return { kind: 'click-button', stableId: b.stableId, reason: 'advancing to next step' };
      }
    }
  }

  // -----------------------------------------------------------------
  // 2) Add-row / expand-section: when the profile has more records for
  //    a base key than the page currently shows, find an "Add X" button
  //    whose subject matches the base key (or one of its synonyms).
  // -----------------------------------------------------------------
  const pageCounts = new Map<string, number>();
  for (const g of page.forms) {
    for (const f of g.fields) {
      if (!f.repeatingGroup) continue;
      const { baseName, index } = f.repeatingGroup;
      const cur = pageCounts.get(baseName) ?? 0;
      if (index + 1 > cur) pageCounts.set(baseName, index + 1);
    }
  }

  const candidates: Array<{ baseName: string; subject: string; profileLen: number }> = [];
  for (const [key, value] of Object.entries(profile)) {
    if (!Array.isArray(value)) continue;
    const seen = pageCounts.get(key) ?? 0;
    if (value.length > seen) {
      candidates.push({
        baseName: key,
        subject: humanizeKey(key),
        profileLen: value.length,
      });
    }
  }

  if (candidates.length > 0) {
    for (const c of candidates) {
      const wanted = c.subject.toLowerCase();
      for (const b of buttons) {
        if (clickedStableIds.has(b.stableId)) continue;
        const text = b.text.trim();
        if (ADD_RE.test(text)) {
          // Match: if the button has a SUBJECT (the noun after "add"),
          // it must include the humanized profile key.
          const m = text.match(ADD_RE);
          const subject = (m?.[2] ?? '').toLowerCase().trim();
          if (subject && !subject.includes(wanted) && !wanted.includes(subject)) {
            // Different subject - skip this button.
            continue;
          }
          return {
            kind: 'click-button',
            stableId: b.stableId,
            reason: `adding another ${c.baseName} (${c.profileLen} in profile)`,
          };
        }
        if (ADD_GENERIC_RE.test(text)) {
          // Generic "Add" button with no subject (e.g. just "Add" or
          // "Add another" with no noun). Only click it as a fallback
          // when the page has exactly one repeatable group still
          // under-filled, to avoid clicking an "Add language" button
          // when we actually need "Add education".
          if (candidates.length === 1) {
            return {
              kind: 'click-button',
              stableId: b.stableId,
              reason: `adding another ${c.baseName} via generic add (${c.profileLen} in profile)`,
            };
          }
        }
      }
    }
  }

  // -----------------------------------------------------------------
  // 3) Multi-step fallback: if the form is multi-step but the buttons
  //    here do not have a clear "Next" pattern, do nothing rather than
  //    risk clicking a destructive action.
  // -----------------------------------------------------------------
  return null;
}

function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .trim();
}
