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
import {
  PROFILE_LIST,
  PROFILE_GET,
  PROFILE_SAVE,
  PROFILE_DELETE,
  BOT_START,
  BOT_STOP,
  BOT_STATUS,
  type ProfileMessage,
  type ProfileListResponse,
  type ProfileGetResponse,
  type ProfileSaveResponse,
  type ProfileDeleteResponse,
  type BotStartResponse,
  type BotStopResponse,
  type BotStatusSnapshot,
  type BotStatusMessage,
} from '../shared/profile-messages';
import type { JsonProfile, ProfileListEntry } from '../shared/profile';

const statusEl = document.getElementById('status') as HTMLDivElement;
const countEl = document.getElementById('count') as HTMLSpanElement;
const formCountEl = document.getElementById('form-count') as HTMLSpanElement;
const urlEl = document.getElementById('url') as HTMLSpanElement;
const detectedAtEl = document.getElementById('detected-at') as HTMLSpanElement;
const typeListEl = document.getElementById('type-list') as HTMLUListElement;
const formsEl = document.getElementById('forms-container') as HTMLDivElement;
const scanBtn = document.getElementById('scan-btn') as HTMLButtonElement;

const profileSelectEl = document.getElementById('profile-select') as HTMLSelectElement;
const profileReloadBtn = document.getElementById('profile-reload-btn') as HTMLButtonElement;
const profileFileInputEl = document.getElementById('profile-file-input') as HTMLInputElement;
const profileSaveBtn = document.getElementById('profile-save-btn') as HTMLButtonElement;
const profileDeleteBtn = document.getElementById('profile-delete-btn') as HTMLButtonElement;
const profileStatusEl = document.getElementById('profile-status') as HTMLDivElement;

const botStartBtn = document.getElementById('bot-start-btn') as HTMLButtonElement;
const botStopBtn = document.getElementById('bot-stop-btn') as HTMLButtonElement;
const botStatusEl = document.getElementById('bot-status') as HTMLDivElement;
const botCurrentEl = document.getElementById('bot-current') as HTMLSpanElement;
const botReasonEl = document.getElementById('bot-reason') as HTMLSpanElement;
const botCompletedEl = document.getElementById('bot-completed') as HTMLSpanElement;
const botSkippedEl = document.getElementById('bot-skipped') as HTMLSpanElement;
const botFailedEl = document.getElementById('bot-failed') as HTMLSpanElement;
const botTotalEl = document.getElementById('bot-total') as HTMLSpanElement;

function setStatus(text: string): void {
  statusEl.textContent = text;
}

function setProfileStatus(text: string, isError: boolean = false): void {
  profileStatusEl.textContent = text;
  profileStatusEl.classList.toggle('error', isError);
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

chrome.runtime.onMessage.addListener((message: FormDetectedMessage | BotStatusMessage) => {
  if (!message || typeof message !== 'object') return;
  if (message.type === FORM_DETECTED_MESSAGE) {
    render(message.payload);
    return;
  }
  if (message.type === BOT_STATUS) {
    renderBotStatus(message.snapshot);
    return;
  }
});

// ---------- Profile UI ----------

function sendProfile<TResp>(msg: ProfileMessage): Promise<TResp> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(msg, (response: TResp) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message ?? 'profile message failed'));
          return;
        }
        resolve(response);
      });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

let cachedProfileList: ProfileListEntry[] = [];
let currentProfile: JsonProfile | null = null;
let currentProfileName: string | null = null;

function renderProfileSelect(): void {
  profileSelectEl.innerHTML = '';
  if (cachedProfileList.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '(no profiles)';
    profileSelectEl.appendChild(opt);
    profileSelectEl.disabled = true;
    return;
  }
  profileSelectEl.disabled = false;
  for (const p of cachedProfileList) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    profileSelectEl.appendChild(opt);
  }
  if (currentProfileName) {
    const match = Array.from(profileSelectEl.options).find(
      (o) => o.textContent === currentProfileName,
    );
    if (match) profileSelectEl.value = match.value;
  }
}

async function loadProfileList(): Promise<void> {
  setProfileStatus('Loading profiles...');
  try {
    const res = await sendProfile<ProfileListResponse>({ type: PROFILE_LIST });
    if (!res.ok || !res.result || !Array.isArray(res.result)) {
      setProfileStatus(res.error ?? 'Failed to load profiles.', true);
      cachedProfileList = [];
      renderProfileSelect();
      return;
    }
    cachedProfileList = res.result;
    renderProfileSelect();
    setProfileStatus(
      `${cachedProfileList.length} profile(s). Load or save a JSON file to begin.`,
    );
  } catch (err) {
    setProfileStatus(err instanceof Error ? err.message : String(err), true);
  }
}

async function loadSelectedProfile(): Promise<void> {
  const id = profileSelectEl.value;
  if (!id) {
    currentProfile = null;
    currentProfileName = null;
    setProfileStatus('No profile selected.', true);
    return;
  }
  setProfileStatus('Loading profile...');
  try {
    const res = await sendProfile<ProfileGetResponse>({ type: PROFILE_GET, id });
    if (!res.ok || !res.result) {
      setProfileStatus(res.error ?? 'Failed to load profile.', true);
      return;
    }
    const entry = res.result;
    currentProfile = entry.profile;
    currentProfileName = entry.name;
    const keys = Object.keys(currentProfile ?? {}).length;
    setProfileStatus(`Loaded "${entry.name}" (${keys} key(s)).`);
  } catch (err) {
    setProfileStatus(err instanceof Error ? err.message : String(err), true);
  }
}

function isPlainJsonProfile(v: unknown): v is JsonProfile {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  return true;
}

function readProfileFile(file: File): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result ?? '');
        const parsed = JSON.parse(text) as unknown;
        resolve(parsed);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    };
    reader.onerror = () => reject(new Error('failed to read file'));
    reader.readAsText(file);
  });
}

async function onLoadJsonFile(): Promise<void> {
  const file = profileFileInputEl.files?.[0];
  if (!file) return;
  setProfileStatus('Reading file...');
  try {
    const parsed = await readProfileFile(file);
    if (!isPlainJsonProfile(parsed)) {
      setProfileStatus('File must contain a JSON object at the top level.', true);
      return;
    }
    const baseName = file.name.replace(/\.json$/i, '');
    const name = baseName || 'Loaded profile';
    const res = await sendProfile<ProfileSaveResponse>({
      type: PROFILE_SAVE,
      name,
      profile: parsed,
    });
    if (!res.ok || !res.result) {
      setProfileStatus(res.error ?? 'Failed to save profile.', true);
      return;
    }
    const entry = res.result;
    currentProfile = entry.profile;
    currentProfileName = entry.name;
    await loadProfileList();
    setProfileStatus(`Saved "${entry.name}" (${Object.keys(parsed).length} key(s)).`);
  } catch (err) {
    setProfileStatus(err instanceof Error ? err.message : String(err), true);
  } finally {
    profileFileInputEl.value = '';
  }
}

async function onSaveCurrent(): Promise<void> {
  if (!currentProfile) {
    setProfileStatus('Nothing to save. Load a JSON file or select a profile first.', true);
    return;
  }
  const name = currentProfileName ?? 'Untitled profile';
  setProfileStatus('Saving...');
  try {
    const res = await sendProfile<ProfileSaveResponse>({
      type: PROFILE_SAVE,
      name,
      profile: currentProfile,
    });
    if (!res.ok || !res.result) {
      setProfileStatus(res.error ?? 'Failed to save profile.', true);
      return;
    }
    const entry = res.result;
    await loadProfileList();
    setProfileStatus(`Saved "${entry.name}".`);
  } catch (err) {
    setProfileStatus(err instanceof Error ? err.message : String(err), true);
  }
}

async function onDeleteSelected(): Promise<void> {
  const id = profileSelectEl.value;
  if (!id) {
    setProfileStatus('No profile selected to delete.', true);
    return;
  }
  setProfileStatus('Deleting...');
  try {
    const res = await sendProfile<ProfileDeleteResponse>({ type: PROFILE_DELETE, id });
    if (!res.ok) {
      setProfileStatus(res.error ?? 'Failed to delete profile.', true);
      return;
    }
    currentProfile = null;
    currentProfileName = null;
    await loadProfileList();
    setProfileStatus('Profile deleted.');
  } catch (err) {
    setProfileStatus(err instanceof Error ? err.message : String(err), true);
  }
}

profileReloadBtn.addEventListener('click', () => void loadProfileList());
profileSelectEl.addEventListener('change', () => void loadSelectedProfile());
profileFileInputEl.addEventListener('change', () => void onLoadJsonFile());
profileSaveBtn.addEventListener('click', () => void onSaveCurrent());
profileDeleteBtn.addEventListener('click', () => void onDeleteSelected());

// ---------- Bot UI ----------

function setBotButtons(running: boolean): void {
  botStartBtn.disabled = running;
  botStopBtn.disabled = !running;
}

function renderBotStatus(snapshot: BotStatusSnapshot | null): void {
  if (!snapshot) {
    botStatusEl.textContent = 'Idle.';
    botStatusEl.className = 'bot-status';
    botCurrentEl.textContent = '-';
    botReasonEl.textContent = '-';
    botCompletedEl.textContent = '0';
    botSkippedEl.textContent = '0';
    botFailedEl.textContent = '0';
    botTotalEl.textContent = '0';
    setBotButtons(false);
    return;
  }

  botStatusEl.classList.remove('error', 'running', 'done', 'stopped');
  let label: string;
  switch (snapshot.status) {
    case 'idle':
      label = 'Idle.';
      break;
    case 'running':
      label = 'Running...';
      botStatusEl.classList.add('running');
      break;
    case 'stopped':
      label = 'Stopped.';
      botStatusEl.classList.add('stopped');
      break;
    case 'done':
      label = 'Done.';
      botStatusEl.classList.add('done');
      break;
    case 'error':
      label = snapshot.lastError ? `Error: ${snapshot.lastError}` : 'Error.';
      botStatusEl.classList.add('error');
      break;
  }
  botStatusEl.textContent = label;

  botCurrentEl.textContent = snapshot.currentField?.label ?? '-';
  botReasonEl.textContent = snapshot.currentField?.reason ?? '-';
  botCompletedEl.textContent = String(snapshot.counters.completed);
  botSkippedEl.textContent = String(snapshot.counters.skipped);
  botFailedEl.textContent = String(snapshot.counters.failed);
  botTotalEl.textContent = String(snapshot.counters.total);

  setBotButtons(snapshot.status === 'running');
}

async function onStartBot(): Promise<void> {
  const id = profileSelectEl.value;
  if (!id) {
    setProfileStatus('Select a profile before starting the bot.', true);
    return;
  }
  const tabId = await getActiveTabId();
  if (tabId == null) {
    setStatus('No active tab.');
    return;
  }
  botStartBtn.disabled = true;
  try {
    const res = await sendProfile<BotStartResponse>({
      type: BOT_START,
      tabId,
      profileId: id,
    });
    if (!res.ok || !res.result) {
      setProfileStatus(res.error ?? 'Failed to start bot.', true);
      setBotButtons(false);
      return;
    }
    renderBotStatus(res.result);
  } catch (err) {
    setProfileStatus(err instanceof Error ? err.message : String(err), true);
    setBotButtons(false);
  }
}

async function onStopBot(): Promise<void> {
  const tabId = await getActiveTabId();
  if (tabId == null) return;
  try {
    const res = await sendProfile<BotStopResponse>({ type: BOT_STOP, tabId });
    if (!res.ok || !res.result) {
      setProfileStatus(res.error ?? 'Failed to stop bot.', true);
      return;
    }
    renderBotStatus(res.result);
  } catch (err) {
    setProfileStatus(err instanceof Error ? err.message : String(err), true);
  }
}

botStartBtn.addEventListener('click', () => void onStartBot());
botStopBtn.addEventListener('click', () => void onStopBot());

renderBotStatus(null);
void loadFromTab();
void loadProfileList();
