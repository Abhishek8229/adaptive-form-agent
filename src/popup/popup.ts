import {
  FORM_DETECTED_MESSAGE,
  GET_DETECTION_MESSAGE,
  SCAN_PAGE_MESSAGE,
  type FormDetectedMessage,
  type GetDetectionMessage,
  type ScanPageMessage,
} from '../shared/types';

const statusEl = document.getElementById('status') as HTMLDivElement;
const countEl = document.getElementById('count') as HTMLSpanElement;
const urlEl = document.getElementById('url') as HTMLSpanElement;
const detectedAtEl = document.getElementById('detected-at') as HTMLSpanElement;
const typeListEl = document.getElementById('type-list') as HTMLUListElement;
const scanBtn = document.getElementById('scan-btn') as HTMLButtonElement;

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function render(payload: FormDetectedMessage['payload'] | null): void {
  if (!payload) {
    setStatus('No detection yet. Click "Scan current page".');
    countEl.textContent = '0';
    urlEl.textContent = '-';
    detectedAtEl.textContent = '-';
    typeListEl.innerHTML = '';
    return;
  }

  setStatus(`Detected ${payload.controls.length} control(s).`);
  countEl.textContent = String(payload.controls.length);
  urlEl.textContent = payload.url;
  urlEl.title = payload.url;
  detectedAtEl.textContent = payload.detectedAt;

  const counts = new Map<string, number>();
  for (const c of payload.controls) {
    counts.set(c.controlType, (counts.get(c.controlType) ?? 0) + 1);
  }
  typeListEl.innerHTML = '';
  const sorted = Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  for (const [type, n] of sorted) {
    const li = document.createElement('li');
    li.textContent = `${type}: ${n}`;
    typeListEl.appendChild(li);
  }
}

async function getActiveTabId(): Promise<number | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id ?? null;
}

async function loadFromTab(): Promise<void> {
  const tabId = await getActiveTabId();
  if (tabId == null) {
    setStatus('No active tab.');
    return;
  }
  const message: GetDetectionMessage = { type: GET_DETECTION_MESSAGE };
  chrome.tabs.sendMessage(tabId, message, (response) => {
    if (chrome.runtime.lastError) {
      setStatus('Content script not active on this page.');
      render(null);
      return;
    }
    const res = response as { ok: boolean; result: FormDetectedMessage['payload'] | null } | undefined;
    if (!res || !res.ok) {
      setStatus('No detection available yet.');
      render(null);
      return;
    }
    render(res.result);
  });
}

scanBtn.addEventListener('click', async () => {
  const tabId = await getActiveTabId();
  if (tabId == null) {
    setStatus('No active tab.');
    return;
  }
  setStatus('Scanning...');
  const message: ScanPageMessage = { type: SCAN_PAGE_MESSAGE };
  chrome.tabs.sendMessage(tabId, message, (response) => {
    if (chrome.runtime.lastError) {
      setStatus('Content script not active on this page.');
      render(null);
      return;
    }
    const res = response as { ok: boolean; count: number } | undefined;
    if (res?.ok) {
      setStatus(`Scan complete (${res.count} controls).`);
    }
    void loadFromTab();
  });
});

chrome.runtime.onMessage.addListener((message: FormDetectedMessage) => {
  if (message?.type === FORM_DETECTED_MESSAGE) {
    render(message.payload);
  }
});

void loadFromTab();
