import type { FieldTarget, FormField, FormPage, SubmitTarget, FormSubmitControl } from '../../shared/types';
import { liveElements } from '../detector';

function radioNameMatch(input: HTMLInputElement, name: string): boolean {
  return (input.getAttribute('name') ?? '') === name;
}

function scoreById(el: HTMLElement, target: { id: string }): number {
  if (target.id && el.id === target.id) return 100;
  return 0;
}

function scoreByName(el: HTMLElement, target: FieldTarget | SubmitTarget): number {
  if (!target.name) return 0;
  const got = el.getAttribute('name') ?? '';
  return got === target.name ? 70 : 0;
}

function scoreByPosition(el: HTMLElement, target: FieldTarget | SubmitTarget): number {
  const tag = el.tagName.toLowerCase();
  if (tag !== target.tag) return -1;
  const root: ParentNode = target.formId
    ? (document.getElementById(target.formId) ?? document)
    : document;
  const same = Array.from(root.querySelectorAll(tag)).filter((n): n is HTMLElement => {
    if (!(n instanceof HTMLElement)) return false;
    if (tag === 'input') {
      return (n as HTMLInputElement).type === (target as { type: string }).type;
    }
    return true;
  });
  if (same.length === 0) return -1;
  const idx = same.indexOf(el);
  if (idx === -1) return -1;
  if (idx === target.pathIndex) return 20;
  return Math.max(0, 10 - Math.abs(idx - target.pathIndex));
}

function isMatchingType(el: HTMLElement, target: FieldTarget | SubmitTarget): boolean {
  if (el.tagName === 'INPUT') {
    const t = (el as HTMLInputElement).type || 'text';
    return t === target.type;
  }
  return el.tagName.toLowerCase() === target.tag;
}

function verifyFieldStillIntended(
  el: HTMLElement,
  field: FormField,
): { ok: boolean; reason?: string } {
  const target = field.target;
  if (el.tagName.toLowerCase() !== target.tag) {
    return { ok: false, reason: 'tag mismatch after re-resolve' };
  }

  if (field.type === 'radio') {
    if (el.tagName !== 'INPUT') {
      return { ok: false, reason: 'radio resolved to non-input' };
    }
    if (!radioNameMatch(el as HTMLInputElement, target.radioName ?? target.name)) {
      return { ok: false, reason: 'radio name mismatch after re-resolve' };
    }
    if (field.options && field.options.length > 0) {
      if ((el as HTMLInputElement).value !== field.options[0].value) {
        return { ok: false, reason: 'radio value mismatch after re-resolve' };
      }
    }
  } else if (field.type === 'checkbox') {
    if (el.tagName !== 'INPUT' || (el as HTMLInputElement).type !== 'checkbox') {
      return { ok: false, reason: 'checkbox resolved to non-checkbox input' };
    }
    if (target.name && el.getAttribute('name') !== target.name) {
      return { ok: false, reason: 'checkbox name mismatch after re-resolve' };
    }
  } else if (!isMatchingType(el, target)) {
    return { ok: false, reason: `type mismatch after re-resolve (expected ${target.type})` };
  }
  return { ok: true };
}

function verifySubmitStillIntended(
  el: HTMLElement,
  submit: FormSubmitControl,
): { ok: boolean; reason?: string } {
  const target = submit.target;
  if (el.tagName.toLowerCase() !== target.tag) {
    return { ok: false, reason: 'tag mismatch after re-resolve' };
  }
  if (target.id && el.id !== target.id) {
    return { ok: false, reason: 'id mismatch after re-resolve' };
  }
  if (target.type === 'submit' || target.type === 'button' || target.type === 'reset') {
    if (el.tagName === 'BUTTON') {
      const t = (el as HTMLButtonElement).type || 'submit';
      if (t !== target.type) {
        return { ok: false, reason: 'button type mismatch after re-resolve' };
      }
    } else if (el.tagName === 'INPUT') {
      const t = (el as HTMLInputElement).type;
      if (t !== target.type) {
        return { ok: false, reason: 'input button type mismatch after re-resolve' };
      }
    }
  }
  return { ok: true };
}

function bestById(
  el: HTMLElement,
  target: { id: string },
): number {
  return scoreById(el, target);
}

/**
 * C4 fix: Improved ranking with tie-breaking and minimum thresholds.
 * - When scores are tied, prefer the candidate closest to target.pathIndex
 * - When only name matches (no id), apply position-based tie-breaking for duplicates
 * - If target has an id but element's id changed, fall back to name/position instead of -1
 */
function rankFieldCandidate(el: HTMLElement, field: FormField): { score: number; reason: string } {
  const t = field.target;
  if (el.tagName.toLowerCase() !== t.tag) return { score: -1, reason: 'no' };
  if (!isMatchingType(el, t)) return { score: -1, reason: 'no' };
  const idScore = bestById(el, t);
  if (idScore === 100) return { score: 100, reason: 'id' };
  // C4 fix: If target has an id but element doesn't match, fall through to
  // name/position instead of returning -1 immediately. This handles dynamic ID changes.
  if (t.type === 'radio') {
    const posScore = scoreByPosition(el, t);
    if (posScore > 0) return { score: posScore, reason: 'position' };
    return { score: -1, reason: 'no' };
  }
  const nameScore = scoreByName(el, t);
  if (nameScore > 0) return { score: nameScore, reason: 'name' };
  const posScore = scoreByPosition(el, t);
  if (posScore > 0) return { score: posScore, reason: 'position' };
  return { score: -1, reason: 'no' };
}

function rankSubmitCandidate(el: HTMLElement, sub: FormSubmitControl): { score: number; reason: string } {
  const t = sub.target;
  if (el.tagName.toLowerCase() !== t.tag) return { score: -1, reason: 'no' };
  const idScore = bestById(el, t);
  if (idScore === 100) return { score: 100, reason: 'id' };

  const nameScore = scoreByName(el, t);
  if (nameScore > 0) return { score: nameScore, reason: 'name' };
  const posScore = scoreByPosition(el, t);
  if (posScore > 0) return { score: posScore, reason: 'position' };
  return { score: -1, reason: 'no' };
}

export function findFieldByStableId(page: FormPage, stableId: string): FormField | null {
  for (const g of page.forms) {
    for (const f of g.fields) {
      if (f.stableId === stableId) return f;
    }
  }
  return null;
}

export function findSubmitByStableId(page: FormPage, stableId: string): FormSubmitControl | null {
  for (const g of page.forms) {
    for (const s of g.submitControls) {
      if (s.stableId === stableId) return s;
    }
  }
  return null;
}

function getAllFormElements(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll('input, textarea, select, button'),
  ).filter((n): n is HTMLElement => n instanceof HTMLElement);
}

/**
 * I7/C4 fix: Try the selector as a fast-path before scanning all candidates.
 * Returns the element if the selector matches and verification passes.
 */
function trySelectorFastPath(
  selector: string,
  field: FormField,
): HTMLElement | null {
  if (!selector || selector === field.target.tag) return null;
  try {
    const els = document.querySelectorAll(selector);
    if (els.length === 0) return null;
    if (els.length > 1 && !selector.includes('#')) return null;
    const el = els[0];
    if (!(el instanceof HTMLElement)) return null;
    if (!isMatchingType(el, field.target)) return null;
    const verify = verifyFieldStillIntended(el, field);
    if (!verify.ok) return null;
    return el;
  } catch {
    return null;
  }
}

export function resolveField(field: FormField): { ok: true; el: HTMLElement; matchedBy: string } | { ok: false; reason: string } {
  // I1 fix: Exact-reference fast path for live elements
  const exactEl = liveElements.get(field.stableId)?.deref();
  if (exactEl && exactEl.isConnected) {
    const verify = verifyFieldStillIntended(exactEl, field);
    if (verify.ok) {
      return { ok: true, el: exactEl, matchedBy: 'exact-reference' };
    }
  }

  // I7/C4 fix: Try selector as fast-path
  const fastEl = trySelectorFastPath(field.target.selector, field);
  if (fastEl) {
    return { ok: true, el: fastEl, matchedBy: 'selector' };
  }

  const candidates = getAllFormElements();
  let bestEl: HTMLElement | null = null;
  let bestScore = -1;
  let bestReason = 'none';
  // C4 fix: Track position distance for tie-breaking
  let bestPositionDistance = Infinity;

  for (const el of candidates) {
    const { score, reason } = rankFieldCandidate(el, field);
    if (score > bestScore) {
      bestScore = score;
      bestEl = el;
      bestReason = reason;
      bestPositionDistance = computePositionDistance(el, field.target);
    } else if (score === bestScore && score > 0) {
      // C4 fix: Tie-breaking — prefer the candidate closest to target.pathIndex
      const dist = computePositionDistance(el, field.target);
      if (dist < bestPositionDistance) {
        bestEl = el;
        bestReason = reason;
        bestPositionDistance = dist;
      }
    }
  }

  // C4 fix: When only position-based matches exist (score <= 20), require exact position
  if (bestEl && bestScore > 0 && bestScore <= 20 && bestReason === 'position') {
    const posScore = scoreByPosition(bestEl, field.target);
    if (posScore < 20) {
      return { ok: false, reason: 'position-only match is not exact; refusing to resolve ambiguously' };
    }
  }

  if (!bestEl || bestScore <= 0) {
    return { ok: false, reason: 'no candidate matched field metadata' };
  }
  const verify = verifyFieldStillIntended(bestEl, field);
  if (!verify.ok) {
    return { ok: false, reason: verify.reason ?? 'verification failed' };
  }
  return { ok: true, el: bestEl, matchedBy: bestReason };
}

/**
 * C4 fix: Compute position distance of an element from the target's expected position.
 */
function computePositionDistance(el: HTMLElement, target: FieldTarget | SubmitTarget): number {
  const tag = el.tagName.toLowerCase();
  if (tag !== target.tag) return Infinity;
  const root: ParentNode = target.formId
    ? (document.getElementById(target.formId) ?? document)
    : document;
  const same = Array.from(root.querySelectorAll(tag)).filter((n): n is HTMLElement => {
    if (!(n instanceof HTMLElement)) return false;
    if (tag === 'input') {
      return (n as HTMLInputElement).type === (target as { type: string }).type;
    }
    return true;
  });
  const idx = same.indexOf(el);
  if (idx === -1) return Infinity;
  return Math.abs(idx - target.pathIndex);
}

export function resolveSubmit(submit: FormSubmitControl): { ok: true; el: HTMLElement; matchedBy: string } | { ok: false; reason: string } {
  // I1 fix: Exact-reference fast path for live elements
  const exactEl = liveElements.get(submit.stableId)?.deref();
  if (exactEl && exactEl.isConnected) {
    const verify = verifySubmitStillIntended(exactEl, submit);
    if (verify.ok) {
      return { ok: true, el: exactEl, matchedBy: 'exact-reference' };
    }
  }

  const candidates = getAllFormElements();
  let bestEl: HTMLElement | null = null;
  let bestScore = -1;
  let bestReason = 'none';
  for (const el of candidates) {
    const { score, reason } = rankSubmitCandidate(el, submit);
    if (score > bestScore) {
      bestScore = score;
      bestEl = el;
      bestReason = reason;
    }
  }
  if (!bestEl || bestScore <= 0) {
    return { ok: false, reason: 'no candidate matched submit metadata' };
  }
  const verify = verifySubmitStillIntended(bestEl, submit);
  if (!verify.ok) {
    return { ok: false, reason: verify.reason ?? 'verification failed' };
  }
  return { ok: true, el: bestEl, matchedBy: bestReason };
}
