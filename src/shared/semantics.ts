import type { FormSemanticHint } from './types';

interface HintPattern {
  hint: FormSemanticHint;
  patterns: RegExp[];
}

const HINT_RULES: HintPattern[] = [
  { hint: 'email', patterns: [/\bemail\b/i, /e-?mail/i] },
  { hint: 'phone', patterns: [/\bphone/i, /\btel\b/i, /\bmobile\b/i, /\bcellphone/i] },
  { hint: 'first_name', patterns: [/\bfirst[\s_-]*name\b/i, /\bgiven[\s_-]*name\b/i, /\bforename\b/i] },
  { hint: 'last_name', patterns: [/\blast[\s_-]*name\b/i, /\bsurname\b/i, /\bfamily[\s_-]*name\b/i] },
  { hint: 'full_name', patterns: [/\bfull[\s_-]*name\b/i, /\byour[\s_-]*name\b/i, /\bname\b/i] },
  { hint: 'date_of_birth', patterns: [/\bdate[\s_-]*of[\s_-]*birth\b/i, /\bdob\b/i, /\bbirthday\b/i, /\bbirth[\s_-]*date\b/i] },
  { hint: 'address_line_2', patterns: [/\baddress[\s_-]*(line[\s_-]*2|2)\b/i, /\bapt\b/i, /\bapartment\b/i, /\bsuite\b/i, /\bunit\b/i] },
  { hint: 'address', patterns: [/\baddress\b/i, /\bstreet\b/i, /\baddr\b/i, /streetaddress/i] },
  { hint: 'city', patterns: [/\bcity\b/i, /\btown\b/i, /\blocality\b/i] },
  { hint: 'state', patterns: [/\bstate\b/i, /\bregion\b/i, /\bprovince\b/i] },
  { hint: 'country', patterns: [/\bcountry\b/i, /\bnation\b/i] },
  { hint: 'postal_code', patterns: [/\bpostal\b/i, /\bzip\b/i, /\bpostcode\b/i, /\bzip[\s_-]*code\b/i] },
  { hint: 'username', patterns: [/\buser[\s_-]*name\b/i, /\blogin\b/i, /\bhandle\b/i, /\baccount[\s_-]*name\b/i] },
  { hint: 'password', patterns: [/\bpassword\b/i, /\bpasswd\b/i, /\bpwd\b/i] },
  { hint: 'search', patterns: [/\bsearch\b/i, /\bquery\b/i, /\bq\b/] },
  { hint: 'url', patterns: [/\burl\b/i, /\bwebsite\b/i, /\bhomepage\b/i, /\bsite\b/i] },
  { hint: 'number', patterns: [/\bnumber\b/i, /\bcount\b/i, /\bquantity\b/i, /\bamount\b/i, /\bage\b/i] },
  { hint: 'date', patterns: [/\bdate\b/i] },
  { hint: 'time', patterns: [/\btime\b/i, /\bhour\b/i] },
  { hint: 'datetime', patterns: [/\bdate[\s_-]*time\b/i, /\bwhen\b/i, /\bscheduled\b/i] },
  { hint: 'color', patterns: [/\bcolor\b/i, /\bcolour\b/i] },
  { hint: 'range', patterns: [/\brange\b/i, /\bvolume\b/i, /\bslider\b/i] },
  { hint: 'file', patterns: [/\bfile\b/i, /\bresume\b/i, /\bcv\b/i, /\bupload\b/i, /\battachment\b/i] },
];

const AUTOCOMPLETE_HINTS: Array<{ tokens: string[]; hint: FormSemanticHint }> = [
  { tokens: ['given-name'], hint: 'first_name' },
  { tokens: ['family-name'], hint: 'last_name' },
  { tokens: ['username'], hint: 'username' },
  { tokens: ['current-password', 'new-password'], hint: 'password' },
  { tokens: ['street-address', 'address-line1'], hint: 'address' },
  { tokens: ['address-line2'], hint: 'address_line_2' },
  { tokens: ['address-level2', 'locality'], hint: 'city' },
  { tokens: ['address-level1', 'region'], hint: 'state' },
  { tokens: ['country', 'country-name'], hint: 'country' },
  { tokens: ['postal-code'], hint: 'postal_code' },
  { tokens: ['email'], hint: 'email' },
  { tokens: ['tel', 'phone'], hint: 'phone' },
  { tokens: ['url'], hint: 'url' },
  { tokens: ['bday', 'birthday'], hint: 'date_of_birth' },
  { tokens: ['name'], hint: 'full_name' },
];

export interface SemanticInput {
  type?: string;
  name?: string;
  id?: string;
  label?: string;
  placeholder?: string;
  ariaLabel?: string;
  autocomplete?: string;
}

export interface SemanticResult {
  hint: FormSemanticHint;
  sources: string[];
}

function matchRules(input: SemanticInput): SemanticResult {
  const fields: Array<{ key: string; value: string }> = [
    { key: 'aria-label', value: input.ariaLabel ?? '' },
    { key: 'label', value: input.label ?? '' },
    { key: 'placeholder', value: input.placeholder ?? '' },
    { key: 'name', value: input.name ?? '' },
    { key: 'id', value: input.id ?? '' },
  ];

  const sources = new Set<string>();

  for (const rule of HINT_RULES) {
    for (const f of fields) {
      if (!f.value) continue;
      for (const p of rule.patterns) {
        if (p.test(f.value)) {
          sources.add(f.key);
          return { hint: rule.hint, sources: Array.from(sources) };
        }
      }
    }
  }

  const ac = (input.autocomplete ?? '').toLowerCase().trim();
  if (ac) {
    for (const rule of AUTOCOMPLETE_HINTS) {
      for (const token of rule.tokens) {
        if (ac.includes(token)) {
          sources.add('autocomplete');
          return { hint: rule.hint, sources: Array.from(sources) };
        }
      }
    }
  }

  if (input.type === 'email') return { hint: 'email', sources: ['type'] };
  if (input.type === 'tel') return { hint: 'phone', sources: ['type'] };
  if (input.type === 'url') return { hint: 'url', sources: ['type'] };
  if (input.type === 'password') return { hint: 'password', sources: ['type'] };
  if (input.type === 'search') return { hint: 'search', sources: ['type'] };
  if (input.type === 'number' || input.type === 'range') return { hint: input.type, sources: ['type'] };
  if (input.type === 'date') return { hint: 'date', sources: ['type'] };
  if (input.type === 'time') return { hint: 'time', sources: ['type'] };
  if (input.type === 'datetime-local' || input.type === 'month' || input.type === 'week') return { hint: 'datetime', sources: ['type'] };
  if (input.type === 'color') return { hint: 'color', sources: ['type'] };
  if (input.type === 'file') return { hint: 'file', sources: ['type'] };
  if (input.type === 'checkbox') return { hint: 'checkbox_group', sources: ['type'] };
  if (input.type === 'radio') return { hint: 'radio_group', sources: ['type'] };

  return { hint: 'unknown', sources: [] };
}

export function inferSemanticHint(input: SemanticInput): SemanticResult {
  return matchRules(input);
}

export const SEMANTIC_HINTS: readonly FormSemanticHint[] = Object.freeze([
  'email', 'phone', 'first_name', 'last_name', 'full_name', 'date_of_birth',
  'address', 'address_line_2', 'city', 'state', 'country', 'postal_code',
  'username', 'password', 'search', 'url', 'number', 'date', 'time', 'datetime',
  'color', 'range', 'file', 'checkbox_group', 'radio_group', 'select_choice',
  'textarea', 'unknown',
]);
