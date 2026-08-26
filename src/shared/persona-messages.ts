/**
 * Persona message contract: the typed messages the popup (and any other
 * extension-context UI) sends to the service worker to read or mutate
 * the persona. The service worker is the only place that owns a
 * PersonaStore; the popup never sees the raw PersonaProfile.
 *
 * Every response is wrapped in a `{ ok, result | error }` envelope so
 * the popup can handle failures uniformly.
 */

import type {
  Experience,
  Fact,
  PersonaProjection,
  PersonaQuery,
  Plan,
  Preference,
} from './persona';

export const PERSONA_GET_PROJECTION = 'AFA_PERSONA_GET' as const;
export const PERSONA_ADD_FACT = 'AFA_PERSONA_ADD_FACT' as const;
export const PERSONA_UPDATE_FACT = 'AFA_PERSONA_UPDATE_FACT' as const;
export const PERSONA_REMOVE_FACT = 'AFA_PERSONA_REMOVE_FACT' as const;
export const PERSONA_ADD_PLAN = 'AFA_PERSONA_ADD_PLAN' as const;
export const PERSONA_UPDATE_PLAN = 'AFA_PERSONA_UPDATE_PLAN' as const;
export const PERSONA_REMOVE_PLAN = 'AFA_PERSONA_REMOVE_PLAN' as const;
export const PERSONA_UPDATE_IDENTITY = 'AFA_PERSONA_UPDATE_IDENTITY' as const;
export const PERSONA_LOAD_EXAMPLES = 'AFA_PERSONA_LOAD_EXAMPLES' as const;
export const PERSONA_CLEAR = 'AFA_PERSONA_CLEAR' as const;

export interface PersonaEnvelope<T> {
  ok: boolean;
  result?: T;
  error?: string;
}

export interface PersonaGetRequest {
  type: typeof PERSONA_GET_PROJECTION;
  query?: PersonaQuery;
}

export interface PersonaAddFactRequest {
  type: typeof PERSONA_ADD_FACT;
  fact: Fact;
}

export interface PersonaUpdateFactRequest {
  type: typeof PERSONA_UPDATE_FACT;
  id: string;
  patch: Partial<Omit<Fact, 'id'>>;
}

export interface PersonaRemoveFactRequest {
  type: typeof PERSONA_REMOVE_FACT;
  id: string;
}

export interface PersonaAddPlanRequest {
  type: typeof PERSONA_ADD_PLAN;
  plan: Plan;
}

export interface PersonaUpdatePlanRequest {
  type: typeof PERSONA_UPDATE_PLAN;
  id: string;
  patch: Partial<Omit<Plan, 'id'>>;
}

export interface PersonaRemovePlanRequest {
  type: typeof PERSONA_REMOVE_PLAN;
  id: string;
}

export interface PersonaUpdateIdentityRequest {
  type: typeof PERSONA_UPDATE_IDENTITY;
  patch: Record<string, string | undefined>;
}

export interface PersonaLoadExamplesRequest {
  type: typeof PERSONA_LOAD_EXAMPLES;
}

export interface PersonaClearRequest {
  type: typeof PERSONA_CLEAR;
}

export type PersonaMessage =
  | PersonaGetRequest
  | PersonaAddFactRequest
  | PersonaUpdateFactRequest
  | PersonaRemoveFactRequest
  | PersonaAddPlanRequest
  | PersonaUpdatePlanRequest
  | PersonaRemovePlanRequest
  | PersonaUpdateIdentityRequest
  | PersonaLoadExamplesRequest
  | PersonaClearRequest;

/** Response from any persona message: always a projection, never a raw profile. */
export type PersonaMessageResponse = PersonaEnvelope<PersonaProjection>;

export type { Experience, Fact, Plan, Preference, PersonaProjection, PersonaQuery };
