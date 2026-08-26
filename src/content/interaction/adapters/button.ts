import type { InteractionRequest } from '../../../shared/interaction';
import type { FormField, FormSubmitControl } from '../../../shared/types';
import type { Adapter, AdapterContext } from '../adapter';
import { isDisabledForInteraction } from '../validity';

function simulateClick(el: HTMLElement): void {
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
}

export class ButtonAdapter implements Adapter {
  readonly kind = 'click-button' as const;

  canHandle(
    _field: FormField | null,
    submit: FormSubmitControl | null,
    el: HTMLElement,
  ): boolean {
    if (!submit) return false;
    if (!(el instanceof HTMLButtonElement)) return false;
    const t = (el.type || 'submit').toLowerCase();
    if (t === 'submit' || t === 'reset') return false;
    return true;
  }

  apply(ctx: AdapterContext, _req: InteractionRequest): { ok: boolean; reason?: string } {
    const { el } = ctx;
    if (!(el instanceof HTMLButtonElement)) {
      return { ok: false, reason: 'element is not a button' };
    }
    const t = (el.type || 'submit').toLowerCase();
    if (t === 'submit' || t === 'reset') {
      return { ok: false, reason: 'submit/reset buttons are not interactable in this phase' };
    }
    if (isDisabledForInteraction(el)) {
      return { ok: false, reason: 'button is disabled' };
    }
    try {
      el.focus();
    } catch {
    }
    try {
      simulateClick(el);
    } catch (err) {
      return { ok: false, reason: 'click dispatch failed: ' + (err instanceof Error ? err.message : String(err)) };
    }
    // M1 fix: dispatch blur after interaction
    try {
      el.blur();
    } catch {
    }
    return { ok: true };
  }
}
