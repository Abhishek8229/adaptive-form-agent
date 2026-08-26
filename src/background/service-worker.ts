import {
  FORM_DETECTED_MESSAGE,
  SCAN_PAGE_MESSAGE,
  GET_DETECTION_MESSAGE,
  type FormDetectedMessage,
  type FormPage,
} from '../shared/types';
import { PersonaMessageHandler } from './persona-handler';
import { PersonaStore } from './persona-store';

interface RuntimeMessage {
  type: string;
}

interface TabState {
  lastDetection: FormPage | null;
  updatedAt: number;
}

const tabStates = new Map<number, TabState>();

const personaStore = new PersonaStore();
const personaHandler = new PersonaMessageHandler({ store: personaStore });

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

  // Persona messages are async; return true to keep the channel open.
  if (isPersonaMessage(message)) {
    personaHandler
      .handle(message)
      .then((response) => sendResponse(response))
      .catch((err: unknown) =>
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      );
    return true;
  }

  return false;
});

function isPersonaMessage(message: RuntimeMessage): message is import('../shared/persona-messages').PersonaMessage {
  if (!message || typeof message !== 'object') return false;
  const t = (message as { type?: unknown }).type;
  return (
    t === 'AFA_PERSONA_GET' ||
    t === 'AFA_PERSONA_ADD_FACT' ||
    t === 'AFA_PERSONA_UPDATE_FACT' ||
    t === 'AFA_PERSONA_REMOVE_FACT' ||
    t === 'AFA_PERSONA_ADD_PLAN' ||
    t === 'AFA_PERSONA_UPDATE_PLAN' ||
    t === 'AFA_PERSONA_REMOVE_PLAN' ||
    t === 'AFA_PERSONA_UPDATE_IDENTITY' ||
    t === 'AFA_PERSONA_LOAD_EXAMPLES' ||
    t === 'AFA_PERSONA_CLEAR'
  );
}

chrome.tabs.onRemoved.addListener((tabId) => {
  tabStates.delete(tabId);
});
