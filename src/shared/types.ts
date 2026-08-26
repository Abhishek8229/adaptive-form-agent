export type FormControlType =
  | 'input-text'
  | 'input-email'
  | 'input-password'
  | 'input-tel'
  | 'input-url'
  | 'input-search'
  | 'input-number'
  | 'input-date'
  | 'input-time'
  | 'input-datetime-local'
  | 'input-month'
  | 'input-week'
  | 'input-color'
  | 'input-range'
  | 'input-hidden'
  | 'input-checkbox'
  | 'input-radio'
  | 'input-file'
  | 'input-submit'
  | 'input-reset'
  | 'input-image'
  | 'input-button'
  | 'input-other'
  | 'textarea'
  | 'select'
  | 'button';

export type FormSemanticHint =
  | 'email'
  | 'phone'
  | 'first_name'
  | 'last_name'
  | 'full_name'
  | 'date_of_birth'
  | 'address'
  | 'address_line_2'
  | 'city'
  | 'state'
  | 'country'
  | 'postal_code'
  | 'username'
  | 'password'
  | 'search'
  | 'url'
  | 'number'
  | 'date'
  | 'time'
  | 'datetime'
  | 'color'
  | 'range'
  | 'file'
  | 'checkbox_group'
  | 'radio_group'
  | 'select_choice'
  | 'textarea'
  | 'unknown';

export type FormGroupKind = 'form' | 'logical' | 'orphan';

export interface FormOption {
  value: string;
  text: string;
  selected: boolean;
  disabled: boolean;
}

export interface FieldTarget {
  id: string;
  name: string;
  tag: string;
  type: string;
  formId: string;
  formName: string;
  label: string;
  ariaLabel: string;
  placeholder: string;
  autocomplete: string;
  radioName?: string;
  pathIndex: number;
  selector: string;
}

export interface FormField {
  stableId: string;
  tag: string;
  type: string;
  controlType: FormControlType;
  name: string;
  id: string;
  label: string;
  placeholder: string;
  ariaLabel: string;
  required: boolean;
  visible: boolean;
  disabled: boolean;
  readOnly: boolean;
  autocomplete: string;
  semanticHint: FormSemanticHint;
  semanticSources: string[];
  options: FormOption[];
  valuePresent: boolean;
  containsSensitiveValue: boolean;
  target: FieldTarget;
}

export interface SubmitTarget {
  id: string;
  name: string;
  tag: string;
  type: string;
  text: string;
  ariaLabel: string;
  formId: string;
  formName: string;
  pathIndex: number;
  selector: string;
}

export interface FormSubmitControl {
  stableId: string;
  tag: string;
  type: string;
  text: string;
  ariaLabel: string;
  disabled: boolean;
  visible: boolean;
  target: SubmitTarget;
}

export interface FormMetadata {
  stableId: string;
  kind: FormGroupKind;
  name: string;
  action: string;
  method: string;
  autocomplete: string;
  enctype: string;
  target: string;
  fieldCount: number;
  submitCount: number;
  labelText: string;
}

export interface FormGroup {
  metadata: FormMetadata;
  fields: FormField[];
  submitControls: FormSubmitControl[];
}

export interface FormPage {
  url: string;
  title: string;
  detectedAt: string;
  formCount: number;
  totalFieldCount: number;
  forms: FormGroup[];
}

export const FORM_DETECTED_MESSAGE = 'AFA_FORM_DETECTED' as const;
export const SCAN_PAGE_MESSAGE = 'AFA_SCAN_PAGE' as const;
export const GET_DETECTION_MESSAGE = 'AFA_GET_DETECTION' as const;

export interface FormDetectedMessage {
  type: typeof FORM_DETECTED_MESSAGE;
  payload: FormPage;
}

export interface ScanPageMessage {
  type: typeof SCAN_PAGE_MESSAGE;
}

export interface GetDetectionMessage {
  type: typeof GET_DETECTION_MESSAGE;
}

export {
  INTERACT_MESSAGE,
  INTERACT_DEMO_MESSAGE,
} from './interaction';
export type {
  InteractionRequest,
  InteractionResult,
  InteractionObservedState,
  InteractionKind,
  InteractMessage,
  InteractDemoMessage,
  SetTextRequest,
  CheckboxRequest,
  RadioRequest,
  SelectOptionRequest,
  SetDateRequest,
  SetTimeRequest,
  ClickButtonRequest,
} from './interaction';
