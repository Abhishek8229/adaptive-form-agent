import {
  FORM_DETECTED_MESSAGE,
  GET_DETECTION_MESSAGE,
  SCAN_PAGE_MESSAGE,
  type FormDetectedMessage,
  type FormField,
  type FormGroup,
  type FormPage,
  type GetDetectionMessage,
  type ScanPageMessage,
} from '../shared/types';

const statusEl = document.getElementById('status') as HTMLDivElement;
const countEl = document.getElementById('count') as HTMLSpanElement;
const formCountEl = document.getElementById('form-count') as HTMLSpanElement;
const urlEl = document.getElementById('url') as HTMLSpanElement;
const detectedAtEl = document.getElementById('detected-at') as HTMLSpanElement;
const typeListEl = document.getElementById('type-list') as HTMLUListElement;
const formsEl = document.getElementById('forms-container') as HTMLDivElement;
const scanBtn = document.getElementById('scan-btn') as HTMLButtonElement;

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function summarizeTypeCounts(groups: FormGroup[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const g of groups) {
    for (const f of g.fields) {
      counts.set(f.controlType, (counts.get(f.controlType) ?? 0) + 1);
    }
  }
  return counts;
}

function renderTypeList(groups: FormGroup[]): void {
  const counts = summarizeTypeCounts(groups);
  typeListEl.innerHTML = '';
  const sorted = Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  if (sorted.length === 0) {
    const li = document.createElement('li');
    li.textContent = '(no controls)';
    typeListEl.appendChild(li);
    return;
  }
  for (const [type, n] of sorted) {
    const li = document.createElement('li');
    li.textContent = `${type}: ${n}`;
    typeListEl.appendChild(li);
  }
}

function renderField(li: HTMLLIElement, f: FormField): void {
  const label = f.label || f.ariaLabel || f.placeholder || f.name || f.id || '(no label)';
  const tag = `${f.tag}${f.type ? `[${f.type}]` : ''}`;
  const flags: string[] = [];
  if (f.required) flags.push('required');
  if (f.disabled) flags.push('disabled');
  if (f.readOnly) flags.push('readonly');
  if (!f.visible) flags.push('hidden');

  li.className = '';
  if (!f.visible) li.classList.add('invisible');
  if (f.disabled) li.classList.add('disabled');

  const labelEl = document.createElement('span');
  labelEl.className = 'label-text';
  labelEl.textContent = label;

  const tagEl = document.createElement('span');
  tagEl.className = 'field-tag';
  tagEl.textContent = ` ${tag}`;

  const hintEl = document.createElement('span');
  hintEl.className = 'hint';
  hintEl.textContent = f.semanticHint !== 'unknown' ? ` \u2192 ${f.semanticHint}` : '';

  li.appendChild(labelEl);
  li.appendChild(tagEl);
  li.appendChild(hintEl);

  if (flags.length > 0) {
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = ` (${flags.join(', ')})`;
    li.appendChild(meta);
  }
}

function renderGroup(group: FormGroup): HTMLDivElement {
  const card = document.createElement('div');
  card.className = 'form-card';

  const head = document.createElement('div');
  head.className = 'head';

  const kindEl = document.createElement('span');
  kindEl.className = 'kind';
  kindEl.textContent = group.metadata.kind;

  const countElSpan = document.createElement('span');
  countElSpan.className = 'meta';
  countElSpan.textContent = `${group.fields.length} field(s), ${group.submitControls.length} submit(s)`;

  head.appendChild(kindEl);
  head.appendChild(countElSpan);
  card.appendChild(head);

  const title = group.metadata.labelText || group.metadata.name || group.metadata.stableId;
  const titleEl = document.createElement('div');
  titleEl.className = 'label-text';
  titleEl.textContent = title;
  card.appendChild(titleEl);

  if (group.metadata.action || group.metadata.method) {
    const routeEl = document.createElement('div');
    routeEl.className = 'meta';
    routeEl.textContent = `${group.metadata.method.toUpperCase()} ${group.metadata.action || '(current url)'}`;
    card.appendChild(routeEl);
  }

  if (group.fields.length > 0) {
    const ul = document.createElement('ul');
    ul.className = 'fields';
    for (const f of group.fields) {
      const li = document.createElement('li');
      renderField(li, f);
      ul.appendChild(li);
    }
    card.appendChild(ul);
  }

  if (group.submitControls.length > 0) {
    const submitMeta = document.createElement('div');
    submitMeta.className = 'meta';
    const labels = group.submitControls
      .map((s) => s.text || s.ariaLabel || s.type)
      .filter(Boolean);
    submitMeta.textContent = `Submit: ${labels.join(', ') || '(none)'}`;
    card.appendChild(submitMeta);
  }

  return card;
}

function renderForms(groups: FormGroup[]): void {
  formsEl.innerHTML = '';
  if (groups.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'meta';
    empty.textContent = 'No forms detected.';
    formsEl.appendChild(empty);
    return;
  }
  for (const g of groups) {
    formsEl.appendChild(renderGroup(g));
  }
}

function render(payload: FormPage | null): void {
  if (!payload) {
    setStatus('No detection yet. Click "Scan current page".');
    countEl.textContent = '0';
    formCountEl.textContent = '0';
    urlEl.textContent = '-';
    detectedAtEl.textContent = '-';
    typeListEl.innerHTML = '';
    formsEl.innerHTML = '';
    return;
  }

  setStatus(`Detected ${payload.totalFieldCount} field(s) in ${payload.formCount} form(s).`);
  countEl.textContent = String(payload.totalFieldCount);
  formCountEl.textContent = String(payload.formCount);
  urlEl.textContent = payload.url;
  urlEl.title = payload.url;
  detectedAtEl.textContent = payload.detectedAt;

  renderTypeList(payload.forms);
  renderForms(payload.forms);
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
    const res = response as { ok: boolean; result: FormPage | null } | undefined;
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
    const res = response as { ok: boolean; count: number; formCount: number } | undefined;
    if (res?.ok) {
      setStatus(`Scan complete (${res.count} fields in ${res.formCount} forms).`);
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
