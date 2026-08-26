import { detectPage } from './detector';
import { runInteraction, setPageSnapshot } from './interaction/engine';
import {
  FORM_DETECTED_MESSAGE,
  GET_DETECTION_MESSAGE,
  INTERACT_MESSAGE,
  SCAN_PAGE_MESSAGE,
  type FormDetectedMessage,
  type FormPage,
  type GetDetectionMessage,
  type InteractMessage,
  type InteractionRequest,
  type InteractionResult,
  type ScanPageMessage,
} from '../shared/types';

let lastResult: FormPage | null = null;
let pendingHandle: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 250;

function captureResult(): FormPage {
  const result = detectPage();
  lastResult = result;
  setPageSnapshot(result);
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

function isValidInteractionRequest(msg: unknown): msg is InteractMessage {
  if (!msg || typeof msg !== 'object') return false;
  const m = msg as { type?: unknown; payload?: unknown };
  if (m.type !== INTERACT_MESSAGE) return false;
  return typeof m.payload === 'object' && m.payload !== null;
}

const DEMO_REQUEST_EVENT = 'AFA_DEMO_REQUEST';
const DEMO_RESPONSE_EVENT = 'AFA_DEMO_RESPONSE';

interface DemoResponseDetail {
  ok: boolean;
  result?: InteractionResult;
  error?: string;
}

function installDemoApi(): void {
  window.addEventListener(DEMO_REQUEST_EVENT, async (ev) => {
    const event = ev as CustomEvent<{ id: string; payload: InteractionRequest }>;
    const detail = event.detail;
    if (!detail || !detail.payload) return;
    const id = detail.id;
    let result: InteractionResult;
    try {
      result = await runInteraction(detail.payload);
    } catch (err) {
      result = {
        success: false,
        reason: 'engine threw: ' + (err instanceof Error ? err.message : String(err)),
        stableId: detail.payload.stableId,
        kind: detail.payload.kind,
        retried: false,
      };
    }
    try {
      const rescan = captureResult();
      broadcast(rescan);
    } catch {
    }
    const response = new CustomEvent<DemoResponseDetail>(DEMO_RESPONSE_EVENT, {
      detail: { ok: result.success, result },
    });
    (response as CustomEvent<DemoResponseDetail> & { __afaId?: string }).__afaId = id;
    window.dispatchEvent(response);
  });

  const w = window as unknown as {
    __AFA_INTERACT__?: (msg: { type: typeof INTERACT_MESSAGE; payload: InteractionRequest }) => Promise<InteractionResult>;
  };
  w.__AFA_INTERACT__ = function interact(msg) {
    return new Promise((resolve, reject) => {
      const id = Math.random().toString(36).slice(2);
      const handler = (ev: Event) => {
        const e = ev as CustomEvent<DemoResponseDetail> & { __afaId?: string };
        if (e.__afaId !== id) return;
        window.removeEventListener(DEMO_RESPONSE_EVENT, handler);
        if (!e.detail.ok || !e.detail.result) {
          reject(new Error(e.detail.error ?? 'engine returned failure'));
          return;
        }
        resolve(e.detail.result);
      };
      window.addEventListener(DEMO_RESPONSE_EVENT, handler);
      const req = new CustomEvent(DEMO_REQUEST_EVENT, {
        detail: { id, payload: msg.payload },
      });
      window.dispatchEvent(req);
      setTimeout(() => {
        window.removeEventListener(DEMO_RESPONSE_EVENT, handler);
        reject(new Error('demo interact timed out'));
      }, 5000);
    });
  };
}

// C1 fix: Only install the demo API in development builds.
// In production, no host-page-accessible execution API is exposed.
if (false) {
  installDemoApi();
}

chrome.runtime.onMessage.addListener((message: ScanPageMessage | GetDetectionMessage | InteractMessage, _sender, sendResponse) => {
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

  if (isValidInteractionRequest(message)) {
    runInteraction(message.payload as InteractionRequest)
      .then((result) => {
        try {
          const rescan = captureResult();
          broadcast(rescan);
        } catch {
        }
        sendResponse({ ok: true, result });
      })
      .catch((err) => {
        const req = message.payload as { stableId?: string; kind?: string };
        try {
          const rescan = captureResult();
          broadcast(rescan);
        } catch {
        }
        sendResponse({
          ok: true,
          result: {
            success: false,
            reason: 'engine threw: ' + (err instanceof Error ? err.message : String(err)),
            stableId: req.stableId ?? '',
            kind: (req.kind as InteractionRequest['kind']) ?? 'set-text',
            retried: false,
          },
        });
      });
    return true;
  }

  return false;
});

export {};
