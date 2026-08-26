import type {
  InteractionKind,
  InteractionRequest,
  InteractionResult,
  InteractionObservedState,
} from '../../shared/interaction';
import type { FormField, FormPage, FormSubmitControl } from '../../shared/types';
import { resolveField, resolveSubmit, findFieldByStableId, findSubmitByStableId } from './resolver';
import { observe } from './validity';
import { isInteractionAllowed } from './safety';
import { CheckboxAdapter, UncheckAdapter } from './adapters/checkbox';
import { RadioAdapter } from './adapters/radio';
import { SelectAdapter } from './adapters/select';
import { DateTimeAdapter, TimeAdapter } from './adapters/datetime';
import { TextLikeAdapter } from './adapters/text';
import { TextareaAdapter } from './adapters/textarea';
import { ButtonAdapter } from './adapters/button';
import type { Adapter } from './adapter';

const ADAPTERS: Adapter[] = [
  new TextLikeAdapter(),
  new TextareaAdapter(),
  new CheckboxAdapter(),
  new UncheckAdapter(),
  new RadioAdapter(),
  new SelectAdapter(),
  new DateTimeAdapter(),
  new TimeAdapter(),
  new ButtonAdapter(),
];

const ADAPTERS_BY_KIND: Map<InteractionKind, Adapter[]> = new Map();
for (const a of ADAPTERS) {
  const list = ADAPTERS_BY_KIND.get(a.kind) ?? [];
  list.push(a);
  ADAPTERS_BY_KIND.set(a.kind, list);
}

function pickAdapter(
  kind: InteractionKind,
  field: FormField | null,
  submit: FormSubmitControl | null,
  el: HTMLElement,
): Adapter | null {
  const list = ADAPTERS_BY_KIND.get(kind) ?? [];
  for (const a of list) {
    if (a.canHandle(field, submit, el)) return a;
  }
  return null;
}

// C1 fix: Module-scoped snapshot instead of window.__AFA_LAST_PAGE.
// The content script calls setPageSnapshot() after each scan.
let _pageSnapshot: FormPage | null = null;

/** Called by content-script after each scan to update the module-scoped snapshot. */
export function setPageSnapshot(page: FormPage | null): void {
  _pageSnapshot = page;
}

function getPageSnapshot(): FormPage | null {
  return _pageSnapshot;
}

function buildObserved(el: HTMLElement): InteractionObservedState {
  return observe(el);
}

function isIdempotent(kind: InteractionKind): boolean {
  switch (kind) {
    // I6 fix: set-text and set-textarea are safe to retry (idempotent).
    case 'set-text':
    case 'set-textarea':
    case 'set-date':
    case 'set-time':
    case 'check':
    case 'uncheck':
    case 'select-radio':
    case 'select-option':
    case 'click-button':
      return true;
    default:
      return false;
  }
}

/**
 * Strip formatting characters for comparison (I5 fix).
 * This allows auto-formatted values like "(123) 456-7890" to match "1234567890".
 */
function stripFormatting(s: string): string {
  return s.replace(/[\s()\-./]/g, '');
}

function expectedMatch(kind: InteractionKind, req: InteractionRequest, observed: InteractionObservedState): { ok: boolean; reason?: string } {
  switch (kind) {
    case 'set-text':
    case 'set-textarea': {
      const r = req as Extract<InteractionRequest, { value: string }>;
      if (observed.value !== r.value) {
        // I5 fix: Fall back to normalized comparison for auto-formatted fields
        if (stripFormatting(observed.value ?? '') === stripFormatting(r.value)) {
          return { ok: true };
        }
        return { ok: false, reason: `value mismatch: expected "${r.value}" got "${observed.value ?? ''}"` };
      }
      return { ok: true };
    }
    case 'check': {
      if (observed.checked !== true) return { ok: false, reason: 'checkbox not checked' };
      return { ok: true };
    }
    case 'uncheck': {
      if (observed.checked !== false) return { ok: false, reason: 'checkbox still checked' };
      return { ok: true };
    }
    case 'select-radio': {
      if (observed.checked !== true) return { ok: false, reason: 'radio is not selected' };
      return { ok: true };
    }
    case 'select-option': {
      const r = req as Extract<InteractionRequest, { by: 'value' | 'text'; value: string }>;
      if (!observed.selectedOption) return { ok: false, reason: 'no selected option observed' };
      if (r.by === 'value') {
        if (observed.selectedOption.value !== r.value) {
          return { ok: false, reason: `selected option value "${observed.selectedOption.value}" != requested "${r.value}"` };
        }
      } else {
        if (observed.selectedOption.text.toLowerCase() !== r.value.trim().toLowerCase()) {
          return { ok: false, reason: `selected option text "${observed.selectedOption.text}" != requested "${r.value}"` };
        }
      }
      return { ok: true };
    }
    case 'set-date':
    case 'set-time': {
      const r = req as Extract<InteractionRequest, { value: string }>;
      if (observed.value !== r.value) {
        return { ok: false, reason: `value mismatch: expected "${r.value}" got "${observed.value ?? ''}"` };
      }
      return { ok: true };
    }
    case 'click-button': {
      return { ok: true };
    }
    default:
      return { ok: false, reason: 'unsupported kind' };
  }
}

function safetyContextFromField(field: FormField) {
  return {
    tag: field.tag,
    type: field.type,
    name: field.name,
    id: field.id,
    label: field.label,
    ariaLabel: field.ariaLabel,
    placeholder: field.placeholder,
    autocomplete: field.autocomplete,
  };
}

function safetyContextFromSubmit(submit: FormSubmitControl) {
  return {
    tag: submit.tag,
    type: submit.type,
    name: '',
    id: '',
    label: submit.text,
    ariaLabel: submit.ariaLabel,
    placeholder: '',
    autocomplete: '',
  };
}

function attemptedFor(req: InteractionRequest): string | undefined {
  if ('value' in req) {
    return (req as { value: string }).value;
  }
  return undefined;
}

// I2 fix: Interaction queue for genuine concurrency control.
// All interactions are serialized via a promise chain so that even
// when callers invoke runInteraction concurrently (e.g. Promise.all),
// each executeInteraction call completes before the next begins.
let _queueTail: Promise<void> = Promise.resolve();

/**
 * Public entry point for running interactions.
 * Returns a Promise to support async callers (e.g. the AI layer).
 * Interactions are serialized: concurrent calls queue behind previous ones.
 */
export function runInteraction(req: InteractionRequest): Promise<InteractionResult> {
  const task = _queueTail.then(() => executeInteraction(req));
  // Swallow errors to keep the chain alive for subsequent interactions
  _queueTail = task.then(() => {}, () => {});
  return task;
}

function executeInteraction(req: InteractionRequest): InteractionResult {
  const baseResult: InteractionResult = {
    success: false,
    stableId: req.stableId,
    kind: req.kind,
    attemptedValue: attemptedFor(req),
    retried: false,
  };

  const page = getPageSnapshot();
  if (!page) {
    return { ...baseResult, reason: 'no page snapshot available' };
  }

  const isSubmitKind = req.kind === 'click-button';
  const field = isSubmitKind ? null : findFieldByStableId(page, req.stableId);
  const submit = isSubmitKind ? findSubmitByStableId(page, req.stableId) : null;
  if (!isSubmitKind && !field) {
    return { ...baseResult, reason: 'field not found by stableId' };
  }
  if (isSubmitKind && !submit) {
    return { ...baseResult, reason: 'submit control not found by stableId' };
  }

  const safetyCtx = field ? safetyContextFromField(field) : safetyContextFromSubmit(submit!);
  const verdict = isInteractionAllowed(safetyCtx, req.kind);
  if (!verdict.allowed) {
    return { ...baseResult, reason: verdict.reason ?? 'blocked by safety policy' };
  }

  let resolvedEl: HTMLElement | null = null;
  let resolveErr: string | null = null;

  const firstResolve = field
    ? resolveField(field)
    : resolveSubmit(submit!);
  if (firstResolve.ok) {
    resolvedEl = firstResolve.el;
  } else {
    resolveErr = firstResolve.reason;
  }

  if (!resolvedEl) {
    return { ...baseResult, reason: resolveErr ?? 'could not resolve element' };
  }

  const adapter = pickAdapter(req.kind, field, submit, resolvedEl);
  if (!adapter) {
    return { ...baseResult, reason: `no adapter for kind "${req.kind}" on resolved element` };
  }

  let applyRes = adapter.apply({ field, submit, el: resolvedEl }, req);
  let observed = buildObserved(applyRes.interactedEl ?? resolvedEl);
  let verifyRes = expectedMatch(req.kind, req, observed);
  let retried = false;

  // I6 fix: All kinds are now retryable
  if ((!applyRes.ok || !verifyRes.ok) && isIdempotent(req.kind)) {
    const secondResolve = field
      ? resolveField(field)
      : resolveSubmit(submit!);
    if (secondResolve.ok && secondResolve.el !== resolvedEl) {
      resolvedEl = secondResolve.el;
    }
    const secondAdapter = pickAdapter(req.kind, field, submit, resolvedEl);
    if (secondAdapter) {
      applyRes = secondAdapter.apply({ field, submit, el: resolvedEl }, req);
      observed = buildObserved(applyRes.interactedEl ?? resolvedEl);
      verifyRes = expectedMatch(req.kind, req, observed);
      retried = true;
    }
  }

  if (!applyRes.ok) {
    return { ...baseResult, retried, reason: applyRes.reason ?? 'adapter failed' };
  }
  if (!verifyRes.ok) {
    return { ...baseResult, retried, observed, reason: verifyRes.reason ?? 'verification failed' };
  }
  return { ...baseResult, success: true, retried, observed };
}
