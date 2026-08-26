/**
 * Persona/Profile type contract.
 *
 * This file is the single source of truth for the shape of the persona.
 * It contains types only — no runtime behavior, no chrome.storage, no AI.
 * Every later module (persona-store, persona-orchestrator, popup UI, AI
 * bridge) imports from here so the schema evolves as one.
 *
 * Design goals (see design doc):
 *   - Separate persistent persona data from the LLM.
 *   - The LLM is never the source of truth; every claim has Provenance.
 *   - Structured, typed claims rather than one free-form blob.
 *   - Retrieval is a filtered projection, never "give me everything".
 *   - Facts (done/true) and Plans (intend) are first-class distinct kinds.
 *   - "unknown" is a first-class value, not a default.
 *   - Privacy: claims can be redacted before crossing a trust boundary.
 */

export const PERSONA_SCHEMA_VERSION = 1 as const;
export type PersonaSchemaVersion = typeof PERSONA_SCHEMA_VERSION;

// ---------- Provenance ----------

/**
 * Where a claim came from. Every claim carries one of these.
 *
 * - user-explicit: the user typed/said it directly. Highest trust.
 * - user-imported: bulk-loaded from a user-supplied file. High trust, audit
 *   trail is the import record.
 * - ai-inferred: produced by the AI layer. Low trust until the user
 *   confirms; the AI is never the source of truth.
 * - derived: computed from other claims (e.g. "age >= 18" derived from a
 *   date-of-birth fact). Trust is bounded by the trust of the inputs.
 */
export type PersonaSource =
  | { kind: 'user-explicit'; recordedAt: string }
  | { kind: 'user-imported'; recordedAt: string; origin: 'csv' | 'manual-form' | 'settings-ui' }
  | { kind: 'ai-inferred'; recordedAt: string; reasoning: string; modelVersion: string }
  | { kind: 'derived'; recordedAt: string; fromIds: string[] };

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface Provenance {
  source: PersonaSource;
  /**
   * Confidence in the claim.
   * High: user-explicit / user-imported / user-verified inferences.
   * Medium: ai-inferred that the user has not contested.
   * Low: ai-inferred, never confirmed.
   */
  confidence: ConfidenceLevel;
  /** When the user last affirmed the claim is still true, if ever. */
  lastConfirmedAt?: string;
  /** True if a user has explicitly confirmed an ai-inferred claim. */
  userVerified?: boolean;
}

// ---------- Identity ----------

/**
 * Identity facts. These are low-risk identifiers that are commonly asked
 * for by forms (name, email, phone, locale, country). They are kept
 * separate from the four claim kinds because they are addressed by field
 * name, not by question, and are more frequently re-confirmed.
 */
export interface IdentityFacts {
  preferredName?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  /** ISO 8601 date string. */
  dateOfBirth?: string;
  /** BCP-47 locale tag, e.g. "en-US". */
  locale?: string;
  /** ISO 3166-1 alpha-2 country code, e.g. "US". */
  country?: string;
  pronouns?: string;
}

// ---------- Fact ----------

/**
 * A fact: a statement about the user that is (or is not) true. The
 * three-valued `status` lets us represent "I have no idea" without
 * collapsing it to false.
 */
export type FactStatus = 'true' | 'false' | 'unknown';

export interface FactValue {
  text?: string;
  quantity?: number;
  /** e.g. "USD", "months", "kg". */
  unit?: string;
  /** ISO 8601 date, the start of the validity window. */
  since?: string;
  /** ISO 8601 date, the end of the validity window. Omit if still valid. */
  until?: string;
}

export interface Fact {
  /** Stable id, e.g. "fact.electronics.smartphone.last2mo". */
  id: string;
  /** Coarse domain, e.g. "electronics", "travel", "employment". */
  category: string;
  /** Canonical noun, e.g. "smartphone". */
  subject: string;
  /** Verb phrase, e.g. "purchased", "owns", "is-allergic-to". */
  predicate: string;
  status: FactStatus;
  value?: FactValue;
  provenance: Provenance;
  /** Human-readable notes. Never used for retrieval matching. */
  notes?: string;
  /** Free-form search hints, e.g. ["phone", "mobile", "ios"]. */
  tags?: string[];
}

// ---------- Plan ----------

/**
 * How soon the user intends to act. The four buckets are deliberately
 * coarse so the AI can ask the right follow-up questions without
 * inventing a date.
 */
export type PlanHorizon = 'immediate' | 'short-term' | 'medium-term' | 'long-term' | 'no-longer';

export type PlanStatus = 'active' | 'completed' | 'abandoned' | 'unknown';

export interface PlanValue {
  text?: string;
  quantity?: number;
  unit?: string;
  budget?: {
    amount: number;
    /** ISO 4217 currency code, e.g. "USD". */
    currency: string;
  };
}

export interface Plan {
  id: string;
  category: string;
  subject: string;
  predicate: string;
  status: PlanStatus;
  horizon: PlanHorizon;
  /** ISO 8601 date, if the user has a specific target. */
  targetDate?: string;
  value?: PlanValue;
  provenance: Provenance;
  tags?: string[];
}

// ---------- Preference ----------

export type PreferenceStrength = 'strong' | 'moderate' | 'mild';

export interface Preference {
  id: string;
  category: string;
  subject: string;
  /** The preferred value, e.g. "Linux", "email", "Italian". */
  value: string;
  strength: PreferenceStrength;
  /** Optional scope, e.g. "for work laptops". */
  appliesWhen?: string;
  provenance: Provenance;
  tags?: string[];
}

// ---------- Experience ----------

export interface Experience {
  id: string;
  category: string;
  subject: string;
  description: string;
  /** ISO 8601 date, when the experience started. */
  occurredAt?: string;
  /** ISO 8601 date, when the experience ended. Omit if ongoing. */
  endedAt?: string;
  value?: FactValue;
  provenance: Provenance;
  tags?: string[];
}

// ---------- Audit log ----------

/**
 * Append-only audit record. Every mutation to the persona appends one of
 * these. Used for "where did this come from?" and for user-facing undo.
 * The audit log is stripped before any data crosses a trust boundary
 * (e.g. before being sent to an LLM).
 */
export type PersonaAuditAction = 'add' | 'update' | 'remove' | 'confirm';

export interface PersonaAuditEntry {
  at: string;
  action: PersonaAuditAction;
  claimId: string;
  before?: unknown;
  after?: unknown;
}

// ---------- Top-level persona ----------

export interface PersonaProfile {
  schemaVersion: PersonaSchemaVersion;
  /** Local anonymous owner id. Never leaves the device. */
  ownerId: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
  /** ISO 8601 timestamp. */
  updatedAt: string;
  identity: IdentityFacts;
  facts: Fact[];
  plans: Plan[];
  preferences: Preference[];
  experiences: Experience[];
  auditLog?: PersonaAuditEntry[];
}

// ---------- Retrieval contract ----------
//
// The following types describe the query/projection interface that the
// persona-store will eventually implement. They live here, in /shared,
// because every layer (background store, content bridge, AI orchestrator)
// imports the same shapes. The store is the only thing allowed to read
// the full PersonaProfile; everyone else gets a PersonaProjection.

/**
 * Subset of fields a caller wants back. Defaults are conservative:
 * identity is opt-in, claims are opt-in per-kind.
 */
export interface PersonaQueryInclude {
  identity?: boolean;
  facts?: boolean;
  plans?: boolean;
  preferences?: boolean;
  experiences?: boolean;
}

export interface PersonaQueryFilter {
  /** Match against category, case-insensitive. */
  categories?: string[];
  /** Match against subject, case-insensitive. */
  subjects?: string[];
  /** Match against tags (any-of), case-insensitive. */
  tagsAny?: string[];
  /** Match against predicate, case-insensitive. */
  predicates?: string[];
  /** For facts: which statuses are acceptable in the result. */
  requireStatus?: FactStatus[];
  /** Minimum confidence level. Defaults to 'low' (return everything). */
  minConfidence?: ConfidenceLevel;
  /**
   * Only return claims from these source kinds. Defaults to all kinds.
   * Typical use: 'user-explicit' to avoid letting the AI act on its
   * own inferences.
   */
  sourcesOnly?: PersonaSource['kind'][];
}

export interface PersonaQuery {
  include?: PersonaQueryInclude;
  filter?: PersonaQueryFilter;
  /** Max claims returned per kind. Default 25. Hard cap enforced by store. */
  limit?: number;
}

export interface PersonaProjectionMeta {
  /** When the projection was assembled. */
  matchedAt: string;
  /** Total claims in the store at query time. */
  totalClaims: number;
  /** Claims actually returned (after filtering + limit). */
  returnedClaims: number;
  /**
   * True if at least one matched fact had status: 'unknown'. Callers
   * can use this to decide between "I don't know" and a confident no.
   */
  hadUnknown: boolean;
}

export interface PersonaProjection {
  identity?: IdentityFacts;
  facts: Fact[];
  plans: Plan[];
  preferences: Preference[];
  experiences: Experience[];
  meta: PersonaProjectionMeta;
}

// ---------- Answer contract ----------
//
// The answer the orchestrator eventually returns to the form-filling
// layer. Three-valued so the interaction engine can distinguish a
// confident answer from a "do not fill" outcome.

export type PersonaAnswer =
  | {
      kind: 'known';
      value: 'yes' | 'no';
      claimId: string;
      provenance: PersonaSource;
      observedAt: string;
    }
  | {
      kind: 'unknown';
      reason: 'no-matching-claim' | 'matching-claim-unknown' | 'low-confidence';
    }
  | {
      kind: 'refused';
      reason: 'out-of-scope' | 'safety-blocked';
    };
