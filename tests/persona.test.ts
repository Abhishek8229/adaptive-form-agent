import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PERSONA_SCHEMA_VERSION,
  type Fact,
  type FactStatus,
  type IdentityFacts,
  type PersonaAnswer,
  type PersonaAuditEntry,
  type PersonaProfile,
  type PersonaProjection,
  type PersonaProjectionMeta,
  type PersonaQuery,
  type PersonaSource,
  type Plan,
  type Preference,
  type Provenance,
  type Experience,
} from '../src/shared/persona.ts';

// ---------------------------------------------------------------------------
// These tests are type-contract tests. They exercise every shape defined in
// src/shared/persona.ts by constructing realistic values and asserting the
// runtime contract. They are intentionally runtime-light: there is no
// storage, no AI, no DOM. The point is to catch accidental schema drift and
// to document, with code, how each kind of claim is meant to be written.
// ---------------------------------------------------------------------------

const ISO = (s: string): string => new Date(s).toISOString();

// 1. The "I purchased a smartphone in the last 2 months" fact.
test('persona: explicit smartphone purchase fact is well-formed', () => {
  const prov: Provenance = {
    source: { kind: 'user-explicit', recordedAt: ISO('2026-08-26T10:00:00Z') },
    confidence: 'high',
  };
  const fact: Fact = {
    id: 'fact.electronics.smartphone.last2mo',
    category: 'electronics',
    subject: 'smartphone',
    predicate: 'purchased',
    status: 'true',
    value: { since: '2026-06-26' },
    provenance: prov,
    tags: ['phone', 'mobile', 'consumer-electronics'],
  };
  assert.equal(fact.id, 'fact.electronics.smartphone.last2mo');
  assert.equal(fact.status, 'true');
  assert.equal(fact.provenance.confidence, 'high');
  assert.equal(fact.provenance.source.kind, 'user-explicit');
  assert.ok(fact.tags?.includes('mobile'));
  assert.equal(fact.value?.since, '2026-06-26');
});

// 2. The "I am planning to purchase a PC" plan.
test('persona: active PC purchase plan is well-formed', () => {
  const prov: Provenance = {
    source: { kind: 'user-explicit', recordedAt: ISO('2026-08-26T10:00:00Z') },
    confidence: 'high',
  };
  const plan: Plan = {
    id: 'plan.computing.pc.buy',
    category: 'computing',
    subject: 'PC',
    predicate: 'planning-to-purchase',
    status: 'active',
    horizon: 'medium-term',
    value: { budget: { amount: 1500, currency: 'USD' } },
    provenance: prov,
    tags: ['desktop', 'windows', 'linux'],
  };
  assert.equal(plan.status, 'active');
  assert.equal(plan.horizon, 'medium-term');
  assert.equal(plan.value?.budget?.amount, 1500);
  assert.equal(plan.value?.budget?.currency, 'USD');
  assert.equal(plan.provenance.source.kind, 'user-explicit');
});

// 3. An unknown fact. The status must be 'unknown', not silently 'false'.
test('persona: unknown fact carries status "unknown"', () => {
  const prov: Provenance = {
    source: { kind: 'user-explicit', recordedAt: ISO('2026-08-26T10:00:00Z') },
    confidence: 'high',
  };
  const fact: Fact = {
    id: 'fact.travel.international.last12mo',
    category: 'travel',
    subject: 'international-trip',
    predicate: 'taken',
    status: 'unknown',
    provenance: prov,
  };
  assert.equal<FactStatus>(fact.status, 'unknown');
  // Build-time sanity: unknown must be a valid FactStatus, not a typo.
  const ok: FactStatus = 'unknown';
  assert.equal(ok, 'unknown');
});

// 4. Provenance variants compile and are distinguishable at runtime.
test('persona: provenance distinguishes user vs AI source', () => {
  const userProv: Provenance = {
    source: { kind: 'user-explicit', recordedAt: ISO('2026-08-26T10:00:00Z') },
    confidence: 'high',
  };
  const aiProv: Provenance = {
    source: {
      kind: 'ai-inferred',
      recordedAt: ISO('2026-08-26T10:00:00Z'),
      reasoning: 'derived from past purchases',
      modelVersion: 'gmi/MiniMaxAI/MiniMax-M3',
    },
    confidence: 'low',
  };
  assert.equal(userProv.source.kind, 'user-explicit');
  assert.equal(aiProv.source.kind, 'ai-inferred');
  assert.equal(aiProv.confidence, 'low');
  // Discriminated union narrowing works at runtime.
  function describe(p: Provenance): string {
    const s: PersonaSource = p.source;
    if (s.kind === 'ai-inferred') return `ai(${s.modelVersion})`;
    return s.kind;
  }
  assert.equal(describe(userProv), 'user-explicit');
  assert.match(describe(aiProv), /^ai\(/);
});

// 5. PersonaAnswer: known vs unknown are distinct runtime cases.
test('persona: PersonaAnswer distinguishes known from unknown', () => {
  const known: PersonaAnswer = {
    kind: 'known',
    value: 'yes',
    claimId: 'fact.electronics.smartphone.last2mo',
    provenance: { kind: 'user-explicit', recordedAt: ISO('2026-08-26T10:00:00Z') },
    observedAt: ISO('2026-08-26T10:00:00Z'),
  };
  const unknown: PersonaAnswer = {
    kind: 'unknown',
    reason: 'no-matching-claim',
  };
  const refused: PersonaAnswer = {
    kind: 'refused',
    reason: 'safety-blocked',
  };

  assert.equal(known.kind, 'known');
  assert.equal(known.value, 'yes');
  assert.equal(known.claimId, 'fact.electronics.smartphone.last2mo');

  assert.equal(unknown.kind, 'unknown');
  assert.equal(unknown.reason, 'no-matching-claim');

  assert.equal(refused.kind, 'refused');
  assert.equal(refused.reason, 'safety-blocked');

  // A simple switch over the discriminated union is exhaustive at the
  // type level; this just confirms the runtime values are reachable.
  function summarize(a: PersonaAnswer): string {
    switch (a.kind) {
      case 'known': return `known:${a.value}`;
      case 'unknown': return `unknown:${a.reason}`;
      case 'refused': return `refused:${a.reason}`;
    }
  }
  assert.equal(summarize(known), 'known:yes');
  assert.equal(summarize(unknown), 'unknown:no-matching-claim');
  assert.equal(summarize(refused), 'refused:safety-blocked');
});

// 6. A full PersonaProfile can be assembled from the pieces above.
test('persona: a full PersonaProfile assembles and is well-formed', () => {
  const identity: IdentityFacts = {
    preferredName: 'Alex',
    locale: 'en-US',
    country: 'US',
  };

  const smartphoneFact: Fact = {
    id: 'fact.electronics.smartphone.last2mo',
    category: 'electronics',
    subject: 'smartphone',
    predicate: 'purchased',
    status: 'true',
    value: { since: '2026-06-26' },
    provenance: {
      source: { kind: 'user-explicit', recordedAt: ISO('2026-08-26T10:00:00Z') },
      confidence: 'high',
    },
    tags: ['phone', 'mobile'],
  };

  const pcPlan: Plan = {
    id: 'plan.computing.pc.buy',
    category: 'computing',
    subject: 'PC',
    predicate: 'planning-to-purchase',
    status: 'active',
    horizon: 'medium-term',
    provenance: {
      source: { kind: 'user-explicit', recordedAt: ISO('2026-08-26T10:00:00Z') },
      confidence: 'high',
    },
  };

  const osPref: Preference = {
    id: 'pref.os.work',
    category: 'operating-system',
    subject: 'work-laptop-os',
    value: 'Linux',
    strength: 'strong',
    provenance: {
      source: { kind: 'user-explicit', recordedAt: ISO('2026-08-26T10:00:00Z') },
      confidence: 'high',
    },
    tags: ['ubuntu', 'fedora'],
  };

  const purchase: Experience = {
    id: 'exp.purchase.smartphone.2026-07',
    category: 'purchases',
    subject: 'smartphone',
    description: 'Bought a Pixel 9 in July 2026',
    occurredAt: '2026-07-12',
    provenance: {
      source: { kind: 'user-explicit', recordedAt: ISO('2026-08-26T10:00:00Z') },
      confidence: 'high',
    },
    tags: ['pixel', 'android'],
  };

  const audit: PersonaAuditEntry = {
    at: ISO('2026-08-26T10:00:00Z'),
    action: 'add',
    claimId: smartphoneFact.id,
    after: smartphoneFact,
  };

  const profile: PersonaProfile = {
    schemaVersion: PERSONA_SCHEMA_VERSION,
    ownerId: 'local-7f3a9c1e',
    createdAt: ISO('2026-08-26T10:00:00Z'),
    updatedAt: ISO('2026-08-26T10:00:00Z'),
    identity,
    facts: [smartphoneFact],
    plans: [pcPlan],
    preferences: [osPref],
    experiences: [purchase],
    auditLog: [audit],
  };

  assert.equal(profile.schemaVersion, PERSONA_SCHEMA_VERSION);
  assert.equal(profile.facts.length, 1);
  assert.equal(profile.facts[0].id, 'fact.electronics.smartphone.last2mo');
  assert.equal(profile.plans[0].status, 'active');
  assert.equal(profile.preferences[0].strength, 'strong');
  assert.equal(profile.experiences[0].occurredAt, '2026-07-12');
  assert.equal(profile.auditLog?.[0].action, 'add');
});

// 7. The retrieval contract compiles end-to-end. A query -> projection
// round-trip is described but not executed by a store (no store yet).
test('persona: PersonaQuery and PersonaProjection shapes compile and round-trip', () => {
  const query: PersonaQuery = {
    include: { facts: true, plans: true, experiences: true },
    filter: {
      subjects: ['smartphone'],
      tagsAny: ['phone', 'mobile'],
      requireStatus: ['true', 'false', 'unknown'],
      sourcesOnly: ['user-explicit', 'user-imported'],
    },
    limit: 10,
  };
  assert.deepEqual(query.filter?.subjects, ['smartphone']);
  assert.equal(query.limit, 10);

  const meta: PersonaProjectionMeta = {
    matchedAt: ISO('2026-08-26T10:00:00Z'),
    totalClaims: 8,
    returnedClaims: 2,
    hadUnknown: false,
  };

  const projection: PersonaProjection = {
    facts: [
      {
        id: 'fact.electronics.smartphone.last2mo',
        category: 'electronics',
        subject: 'smartphone',
        predicate: 'purchased',
        status: 'true',
        value: { since: '2026-06-26' },
        provenance: {
          source: { kind: 'user-explicit', recordedAt: ISO('2026-08-26T10:00:00Z') },
          confidence: 'high',
        },
        tags: ['phone', 'mobile'],
      },
    ],
    plans: [],
    preferences: [],
    experiences: [],
    meta,
  };

  assert.equal(projection.facts.length, 1);
  assert.equal(projection.facts[0].status, 'true');
  assert.equal(projection.meta.hadUnknown, false);
  assert.equal(projection.meta.returnedClaims, 2);
});
