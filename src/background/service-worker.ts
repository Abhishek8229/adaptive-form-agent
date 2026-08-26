import {
  FORM_DETECTED_MESSAGE,
  SCAN_PAGE_MESSAGE,
  GET_DETECTION_MESSAGE,
  type FormDetectedMessage,
  type FormPage,
} from '../shared/types';

interface RuntimeMessage {
  type: string;
}

interface TabState {
  lastDetection: FormPage | null;
  updatedAt: number;
}

const tabStates = new Map<number, TabState>();

chrome.runtime.onInstalled.addListener(() => {
  console.log('[AFA] extension installed');
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return;

  if (message.type === FORM_DETECTED_MESSAGE) {
    const payload = (message as FormDetectedMessage).payload;
    if (sender.tab?.id != null) {
      tabStates.set(sender.tab.id, { lastDetection: payload, updatedAt: Date.now() });
    }
    return false;
  }

  if (message.type === SCAN_PAGE_MESSAGE || message.type === GET_DETECTION_MESSAGE) {
    const tabId = sender.tab?.id;
    if (tabId == null) {
      sendResponse({ ok: false, error: 'no_active_tab' });
      return false;
    }
    const state = tabStates.get(tabId);
    sendResponse({ ok: true, result: state?.lastDetection ?? null });
    return false;
  }

  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabStates.delete(tabId);
});
