import type { InteractionRequest, SelectOptionRequest } from '../../../shared/interaction';
import type { FormField, FormSubmitControl } from '../../../shared/types';
import type { Adapter, AdapterContext } from '../adapter';
import { isDisabledForInteraction } from '../validity';

function dispatchChange(el: HTMLSelectElement): void {
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

export class SelectAdapter implements Adapter {
  readonly kind = 'select-option' as const;

  canHandle(
    field: FormField | null,
    _submit: FormSubmitControl | null,
    el: HTMLElement,
  ): boolean {
    if (!field) return false;
    return el instanceof HTMLSelectElement;
  }

  apply(ctx: AdapterContext, req: InteractionRequest): { ok: boolean; reason?: string } {
    const { el } = ctx;
    const r = req as SelectOptionRequest;
    if (!(el instanceof HTMLSelectElement)) {
      return { ok: false, reason: 'element is not a select' };
    }
    if (isDisabledForInteraction(el)) {
      return { ok: false, reason: 'select is disabled' };
    }
    const options = Array.from(el.options);

    try {
      el.focus();
    } catch {}

    if (el.multiple && r.values && r.values.length > 0) {
      // Handle multi-select
      const optSelectedDesc = Object.getOwnPropertyDescriptor(HTMLOptionElement.prototype, 'selected');
      const optSelectedSetter = optSelectedDesc?.set;

      for (const opt of options) {
        const shouldSelect = r.values.includes(opt.value);
        if (optSelectedSetter) {
          optSelectedSetter.call(opt, shouldSelect);
        } else {
          opt.selected = shouldSelect;
        }
      }
    } else {
      // Handle single select (or fallback if values not provided)
      let chosen: HTMLOptionElement | null = null;
      if (r.by === 'value') {
        chosen = options.find((o) => o.value === r.value) ?? null;
      } else {
        const wanted = r.value.trim().toLowerCase();
        chosen = options.find((o) => (o.textContent ?? '').trim().toLowerCase() === wanted) ?? null;
      }
      if (!chosen) {
        const where = r.by === 'value' ? `value "${r.value}"` : `text "${r.value}"`;
        return { ok: false, reason: `select has no option with ${where}` };
      }
      if (chosen.disabled) {
        return { ok: false, reason: 'option is disabled' };
      }

      try {
        const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
        const setter = desc?.set;
        if (setter) {
          setter.call(el, chosen.value);
        } else {
          el.value = chosen.value;
        }
      } catch (err) {
        return { ok: false, reason: 'failed to set select value: ' + (err instanceof Error ? err.message : String(err)) };
      }
    }

    dispatchChange(el);
    try {
      el.blur();
    } catch {}
    
    return { ok: true };
  }
}
