import type { InteractionRequest, RadioRequest } from '../../../shared/interaction';
import type { FormField, FormSubmitControl } from '../../../shared/types';
import type { Adapter, AdapterContext } from '../adapter';
import { isDisabledForInteraction } from '../validity';

function dispatchChange(el: HTMLInputElement): void {
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function simulateClick(el: HTMLElement): void {
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/([!"#$%&'()*+,./:;<=>?@[\]^`{|}~])/g, '\\$1');
}

export class RadioAdapter implements Adapter {
  readonly kind = 'select-radio' as const;

  canHandle(
    field: FormField | null,
    _submit: FormSubmitControl | null,
    el: HTMLElement,
  ): boolean {
    if (!field) return false;
    return el instanceof HTMLInputElement && el.type === 'radio';
  }

  apply(ctx: AdapterContext, req: InteractionRequest): { ok: boolean; reason?: string; interactedEl?: HTMLElement } {
    const { el } = ctx;
    const r = req as RadioRequest;
    if (!(el instanceof HTMLInputElement) || el.type !== 'radio') {
      return { ok: false, reason: 'element is not a radio' };
    }
    if (isDisabledForInteraction(el)) {
      return { ok: false, reason: 'radio is disabled' };
    }
    const groupName = el.getAttribute('name') ?? '';
    if (!groupName) {
      return { ok: false, reason: 'radio has no group name' };
    }
    // C2 fix: Scope radio groups to the owning form (per HTML spec).
    // If the radio has no form owner, fall back to document scope.
    // M5 fix: Use CSS.escape() to prevent selector injection.
    const form = el.form;
    const root: ParentNode = form ?? document;
    const group = Array.from(
      root.querySelectorAll(`input[type="radio"][name="${cssEscape(groupName)}"]`),
    ).filter((n): n is HTMLInputElement => n instanceof HTMLInputElement);
    const target = group.find((g) => (g.value ?? '') === r.value);
    if (!target) {
      return { ok: false, reason: `radio option "${r.value}" not found in group "${groupName}"` };
    }
    if (isDisabledForInteraction(target)) {
      return { ok: false, reason: `radio option "${r.value}" is disabled` };
    }
    if (target.checked && target === el) {
      return { ok: true };
    }

    try {
      target.focus();
    } catch {
    }
    if (!target.checked) {
      try {
        simulateClick(target);
      } catch (err) {
        return { ok: false, reason: 'click dispatch failed: ' + (err instanceof Error ? err.message : String(err)) };
      }
    }
    // M2 fix: Only dispatch change events if simulateClick did not fire a native click
    // (i.e., the radio was already checked). If we just clicked it, the native click
    // already fired input/change, so we skip the duplicate dispatch.
    if (target.checked) {
      // Already was checked before click, or click didn't actually change state.
      // Dispatch manually to ensure events fire.
    } else {
      // Click was dispatched above but checked didn't flip (shouldn't happen).
      dispatchChange(target);
    }
    try {
      target.blur();
    } catch {
    }
    return { ok: true, interactedEl: target };
  }
}
