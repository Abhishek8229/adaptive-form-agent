import { inferSemanticHint } from '../shared/semantics';
import type {
  FieldTarget,
  FormField,
  FormGroup,
  FormGroupKind,
  FormRepeatingGroup,
  FormMetadata,
  FormOption,
  FormPage,
  FormSemanticHint,
  FormSubmitControl,
  SubmitTarget,
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

type FormElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement | HTMLElement;

function isFormElement(node: Element): node is FormElement {
  if (!(node instanceof HTMLElement)) return false;
  const tag = node.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return true;
  if (tag === 'INPUT') {
    const type = ((node as HTMLInputElement).type ?? 'text').toLowerCase();
    return SUPPORTED_INPUT_TYPES.has(type);
  }
  const role = node.getAttribute('role');
  if (role === 'combobox' || role === 'radio' || role === 'checkbox') return true;
  return false;
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

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/([!"#$%&'()*+,./:;<=>?@[\]^`{|}~])/g, '\\$1');
}

function buildSelector(el: FormElement): string {
  const tag = el.tagName.toLowerCase();
  if (el.id) {
    return `${tag}#${cssEscape(el.id)}`;
  }
  const name = el.getAttribute('name');
  if (name) {
    return `${tag}[name="${name.replace(/"/g, '\\"')}"]`;
  }
  return tag;
}

function pathIndexWithinScope(el: FormElement, owner: HTMLFormElement | null): number {
  const root: ParentNode = owner ?? document;
  const tag = el.tagName.toLowerCase();
  const type = (el as HTMLInputElement).type;
  const same = Array.from(root.querySelectorAll(tag)).filter((n) => {
    if (!(n instanceof HTMLElement)) return false;
    if (n === el) return true;
    if (tag === 'input') {
      return (n as HTMLInputElement).type === type;
    }
    return true;
  });
  return same.indexOf(el);
}

function buildFieldTarget(
  el: FormElement,
  owner: HTMLFormElement | null,
  label: string,
): FieldTarget {
  const tag = el.tagName.toLowerCase();
  const type = el instanceof HTMLInputElement ? (el.type || 'text') : tag;
  const id = el.getAttribute('id') ?? '';
  const name = el.getAttribute('name') ?? '';
  const ariaLabel = el.getAttribute('aria-label') ?? '';
  const placeholder = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
    ? el.getAttribute('placeholder') ?? ''
    : '';
  const autocomplete = el.getAttribute('autocomplete') ?? '';
  const formId = owner ? (owner.id ?? '') : '';
  const formName = owner ? (owner.getAttribute('name') ?? '') : '';
  const radioName = type === 'radio' ? name : undefined;
  const pathIndex = pathIndexWithinScope(el, owner);
  const selector = buildSelector(el);
  return {
    id,
    name,
    tag,
    type,
    formId,
    formName,
    label,
    ariaLabel,
    placeholder,
    autocomplete,
    radioName,
    pathIndex,
    selector,
  };
}

function buildSubmitTarget(
  el: FormElement,
  owner: HTMLFormElement | null,
): SubmitTarget {
  const tag = el.tagName.toLowerCase();
  const type = el instanceof HTMLInputElement
    ? (el.type || 'submit')
    : ((el as HTMLButtonElement).type || 'submit');
  const id = el.getAttribute('id') ?? '';
  const name = el.getAttribute('name') ?? '';
  const text = (el.textContent ?? '').trim();
  const ariaLabel = el.getAttribute('aria-label') ?? '';
  const formId = owner ? (owner.id ?? '') : '';
  const formName = owner ? (owner.getAttribute('name') ?? '') : '';
  const pathIndex = pathIndexWithinScope(el, owner);
  const selector = buildSelector(el);
  return { id, name, tag, type, text, ariaLabel, formId, formName, pathIndex, selector };
}

export const liveElements = new Map<string, WeakRef<HTMLElement>>();

// Track radios that have already been grouped to prevent emitting them as standalone fields
let seenRadios = new WeakSet<Element>();
function isRadioGroupable(el: Element): boolean {
  if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'radio' && (el as HTMLInputElement).name) return true;
  if (el.getAttribute('role') === 'radio') return true;
  return false;
}

function buildField(
  el: FormElement,
  groupId: string,
  groupFieldIndex: number,
  owner: HTMLFormElement | null,
): FormField {
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
  let label = findLabelText(el, id);

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
  } else if (el instanceof HTMLInputElement && el.type === 'radio') {
    const radioName = el.name;
    if (radioName) {
      const root = owner ?? document;
      let escapedName = radioName;
      if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
        escapedName = CSS.escape(radioName);
      } else {
        escapedName = radioName.replace(/([!"#$%&'()*+,./:;<=>?@[\]^`{|}~])/g, '\\$1');
      }
      
      const siblings = Array.from(root.querySelectorAll(`input[type="radio"][name="${escapedName}"]`)) as HTMLInputElement[];
      for (const s of siblings) {
        seenRadios.add(s);
      }
      
      options = siblings.map(s => ({
        value: s.value ?? '',
        text: (s.getAttribute('aria-label') ?? '').trim() || findLabelText(s, s.id) || s.value || '',
        selected: s.checked,
        disabled: s.disabled,
      }));
      
      let p: HTMLElement | null = el.parentElement;
      while (p) {
        if (p.tagName === 'FIELDSET') {
          const leg = p.querySelector(':scope > legend');
          if (leg && leg.textContent) {
            const legendText = leg.textContent.trim();
            if (legendText) {
              label = legendText;
            }
          }
          break;
        }
        p = p.parentElement;
      }
    } else {
      const v = el.value ?? '';
      options = [{
        value: v,
        text: (el.getAttribute('aria-label') ?? '').trim() || v,
        selected: el.checked,
        disabled: el.disabled,
      }];
    }
  } else if (el.getAttribute('role') === 'radio') {
    const name = el.getAttribute('name');
    const radiogroup = el.closest('[role="radiogroup"]');
    const ariaLabelledby = el.getAttribute('aria-labelledby');
    const root = owner ?? document;
    const allRadios = Array.from(root.querySelectorAll('[role="radio"]')) as HTMLElement[];
    const siblings = allRadios.filter(r => {
       if (name && r.getAttribute('name') === name) return true;
       if (radiogroup && r.closest('[role="radiogroup"]') === radiogroup) return true;
       if (ariaLabelledby && r.getAttribute('aria-labelledby') === ariaLabelledby) return true;
       if (!name && !radiogroup && !ariaLabelledby) return r === el;
       return false;
    });
    for (const s of siblings) seenRadios.add(s);
    options = siblings.map((s, idx) => {
      const sId = s.id || `custom_radio_${idx}`;
      return {
        value: s.getAttribute('value') ?? `radio_${idx}`,
        text: findLabelText(s as any, sId) || (s.textContent || '').trim(),
        selected: s.getAttribute('aria-checked') === 'true',
        disabled: s.getAttribute('aria-disabled') === 'true'
      };
    });
  }

  const stableId = `${groupId}.f${groupFieldIndex}`;
  liveElements.set(stableId, new WeakRef(el));

  const valuePresent = getValuePresent(el);
  const sensitive = containsSensitiveValue(el);
  let repeatingGroup: FormRepeatingGroup | undefined;
  if (name) {
    const m = name.match(/^([a-zA-Z0-9]+)(?:\[(\d+)\]|_(\d+)_)(?:\.|\[)?([a-zA-Z0-9_]+)\]?$/);
    if (m) {
      repeatingGroup = {
        baseName: m[1],
        index: parseInt(m[2] || m[3], 10)
      };
    }
  }

  if (!repeatingGroup) {
    let p = el.parentElement;
    while (p) {
      if (p.tagName === 'FIELDSET') {
        const leg = p.querySelector(':scope > legend');
        if (leg && leg.textContent) {
          const text = leg.textContent.trim();
          const baseText = text.replace(/#?\d+$/, '').trim();
          
          const doc = owner ?? document;
          const allFieldsets = Array.from(doc.querySelectorAll('fieldset')).filter(fs => {
            const l = fs.querySelector(':scope > legend');
            return l && l.textContent && l.textContent.trim().replace(/#?\d+$/, '').trim() === baseText;
          });
          
          if (allFieldsets.length > 1 || text !== baseText) {
            const baseName = baseText.toLowerCase().replace(/[^a-z0-9]+(.)/g, (_m, chr) => chr.toUpperCase());
            repeatingGroup = {
              baseName,
              index: allFieldsets.indexOf(p as HTMLFieldSetElement) > -1 ? allFieldsets.indexOf(p as HTMLFieldSetElement) : 0
            };
          }
        }
        break;
      }
      p = p.parentElement;
    }
  }

  const target = buildFieldTarget(el, owner, label);

  let controlType: FormField['controlType'] = 'input-text';
  if (tag === 'input') {
    if (SUPPORTED_INPUT_TYPES.has(type)) {
      controlType = `input-${type}` as FormField['controlType'];
    }
  } else if (tag === 'textarea') {
    controlType = 'textarea';
  } else if (tag === 'select') {
    controlType = 'select';
  } else if (tag === 'button') {
    controlType = 'button';
  } else {
    const role = el.getAttribute('role');
    if (role === 'combobox') controlType = 'custom-combobox';
    if (role === 'radio') controlType = 'custom-radio';
    if (role === 'checkbox') controlType = 'custom-checkbox';
  }

  return {
    stableId,
    tag,
    type,
    controlType,
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
    target,
    repeatingGroup,
  };
}

function buildSubmitControl(
  el: FormElement,
  groupId: string,
  index: number,
  owner: HTMLFormElement | null,
): FormSubmitControl {
  const tag = el.tagName.toLowerCase();
  const type = tag === 'input' ? ((el as HTMLInputElement).type || 'submit') : ((el as HTMLButtonElement).type || 'submit');
  const text = (el.textContent ?? '').trim();
  const ariaLabel = el.getAttribute('aria-label') ?? '';
  const stableId = `${groupId}.s${index}`;
  liveElements.set(stableId, new WeakRef(el));

  return {
    stableId,
    tag,
    type,
    text,
    ariaLabel,
    disabled: isDisabled(el),
    visible: isElementVisible(el),
    target: buildSubmitTarget(el, owner),
  };
}

function groupIdFor(kind: FormGroupKind, raw: HTMLFormElement | string, index: number): string {
  const base = kind === 'form'
    ? (raw instanceof HTMLFormElement ? (raw.id || raw.getAttribute('name') || `form_${index}`) : raw)
    : raw;
  return `${kind}_${index}_${base.toString().replace(/[^a-z0-9]+/gi, '_').toLowerCase() || 'x'}`;
}

function findOwnerForm(el: FormElement, forms: HTMLFormElement[]): HTMLFormElement | null {
  const direct = (el as any).form;
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

    const descendants = Array.from(form.querySelectorAll('input, textarea, select, button, [role="combobox"], [role="radio"], [role="checkbox"]'));
    for (const d of descendants) {
      if (!isFormElement(d)) continue;
      if (d.tagName === 'INPUT' && (d as HTMLInputElement).type === 'hidden') {
        assigned.add(d);
        continue;
      }
      if (isSubmitControl(d)) {
        if (!seen.has(d)) {
          seen.add(d);
          submits.push(buildSubmitControl(d, groupId, submits.length, form));
          assigned.add(d);
        }
        continue;
      }
      if (!isCandidateControl(d)) continue;
      if (isRadioGroupable(d)) { if (seenRadios.has(d)) continue; }
      if (seen.has(d)) continue;
      seen.add(d);
      fields.push(buildField(d, groupId, fields.length, form));
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
  const candidates = Array.from(document.querySelectorAll('input, textarea, select, button, [role="combobox"], [role="radio"], [role="checkbox"]'));
  for (const el of candidates) {
    if (!isFormElement(el)) continue;
    if (assigned.has(el)) continue;
    if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'hidden') continue;
    if (!isCandidateControl(el)) continue;
    if (isRadioGroupable(el)) { if (seenRadios.has(el)) continue; }
    const owner = findOwnerForm(el, forms);
    if (!owner) continue;
    const gIdx = groupIndexByForm.get(owner);
    if (gIdx == null) continue;
    const group = groups[gIdx];
    const groupId = group.metadata.stableId;
    if (isSubmitControl(el)) {
      group.submitControls.push(buildSubmitControl(el, groupId, group.submitControls.length, owner));
    } else {
      group.fields.push(buildField(el, groupId, group.fields.length, owner));
    }
    group.metadata.fieldCount = group.fields.length;
    group.metadata.submitCount = group.submitControls.length;
    assigned.add(el);
  }
}

function collectLooseControls(assigned: WeakSet<Element>): FormElement[] {
  const loose: FormElement[] = [];
  const all = Array.from(document.querySelectorAll('input, textarea, select, button, [role="combobox"], [role="radio"], [role="checkbox"]'));
  for (const el of all) {
    if (!isFormElement(el)) continue;
    if (assigned.has(el)) continue;
    if (el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'hidden') continue;
    if (!isCandidateControl(el)) continue;
    if (isRadioGroupable(el)) { if (seenRadios.has(el)) continue; }
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
      submits.push(buildSubmitControl(el, groupId, submits.length, null));
    } else {
      fields.push(buildField(el, groupId, fields.length, null));
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
  liveElements.clear();
  seenRadios = new WeakSet<Element>();
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
