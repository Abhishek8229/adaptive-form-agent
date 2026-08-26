import { inferSemanticHint } from '../shared/semantics';
import type {
  FormField,
  FormGroup,
  FormGroupKind,
  FormMetadata,
  FormOption,
  FormPage,
  FormSemanticHint,
  FormSubmitControl,
} from '../shared/types';

const SUPPORTED_INPUT_TYPES = new Set([
  'text', 'email', 'password', 'tel', 'url', 'search', 'number',
  'date', 'time', 'datetime-local', 'month', 'week',
  'color', 'range', 'hidden',
  'checkbox', 'radio', 'file',
  'submit', 'reset', 'image', 'button',
]);

const SENSITIVE_INPUT_TYPES = new Set(['password', 'file']);
const NEVER_DISPLAY_VALUE_TYPES = new Set(['password', 'file']);

type FormElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement;

function isFormElement(node: Element): node is FormElement {
  if (!(node instanceof HTMLElement)) return false;
  const tag = node.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return true;
  if (tag !== 'INPUT') return false;
  const type = ((node as HTMLInputElement).type ?? 'text').toLowerCase();
  return SUPPORTED_INPUT_TYPES.has(type);
}

function isCandidateControl(node: Element): boolean {
  if (!isFormElement(node)) return false;
  if (node.tagName === 'INPUT') {
    const type = ((node as HTMLInputElement).type ?? 'text').toLowerCase();
    if (type === 'hidden') return false;
  }
  if (node.tagName === 'BUTTON') {
    const btn = node as HTMLButtonElement;
    if (btn.type === 'button' && !btn.hasAttribute('aria-label') && !(btn.textContent ?? '').trim()) {
      return true;
    }
  }
  return true;
}

function isSubmitControl(el: FormElement): boolean {
  if (el.tagName === 'BUTTON') {
    const btn = el as HTMLButtonElement;
    if (btn.type === 'submit' || btn.type === 'button' || btn.type === 'reset') return true;
    if (btn.type === '') return true;
  }
  if (el.tagName === 'INPUT') {
    const t = (el as HTMLInputElement).type;
    if (t === 'submit' || t === 'image') return true;
  }
  return false;
}

function classifyInput(input: HTMLInputElement): string {
  const raw = (input.type || 'text').toLowerCase();
  return SUPPORTED_INPUT_TYPES.has(raw) ? raw : 'other';
}

function isElementVisible(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.hidden) return false;
  if (el.getAttribute('aria-hidden') === 'true') return false;

  const style = window.getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none') return false;
  if (parseFloat(style.opacity) === 0) return false;

  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  return true;
}

function findLabelText(el: FormElement, controlId: string): string {
  const labelEl = el as unknown as { labels?: HTMLCollectionOf<HTMLLabelElement> | null };
  if (labelEl.labels && labelEl.labels.length > 0) {
    const text = Array.from(labelEl.labels)
      .map((l) => (l.textContent ?? '').trim())
      .filter(Boolean)
      .join(' ');
    if (text) return text;
  }

  const ariaLabelledBy = el.getAttribute('aria-labelledby');
  if (ariaLabelledBy) {
    const refs = ariaLabelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id))
      .filter((n): n is HTMLElement => n !== null);
    const text = refs.map((r) => (r.textContent ?? '').trim()).join(' ');
    if (text) return text;
  }

  if (el.parentElement && el.parentElement.tagName === 'LABEL') {
    return (el.parentElement.textContent ?? '').trim();
  }

  if (controlId) {
    const explicit = document.querySelector(`label[for="${CSS.escape(controlId)}"]`);
    if (explicit) {
      const text = (explicit.textContent ?? '').trim();
      if (text) return text;
    }
  }

  let parent: HTMLElement | null = el.parentElement;
  let depth = 0;
  while (parent && depth < 4) {
    if (parent.tagName === 'FIELDSET') {
      const legend = parent.querySelector(':scope > legend');
      if (legend) {
        const t = (legend.textContent ?? '').trim();
        if (t) return t;
      }
    }
    parent = parent.parentElement;
    depth++;
  }

  return '';
}

function getAutocomplete(el: Element): string {
  return (el.getAttribute('autocomplete') ?? '').trim();
}

function isDisabled(el: FormElement): boolean {
  if ((el as HTMLInputElement).disabled) return true;
  if (el.getAttribute('aria-disabled') === 'true') return true;
  return false;
}

function isReadOnly(el: FormElement): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.readOnly === true;
  }
  return false;
}

function getValuePresent(el: FormElement): boolean {
  if (NEVER_DISPLAY_VALUE_TYPES.has(el.tagName === 'INPUT' ? (el as HTMLInputElement).type : '')) {
    return false;
  }
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox' || el.type === 'radio') return el.checked;
    return el.value.length > 0;
  }
  if (el instanceof HTMLTextAreaElement) {
    return el.value.length > 0;
  }
  if (el instanceof HTMLSelectElement) {
    return el.value.length > 0 && Array.from(el.options).some((o) => o.selected);
  }
  return false;
}

function containsSensitiveValue(el: FormElement): boolean {
  if (el.tagName === 'INPUT') {
    const t = (el as HTMLInputElement).type;
    return SENSITIVE_INPUT_TYPES.has(t);
  }
  return false;
}

function extractOptions(select: HTMLSelectElement): FormOption[] {
  const opts: FormOption[] = [];
  for (const o of Array.from(select.options)) {
    opts.push({
      value: o.value,
      text: (o.textContent ?? '').trim(),
      selected: o.selected,
      disabled: o.disabled,
    });
  }
  return opts;
}

function buildField(el: FormElement, groupId: string, groupFieldIndex: number): FormField {
  const tag = el.tagName.toLowerCase();
  const id = el.getAttribute('id') ?? '';
  const name = el.getAttribute('name') ?? '';
  const placeholder = ('placeholder' in el ? el.getAttribute('placeholder') ?? '' : '');
  const ariaLabel = el.getAttribute('aria-label') ?? '';
  const type = tag === 'input' ? classifyInput(el as HTMLInputElement) : tag;
  const required = el.hasAttribute('required') || el.getAttribute('aria-required') === 'true';
  const disabled = isDisabled(el);
  const readOnly = isReadOnly(el);
  const visible = isElementVisible(el);
  const autocomplete = getAutocomplete(el);
  const label = findLabelText(el, id);

  const { hint, sources } = inferSemanticHint({
    type,
    name,
    id,
    label,
    placeholder,
    ariaLabel,
    autocomplete,
  });

  let semanticHint: FormSemanticHint = hint;
  if (type === 'select' && semanticHint === 'unknown') semanticHint = 'select_choice';
  if (tag === 'textarea' && semanticHint === 'unknown') semanticHint = 'textarea';

  let options: FormOption[] = [];
  if (el instanceof HTMLSelectElement) {
    options = extractOptions(el);
  }

  const stableId = `${groupId}.f${groupFieldIndex}`;
  const valuePresent = getValuePresent(el);
  const sensitive = containsSensitiveValue(el);

  return {
    stableId,
    tag,
    type,
    controlType: (`${tag === 'input' ? 'input' : tag}-${type}`) as FormField['controlType'],
    name,
    id,
    label,
    placeholder,
    ariaLabel,
    required,
    visible,
    disabled,
    readOnly,
    autocomplete,
    semanticHint,
    semanticSources: sources,
    options,
    valuePresent,
    containsSensitiveValue: sensitive,
  };
}

function buildSubmitControl(el: FormElement, groupId: string, index: number): FormSubmitControl {
  const tag = el.tagName.toLowerCase();
  const type = tag === 'input' ? ((el as HTMLInputElement).type || 'submit') : ((el as HTMLButtonElement).type || 'submit');
  const text = (el.textContent ?? '').trim();
  const ariaLabel = el.getAttribute('aria-label') ?? '';
  return {
    stableId: `${groupId}.s${index}`,
    tag,
    type,
    text,
    ariaLabel,
    disabled: isDisabled(el),
    visible: isElementVisible(el),
  };
}

function groupIdFor(kind: FormGroupKind, raw: HTMLFormElement | string, index: number): string {
  const base = kind === 'form'
    ? (raw instanceof HTMLFormElement ? (raw.id || raw.getAttribute('name') || `form_${index}`) : raw)
    : raw;
  return `${kind}_${index}_${base.toString().replace(/[^a-z0-9]+/gi, '_').toLowerCase() || 'x'}`;
}

function findOwnerForm(el: FormElement, forms: HTMLFormElement[]): HTMLFormElement | null {
  const direct = el.form;
  if (direct) {
    if (forms.indexOf(direct) !== -1) return direct;
  }
  let p: HTMLElement | null = el.parentElement;
  while (p) {
    if (p.tagName === 'FORM') {
      if (forms.indexOf(p as HTMLFormElement) !== -1) return p as HTMLFormElement;
    }
    p = p.parentElement;
  }
  return null;
}

function groupLabelText(form: HTMLFormElement): string {
  const aria = form.getAttribute('aria-label') ?? '';
  if (aria.trim()) return aria.trim();
  const labelledBy = form.getAttribute('aria-labelledby');
  if (labelledBy) {
    const refs = labelledBy.split(/\s+/)
      .map((id) => document.getElementById(id))
      .filter((n): n is HTMLElement => n !== null);
    const t = refs.map((r) => (r.textContent ?? '').trim()).join(' ');
    if (t) return t;
  }
  const legend = form.querySelector(':scope > fieldset > legend, :scope > legend');
  if (legend) return (legend.textContent ?? '').trim();
  return '';
}

function detectFromRealForms(forms: HTMLFormElement[]): { groups: FormGroup[]; assigned: WeakSet<Element>; groupIndexByForm: Map<HTMLFormElement, number> } {
  const groups: FormGroup[] = [];
  const assigned = new WeakSet<Element>();
  const groupIndexByForm = new Map<HTMLFormElement, number>();
  const seenInGroupPerForm: WeakMap<HTMLFormElement, WeakSet<Element>> = new WeakMap();

  for (let i = 0; i < forms.length; i++) {
    const form = forms[i];
    const groupId = groupIdFor('form', form, i);
    const fields: FormField[] = [];
    const submits: FormSubmitControl[] = [];
    const seen = new WeakSet<Element>();
    seenInGroupPerForm.set(form, seen);

    const descendants = Array.from(form.querySelectorAll('input, textarea, select, button'));
    for (const d of descendants) {
      if (!isFormElement(d)) continue;
      if (d.tagName === 'INPUT' && (d as HTMLInputElement).type === 'hidden') {
        assigned.add(d);
        continue;
      }
      if (isSubmitControl(d)) {
        if (!seen.has(d)) {
          seen.add(d);
          submits.push(buildSubmitControl(d, groupId, submits.length));
          assigned.add(d);
        }
        continue;
      }
      if (!isCandidateControl(d)) continue;
      if (seen.has(d)) continue;
      seen.add(d);
      fields.push(buildField(d, groupId, fields.length));
      assigned.add(d);
    }

    const metadata: FormMetadata = {
      stableId: groupId,
      kind: 'form',
      name: form.getAttribute('name') ?? '',
      action: form.getAttribute('action') ?? '',
      method: (form.getAttribute('method') ?? 'get').toLowerCase(),
      autocomplete: form.getAttribute('autocomplete') ?? '',
      enctype: form.getAttribute('enctype') ?? '',
      target: form.getAttribute('target') ?? '',
      fieldCount: fields.length,
      submitCount: submits.length,
      labelText: groupLabelText(form),
    };
    groups.push({ metadata, fields, submitControls: submits });
    groupIndexByForm.set(form, i);
  }

  return { groups, assigned, groupIndexByForm };
}

function collectExternalControls(
  forms: HTMLFormElement[],
  assigned: WeakSet<Element>,
  groupIndexByForm: Map<HTMLFormElement, number>,
  groups: FormGroup[],
): void {
  const candidates = Array.from(document.querySelectorAll('input, textarea, select, button'));
  for (const el of candidates) {
    if (!isFormElement(el)) continue;
    if (assigned.has(el)) continue;
    if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'hidden') continue;
    if (!isCandidateControl(el)) continue;
    const owner = findOwnerForm(el, forms);
    if (!owner) continue;
    const gIdx = groupIndexByForm.get(owner);
    if (gIdx == null) continue;
    const group = groups[gIdx];
    const groupId = group.metadata.stableId;
    if (isSubmitControl(el)) {
      group.submitControls.push(buildSubmitControl(el, groupId, group.submitControls.length));
    } else {
      group.fields.push(buildField(el, groupId, group.fields.length));
    }
    group.metadata.fieldCount = group.fields.length;
    group.metadata.submitCount = group.submitControls.length;
    assigned.add(el);
  }
}

function collectLooseControls(assigned: WeakSet<Element>): FormElement[] {
  const loose: FormElement[] = [];
  const all = Array.from(document.querySelectorAll('input, textarea, select, button'));
  for (const el of all) {
    if (!isFormElement(el)) continue;
    if (assigned.has(el)) continue;
    if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'hidden') continue;
    if (!isCandidateControl(el)) continue;
    loose.push(el);
  }
  return loose;
}

function buildLogicalGroup(loose: FormElement[], index: number): FormGroup {
  const groupId = groupIdFor('logical', `loose_${index}`, index);
  const fields: FormField[] = [];
  const submits: FormSubmitControl[] = [];

  const sorted = loose.slice().sort((a, b) => {
    if (a === b) return 0;
    const cmp = a.compareDocumentPosition(b);
    if (cmp & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
    if (cmp & Node.DOCUMENT_POSITION_PRECEDING) return 1;
    return 0;
  });

  for (const el of sorted) {
    if (isSubmitControl(el)) {
      submits.push(buildSubmitControl(el, groupId, submits.length));
    } else {
      fields.push(buildField(el, groupId, fields.length));
    }
  }

  const metadata: FormMetadata = {
    stableId: groupId,
    kind: loose.length === 0 ? 'orphan' : 'logical',
    name: '',
    action: '',
    method: '',
    autocomplete: '',
    enctype: '',
    target: '',
    fieldCount: fields.length,
    submitCount: submits.length,
    labelText: '',
  };
  return { metadata, fields, submitControls: submits };
}

export function detectPage(): FormPage {
  const forms = Array.from(document.querySelectorAll('form'));
  const { groups, assigned, groupIndexByForm } = detectFromRealForms(forms);

  collectExternalControls(forms, assigned, groupIndexByForm, groups);

  const loose = collectLooseControls(assigned);
  if (loose.length > 0) {
    groups.push(buildLogicalGroup(loose, groups.length));
  }

  let totalFields = 0;
  for (const g of groups) totalFields += g.fields.length;

  return {
    url: location.href,
    title: document.title,
    detectedAt: new Date().toISOString(),
    formCount: groups.length,
    totalFieldCount: totalFields,
    forms: groups,
  };
}
