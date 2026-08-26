import type { InteractionObservedState } from '../../shared/interaction';

function readValidity(el: HTMLElement): InteractionObservedState['validity'] | undefined {
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  ) {
    const v = el.validity;
    return {
      valid: v.valid,
      valueMissing: v.valueMissing,
      typeMismatch: v.typeMismatch,
      patternMismatch: v.patternMismatch,
      rangeUnderflow: v.rangeUnderflow,
      rangeOverflow: v.rangeOverflow,
      stepMismatch: v.stepMismatch,
      badInput: v.badInput,
      customError: v.customError,
    };
  }
  return undefined;
}

function isVisible(el: HTMLElement): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.hidden) return false;
  if (el.getAttribute('aria-hidden') === 'true') return false;
  const style = window.getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none') return false;
  if (parseFloat(style.opacity) === 0) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  // M3 fix: Detect screen-reader-only patterns and off-screen placement
  const clipPath = style.getPropertyValue('clip-path');
  if (clipPath === 'inset(100%)') return false;
  const clip = style.getPropertyValue('clip');
  if (clip === 'rect(0px, 0px, 0px, 0px)' || clip === 'rect(0, 0, 0, 0)') return false;
  // Detect extreme off-screen placement via transform
  const transform = style.getPropertyValue('transform');
  if (transform && /translate\(\s*-\d{4,}/.test(transform)) return false;
  return true;
}

function readValue(el: HTMLElement): string | undefined {
  if (el instanceof HTMLInputElement) {
    if (el.type === 'password' || el.type === 'file') return undefined;
    return el.value;
  }
  if (el instanceof HTMLTextAreaElement) {
    return el.value;
  }
  if (el instanceof HTMLSelectElement) {
    return el.value;
  }
  return undefined;
}

function readChecked(el: HTMLElement): boolean | undefined {
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
    return el.checked;
  }
  return undefined;
}

function readSelectedOption(el: HTMLElement): InteractionObservedState['selectedOption'] {
  if (!(el instanceof HTMLSelectElement)) return undefined;
  if (el.selectedIndex < 0) return undefined;
  const opt = el.options[el.selectedIndex];
  if (!opt) return undefined;
  return {
    value: opt.value,
    text: (opt.textContent ?? '').trim(),
    index: el.selectedIndex,
  };
}

function readDisabled(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || el instanceof HTMLButtonElement) {
    if (el.disabled) return true;
  }
  return el.getAttribute('aria-disabled') === 'true';
}

function readReadOnly(el: HTMLElement): boolean | undefined {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.readOnly;
  }
  return undefined;
}

export function observe(el: HTMLElement): InteractionObservedState {
  const result: InteractionObservedState = {
    disabled: readDisabled(el),
    visible: isVisible(el),
  };
  const value = readValue(el);
  if (value !== undefined) result.value = value;
  const checked = readChecked(el);
  if (checked !== undefined) result.checked = checked;
  const selected = readSelectedOption(el);
  if (selected !== undefined) result.selectedOption = selected;
  const ro = readReadOnly(el);
  if (ro !== undefined) result.readOnly = ro;
  const validity = readValidity(el);
  if (validity !== undefined) result.validity = validity;
  return result;
}

export function isDisabledForInteraction(el: HTMLElement): boolean {
  return readDisabled(el);
}

export function isReadOnlyForInteraction(el: HTMLElement): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.readOnly === true;
  }
  return false;
}
