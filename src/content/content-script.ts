import { detectFormControls } from './detector';
import {
  FORM_DETECTED_MESSAGE,
  GET_DETECTION_MESSAGE,
  SCAN_PAGE_MESSAGE,
  type FormDetectionResult,
  type FormDetectedMessage,
  type GetDetectionMessage,
  type ScanPageMessage,
} from '../shared/types';

let lastResult: FormDetectionResult | null = null;

function captureResult(): FormDetectionResult {
  const controls = detectFormControls(document);
  const result: FormDetectionResult = {
    url: location.href,
    detectedAt: new Date().toISOString(),
    controls,
  };
  lastResult = result;
  return result;
}

function broadcast(result: FormDetectionResult): void {
  const message: FormDetectedMessage = { type: FORM_DETECTED_MESSAGE, payload: result };
  try {
    chrome.runtime.sendMessage(message).catch(() => {});
  } catch {
  }
}

function scheduleScan(): void {
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
  attributeFilter: ['type', 'name', 'id', 'placeholder', 'aria-label', 'aria-labelledby', 'required', 'hidden', 'style', 'class', 'disabled'],
});

scheduleScan();

chrome.runtime.onMessage.addListener((message: ScanPageMessage | GetDetectionMessage, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return;

  if (message.type === SCAN_PAGE_MESSAGE) {
    const result = captureResult();
    broadcast(result);
    sendResponse({ ok: true, count: result.controls.length });
    return true;
  }

  if (message.type === GET_DETECTION_MESSAGE) {
    sendResponse({ ok: true, result: lastResult });
    return true;
  }

  return false;
});
