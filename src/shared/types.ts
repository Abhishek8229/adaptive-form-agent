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

export interface FormControlMetadata {
  tag: string;
  type: string;
  name: string;
  id: string;
  label: string;
  placeholder: string;
  ariaLabel: string;
  required: boolean;
  visible: boolean;
  controlType: FormControlType;
}

export interface FormDetectionResult {
  url: string;
  detectedAt: string;
  controls: FormControlMetadata[];
}

export const FORM_DETECTED_MESSAGE = 'AFA_FORM_DETECTED' as const;
export const SCAN_PAGE_MESSAGE = 'AFA_SCAN_PAGE' as const;
export const GET_DETECTION_MESSAGE = 'AFA_GET_DETECTION' as const;

export interface FormDetectedMessage {
  type: typeof FORM_DETECTED_MESSAGE;
  payload: FormDetectionResult;
}

export interface ScanPageMessage {
  type: typeof SCAN_PAGE_MESSAGE;
}

export interface GetDetectionMessage {
  type: typeof GET_DETECTION_MESSAGE;
}
