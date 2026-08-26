import type { InteractionRequest, SetTextRequest } from '../../../shared/interaction';
import type { FormField, FormSubmitControl } from '../../../shared/types';
import type { Adapter, AdapterContext } from '../adapter';
import { isDisabledForInteraction, isReadOnlyForInteraction } from '../validity';

function getTextLikeValueSetter(el: HTMLElement): ((value: string) => void) | null {
  if (el instanceof HTMLInputElement) {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value') ?? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    return desc?.set ? (desc.set as (v: string) => void).bind(el) : null;
  }
  if (el instanceof HTMLTextAreaElement) {
    const desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    return desc?.set ? (desc.set as (v: string) => void).bind(el) : null;
  }
  return null;
}

function dispatchInputEvents(el: HTMLElement): void {
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

export class TextLikeAdapter implements Adapter {
  readonly kind = 'set-text' as const;

  canHandle(
    field: FormField | null,
    _submit: FormSubmitControl | null,
    el: HTMLElement,
  ): boolean {
    if (!field) return false;
    if (el instanceof HTMLTextAreaElement) return false;
    if (!(el instanceof HTMLInputElement)) return false;
    const t = el.type;
    if (
      t === 'text' || t === 'email' || t === 'url' || t === 'search' ||
      t === 'tel' || t === 'number' || t === 'password' || t === ''
    ) {
      return true;
    }
    return false;
  }

  apply(ctx: AdapterContext, req: InteractionRequest): { ok: boolean; reason?: string } {
    const { el } = ctx;
    const r = req as SetTextRequest;
    if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) {
      return { ok: false, reason: 'element is not a text input or textarea' };
    }
    if (isDisabledForInteraction(el)) {
      return { ok: false, reason: 'control is disabled' };
    }
    if (isReadOnlyForInteraction(el)) {
      return { ok: false, reason: 'control is readOnly' };
    }
    const setter = getTextLikeValueSetter(el);
    if (typeof setter !== 'function') {
      return { ok: false, reason: 'could not access native value setter' };
    }
    try {
      el.focus();
    } catch {
    }
    try {
      setter(r.value);
    } catch (err) {
      return { ok: false, reason: 'value setter threw: ' + (err instanceof Error ? err.message : String(err)) };
    }
    dispatchInputEvents(el);
    // M1 fix: dispatch blur after interaction
    try {
      el.blur();
    } catch {
    }
    return { ok: true };
  }
}
