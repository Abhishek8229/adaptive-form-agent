import type { InteractionRequest, SetDateRequest, SetTimeRequest } from '../../../shared/interaction';
import type { FormField, FormSubmitControl } from '../../../shared/types';
import type { Adapter, AdapterContext } from '../adapter';
import { isDisabledForInteraction, isReadOnlyForInteraction } from '../validity';

const DATE_TYPES = new Set(['date', 'datetime-local', 'month', 'week']);
const TIME_TYPES = new Set(['time']);

function dispatchInputEvents(el: HTMLElement): void {
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function getValueSetter(el: HTMLInputElement): ((v: string) => void) | null {
  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  return desc?.set ? (desc.set as (v: string) => void).bind(el) : null;
}

export class DateTimeAdapter implements Adapter {
  readonly kind = 'set-date' as const;

  canHandle(
    field: FormField | null,
    _submit: FormSubmitControl | null,
    el: HTMLElement,
  ): boolean {
    if (!field) return false;
    if (!(el instanceof HTMLInputElement)) return false;
    return DATE_TYPES.has(el.type);
  }

  apply(ctx: AdapterContext, req: InteractionRequest): { ok: boolean; reason?: string } {
    const { el } = ctx;
    const r = req as SetDateRequest;
    if (!(el instanceof HTMLInputElement)) return { ok: false, reason: 'not a date input' };
    if (!DATE_TYPES.has(el.type)) return { ok: false, reason: 'not a date input' };
    if (isDisabledForInteraction(el)) return { ok: false, reason: 'control is disabled' };
    if (isReadOnlyForInteraction(el)) return { ok: false, reason: 'control is readOnly' };
    const setter = getValueSetter(el);
    if (!setter) return { ok: false, reason: 'no native value setter' };
    const min = el.getAttribute('min');
    const max = el.getAttribute('max');
    if (min && r.value < min) return { ok: false, reason: `value ${r.value} is below min ${min}` };
    if (max && r.value > max) return { ok: false, reason: `value ${r.value} is above max ${max}` };
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

export class TimeAdapter implements Adapter {
  readonly kind = 'set-time' as const;

  canHandle(
    field: FormField | null,
    _submit: FormSubmitControl | null,
    el: HTMLElement,
  ): boolean {
    if (!field) return false;
    if (!(el instanceof HTMLInputElement)) return false;
    return TIME_TYPES.has(el.type);
  }

  apply(ctx: AdapterContext, req: InteractionRequest): { ok: boolean; reason?: string } {
    const { el } = ctx;
    const r = req as SetTimeRequest;
    if (!(el instanceof HTMLInputElement)) return { ok: false, reason: 'not a time input' };
    if (!TIME_TYPES.has(el.type)) return { ok: false, reason: 'not a time input' };
    if (isDisabledForInteraction(el)) return { ok: false, reason: 'control is disabled' };
    if (isReadOnlyForInteraction(el)) return { ok: false, reason: 'control is readOnly' };
    const setter = getValueSetter(el);
    if (!setter) return { ok: false, reason: 'no native value setter' };
    if (!/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(r.value)) {
      return { ok: false, reason: 'time value must be HH:MM or HH:MM:SS' };
    }
    const min = el.getAttribute('min');
    const max = el.getAttribute('max');
    if (min && r.value < min) return { ok: false, reason: `value ${r.value} is below min ${min}` };
    if (max && r.value > max) return { ok: false, reason: `value ${r.value} is above max ${max}` };
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
