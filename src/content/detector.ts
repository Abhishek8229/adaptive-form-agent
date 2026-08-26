import type { FormControlMetadata, FormControlType } from '../shared/types';

const SUPPORTED_INPUT_TYPES = new Set([
  'text',
  'email',
  'password',
  'tel',
  'url',
  'search',
  'number',
  'date',
  'time',
  'datetime-local',
  'month',
  'week',
  'color',
  'range',
  'hidden',
  'checkbox',
  'radio',
  'file',
  'submit',
  'reset',
  'image',
  'button',
]);

const CHECKBOX_RADIO_TYPES = new Set(['checkbox', 'radio']);
const BUTTON_LIKE_TYPES = new Set(['submit', 'reset', 'image', 'button']);

function classifyInput(input: HTMLInputElement): FormControlType {
  const raw = (input.type || 'text').toLowerCase();
  const base = `input-${raw}`;
  if (SUPPORTED_INPUT_TYPES.has(raw)) {
    return base as FormControlType;
  }
  return 'input-other';
}

function isElementVisible(el: Element): boolean {
  if (!(el instanceof HTMLElement) && !(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement) && !(el instanceof HTMLSelectElement) && !(el instanceof HTMLButtonElement)) {
    return false;
  }

  const htmlEl = el as HTMLElement;
  if (htmlEl.hidden) return false;
  if (htmlEl.getAttribute('aria-hidden') === 'true') return false;

  const style = window.getComputedStyle(htmlEl);
  if (style.visibility === 'hidden' || style.display === 'none') return false;
  if (parseFloat(style.opacity) === 0) return false;

  const rect = htmlEl.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;

  return true;
}

function findLabelText(el: HTMLElement, controlId: string): string {
  const labelEl = el as HTMLElement & { labels?: HTMLCollectionOf<HTMLLabelElement> | null };
  if (labelEl.labels && labelEl.labels.length > 0) {
    return Array.from(labelEl.labels)
      .map((l: HTMLLabelElement) => (l.textContent ?? '').trim())
      .filter(Boolean)
      .join(' ');
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
    if (explicit) return (explicit.textContent ?? '').trim();
  }

  return '';
}

function readString(el: Element, attr: string): string {
  const v = el.getAttribute(attr);
  return v ?? '';
}

function buildMetadata(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement): FormControlMetadata {
  const tag = el.tagName.toLowerCase();
  const type = 'type' in el ? (el as HTMLInputElement).type ?? '' : '';
  const id = readString(el, 'id');
  const name = readString(el, 'name');
  const placeholder = 'placeholder' in el ? readString(el as HTMLInputElement | HTMLTextAreaElement, 'placeholder') : '';
  const ariaLabel = readString(el, 'aria-label');
  const required = el.hasAttribute('required') || el.getAttribute('aria-required') === 'true';
  const label = findLabelText(el, id);
  const visible = isElementVisible(el);

  let controlType: FormControlType;
  if (tag === 'textarea') {
    controlType = 'textarea';
  } else if (tag === 'select') {
    controlType = 'select';
  } else if (tag === 'button') {
    controlType = 'button';
  } else {
    const inputEl = el as HTMLInputElement;
    controlType = classifyInput(inputEl);
  }

  return {
    tag,
    type,
    name,
    id,
    label,
    placeholder,
    ariaLabel,
    required,
    visible,
    controlType,
  };
}

function isCandidate(el: Element): el is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLButtonElement {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return true;
  if (tag !== 'INPUT') return false;

  const inputType = ((el as HTMLInputElement).type ?? 'text').toLowerCase();
  return SUPPORTED_INPUT_TYPES.has(inputType) || CHECKBOX_RADIO_TYPES.has(inputType) || BUTTON_LIKE_TYPES.has(inputType);
}

export function detectFormControls(root: ParentNode = document): FormControlMetadata[] {
  const selector = 'input, textarea, select, button';
  const nodes = Array.from(root.querySelectorAll(selector));
  const results: FormControlMetadata[] = [];

  for (const node of nodes) {
    if (!isCandidate(node)) continue;
    results.push(buildMetadata(node));
  }

  return results;
}
