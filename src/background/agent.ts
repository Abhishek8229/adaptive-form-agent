/**
 * Agent planner: pure functions that decide "what does this field mean?"
 * and "which JSON value answers it?". No DOM access. The actual
 * "how do I modify and verify this DOM element?" lives in the
 * deterministic interaction engine; this module only produces the
 * InteractionRequest values that engine consumes.
 *
 * Matching priority for picking a profile key:
 *   1. autocomplete token  (most reliable signal of intent)
 *   2. semanticHint        (already classified by detector/semantics)
 *   3. label/aria/placeholder/name/id substring match
 *
 * All matching is case-insensitive, normalized (camelCase, snake_case,
 * kebab-case, spaces all collapse to one form).
 */

import type {
  InteractionKind,
  InteractionRequest,
  RadioRequest,
  SelectOptionRequest,
  SetTextRequest,
  CheckboxRequest,
  SetDateRequest,
  SetTimeRequest,
} from '../shared/interaction';
import type { FormField, FormOption, FormSemanticHint } from '../shared/types';
import type { JsonProfile, ProfileValue } from '../shared/profile';

// ---------- Normalization ----------

/**
 * Normalize a key for comparison:
 *   - lower-case
 *   - collapse camelCase boundaries ("firstName" -> "first name")
 *   - replace [_\\-.] with a single space
 *   - collapse whitespace
 */
export function normalizeKey(s: string): string {
  if (!s) return '';
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-.]+/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A loose, normalized substring match: returns true when every token of
 * `needle` appears in `haystack` in order (not necessarily contiguous).
 * This is a deliberately gentle match for the third-priority case.
 */
export function fuzzyContains(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const h = normalizeKey(haystack);
  const n = normalizeKey(needle);
  if (!n) return false;
  if (h.includes(n)) return true;
  // Token-order subsequence: every token of needle appears in haystack.
  const tokens = n.split(' ').filter(Boolean);
  if (tokens.length <= 1) return false;
  let idx = 0;
  for (const t of tokens) {
    const found = h.indexOf(t, idx);
    if (found < 0) return false;
    idx = found + t.length;
  }
  return true;
}

// ---------- Autocomplete token -> hint ----------

/**
 * Maps a (lowercased) autocomplete token to a FormSemanticHint.
 * Returns null if the token doesn't map to anything we know.
 */
const AUTOCOMPLETE_TO_HINT: Array<{ tokens: string[]; hint: FormSemanticHint }> = [
  { tokens: ['given-name'], hint: 'first_name' },
  { tokens: ['family-name'], hint: 'last_name' },
  { tokens: ['additional-name'], hint: 'first_name' },
  { tokens: ['honorific-prefix'], hint: 'full_name' },
  { tokens: ['honorific-suffix'], hint: 'full_name' },
  { tokens: ['nickname'], hint: 'full_name' },
  { tokens: ['username'], hint: 'username' },
  { tokens: ['new-password', 'current-password'], hint: 'password' },
  { tokens: ['one-time-code'], hint: 'unknown' },
  { tokens: ['organization-title'], hint: 'unknown' },
  { tokens: ['organization'], hint: 'unknown' },
  { tokens: ['street-address', 'address-line1'], hint: 'address' },
  { tokens: ['address-line2', 'address-line3'], hint: 'address_line_2' },
  { tokens: ['address-level2', 'locality'], hint: 'city' },
  { tokens: ['address-level1', 'region'], hint: 'state' },
  { tokens: ['country', 'country-name'], hint: 'country' },
  { tokens: ['postal-code'], hint: 'postal_code' },
  { tokens: ['email'], hint: 'email' },
  { tokens: ['tel', 'tel-national', 'tel-country-code', 'tel-area-code', 'tel-local', 'tel-local-prefix', 'tel-local-suffix'], hint: 'phone' },
  { tokens: ['url'], hint: 'url' },
  { tokens: ['photo'], hint: 'file' },
  { tokens: ['bday', 'birthday'], hint: 'date_of_birth' },
  { tokens: ['name'], hint: 'full_name' },
  { tokens: ['cc-name', 'cc-given-name', 'cc-family-name'], hint: 'full_name' },
  { tokens: ['cc-number', 'cc-csc', 'cc-exp', 'cc-exp-month', 'cc-exp-year', 'cc-type'], hint: 'unknown' },
];

export function hintFromAutocomplete(autocomplete: string): FormSemanticHint | null {
  const ac = (autocomplete ?? '').toLowerCase().trim();
  if (!ac) return null;
  if (ac === 'off' || ac === 'on') return null;
  for (const entry of AUTOCOMPLETE_TO_HINT) {
    for (const t of entry.tokens) {
      if (ac === t || ac.includes(t)) return entry.hint;
    }
  }
  return null;
}

// ---------- Plan result types ----------

export type SkipReason =
  | 'no_profile_match'
  | 'value_unsupported'
  | 'select_option_not_found'
  | 'radio_value_not_found'
  | 'checkbox_value_not_boolean'
  | 'no_reliable_label';

export interface FieldPlan {
  ok: true;
  profileKey: string;
  value: ProfileValue;
  request: InteractionRequest;
  match: 'autocomplete' | 'semantic' | 'label';
}

export interface FieldSkip {
  ok: false;
  reason: SkipReason;
  detail?: string;
}

export type PlanResult = FieldPlan | FieldSkip;

// ---------- planField ----------

const HINT_TO_PROFILE_HINTS: Record<FormSemanticHint, string[]> = {
  email: ['email'],
  phone: ['phone', 'tel', 'mobile', 'cellphone', 'telephone'],
  first_name: ['first name', 'firstname', 'given name', 'givenname', 'forename'],
  last_name: ['last name', 'lastname', 'surname', 'family name', 'familyname'],
  full_name: ['full name', 'fullname', 'name', 'your name'],
  date_of_birth: ['date of birth', 'dateofbirth', 'dob', 'birthday', 'birth date', 'birthdate'],
  address: ['address', 'street', 'street address', 'address line 1', 'addressline1', 'address1'],
  address_line_2: ['address line 2', 'addressline2', 'address2', 'apartment', 'apt', 'suite', 'unit'],
  city: ['city', 'town', 'locality'],
  state: ['state', 'region', 'province'],
  country: ['country', 'nation'],
  postal_code: ['postal code', 'postalcode', 'zip', 'zip code', 'zipcode', 'postcode'],
  username: ['username', 'user name', 'login', 'handle', 'account name'],
  password: ['password', 'passwd', 'pwd'],
  search: ['search', 'query', 'q'],
  url: ['url', 'website', 'homepage', 'site'],
  number: ['number', 'count', 'quantity', 'amount', 'age'],
  date: ['date'],
  time: ['time', 'hour'],
  datetime: ['date time', 'datetime', 'when', 'scheduled'],
  color: ['color', 'colour'],
  range: ['range', 'volume', 'slider'],
  file: ['file', 'resume', 'cv', 'upload', 'attachment'],
  checkbox_group: ['checkbox'],
  radio_group: ['radio'],
  select_choice: ['select'],
  textarea: ['textarea', 'message', 'comment', 'description', 'bio', 'notes', 'about'],
  unknown: [],
};

function profileKeys(profile: JsonProfile): string[] {
  return Object.keys(profile);
}

function pickKeyByProfileHints(profile: JsonProfile, candidates: string[]): string | null {
  const normCandidates = candidates.map((c) => normalizeKey(c));
  for (const key of profileKeys(profile)) {
    const nk = normalizeKey(key);
    for (const c of normCandidates) {
      if (nk === c) return key;
    }
  }
  return null;
}

function pickKeyByLabelFuzzy(
  profile: JsonProfile,
  field: FormField,
): string[] {
  const haystack = [
    field.label,
    field.ariaLabel,
    field.placeholder,
    field.name,
    field.id,
  ].filter(Boolean).join(' | ');

  if (!haystack) return [];

  const matched: string[] = [];

  // First pass: exact normalized key match.
  for (const key of profileKeys(profile)) {
    const nk = normalizeKey(key);
    if (nk && normalizeKey(haystack).includes(nk)) {
      if (!matched.includes(key)) matched.push(key);
    }
  }
  // Second pass: fuzzy token-order match (catches multi-word profile keys
  // against labels that contain them as a phrase).
  for (const key of profileKeys(profile)) {
    if (fuzzyContains(haystack, key)) {
      if (!matched.includes(key)) matched.push(key);
    }
  }
  
  // Sort by length descending to prefer more specific (longer) keys over generic ones
  return matched.sort((a, b) => b.length - a.length);
}

const LABEL_SYNONYMS: Record<string, string[]> = {
  addressLine1: ['where do you live', 'street address', 'address 1'],
  addressLine2: ['apartment', 'suite', 'unit'],
  city: ['metro area', 'city'],
  phone: ['reach you', 'phone number'],
  firstName: ['what should we call you', 'first name', 'given name'],
  expectedSalary: ['expected salary', 'minimum salary', 'maximum salary'],
  jobTitle: ['job title', 'position'],
  currentCompany: ['current company', 'recent company'],
  employmentType: ['employment type'],
  experienceLevel: ['experience level'],
  yearsExperience: ['years of experience'],
  workLocation: ['work location', 'open to remote'],
  noticePeriod: ['notice period'],
  hoursOverlap: ['hours overlap', 'working hours'],
  preferredStartDate: ['start date'],
  preferredInterviewTime: ['interview time'],
  referralSource: ['hear about us', 'referral source'],
  referrerName: ['referrer name'],
  contactMethod: ['contact method', 'preferred contact'],
  preferredLanguage: ['preferred language'],
  timezone: ['time zone', 'timezone'],
};

function pickKeysByLabelSynonyms(profile: JsonProfile, field: FormField): string[] {
  const haystack = [field.label, field.ariaLabel, field.placeholder, field.name, field.id].filter(Boolean).join(' | ').toLowerCase();
  const matched: string[] = [];
  for (const key of profileKeys(profile)) {
    const synonyms = LABEL_SYNONYMS[key] ?? [];
    for (const syn of synonyms) {
      if (haystack.includes(syn.toLowerCase())) {
        matched.push(key);
        break;
      }
    }
  }
  return matched;
}

export function planField(
  field: FormField,
  profile: JsonProfile,
): PlanResult {
  if (field.disabled || field.readOnly) {
    return { ok: false, reason: 'no_reliable_label', detail: 'field is disabled or readonly' };
  }

  const protectedPattern = /\b(password|passwd|pwd|otp|one-time-code|cvv|cvc|cc-number|credit-?card|iban|captcha|bot challenge|recovery)\b/i;
  const matchStr = [field.name, field.id, field.label, field.placeholder, field.ariaLabel, field.autocomplete].filter(Boolean).join(' | ');
  if (protectedPattern.test(matchStr) || field.controlType === 'input-password' || field.controlType === 'input-file' || field.containsSensitiveValue) {
    return { ok: false, reason: 'no_reliable_label', detail: 'sensitive or protected field' };
  }

  // Collect candidate profile keys in priority order
  const candidates: Array<{ key: string, match: FieldPlan['match'] }> = [];

  const addCandidate = (key: string, match: FieldPlan['match']) => {
    if (!candidates.find((c) => c.key === key)) {
      candidates.push({ key, match });
    }
  };

  // 1. autocomplete
  const acHint = hintFromAutocomplete(field.autocomplete);
  if (acHint) {
    const hints = HINT_TO_PROFILE_HINTS[acHint] ?? [];
    const k = pickKeyByProfileHints(profile, hints);
    if (k) addCandidate(k, 'autocomplete');
  }

  // 2. semanticHint
  if (field.semanticHint && field.semanticHint !== 'unknown') {
    const hints = HINT_TO_PROFILE_HINTS[field.semanticHint] ?? [];
    const k = pickKeyByProfileHints(profile, hints);
    if (k) addCandidate(k, 'semantic');
  }

  // 3. Synonyms
  const synKeys = pickKeysByLabelSynonyms(profile, field);
  for (const k of synKeys) addCandidate(k, 'label');

  // 4. label / ariaLabel / placeholder / name / id fuzzy match
  const fuzzyKeys = pickKeyByLabelFuzzy(profile, field);
  for (const k of fuzzyKeys) addCandidate(k, 'label');

  if (candidates.length === 0) {
    if (field.controlType === 'input-checkbox' && field.required) {
      const req: CheckboxRequest = { stableId: field.stableId, kind: 'check' };
      return {
        ok: true,
        profileKey: '__consent__',
        value: true,
        request: req,
        match: 'semantic',
      };
    }
    return { ok: false, reason: 'no_profile_match' };
  }

  // Try candidates until one successfully yields an interaction
  let lastSkip: FieldSkip | null = null;
  for (const { key, match } of candidates) {
    const value = profile[key];
    const res = valueToInteraction(field, key, value, match);
    if (res.ok) {
      return res;
    }
    lastSkip = res;
  }

  return lastSkip ?? { ok: false, reason: 'no_profile_match' };
}

// ---------- valueToInteraction ----------

function findSelectOptionFuzzy(options: FormOption[], wanted: string): FormOption | null {
  const w = wanted.trim().toLowerCase();
  if (!w) return null;

  // 1. Exact value match
  let match = options.find((o) => (o.value ?? '').trim().toLowerCase() === w);
  if (match) return match;

  // 2. Exact text match
  match = options.find((o) => (o.text ?? '').trim().toLowerCase() === w);
  if (match) return match;

  const normW = normalizeKey(w);
  if (!normW) return null;

  // 3. Substring match on text (Profile value in option text)
  match = options.find((o) => {
    const normText = normalizeKey(o.text ?? '');
    return normText && normText.includes(normW);
  });
  if (match) return match;

  // 4. Substring match on value (Profile value in option value)
  match = options.find((o) => {
    const normVal = normalizeKey(o.value ?? '');
    return normVal && normW.length >= 3 && normVal.includes(normW);
  });
  if (match) return match;

  // 5. Reverse substring match on text (Option text in profile value)
  match = options.find((o) => {
    const normText = normalizeKey(o.text ?? '');
    if (!normText) return false;
    if (normText.length < 4) {
      return new RegExp(`\\b${normText.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i').test(normW);
    }
    return normW.includes(normText);
  });
  
  return match ?? null;
}

function asString(v: ProfileValue): string | null {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return null;
}

export function valueToInteraction(
  field: FormField,
  key: string,
  value: ProfileValue,
  match: FieldPlan['match'],
): PlanResult {
  const baseSkip = (reason: SkipReason, detail?: string): FieldSkip => ({
    ok: false,
    reason,
    detail,
  });
  const basePlan = (req: InteractionRequest): FieldPlan => ({
    ok: true,
    profileKey: key,
    value,
    request: req,
    match,
  });

  const controlType = field.controlType;

  // --- checkboxes ---
  if (controlType === 'input-checkbox') {
    let check: boolean | null = null;
    if (typeof value === 'boolean') {
      check = value;
    } else if (typeof value === 'string') {
      const lower = value.trim().toLowerCase();
      if (lower === 'yes' || lower === 'true' || lower === '1') check = true;
      else if (lower === 'no' || lower === 'false' || lower === '0') check = false;
    }

    if (check !== null) {
      const kind: InteractionKind = check ? 'check' : 'uncheck';
      const req: CheckboxRequest = { stableId: field.stableId, kind };
      return basePlan(req);
    } else if (Array.isArray(value)) {
      const optionValue = field.options?.[0]?.value ?? '';
      const haystack = [field.label, field.name, field.id, optionValue].filter(Boolean).join(' ').toLowerCase();
      let matched = false;
      for (const item of value) {
        if (typeof item === 'string' && haystack.includes(item.trim().toLowerCase())) {
          matched = true;
          break;
        }
      }
      const kind: InteractionKind = matched ? 'check' : 'uncheck';
      const req: CheckboxRequest = { stableId: field.stableId, kind };
      return basePlan(req);
    }
    return baseSkip('checkbox_value_not_boolean', `profile "${key}" is ${typeof value}, expected boolean, string (yes/no) or array`);
  }

  // --- radio (single-field surface in detector is one FormField with options[]) ---
  if (controlType === 'input-radio') {
    if (typeof value !== 'string') {
      return baseSkip('radio_value_not_found', `profile "${key}" is not a string`);
    }
    const wanted = value;
    const matchOpt = findSelectOptionFuzzy(field.options, wanted);
    if (!matchOpt) {
      return baseSkip('radio_value_not_found', `no radio option matches "${wanted}"`);
    }
    const req: RadioRequest = {
      stableId: field.stableId,
      kind: 'select-radio',
      value: matchOpt.value,
    };
    return basePlan(req);
  }

  // --- selects ---
  if (controlType === 'select') {
    if (value === null || value === undefined) {
      return baseSkip('select_option_not_found', 'profile value is null');
    }
    if (typeof value === 'string') {
      const matchOpt = findSelectOptionFuzzy(field.options, value);
      if (!matchOpt) {
        return baseSkip('select_option_not_found', `no option matches "${value}"`);
      }
      const req: SelectOptionRequest = {
        stableId: field.stableId,
        kind: 'select-option',
        by: 'value',
        value: matchOpt.value,
      };
      return basePlan(req);
    }
    if (typeof value === 'object' && !Array.isArray(value) && 'value' in value) {
      const target = (value as { value: unknown }).value;
      if (typeof target !== 'string') {
        return baseSkip('select_option_not_found', 'profile value object is malformed');
      }
      const matchOpt = findSelectOptionFuzzy(field.options, target);
      if (!matchOpt) {
        return baseSkip('select_option_not_found', `no option matches value "${target}"`);
      }
      const req: SelectOptionRequest = {
        stableId: field.stableId,
        kind: 'select-option',
        by: 'value',
        value: matchOpt.value,
      };
      return basePlan(req);
    }
    return baseSkip('select_option_not_found', `unsupported profile value type: ${typeof value}`);
  }

  // --- dates / times ---
  if (controlType === 'input-date') {
    const s = asString(value);
    if (s === null) return baseSkip('value_unsupported', 'date requires a string/number/boolean');
    const req: SetDateRequest = { stableId: field.stableId, kind: 'set-date', value: s };
    return basePlan(req);
  }
  if (controlType === 'input-time') {
    const s = asString(value);
    if (s === null) return baseSkip('value_unsupported', 'time requires a string/number/boolean');
    const req: SetTimeRequest = { stableId: field.stableId, kind: 'set-time', value: s };
    return basePlan(req);
  }
  if (controlType === 'input-month' || controlType === 'input-week' || controlType === 'input-datetime-local') {
    const s = asString(value);
    if (s === null) return baseSkip('value_unsupported', 'datetime requires a string/number/boolean');
    const req: SetTextRequest = { stableId: field.stableId, kind: 'set-text', value: s };
    return basePlan(req);
  }

  // --- textarea ---
  if (controlType === 'textarea') {
    if (typeof value !== 'string') {
      return baseSkip('value_unsupported', 'textarea requires a string');
    }
    const req: SetTextRequest = { stableId: field.stableId, kind: 'set-textarea', value };
    return basePlan(req);
  }

  // --- everything else: text-like ---
  if (
    controlType === 'input-text' ||
    controlType === 'input-email' ||
    controlType === 'input-tel' ||
    controlType === 'input-url' ||
    controlType === 'input-search' ||
    controlType === 'input-number' ||
    controlType === 'input-color' ||
    controlType === 'input-range'
  ) {
    const s = asString(value);
    if (s === null) return baseSkip('value_unsupported', 'requires a string/number/boolean');
    const req: SetTextRequest = { stableId: field.stableId, kind: 'set-text', value: s };
    return basePlan(req);
  }

  return baseSkip('value_unsupported', `unsupported controlType: ${controlType}`);
}
