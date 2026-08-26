import type { InteractionRequest, SetTextRequest } from '../../../shared/interaction';
import type { FormField, FormSubmitControl } from '../../../shared/types';
import type { Adapter, AdapterContext } from '../adapter';
import { isDisabledForInteraction, isReadOnlyForInteraction } from '../validity';

function dispatchInputEvents(el: HTMLElement): void {
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function getValueSetter(el: HTMLTextAreaElement): ((v: string) => void) | null {
  const desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
  return desc?.set ? (desc.set as (v: string) => void).bind(el) : null;
}

export class TextareaAdapter implements Adapter {
  readonly kind = 'set-textarea' as const;

  canHandle(
    field: FormField | null,
    _submit: FormSubmitControl | null,
    el: HTMLElement,
  ): boolean {
    if (!field) return false;
    return el instanceof HTMLTextAreaElement;
  }

  apply(ctx: AdapterContext, req: InteractionRequest): { ok: boolean; reason?: string } {
    const { el } = ctx;
    const r = req as SetTextRequest;
    if (!(el instanceof HTMLTextAreaElement)) {
      return { ok: false, reason: 'element is not a textarea' };
    }
    if (isDisabledForInteraction(el)) return { ok: false, reason: 'control is disabled' };
    if (isReadOnlyForInteraction(el)) return { ok: false, reason: 'control is readOnly' };
    const setter = getValueSetter(el);
    if (!setter) return { ok: false, reason: 'could not access native value setter' };
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
