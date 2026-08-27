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
    return (el instanceof HTMLInputElement && el.type === 'checkbox') || el.getAttribute('role') === 'checkbox';
  }

  apply(ctx: AdapterContext, _req: InteractionRequest): { ok: boolean; reason?: string } {
    const { el } = ctx;
    if (!((el instanceof HTMLInputElement && el.type === 'checkbox') || el.getAttribute('role') === 'checkbox')) {
      return { ok: false, reason: 'element is not a checkbox' };
    }
    if (isDisabledForInteraction(el)) {
      return { ok: false, reason: 'control is disabled' };
    }
    const want = true;
    const isChecked = el instanceof HTMLInputElement ? el.checked : el.getAttribute('aria-checked') === 'true';
    if (isChecked === want) {
      return { ok: true };
    }
    try { el.focus(); } catch {}
    try {
      simulateClick(el);
    } catch (err) {
      return { ok: false, reason: 'click dispatch failed: ' + (err instanceof Error ? err.message : String(err)) };
    }
    try { el.blur(); } catch {}
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
    return (el instanceof HTMLInputElement && el.type === 'checkbox') || el.getAttribute('role') === 'checkbox';
  }

  apply(ctx: AdapterContext, _req: InteractionRequest): { ok: boolean; reason?: string } {
    const { el } = ctx;
    if (!((el instanceof HTMLInputElement && el.type === 'checkbox') || el.getAttribute('role') === 'checkbox')) {
      return { ok: false, reason: 'element is not a checkbox' };
    }
    if (isDisabledForInteraction(el)) {
      return { ok: false, reason: 'control is disabled' };
    }
    const want = false;
    const isChecked = el instanceof HTMLInputElement ? el.checked : el.getAttribute('aria-checked') === 'true';
    if (isChecked === want) {
      return { ok: true };
    }
    try { el.focus(); } catch {}
    try {
      simulateClick(el);
    } catch (err) {
      return { ok: false, reason: 'click dispatch failed: ' + (err instanceof Error ? err.message : String(err)) };
    }
    try { el.blur(); } catch {}
    return { ok: true };
  }
}
