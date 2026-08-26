/**
 * Pure message dispatcher for persona messages. Owns a PersonaStore
 * instance and translates typed PersonaMessage values into store calls.
 *
 * The dispatcher is the trust boundary: it always returns a
 * PersonaProjection, never the raw PersonaProfile. The audit log and
 * `notes` field never leave this module.
 *
 * Designed to be called from the service worker but factored out so
 * it can be unit-tested without a real Chrome runtime.
 */

import type {
  Experience,
  Fact,
  PersonaProjection,
  PersonaQuery,
  Plan,
} from '../shared/persona';
import type {
  PersonaEnvelope,
  PersonaMessage,
  PersonaMessageResponse,
} from '../shared/persona-messages';
import { PersonaStore } from './persona-store';

export interface PersonaHandlerOptions {
  store: PersonaStore;
}

export class PersonaMessageHandler {
  constructor(private readonly opts: PersonaHandlerOptions) {}

  async handle(msg: PersonaMessage): Promise<PersonaMessageResponse> {
    try {
      switch (msg.type) {
        case 'AFA_PERSONA_GET': {
          const projection = await this.opts.store.queryPersona(msg.query ?? {});
          return ok(projection);
        }
        case 'AFA_PERSONA_ADD_FACT': {
          await this.opts.store.addFact(msg.fact);
          return this.freshProjection();
        }
        case 'AFA_PERSONA_UPDATE_FACT': {
          await this.opts.store.updateFact(msg.id, msg.patch);
          return this.freshProjection();
        }
        case 'AFA_PERSONA_REMOVE_FACT': {
          await this.opts.store.removeFact(msg.id);
          return this.freshProjection();
        }
        case 'AFA_PERSONA_ADD_PLAN': {
          await this.opts.store.addPlan(msg.plan);
          return this.freshProjection();
        }
        case 'AFA_PERSONA_UPDATE_PLAN': {
          await this.opts.store.updatePlan(msg.id, msg.patch);
          return this.freshProjection();
        }
        case 'AFA_PERSONA_REMOVE_PLAN': {
          await this.opts.store.removePlan(msg.id);
          return this.freshProjection();
        }
        case 'AFA_PERSONA_UPDATE_IDENTITY': {
          // Coerce Record<string,string|undefined> to Partial<IdentityFacts>
          // The handler does not see typed identity; it just forwards patches.
          await this.opts.store.updateIdentity(
            msg.patch as Record<string, string | undefined>,
          );
          return this.freshProjection();
        }
        case 'AFA_PERSONA_LOAD_EXAMPLES': {
          await this.loadExamples();
          return this.freshProjection();
        }
        case 'AFA_PERSONA_CLEAR': {
          await this.opts.store.clear();
          return this.freshProjection();
        }
        default: {
          // Exhaustiveness check: if a new message type is added without
          // a handler, this line will fail to compile.
          const _exhaustive: never = msg;
          void _exhaustive;
          return fail('unknown message type');
        }
      }
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err));
    }
  }

  private async freshProjection(): Promise<PersonaEnvelope<PersonaProjection>> {
    const projection = await this.opts.store.queryPersona({
      include: { identity: true, facts: true, plans: true, preferences: true, experiences: true },
    });
    return ok(projection);
  }

  private async loadExamples(): Promise<void> {
    const now = new Date().toISOString();
    const userProv = {
      source: { kind: 'user-explicit' as const, recordedAt: now },
      confidence: 'high' as const,
    };

    const smartphoneFact: Fact = {
      id: 'fact.electronics.smartphone.recent',
      category: 'electronics',
      subject: 'smartphone',
      predicate: 'purchased',
      status: 'true',
      value: { since: '2026-06-26' },
      provenance: userProv,
      tags: ['phone', 'mobile', 'consumer-electronics'],
    };

    const pcPlan: Plan = {
      id: 'plan.computing.pc.buy',
      category: 'computing',
      subject: 'PC',
      predicate: 'planning-to-purchase',
      status: 'active',
      horizon: 'medium-term',
      provenance: userProv,
      tags: ['desktop', 'windows', 'linux'],
    };

    // Use a single composite query for existence so the example call
    // is idempotent.
    const existing = await this.opts.store.queryPersona({
      include: { facts: true, plans: true },
      filter: { sourcesOnly: ['user-explicit'] },
    });
    if (!existing.facts.some((f) => f.id === smartphoneFact.id)) {
      await this.opts.store.addFact(smartphoneFact);
    }
    if (!existing.plans.some((p) => p.id === pcPlan.id)) {
      await this.opts.store.addPlan(pcPlan);
    }
  }
}

function ok<T>(result: T): PersonaEnvelope<T> {
  return { ok: true, result };
}

function fail(error: string): PersonaEnvelope<never> {
  return { ok: false, error };
}

// Type aliases re-exported for convenience.
export type { Experience, Fact, PersonaQuery, Plan };
