/**
 * Tests for the persona message handler. These exercise the same code
 * path the service worker uses when responding to popup messages,
 * without needing a real Chrome runtime. They cover the trust boundary:
 * the response is always a PersonaProjection, never a raw PersonaProfile.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PersonaMessageHandler } from '../src/background/persona-handler.ts';
import { PersonaStore } from '../src/background/persona-store.ts';
import { createInMemoryStorage, type InMemoryStorage } from '../src/background/persona-storage-mock.ts';
import type { Fact, Plan, Provenance } from '../src/shared/persona.ts';

function prov(overrides: Partial<Provenance> = {}): Provenance {
  return {
    source: { kind: 'user-explicit', recordedAt: '2026-08-26T10:00:00.000Z' },
    confidence: 'high',
    ...overrides,
  };
}

const SMARTPHONE_FACT: Fact = {
  id: 'fact.electronics.smartphone.recent',
  category: 'electronics',
  subject: 'smartphone',
  predicate: 'purchased',
  status: 'true',
  value: { since: '2026-06-26' },
  provenance: prov(),
  tags: ['phone', 'mobile'],
};

const PC_PLAN: Plan = {
  id: 'plan.computing.pc.buy',
  category: 'computing',
  subject: 'PC',
  predicate: 'planning-to-purchase',
  status: 'active',
  horizon: 'medium-term',
  provenance: prov(),
  tags: ['desktop', 'windows', 'linux'],
};

function makeHandler(): { handler: PersonaMessageHandler; store: PersonaStore; storage: InMemoryStorage } {
  const storage = createInMemoryStorage();
  const store = new PersonaStore({ storage, clock: { now: () => '2026-08-26T10:00:00.000Z' } });
  return { handler: new PersonaMessageHandler({ store }), store, storage };
}

// ---------- trust boundary ----------

test('persona-handler: responses never include the raw profile', async () => {
  const { handler } = makeHandler();
  await handler.handle({ type: 'AFA_PERSONA_ADD_FACT', fact: SMARTPHONE_FACT });
  const res = await handler.handle({ type: 'AFA_PERSONA_GET' });
  assert.equal(res.ok, true);
  // The response must be a PersonaProjection, not a PersonaProfile.
  assert.ok(res.result, 'result should be present');
  // The result must not contain auditLog, notes, or ownerId.
  const r = res.result as unknown as Record<string, unknown>;
  assert.equal(r.auditLog, undefined, 'auditLog must not leak');
  assert.equal(r.ownerId, undefined, 'ownerId must not leak');
  for (const f of (res.result?.facts ?? []) as Fact[]) {
    assert.equal((f as { notes?: unknown }).notes, undefined, 'fact.notes must not leak');
  }
});

// ---------- GET ----------

test('persona-handler: GET returns empty projection when store is empty', async () => {
  const { handler } = makeHandler();
  const res = await handler.handle({ type: 'AFA_PERSONA_GET' });
  assert.equal(res.ok, true);
  assert.equal(res.result?.facts.length, 0);
  assert.equal(res.result?.plans.length, 0);
  assert.equal(res.result?.preferences.length, 0);
  assert.equal(res.result?.experiences.length, 0);
});

test('persona-handler: GET respects a query (subjects filter)', async () => {
  const { handler } = makeHandler();
  await handler.handle({ type: 'AFA_PERSONA_ADD_FACT', fact: SMARTPHONE_FACT });
  const res = await handler.handle({
    type: 'AFA_PERSONA_GET',
    query: { include: { facts: true }, filter: { subjects: ['smartphone'] } },
  });
  assert.equal(res.result?.facts.length, 1);
});

// ---------- add / update / remove fact ----------

test('persona-handler: ADD_FACT persists and returns updated projection', async () => {
  const { handler } = makeHandler();
  const res = await handler.handle({ type: 'AFA_PERSONA_ADD_FACT', fact: SMARTPHONE_FACT });
  assert.equal(res.ok, true);
  assert.equal(res.result?.facts.length, 1);
  assert.equal(res.result?.facts[0].id, SMARTPHONE_FACT.id);
});

test('persona-handler: ADD_FACT rejects duplicate ids with ok=false', async () => {
  const { handler } = makeHandler();
  await handler.handle({ type: 'AFA_PERSONA_ADD_FACT', fact: SMARTPHONE_FACT });
  const res = await handler.handle({ type: 'AFA_PERSONA_ADD_FACT', fact: SMARTPHONE_FACT });
  assert.equal(res.ok, false);
  assert.match(res.error ?? '', /already exists/);
});

test('persona-handler: UPDATE_FACT changes status', async () => {
  const { handler } = makeHandler();
  await handler.handle({ type: 'AFA_PERSONA_ADD_FACT', fact: SMARTPHONE_FACT });
  const res = await handler.handle({
    type: 'AFA_PERSONA_UPDATE_FACT',
    id: SMARTPHONE_FACT.id,
    patch: { status: 'false' },
  });
  assert.equal(res.ok, true);
  const updated = res.result?.facts.find((f) => f.id === SMARTPHONE_FACT.id);
  assert.equal(updated?.status, 'false');
});

test('persona-handler: REMOVE_FACT removes the fact', async () => {
  const { handler } = makeHandler();
  await handler.handle({ type: 'AFA_PERSONA_ADD_FACT', fact: SMARTPHONE_FACT });
  const res = await handler.handle({ type: 'AFA_PERSONA_REMOVE_FACT', id: SMARTPHONE_FACT.id });
  assert.equal(res.ok, true);
  assert.equal(res.result?.facts.length, 0);
});

// ---------- plans ----------

test('persona-handler: ADD_PLAN persists an active PC plan', async () => {
  const { handler } = makeHandler();
  const res = await handler.handle({ type: 'AFA_PERSONA_ADD_PLAN', plan: PC_PLAN });
  assert.equal(res.ok, true);
  assert.equal(res.result?.plans.length, 1);
  assert.equal(res.result?.plans[0].status, 'active');
  assert.equal(res.result?.plans[0].horizon, 'medium-term');
});

test('persona-handler: UPDATE_PLAN flips status', async () => {
  const { handler } = makeHandler();
  await handler.handle({ type: 'AFA_PERSONA_ADD_PLAN', plan: PC_PLAN });
  const res = await handler.handle({
    type: 'AFA_PERSONA_UPDATE_PLAN',
    id: PC_PLAN.id,
    patch: { status: 'completed' },
  });
  assert.equal(res.ok, true);
  const updated = res.result?.plans.find((p) => p.id === PC_PLAN.id);
  assert.equal(updated?.status, 'completed');
});

test('persona-handler: REMOVE_PLAN removes the plan', async () => {
  const { handler } = makeHandler();
  await handler.handle({ type: 'AFA_PERSONA_ADD_PLAN', plan: PC_PLAN });
  const res = await handler.handle({ type: 'AFA_PERSONA_REMOVE_PLAN', id: PC_PLAN.id });
  assert.equal(res.ok, true);
  assert.equal(res.result?.plans.length, 0);
});

// ---------- load examples ----------

test('persona-handler: LOAD_EXAMPLES seeds the smartphone fact and PC plan', async () => {
  const { handler } = makeHandler();
  const res = await handler.handle({ type: 'AFA_PERSONA_LOAD_EXAMPLES' });
  assert.equal(res.ok, true);
  const facts = res.result?.facts ?? [];
  const plans = res.result?.plans ?? [];
  const smartphone = facts.find((f) => f.subject === 'smartphone' && f.predicate === 'purchased');
  const pc = plans.find((p) => p.subject === 'PC' && p.predicate === 'planning-to-purchase');
  assert.ok(smartphone, 'smartphone fact should be seeded');
  assert.equal(smartphone?.status, 'true');
  assert.ok(pc, 'PC plan should be seeded');
  assert.equal(pc?.status, 'active');
});

test('persona-handler: LOAD_EXAMPLES is idempotent', async () => {
  const { handler } = makeHandler();
  await handler.handle({ type: 'AFA_PERSONA_LOAD_EXAMPLES' });
  const res = await handler.handle({ type: 'AFA_PERSONA_LOAD_EXAMPLES' });
  assert.equal(res.ok, true);
  // Calling twice must not double-seed.
  const smartphoneCount = (res.result?.facts ?? []).filter(
    (f) => f.subject === 'smartphone' && f.predicate === 'purchased',
  ).length;
  const pcCount = (res.result?.plans ?? []).filter(
    (p) => p.subject === 'PC' && p.predicate === 'planning-to-purchase',
  ).length;
  assert.equal(smartphoneCount, 1);
  assert.equal(pcCount, 1);
});

// ---------- clear ----------

test('persona-handler: CLEAR removes all claims', async () => {
  const { handler } = makeHandler();
  await handler.handle({ type: 'AFA_PERSONA_ADD_FACT', fact: SMARTPHONE_FACT });
  await handler.handle({ type: 'AFA_PERSONA_ADD_PLAN', plan: PC_PLAN });
  const res = await handler.handle({ type: 'AFA_PERSONA_CLEAR' });
  assert.equal(res.ok, true);
  assert.equal(res.result?.facts.length, 0);
  assert.equal(res.result?.plans.length, 0);
});

// ---------- failure modes ----------

test('persona-handler: UPDATE_FACT on unknown id returns ok=false', async () => {
  const { handler } = makeHandler();
  const res = await handler.handle({
    type: 'AFA_PERSONA_UPDATE_FACT',
    id: 'does-not-exist',
    patch: { status: 'false' },
  });
  assert.equal(res.ok, false);
  assert.match(res.error ?? '', /not found/);
});

test('persona-handler: REMOVE_PLAN on unknown id returns ok=false', async () => {
  const { handler } = makeHandler();
  const res = await handler.handle({ type: 'AFA_PERSONA_REMOVE_PLAN', id: 'does-not-exist' });
  assert.equal(res.ok, false);
  assert.match(res.error ?? '', /not found/);
});

// ---------- identity patch ----------

test('persona-handler: UPDATE_IDENTITY merges fields and includes identity in projection', async () => {
  const { handler } = makeHandler();
  const res = await handler.handle({
    type: 'AFA_PERSONA_UPDATE_IDENTITY',
    patch: { preferredName: 'Alex', locale: 'en-US' },
  });
  assert.equal(res.ok, true);
  assert.equal(res.result?.identity?.preferredName, 'Alex');
  assert.equal(res.result?.identity?.locale, 'en-US');
});
