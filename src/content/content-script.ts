import { detectPage } from './detector';
import {
  FORM_DETECTED_MESSAGE,
  GET_DETECTION_MESSAGE,
  SCAN_PAGE_MESSAGE,
  type FormDetectedMessage,
  type FormPage,
  type GetDetectionMessage,
  type ScanPageMessage,
} from '../shared/types';

let lastResult: FormPage | null = null;
let pendingHandle: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 250;

function captureResult(): FormPage {
  const result = detectPage();
  lastResult = result;
  return result;
}

function broadcast(result: FormPage): void {
  const message: FormDetectedMessage = { type: FORM_DETECTED_MESSAGE, payload: result };
  try {
    chrome.runtime.sendMessage(message).catch(() => {});
  } catch {
  }
}

function scheduleScan(): void {
  if (pendingHandle != null) clearTimeout(pendingHandle);
  pendingHandle = setTimeout(() => {
    pendingHandle = null;
    const result = captureResult();
    broadcast(result);
  }, DEBOUNCE_MS);
}

function runImmediateScan(): void {
  if (pendingHandle != null) {
    clearTimeout(pendingHandle);
    pendingHandle = null;
  }
  const result = captureResult();
  broadcast(result);
}

const observer = new MutationObserver(() => {
  scheduleScan();
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: [
    'type', 'name', 'id', 'placeholder', 'value', 'checked', 'selected',
    'aria-label', 'aria-labelledby', 'aria-required', 'aria-disabled', 'aria-hidden',
    'required', 'disabled', 'readonly', 'hidden', 'style', 'class', 'form', 'autocomplete',
  ],
});

runImmediateScan();

chrome.runtime.onMessage.addListener((message: ScanPageMessage | GetDetectionMessage, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return;

  if (message.type === SCAN_PAGE_MESSAGE) {
    runImmediateScan();
    const count = lastResult?.totalFieldCount ?? 0;
    sendResponse({ ok: true, count, formCount: lastResult?.formCount ?? 0 });
    return true;
  }

  if (message.type === GET_DETECTION_MESSAGE) {
    sendResponse({ ok: true, result: lastResult });
    return true;
  }

  return false;
});
