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
    return (el instanceof HTMLInputElement && el.type === 'radio') || el.getAttribute('role') === 'radio';
  }

  apply(ctx: AdapterContext, req: InteractionRequest): { ok: boolean; reason?: string; interactedEl?: HTMLElement } {
    const { el } = ctx;
    const r = req as RadioRequest;
    if (!((el instanceof HTMLInputElement && el.type === 'radio') || el.getAttribute('role') === 'radio')) {
      return { ok: false, reason: 'element is not a radio' };
    }
    if (isDisabledForInteraction(el)) {
      return { ok: false, reason: 'radio is disabled' };
    }
    
    const isCustom = el.getAttribute('role') === 'radio';
    if (isCustom) {
      const name = el.getAttribute('name');
      const radiogroup = el.closest('[role="radiogroup"]');
      const ariaLabelledby = el.getAttribute('aria-labelledby');
      const root = 'form' in el ? (el as any).form ?? document : document;
      const allRadios = Array.from(root.querySelectorAll('[role="radio"]')) as HTMLElement[];
      const siblings = allRadios.filter(c => {
         if (name && c.getAttribute('name') === name) return true;
         if (radiogroup && c.closest('[role="radiogroup"]') === radiogroup) return true;
         if (ariaLabelledby && c.getAttribute('aria-labelledby') === ariaLabelledby) return true;
         if (!name && !radiogroup && !ariaLabelledby) return c === el;
         return false;
      });
      const target = siblings.find(g => (g.getAttribute('value') ?? '') === r.value);
      if (!target) return { ok: false, reason: `radio option "${r.value}" not found` };
      if (isDisabledForInteraction(target)) return { ok: false, reason: `radio option "${r.value}" is disabled` };
      
      const isChecked = target.getAttribute('aria-checked') === 'true';
      if (isChecked && target === el) return { ok: true };
      
      try { target.focus(); } catch {}
      if (!isChecked) {
        try { simulateClick(target); } catch (err) {
          return { ok: false, reason: 'click dispatch failed: ' + (err instanceof Error ? err.message : String(err)) };
        }
      }
      try { target.blur(); } catch {}
      return { ok: true, interactedEl: target };
    }

    const groupName = el.getAttribute('name') ?? '';
    if (!groupName) {
      return { ok: false, reason: 'radio has no group name' };
    }
    
    const form = (el as HTMLInputElement).form;
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
    if (target.checked) {
    } else {
      dispatchChange(target);
    }
    try {
      target.blur();
    } catch {
    }
    return { ok: true, interactedEl: target };
  }
}
