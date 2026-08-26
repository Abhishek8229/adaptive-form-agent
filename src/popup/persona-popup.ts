/**
 * Popup persona UI. Talks to the service worker via typed
 * PersonaMessage envelopes. Never constructs a PersonaStore directly
 * and never holds a raw PersonaProfile — only PersonaProjections.
 */

import {
  PERSONA_GET_PROJECTION,
  PERSONA_ADD_FACT,
  PERSONA_UPDATE_FACT,
  PERSONA_REMOVE_FACT,
  PERSONA_ADD_PLAN,
  PERSONA_UPDATE_PLAN,
  PERSONA_REMOVE_PLAN,
  PERSONA_UPDATE_IDENTITY,
  PERSONA_LOAD_EXAMPLES,
  PERSONA_CLEAR,
  type PersonaMessage,
  type PersonaMessageResponse,
} from '../shared/persona-messages';
import type {
  Fact,
  FactStatus,
  PersonaProjection,
  Plan,
  PlanStatus,
  PlanHorizon,
} from '../shared/persona';

const els = {
  reloadBtn: required<HTMLButtonElement>('persona-reload-btn'),
  examplesBtn: required<HTMLButtonElement>('persona-examples-btn'),
  clearBtn: required<HTMLButtonElement>('persona-clear-btn'),
  status: required<HTMLDivElement>('persona-status'),
  identity: required<HTMLDivElement>('persona-identity'),
  factsList: required<HTMLUListElement>('persona-facts'),
  plansList: required<HTMLUListElement>('persona-plans'),
  preferencesList: required<HTMLUListElement>('persona-preferences'),
  experiencesList: required<HTMLUListElement>('persona-experiences'),

  factId: required<HTMLInputElement>('fact-id'),
  factCategory: required<HTMLInputElement>('fact-category'),
  factSubject: required<HTMLInputElement>('fact-subject'),
  factPredicate: required<HTMLInputElement>('fact-predicate'),
  factStatus: required<HTMLSelectElement>('fact-status'),
  factAddBtn: required<HTMLButtonElement>('fact-add-btn'),

  planId: required<HTMLInputElement>('plan-id'),
  planCategory: required<HTMLInputElement>('plan-category'),
  planSubject: required<HTMLInputElement>('plan-subject'),
  planPredicate: required<HTMLInputElement>('plan-predicate'),
  planStatus: required<HTMLSelectElement>('plan-status'),
  planHorizon: required<HTMLSelectElement>('plan-horizon'),
  planAddBtn: required<HTMLButtonElement>('plan-add-btn'),
};

function required<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing popup element #${id}`);
  return el as T;
}

let cachedProjection: PersonaProjection | null = null;

// ---------- chrome.runtime bridge ----------

function sendPersona<TResp = PersonaMessageResponse>(msg: PersonaMessage): Promise<TResp> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(msg, (response: TResp) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message ?? 'persona message failed'));
          return;
        }
        resolve(response);
      });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

async function callPersona(msg: PersonaMessage): Promise<PersonaProjection> {
  const res = await sendPersona<PersonaMessageResponse>(msg);
  if (!res.ok) {
    throw new Error(res.error ?? 'persona message returned failure');
  }
  if (!res.result) throw new Error('persona message returned empty result');
  return res.result;
}

// ---------- render ----------

function setStatus(text: string, isError: boolean = false): void {
  els.status.textContent = text;
  els.status.classList.toggle('error', isError);
}

function renderIdentity(projection: PersonaProjection): void {
  const id = projection.identity ?? {};
  const fields: Array<[string, string | undefined]> = [
    ['preferredName', id.preferredName],
    ['fullName', id.fullName],
    ['email', id.email],
    ['phone', id.phone],
    ['dateOfBirth', id.dateOfBirth],
    ['locale', id.locale],
    ['country', id.country],
    ['pronouns', id.pronouns],
  ];
  const present = fields.filter(([, v]) => typeof v === 'string' && v.length > 0);
  if (present.length === 0) {
    els.identity.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '(no identity set)';
    els.identity.appendChild(empty);
    return;
  }
  els.identity.innerHTML = '';
  for (const [k, v] of present) {
    const row = document.createElement('div');
    row.className = 'kv';
    const kEl = document.createElement('span');
    kEl.className = 'k';
    kEl.textContent = k;
    const vEl = document.createElement('span');
    vEl.className = 'v';
    vEl.textContent = v ?? '';
    row.appendChild(kEl);
    row.appendChild(vEl);
    els.identity.appendChild(row);
  }
}

function renderFact(li: HTMLLIElement, f: Fact): void {
  li.innerHTML = '';
  const row1 = document.createElement('div');
  row1.className = 'row1';
  const idEl = document.createElement('span');
  idEl.className = 'id';
  idEl.textContent = f.id;
  row1.appendChild(idEl);
  li.appendChild(row1);

  const row1b = document.createElement('div');
  row1b.className = 'row1';
  const subject = document.createElement('span');
  subject.className = 'subject';
  subject.textContent = f.subject;
  const predicate = document.createElement('span');
  predicate.className = 'predicate';
  predicate.textContent = f.predicate;
  const category = document.createElement('span');
  category.className = 'meta';
  category.textContent = f.category;
  row1b.appendChild(subject);
  row1b.appendChild(predicate);
  row1b.appendChild(category);
  li.appendChild(row1b);

  const row2 = document.createElement('div');
  row2.className = 'row2';
  const statusBadge = document.createElement('span');
  statusBadge.className = `badge status-${f.status}`;
  statusBadge.textContent = f.status;
  row2.appendChild(statusBadge);
  if (f.value?.since || f.value?.text || f.value?.quantity != null) {
    const valueMeta = document.createElement('span');
    valueMeta.className = 'meta';
    const parts: string[] = [];
    if (f.value.since) parts.push(`since ${f.value.since}`);
    if (f.value.until) parts.push(`until ${f.value.until}`);
    if (f.value.text) parts.push(f.value.text);
    if (f.value.quantity != null) {
      parts.push(f.value.unit ? `${f.value.quantity} ${f.value.unit}` : String(f.value.quantity));
    }
    valueMeta.textContent = parts.join(' \u00b7 ');
    row2.appendChild(valueMeta);
  }
  if (f.tags && f.tags.length > 0) {
    const tags = document.createElement('span');
    tags.className = 'tags';
    tags.textContent = `tags: ${f.tags.join(', ')}`;
    row2.appendChild(tags);
  }
  const controls = document.createElement('span');
  controls.className = 'controls';
  // Cycle status button.
  const cycle = document.createElement('button');
  cycle.type = 'button';
  cycle.textContent = 'cycle status';
  cycle.title = 'true -> false -> unknown -> true';
  cycle.addEventListener('click', () => void cycleFactStatus(f.id, f.status));
  controls.appendChild(cycle);
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = 'remove';
  remove.addEventListener('click', () => void removeFact(f.id));
  controls.appendChild(remove);
  row2.appendChild(controls);
  li.appendChild(row2);
}

function renderPlan(li: HTMLLIElement, p: Plan): void {
  li.innerHTML = '';
  const row1 = document.createElement('div');
  row1.className = 'row1';
  const idEl = document.createElement('span');
  idEl.className = 'id';
  idEl.textContent = p.id;
  row1.appendChild(idEl);
  li.appendChild(row1);

  const row1b = document.createElement('div');
  row1b.className = 'row1';
  const subject = document.createElement('span');
  subject.className = 'subject';
  subject.textContent = p.subject;
  const predicate = document.createElement('span');
  predicate.className = 'predicate';
  predicate.textContent = p.predicate;
  const category = document.createElement('span');
  category.className = 'meta';
  category.textContent = p.category;
  row1b.appendChild(subject);
  row1b.appendChild(predicate);
  row1b.appendChild(category);
  li.appendChild(row1b);

  const row2 = document.createElement('div');
  row2.className = 'row2';
  const statusBadge = document.createElement('span');
  statusBadge.className = `badge status-${p.status}`;
  statusBadge.textContent = p.status;
  row2.appendChild(statusBadge);
  const horizon = document.createElement('span');
  horizon.className = 'horizon';
  horizon.textContent = p.horizon;
  row2.appendChild(horizon);
  if (p.tags && p.tags.length > 0) {
    const tags = document.createElement('span');
    tags.className = 'tags';
    tags.textContent = `tags: ${p.tags.join(', ')}`;
    row2.appendChild(tags);
  }
  const controls = document.createElement('span');
  controls.className = 'controls';
  const cycle = document.createElement('button');
  cycle.type = 'button';
  cycle.textContent = 'cycle status';
  cycle.addEventListener('click', () => void cyclePlanStatus(p.id, p.status));
  controls.appendChild(cycle);
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.textContent = 'remove';
  remove.addEventListener('click', () => void removePlan(p.id));
  controls.appendChild(remove);
  row2.appendChild(controls);
  li.appendChild(row2);
}

function renderFacts(projection: PersonaProjection): void {
  els.factsList.innerHTML = '';
  if (projection.facts.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = '(no facts yet)';
    els.factsList.appendChild(empty);
    return;
  }
  for (const f of projection.facts) {
    const li = document.createElement('li');
    renderFact(li, f);
    els.factsList.appendChild(li);
  }
}

function renderPlans(projection: PersonaProjection): void {
  els.plansList.innerHTML = '';
  if (projection.plans.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = '(no plans yet)';
    els.plansList.appendChild(empty);
    return;
  }
  for (const p of projection.plans) {
    const li = document.createElement('li');
    renderPlan(li, p);
    els.plansList.appendChild(li);
  }
}

function renderReadOnlyList(
  list: HTMLUListElement,
  rows: Array<{ id: string; primary: string; secondary: string; meta: string[] }>,
  emptyText: string,
): void {
  list.innerHTML = '';
  if (rows.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'empty';
    empty.textContent = emptyText;
    list.appendChild(empty);
    return;
  }
  for (const r of rows) {
    const li = document.createElement('li');
    const id = document.createElement('div');
    id.className = 'id';
    id.textContent = r.id;
    const primary = document.createElement('div');
    primary.className = 'row1';
    const subj = document.createElement('span');
    subj.className = 'subject';
    subj.textContent = r.primary;
    primary.appendChild(subj);
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = r.secondary;
    primary.appendChild(meta);
    li.appendChild(id);
    li.appendChild(primary);
    if (r.meta.length > 0) {
      const tags = document.createElement('div');
      tags.className = 'tags';
      tags.textContent = r.meta.join(' \u00b7 ');
      li.appendChild(tags);
    }
    list.appendChild(li);
  }
}

function renderPreferences(projection: PersonaProjection): void {
  renderReadOnlyList(
    els.preferencesList,
    projection.preferences.map((p) => ({
      id: p.id,
      primary: p.subject,
      secondary: `${p.value} (${p.strength})`,
      meta: [p.category, ...(p.tags ?? [])],
    })),
    '(no preferences yet)',
  );
}

function renderExperiences(projection: PersonaProjection): void {
  renderReadOnlyList(
    els.experiencesList,
    projection.experiences.map((e) => ({
      id: e.id,
      primary: e.subject,
      secondary: e.description,
      meta: [e.category, e.occurredAt ?? '', ...(e.tags ?? [])].filter(Boolean),
    })),
    '(no experiences yet)',
  );
}

function render(projection: PersonaProjection): void {
  cachedProjection = projection;
  renderIdentity(projection);
  renderFacts(projection);
  renderPlans(projection);
  renderPreferences(projection);
  renderExperiences(projection);
}

// ---------- actions ----------

async function reload(): Promise<void> {
  setStatus('Loading...');
  try {
    const projection = await callPersona({
      type: PERSONA_GET_PROJECTION,
      query: {
        include: { identity: true, facts: true, plans: true, preferences: true, experiences: true },
      },
    });
    render(projection);
    setStatus(
      `${projection.facts.length} fact(s), ${projection.plans.length} plan(s), ` +
        `${projection.preferences.length} preference(s), ${projection.experiences.length} experience(s)`,
    );
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), true);
  }
}

async function loadExamples(): Promise<void> {
  setStatus('Loading examples...');
  try {
    const projection = await callPersona({ type: PERSONA_LOAD_EXAMPLES });
    render(projection);
    setStatus('Examples loaded.');
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), true);
  }
}

async function clearAll(): Promise<void> {
  setStatus('Clearing...');
  try {
    const projection = await callPersona({ type: PERSONA_CLEAR });
    render(projection);
    setStatus('Cleared.');
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), true);
  }
}

async function addFactFromForm(): Promise<void> {
  const id = els.factId.value.trim();
  const category = els.factCategory.value.trim();
  const subject = els.factSubject.value.trim();
  const predicate = els.factPredicate.value.trim();
  const status = els.factStatus.value as FactStatus;
  if (!id || !category || !subject || !predicate) {
    setStatus('Fact requires id, category, subject, predicate.', true);
    return;
  }
  const fact: Fact = {
    id,
    category,
    subject,
    predicate,
    status,
    provenance: {
      source: { kind: 'user-explicit', recordedAt: new Date().toISOString() },
      confidence: 'high',
    },
  };
  setStatus('Adding fact...');
  try {
    const projection = await callPersona({ type: PERSONA_ADD_FACT, fact });
    render(projection);
    setStatus(`Added ${id}.`);
    els.factId.value = '';
    els.factCategory.value = '';
    els.factSubject.value = '';
    els.factPredicate.value = '';
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), true);
  }
}

async function addPlanFromForm(): Promise<void> {
  const id = els.planId.value.trim();
  const category = els.planCategory.value.trim();
  const subject = els.planSubject.value.trim();
  const predicate = els.planPredicate.value.trim();
  const status = els.planStatus.value as PlanStatus;
  const horizon = els.planHorizon.value as PlanHorizon;
  if (!id || !category || !subject || !predicate) {
    setStatus('Plan requires id, category, subject, predicate.', true);
    return;
  }
  const plan: Plan = {
    id,
    category,
    subject,
    predicate,
    status,
    horizon,
    provenance: {
      source: { kind: 'user-explicit', recordedAt: new Date().toISOString() },
      confidence: 'high',
    },
  };
  setStatus('Adding plan...');
  try {
    const projection = await callPersona({ type: PERSONA_ADD_PLAN, plan });
    render(projection);
    setStatus(`Added ${id}.`);
    els.planId.value = '';
    els.planCategory.value = '';
    els.planSubject.value = '';
    els.planPredicate.value = '';
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), true);
  }
}

const STATUS_CYCLE: Record<FactStatus, FactStatus> = {
  true: 'false',
  false: 'unknown',
  unknown: 'true',
};

const PLAN_STATUS_CYCLE: Record<PlanStatus, PlanStatus> = {
  active: 'completed',
  completed: 'abandoned',
  abandoned: 'unknown',
  unknown: 'active',
};

async function cycleFactStatus(id: string, current: FactStatus): Promise<void> {
  const next = STATUS_CYCLE[current];
  try {
    const projection = await callPersona({
      type: PERSONA_UPDATE_FACT,
      id,
      patch: { status: next },
    });
    render(projection);
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), true);
  }
}

async function cyclePlanStatus(id: string, current: PlanStatus): Promise<void> {
  const next = PLAN_STATUS_CYCLE[current];
  try {
    const projection = await callPersona({
      type: PERSONA_UPDATE_PLAN,
      id,
      patch: { status: next },
    });
    render(projection);
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), true);
  }
}

async function removeFact(id: string): Promise<void> {
  try {
    const projection = await callPersona({ type: PERSONA_REMOVE_FACT, id });
    render(projection);
    setStatus(`Removed ${id}.`);
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), true);
  }
}

async function removePlan(id: string): Promise<void> {
  try {
    const projection = await callPersona({ type: PERSONA_REMOVE_PLAN, id });
    render(projection);
    setStatus(`Removed ${id}.`);
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), true);
  }
}

// ---------- wire up ----------

export function initPersonaPopup(): void {
  els.reloadBtn.addEventListener('click', () => void reload());
  els.examplesBtn.addEventListener('click', () => void loadExamples());
  els.clearBtn.addEventListener('click', () => void clearAll());
  els.factAddBtn.addEventListener('click', () => void addFactFromForm());
  els.planAddBtn.addEventListener('click', () => void addPlanFromForm());
  void reload();
}

// Mark a few symbols as intentionally unused (they exist for future
// identity editing without changing the public shape of the module).
void PERSONA_UPDATE_IDENTITY;
void cachedProjection;
