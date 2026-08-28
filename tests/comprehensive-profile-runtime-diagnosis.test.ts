import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import type { BotStatusSnapshot } from '../src/shared/profile-messages.ts';
import type { ContentBridge } from '../src/background/bot.ts';
import type { FormField, FormPage } from '../src/shared/types.ts';
import type { InteractionRequest } from '../src/shared/interaction.ts';
import type { JsonProfile, ProfileEntry, ProfileValue } from '../src/shared/profile.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const complexFormPath = resolve(__dirname, '..', 'complex-form.html');
const profilePath = resolve(__dirname, '..', 'comprehensive-profile.json');

function initDomGlobals(dom: JSDOM): void {
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = dom.window;
  g.document = dom.window.document;
  g.location = dom.window.location;
  g.HTMLElement = dom.window.HTMLElement;
  g.HTMLInputElement = dom.window.HTMLInputElement;
  g.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
  g.HTMLSelectElement = dom.window.HTMLSelectElement;
  g.HTMLButtonElement = dom.window.HTMLButtonElement;
  g.HTMLOptionElement = dom.window.HTMLOptionElement;
  g.HTMLFormElement = dom.window.HTMLFormElement;
  g.HTMLLabelElement = dom.window.HTMLLabelElement;
  g.HTMLCollection = dom.window.HTMLCollection;
  g.Element = dom.window.Element;
  g.Event = dom.window.Event;
  g.MouseEvent = dom.window.MouseEvent;
  g.CustomEvent = dom.window.CustomEvent;
  g.Node = dom.window.Node;
  g.NodeFilter = dom.window.NodeFilter;
  g.MutationObserver = dom.window.MutationObserver;
  g.CSS = dom.window.CSS || { escape: (s: string) => s.replace(/([!"#$%&'()*+,./:;<=>?@[\]^`{|}~])/g, '\\$1') };
  g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
}

function installVisibilityShim(dom: JSDOM): void {
  const protoProto = Object.getPrototypeOf(dom.window.HTMLElement.prototype) as {
    getBoundingClientRect?: () => DOMRect;
  };
  protoProto.getBoundingClientRect = function (this: Element) {
    const el = this as HTMLElement;
    const style = dom.window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return zeroRect();
    }
    let parent = el.parentElement;
    while (parent) {
      const ps = dom.window.getComputedStyle(parent);
      if (ps.display === 'none' || ps.visibility === 'hidden') return zeroRect();
      parent = parent.parentElement;
    }
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 100,
      bottom: 30,
      width: 100,
      height: 30,
      toJSON() {
        return {};
      },
    } as DOMRect;
  };
}

function zeroRect(): DOMRect {
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    toJSON() {
      return {};
    },
  } as DOMRect;
}

function fieldLabel(f: FormField): string {
  return f.label || f.ariaLabel || f.placeholder || f.name || f.id || f.stableId;
}

function stableFields(page: FormPage): Map<string, FormField> {
  const out = new Map<string, FormField>();
  for (const group of page.forms) {
    for (const field of group.fields) out.set(field.stableId, field);
  }
  return out;
}

function sourceForReason(reason: string): 'preFilter' | 'planner' {
  if (
    reason === 'field is disabled' ||
    reason === 'field is readonly' ||
    reason === 'sensitive field' ||
    reason === 'field already has a value' ||
    reason === 'field is not visible' ||
    reason.startsWith('unsupported controlType:')
  ) {
    return 'preFilter';
  }
  return 'planner';
}

function valueSummary(value: ProfileValue | undefined): string {
  if (value === undefined) return '<missing>';
  return JSON.stringify(value);
}

test('diagnosis: comprehensive profile browser-equivalent skip reasons', async () => {
  const html = readFileSync(complexFormPath, 'utf8');
  const profile = JSON.parse(readFileSync(profilePath, 'utf8')) as JsonProfile;
  const dom = new JSDOM(html, {
    url: 'file:///E:/adaptive-form-agent/tests/complex-form.html',
    pretendToBeVisual: true,
    runScripts: 'dangerously',
  });
  installVisibilityShim(dom);
  initDomGlobals(dom);

  const { detectPage } = await import('../src/content/detector.ts');
  const { runInteraction, setPageSnapshot } = await import('../src/content/interaction/engine.ts');
  const { Bot } = await import('../src/background/bot.ts');
  const { planField } = await import('../src/background/agent.ts');

  let scannedPage: FormPage | null = null;
  const snapshots: BotStatusSnapshot[] = [];
  const skipped: Array<{ stableId: string; label: string; reason: string }> = [];
  let prevSkipped = 0;

  const bridge: ContentBridge = {
    async scan() {
      scannedPage = detectPage();
      setPageSnapshot(scannedPage);
      return { ok: true, result: scannedPage };
    },
    async interact(_tabId: number, request: InteractionRequest) {
      const result = await runInteraction(request);
      return { ok: true, result };
    },
  };

  const profileEntry: ProfileEntry = {
    id: 'p_comprehensive',
    name: 'comprehensive-profile',
    profile,
    updatedAt: new Date().toISOString(),
  };

  const bot = new Bot({
    tabId: 1,
    profile: profileEntry,
    bridge,
    pushStatus: (snapshot) => {
      snapshots.push(snapshot);
      if (snapshot.counters.skipped > prevSkipped && snapshot.currentField) {
        skipped.push({
          stableId: snapshot.currentField.stableId,
          label: snapshot.currentField.label,
          reason: snapshot.currentField.reason,
        });
      }
      prevSkipped = snapshot.counters.skipped;
    },
  });

  const result = await bot.run();
  assert.ok(scannedPage);
  assert.equal(result.status, 'done', result.lastError ?? 'bot did not finish');
  // assert.equal(result.counters.total, 95);
  // assert.equal(result.counters.completed, 67);
  // assert.equal(result.counters.skipped, 28);
  // assert.equal(result.counters.failed, 0);
  // assert.equal(skipped.length, 28);

  const fields = stableFields(scannedPage);
  const lines: string[] = [];
  for (const [i, event] of skipped.entries()) {
    const field = fields.get(event.stableId);
    assert.ok(field, `missing field for ${event.stableId}`);
    const plan = await planField(field, profile);
    const source = sourceForReason(event.reason);
    const matchedKey = plan.ok ? plan.profileKey : null;
    const value = matchedKey === null ? undefined : profile[matchedKey];
    const detail = plan.ok ? `would fill via ${plan.profileKey}` : (plan.detail ?? '');
    lines.push(
      [
        String(i + 1).padStart(2, '0'),
        source,
        event.reason,
        `id=${field.id || '-'}`,
        `name=${field.name || '-'}`,
        `type=${field.controlType}`,
        `semantic=${field.semanticHint}`,
        `label=${JSON.stringify(fieldLabel(field))}`,
        `matched=${matchedKey ?? '-'}`,
        `value=${valueSummary(value)}`,
        detail ? `detail=${JSON.stringify(detail)}` : 'detail=-',
      ].join(' | '),
    );
  }

  console.log('\nCOMPREHENSIVE_PROFILE_RUNTIME_SKIPS_START');
  console.log(lines.join('\n'));
  console.log('COMPREHENSIVE_PROFILE_RUNTIME_SKIPS_END\n');

  dom.window.close();
  assert.ok(snapshots.length > 0);
});
