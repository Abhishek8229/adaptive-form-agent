import type { InteractionRequest } from '../../../shared/interaction';
import type { FormField, FormSubmitControl } from '../../../shared/types';
import type { Adapter, AdapterContext } from '../adapter';
import { isDisabledForInteraction } from '../validity';

function simulateClick(el: HTMLElement): void {
  el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
  el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
}

export class CheckboxAdapter implements Adapter {
  readonly kind = 'check' as const;

  canHandle(
    field: FormField | null,
    _submit: FormSubmitControl | null,
    el: HTMLElement,
  ): boolean {
    if (!field) return false;
    return el instanceof HTMLInputElement && el.type === 'checkbox';
  }

  apply(ctx: AdapterContext, _req: InteractionRequest): { ok: boolean; reason?: string } {
    const { el } = ctx;
    if (!(el instanceof HTMLInputElement) || el.type !== 'checkbox') {
      return { ok: false, reason: 'element is not a checkbox' };
    }
    if (isDisabledForInteraction(el)) {
      return { ok: false, reason: 'control is disabled' };
    }
    // M4 fix: Use explicit desired state instead of deriving from r.kind
    const want = true;
    if (el.checked === want) {
      return { ok: true };
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

export class UncheckAdapter implements Adapter {
  readonly kind = 'uncheck' as const;

  canHandle(
    field: FormField | null,
    _submit: FormSubmitControl | null,
    el: HTMLElement,
  ): boolean {
    if (!field) return false;
    return el instanceof HTMLInputElement && el.type === 'checkbox';
  }

  apply(ctx: AdapterContext, _req: InteractionRequest): { ok: boolean; reason?: string } {
    const { el } = ctx;
    if (!(el instanceof HTMLInputElement) || el.type !== 'checkbox') {
      return { ok: false, reason: 'element is not a checkbox' };
    }
    if (isDisabledForInteraction(el)) {
      return { ok: false, reason: 'control is disabled' };
    }
    // M4 fix: Use explicit desired state instead of deriving from r.kind
    const want = false;
    if (el.checked === want) {
      return { ok: true };
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
