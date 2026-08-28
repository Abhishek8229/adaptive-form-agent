/**
 * Diagnostic test for complex-form.html skip analysis.
 *
 * Runs two profiles:
 *   1. A minimal profile (similar to integration test's EXAMPLE_PROFILE)
 *   2. A comprehensive profile that covers most fields
 *
 * Reports skip reasons grouped by category for both.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const complexFormPath = resolve(__dirname, '..', '..', 'tests', 'complex-form.html');

const seedHtml = readFileSync(complexFormPath, 'utf8');
const seedDom = new JSDOM(seedHtml, {
  url: 'http://localhost/',
  pretendToBeVisual: true,
  runScripts: 'dangerously',
});

const g = globalThis as unknown as Record<string, unknown>;
g.window = seedDom.window;
g.document = seedDom.window.document;
g.location = seedDom.window.location;
g.HTMLElement = seedDom.window.HTMLElement;
g.HTMLInputElement = seedDom.window.HTMLInputElement;
g.HTMLTextAreaElement = seedDom.window.HTMLTextAreaElement;
g.HTMLSelectElement = seedDom.window.HTMLSelectElement;
g.HTMLButtonElement = seedDom.window.HTMLButtonElement;
g.HTMLOptionElement = seedDom.window.HTMLOptionElement;
g.HTMLFormElement = seedDom.window.HTMLFormElement;
g.HTMLLabelElement = seedDom.window.HTMLLabelElement;
g.HTMLCollection = seedDom.window.HTMLCollection;
g.Element = seedDom.window.Element;
g.Event = seedDom.window.Event;
g.MouseEvent = seedDom.window.MouseEvent;
g.CustomEvent = seedDom.window.CustomEvent;
g.CSS =
  seedDom.window.CSS ||
  { escape: (s: string) => s.replace(/([!"#$%&'()*+,./:;<=>?@[\]^`{|}~])/g, '\\$1') };
g.Node = seedDom.window.Node;
g.MutationObserver = seedDom.window.MutationObserver;
g.getComputedStyle = seedDom.window.getComputedStyle.bind(seedDom.window);

function installVisibilityShim(dom: JSDOM): void {
  const protoProto = Object.getPrototypeOf(dom.window.HTMLElement.prototype) as {
    getBoundingClientRect?: () => DOMRect;
  };
  protoProto.getBoundingClientRect = function (this: Element) {
    const el = this as HTMLElement;
    const style = dom.window.getComputedStyle(el);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0'
    ) {
      return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() { return {}; } } as DOMRect;
    }
    let parent = el.parentElement;
    while (parent) {
      const ps = dom.window.getComputedStyle(parent);
      if (ps.display === 'none') {
        return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() { return {}; } } as DOMRect;
      }
      parent = parent.parentElement;
    }
    return { x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 30, width: 100, height: 30, toJSON() { return {}; } } as DOMRect;
  };
}
installVisibilityShim(seedDom);

const { detectPage } = await import('../src/content/detector.ts');
const { setPageSnapshot } = await import('../src/content/interaction/engine.ts');
const { planField } = await import('../src/background/agent.ts');

import type { FormField, FormPage } from '../src/shared/types.ts';
import type { JsonProfile } from '../src/shared/profile.ts';

// preFilter copied from bot.ts (the exact same logic the bot uses)
function preFilter(field: FormField): string | null {
  if (field.disabled) return 'field is disabled';
  if (field.readOnly) return 'field is readonly';
  if (field.containsSensitiveValue) return 'sensitive field';
  if (
    field.controlType === 'input-password' ||
    field.controlType === 'input-file' ||
    field.controlType === 'input-hidden' ||
    field.controlType === 'input-submit' ||
    field.controlType === 'input-reset' ||
    field.controlType === 'input-image' ||
    field.controlType === 'input-button' ||
    field.controlType === 'button'
  ) {
    return `unsupported controlType: ${field.controlType}`;
  }
  if (
    field.valuePresent &&
    field.controlType !== 'input-checkbox' &&
    field.controlType !== 'input-radio' &&
    field.controlType !== 'select'
  ) {
    return 'field already has a value';
  }
  if (!field.visible) return 'field is not visible';
  return null;
}

type SkipCategory =
  | 'sensitive/protected field'
  | 'hidden field'
  | 'readonly/disabled'
  | 'unsupported control'
  | 'no matching profile value'
  | 'radio/checkbox/select handling'
  | 'field already has a value'
  | 'other';

function categorize(preFilterReason: string | null, planReason: string | null): SkipCategory {
  const reason = preFilterReason ?? planReason ?? '';
  if (reason.includes('disabled') || reason.includes('readonly')) return 'readonly/disabled';
  if (reason.includes('sensitive')) return 'sensitive/protected field';
  if (reason.includes('input-password') || reason.includes('input-file')) return 'sensitive/protected field';
  if (
    reason.includes('input-hidden') ||
    reason.includes('input-submit') ||
    reason.includes('input-reset') ||
    reason.includes('input-image') ||
    reason.includes('input-button') ||
    reason === 'unsupported controlType: button'
  ) return 'unsupported control';
  if (reason.includes('already has a value')) return 'field already has a value';
  if (reason.includes('not visible')) return 'hidden field';
  if (reason.includes('no_profile_match') || reason.includes('no_reliable_label')) return 'no matching profile value';
  if (
    reason.includes('checkbox') ||
    reason.includes('radio') ||
    reason.includes('select_option_not_found')
  ) return 'radio/checkbox/select handling';
  return 'other';
}

interface FieldDiag {
  stableId: string;
  id: string;
  name: string;
  label: string;
  controlType: string;
  outcome: 'completed' | 'skipped';
  skipSource?: 'preFilter' | 'planner';
  reason?: string;
  category?: SkipCategory;
}

function diagnoseFields(fields: FormField[], profile: JsonProfile): FieldDiag[] {
  const diagnostics: FieldDiag[] = [];
  for (const field of fields) {
    const fieldLabel = field.label || field.ariaLabel || field.placeholder || field.name || field.id || field.stableId;
    const preSkip = preFilter(field);
    if (preSkip !== null) {
      console.log(f.name + ' -> ' + res.reason); diagnostics.push({
        stableId: field.stableId,
        id: field.id,
        name: field.name,
        label: fieldLabel,
        controlType: field.controlType,
        outcome: 'skipped',
        skipSource: 'preFilter',
        reason: preSkip,
        category: categorize(preSkip, null),
      });
      continue;
    }
    const plan = await planField(field, profile);
    if (!plan.ok) {
      const detail = plan.detail ? ` (${plan.detail})` : '';
      console.log(f.name + ' -> ' + res.reason); diagnostics.push({
        stableId: field.stableId,
        id: field.id,
        name: field.name,
        label: fieldLabel,
        controlType: field.controlType,
        outcome: 'skipped',
        skipSource: 'planner',
        reason: `${plan.reason}${detail}`,
        category: categorize(null, plan.reason + (plan.detail ? `: ${plan.detail}` : '')),
      });
      continue;
    }
    console.log(f.name + ' -> ' + res.reason); diagnostics.push({
      stableId: field.stableId,
      id: field.id,
      name: field.name,
      label: fieldLabel,
      controlType: field.controlType,
      outcome: 'completed',
    });
  }
  return diagnostics;
}

function printReport(label: string, diagnostics: FieldDiag[]): void {
  const completed = diagnostics.filter(d => d.outcome === 'completed');
  const skipped = diagnostics.filter(d => d.outcome === 'skipped');

  console.log(`\n=== ${label} ===`);
  console.log(`Completed: ${completed.length}  |  Skipped: ${skipped.length}  |  Total: ${diagnostics.length}\n`);

  const grouped = new Map<SkipCategory, FieldDiag[]>();
  for (const d of skipped) {
    const cat = d.category!;
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(d);
  }

  for (const [cat, fields] of Array.from(grouped.entries()).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  [${cat}] (${fields.length}):`);
    for (const f of fields) {
      console.log(`    - ${f.id || f.name || f.stableId} (${f.controlType}) "${f.label}" → ${f.reason}`);
    }
  }
}

// ----- Profiles -----

const MINIMAL_PROFILE: JsonProfile = {
  firstName: 'Jane',
  lastName: 'Doe',
  fullName: 'Jane Doe',
  email: 'jane.doe@example.com',
  phone: '555-123-4567',
  address: '123 Main St',
  addressLine2: 'Apt 4B',
  city: 'Springfield',
  state: 'IL',
  postalCode: '62701',
  country: 'United States',
  username: 'jane_doe',
  url: 'https://example.com',
  dateOfBirth: '1990-01-15',
};

const COMPREHENSIVE_PROFILE: JsonProfile = {
  fullName: 'Jane Q. Doe',
  email: 'jane.doe@example.com',
  firstName: 'Jane',
  lastName: 'Doe',
  phone: '+1 555 0100',
  personalSite: 'https://example.com',
  bio: 'Experienced frontend engineer.',
  username: 'jane_doe',
  password: 'supersecret123',
  recoveryEmail: 'recovery@example.com',
  twoFactorCode: '123456',
  currentCompany: 'Acme Corp',
  jobTitle: 'Senior Frontend Engineer',
  employmentType: 'full_time',
  experienceLevel: 'senior',
  yearsExperience: 8,
  expectedSalary: 150000,
  workLocation: 'remote',
  noticePeriod: 'two_weeks',
  addressLine1: '123 Main St',
  addressLine2: 'Apt 4B',
  city: 'Springfield',
  state: 'IL',
  postalCode: '62701',
  country: 'us',
  dateOfBirth: '1990-01-15',
  preferredStartDate: '2025-06-01',
  preferredInterviewTime: '10:00',
  hoursOverlap: 'flexible',
  referralSource: 'linkedin',
  referrerName: 'John Smith',
  referralOther: 'A podcast episode',
  frameworks: true,
  backend: true,
  cloud: true,
  contactMethod: 'email',
  preferredLanguage: 'en',
  timezone: 'utc-5',
  newsletter: true,
  events: true,
  anonymousProfile: true,
  searchBox: 'engineering',
  minSalary: 100000,
  maxSalary: 200000,
  remoteOk: 'yes',
  terms: true,
  ageConfirm: true,
  alreadyFilled: 'new value',
  readonlyField: 'new value',
  disabledField: 'new value',
  hiddenField: 'new value',
  visHiddenField: 'new value',
  zeroOpacityField: 'new value',
  ariaHiddenField: 'new value',
  resume: 'resume.pdf',
  captcha: 'abc123',
  creditCardNumber: '4111111111111111',
  cvv: '123',
  otp: '654321',
  iban: 'DE00 0000 0000 0000 0000 00',
  trailingSpace: 'test',
  punctField: 'test',
  longLabel: 'test',
  emptyLabel: 'test',
  misleadingPlaceholder: 'test@example.com',
  similarA: 'work@example.com',
  similarB: 'personal@example.com',
  ariaLabelledBy: 'test',
  ariaOnly: 'test',
  usr_addr_1: '123 Elm St',
  usr_nick_99: 'JaneyD',
  caller_line: '+15550199',
  usr_loc_city: 'Chicago',
};

test('complex-form diagnosis: minimal profile', async () => {
  setPageSnapshot(null);
  const page: FormPage = detectPage();
  setPageSnapshot(page);

  const allFields: FormField[] = [];
  for (const group of page.forms) for (const f of group.fields) allFields.push(f);

  const diagnostics = diagnoseFields(allFields, MINIMAL_PROFILE);
  printReport('MINIMAL PROFILE (integration-like)', diagnostics);

  const skipped = diagnostics.filter(d => d.outcome === 'skipped');
  const completed = diagnostics.filter(d => d.outcome === 'completed');

  assert.ok(allFields.length === 84, `expected 84 fields, got ${allFields.length}`);
  // Just record the counts, no assertion on specific numbers
  console.log(`\n  → Minimal profile: ${completed.length} completed, ${skipped.length} skipped out of ${allFields.length}`);
});

test('complex-form diagnosis: comprehensive profile', async () => {
  setPageSnapshot(null);
  const page: FormPage = detectPage();
  setPageSnapshot(page);

  const allFields: FormField[] = [];
  for (const group of page.forms) for (const f of group.fields) allFields.push(f);

  const diagnostics = diagnoseFields(allFields, COMPREHENSIVE_PROFILE);
  printReport('COMPREHENSIVE PROFILE', diagnostics);

  const skipped = diagnostics.filter(d => d.outcome === 'skipped');
  const completed = diagnostics.filter(d => d.outcome === 'completed');

  assert.ok(allFields.length === 84, `expected 84 fields, got ${allFields.length}`);
  console.log(`\n  → Comprehensive profile: ${completed.length} completed, ${skipped.length} skipped out of ${allFields.length}`);
});
