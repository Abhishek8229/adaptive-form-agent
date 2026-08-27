import type { InteractionRequest, SetTextRequest } from '../../../shared/interaction';
import type { FormField, FormSubmitControl } from '../../../shared/types';
import type { Adapter, AdapterContext } from '../adapter';
import { isDisabledForInteraction, isReadOnlyForInteraction } from '../validity';

function dispatchInputEvents(el: HTMLElement): void {
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

export class RangeAdapter implements Adapter {
  readonly kind = 'set-text' as const;

  canHandle(
    field: FormField | null,
    _submit: FormSubmitControl | null,
    el: HTMLElement,
  ): boolean {
    if (!field) return false;
    return el instanceof HTMLInputElement && el.type === 'range';
  }

  apply(ctx: AdapterContext, req: InteractionRequest): { ok: boolean; reason?: string } {
    const { el } = ctx;
    const r = req as SetTextRequest;
    if (!(el instanceof HTMLInputElement) || el.type !== 'range') return { ok: false, reason: 'not a range input' };
    if (isDisabledForInteraction(el)) return { ok: false, reason: 'control is disabled' };
    if (isReadOnlyForInteraction(el)) return { ok: false, reason: 'control is readOnly' };

    const val = parseFloat(r.value);
    if (isNaN(val)) {
      return { ok: false, reason: 'validity: badInput' };
    }

    const minStr = el.getAttribute('min');
    const maxStr = el.getAttribute('max');
    const stepStr = el.getAttribute('step');

    let minVal = 0; // default for range is 0 according to spec
    if (minStr !== null) {
      const min = parseFloat(minStr);
      if (!isNaN(min)) {
        minVal = min;
        if (val < minVal) return { ok: false, reason: 'validity: rangeUnderflow' };
      }
    }
    
    let maxVal = 100; // default for range is 100
    if (maxStr !== null) {
      const max = parseFloat(maxStr);
      if (!isNaN(max)) {
        maxVal = max;
        if (val > maxVal) return { ok: false, reason: 'validity: rangeOverflow' };
      }
    }

    // Check step mismatch
    let stepVal = 1; // default step is 1
    if (stepStr !== null) {
      if (stepStr.toLowerCase() === 'any') {
        stepVal = 0; // 0 means 'any'
      } else {
        const parsedStep = parseFloat(stepStr);
        if (!isNaN(parsedStep) && parsedStep > 0) {
          stepVal = parsedStep;
        }
      }
    }
    
    if (stepVal > 0) {
      const diff = Math.abs(val - minVal);
      const remainder = diff % stepVal;
      const epsilon = 1e-9;
      if (remainder > epsilon && Math.abs(remainder - stepVal) > epsilon) {
         return { ok: false, reason: 'validity: stepMismatch' };
      }
    }

    const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    const setter = desc?.set ? (desc.set as (v: string) => void).bind(el) : null;
    if (!setter) return { ok: false, reason: 'no native value setter' };

    try { el.focus(); } catch {}
    setter(r.value);
    dispatchInputEvents(el);
    try { el.blur(); } catch {}
    return { ok: true };
  }
}
