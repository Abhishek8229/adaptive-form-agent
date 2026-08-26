import type { InteractionKind } from '../../shared/interaction';

const DISALLOWED_INPUT_TYPES = new Set(['password', 'file', 'image']);

const DISALLOWED_LABEL_PATTERNS: RegExp[] = [
  /\bcaptcha\b/i,
  /\brecaptcha\b/i,
  /\bhcaptcha\b/i,
  /\botp\b/i,
  /\bone[\s_-]*time[\s_-]*(code|password|pin)\b/i,
  /\b2fa\b/i,
  /\bmfa\b/i,
  /\bverification[\s_-]*code\b/i,
  /\bsecurity[\s_-]*code\b/i,
  // I3 fix: Also detect password-like labels
  /\bpassword\b/i,
  /\bpasswd\b/i,
  /\bpwd\b/i,
];

const DISALLOWED_NAME_PATTERNS: RegExp[] = [
  /\bcard[\s_-]*number\b/i,
  /\bcc[\s_-]*number\b/i,
  /\bcredit[\s_-]*card\b/i,
  /\bdebit[\s_-]*card\b/i,
  /\bcvv\b/i,
  /\bcvc\b/i,
  /\bcard[\s_-]*code\b/i,
  /\bcardholder\b/i,
  /\bbilling\b/i,
  /\bexpir(y|ation)\b/i,
  /\biban\b/i,
  /\bswift\b/i,
  /\baccount[\s_-]*number\b/i,
  /\brouting[\s_-]*number\b/i,
  // I3 fix: Also detect password-related names
  /\bpassword\b/i,
  /\bpasswd\b/i,
  /\bpwd\b/i,
];

const PAYMENT_AUTOCOMPLETE_TOKENS = new Set([
  'cc-number',
  'cc-csc',
  'cc-exp',
  'cc-exp-month',
  'cc-exp-year',
  'cc-name',
  'cc-given-name',
  'cc-family-name',
  'cc-additional-name',
  'cc-type',
  // I3 fix: Include password autocomplete tokens
  'current-password',
  'new-password',
]);

export interface SafetyContext {
  tag: string;
  type: string;
  name: string;
  id: string;
  label: string;
  ariaLabel: string;
  placeholder: string;
  autocomplete: string;
}

export interface SafetyVerdict {
  allowed: boolean;
  reason?: string;
}

export function isInteractionAllowed(
  ctx: SafetyContext,
  kind: InteractionKind,
): SafetyVerdict {
  if (kind === 'click-button') {
    if (ctx.type === 'submit' || ctx.type === 'image' || ctx.type === 'reset') {
      return {
        allowed: false,
        reason: 'submit/reset/image buttons are not interacted with in this phase',
      };
    }
  }

  if (DISALLOWED_INPUT_TYPES.has(ctx.type)) {
    return {
      allowed: false,
      reason: `inputs of type "${ctx.type}" are blocked by safety policy`,
    };
  }

  const ac = (ctx.autocomplete ?? '').toLowerCase().trim();
  if (ac && PAYMENT_AUTOCOMPLETE_TOKENS.has(ac)) {
    return {
      allowed: false,
      reason: `payment-related autocomplete token "${ac}" is blocked`,
    };
  }

  for (const p of DISALLOWED_LABEL_PATTERNS) {
    if (
      p.test(ctx.label ?? '') ||
      p.test(ctx.ariaLabel ?? '') ||
      p.test(ctx.name ?? '') ||
      p.test(ctx.id ?? '') ||
      p.test(ctx.placeholder ?? '')
    ) {
      return {
        allowed: false,
        reason: 'field matches a captcha / OTP / verification / password pattern',
      };
    }
  }

  for (const p of DISALLOWED_NAME_PATTERNS) {
    if (
      p.test(ctx.name ?? '') ||
      p.test(ctx.id ?? '') ||
      p.test(ctx.label ?? '') ||
      p.test(ctx.ariaLabel ?? '')
    ) {
      return {
        allowed: false,
        reason: 'field matches a payment / financial / password pattern',
      };
    }
  }

  return { allowed: true };
}
