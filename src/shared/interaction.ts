export type InteractionKind =
  | 'set-text'
  | 'set-textarea'
  | 'check'
  | 'uncheck'
  | 'select-radio'
  | 'select-option'
  | 'set-date'
  | 'set-time'
  | 'click-button'
  | 'select-custom-combobox';

export interface InteractionBaseRequest {
  stableId: string;
  kind: InteractionKind;
}

export interface SetTextRequest extends InteractionBaseRequest {
  kind: 'set-text' | 'set-textarea';
  value: string;
}

export interface CheckboxRequest extends InteractionBaseRequest {
  kind: 'check' | 'uncheck';
}

export interface RadioRequest extends InteractionBaseRequest {
  kind: 'select-radio';
  value: string;
}

export interface SelectOptionRequest extends InteractionBaseRequest {
  kind: 'select-option';
  by: 'value' | 'text';
  value: string;
  values?: string[]; // Multiple matched values for <select multiple>
}

export interface SetDateRequest extends InteractionBaseRequest {
  kind: 'set-date';
  value: string;
}

export interface SetTimeRequest extends InteractionBaseRequest {
  kind: 'set-time';
  value: string;
}

export interface ClickButtonRequest extends InteractionBaseRequest {
  kind: 'click-button';
}

export interface SelectCustomComboboxRequest extends InteractionBaseRequest {
  kind: 'select-custom-combobox';
  value: string;
}

export type InteractionRequest =
  | SetTextRequest
  | CheckboxRequest
  | RadioRequest
  | SelectOptionRequest
  | SetDateRequest
  | SetTimeRequest
  | ClickButtonRequest
  | SelectCustomComboboxRequest;

export interface InteractionObservedState {
  value?: string;
  checked?: boolean;
  selectedOption?: { value: string; text: string; index: number };
  selectedValues?: string[];
  disabled?: boolean;
  readOnly?: boolean;
  visible?: boolean;
  validity?: {
    valid: boolean;
    valueMissing: boolean;
    typeMismatch: boolean;
    patternMismatch: boolean;
    rangeUnderflow: boolean;
    rangeOverflow: boolean;
    stepMismatch: boolean;
    badInput: boolean;
    customError: boolean;
  };
}

export interface InteractionResult {
  success: boolean;
  reason?: string;
  stableId: string;
  kind: InteractionKind;
  attemptedValue?: string;
  observed?: InteractionObservedState;
  retried: boolean;
}

export const INTERACT_MESSAGE = 'AFA_INTERACT' as const;
export const INTERACT_DEMO_MESSAGE = 'AFA_INTERACT_DEMO' as const;

export interface InteractMessage {
  type: typeof INTERACT_MESSAGE;
  payload: InteractionRequest;
}

export interface InteractDemoMessage {
  type: typeof INTERACT_DEMO_MESSAGE;
  payload: { stableId: string; value: string };
}
