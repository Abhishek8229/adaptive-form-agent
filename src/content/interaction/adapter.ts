import type { InteractionRequest } from '../../shared/interaction';
import type { FormField, FormSubmitControl } from '../../shared/types';

export interface AdapterContext {
  field: FormField | null;
  submit: FormSubmitControl | null;
  el: HTMLElement;
}

export interface Adapter {
  readonly kind: InteractionRequest['kind'];
  canHandle(field: FormField | null, submit: FormSubmitControl | null, el: HTMLElement): boolean;
  apply(ctx: AdapterContext, req: InteractionRequest): { ok: boolean; reason?: string; interactedEl?: HTMLElement } | Promise<{ ok: boolean; reason?: string; interactedEl?: HTMLElement }>;
}
