import type { InteractionRequest, SelectCustomComboboxRequest } from '../../../shared/interaction';
import type { FormField, FormSubmitControl } from '../../../shared/types';
import type { Adapter, AdapterContext } from '../adapter';

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class CustomComboboxAdapter implements Adapter {
  readonly kind = 'select-custom-combobox' as const;

  canHandle(
    _field: FormField | null,
    _submit: FormSubmitControl | null,
    el: HTMLElement,
  ): boolean {
    return el.getAttribute('role') === 'combobox';
  }

  async apply(ctx: AdapterContext, req: InteractionRequest): Promise<{ ok: boolean; reason?: string; interactedEl?: HTMLElement }> {
    const { el } = ctx;
    const r = req as SelectCustomComboboxRequest;
    
    if (el.getAttribute('role') !== 'combobox') {
      return { ok: false, reason: 'element is not a combobox' };
    }
    
    // Interact with combobox to open it
    try {
      el.focus();
      el.click();
    } catch {}

    // Wait for options to appear
    await wait(300);

    // Find options
    const options = Array.from(document.querySelectorAll('[role="option"]')) as HTMLElement[];
    if (options.length === 0) {
      return { ok: false, reason: 'no combobox options appeared' };
    }

    const wanted = r.value.trim().toLowerCase();
    
    // Fuzzy match option
    let chosen: HTMLElement | null = null;
    
    // Exact match
    chosen = options.find((o) => (o.textContent ?? '').trim().toLowerCase() === wanted) ?? null;
    
    // Substring match
    if (!chosen) {
      chosen = options.find((o) => (o.textContent ?? '').trim().toLowerCase().includes(wanted)) ?? null;
    }

    if (!chosen) {
      return { ok: false, reason: `no combobox option matches "${r.value}"` };
    }

    try {
      if (typeof chosen.scrollIntoView === 'function') chosen.scrollIntoView({ block: 'nearest' });
      chosen.click();
    } catch (e) {
      return { ok: false, reason: 'failed to click option: ' + (e instanceof Error ? e.message : String(e)) };
    }

    return { ok: true, interactedEl: chosen };
  }
}
