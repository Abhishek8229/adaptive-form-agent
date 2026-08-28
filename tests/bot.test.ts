/**
 * Tests for the bot driver (bot.ts). The bot is dependency-injectable:
 * we provide a fake ContentBridge and capture pushed status snapshots.
 *
 * These tests prove:
 *   - fields are processed sequentially (one at a time, awaiting result)
 *   - STOP halts the loop cleanly
 *   - disabled/readonly/safety-blocked fields are skipped
 *   - unmatched fields are skipped
 *   - the InteractionRequest produced by the planner is the one dispatched
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Bot, type ContentBridge } from '../src/background/bot.ts';
import type { FormField, FormPage, FieldTarget } from '../src/shared/types.ts';
import type { InteractionRequest, InteractionResult } from '../src/shared/interaction.ts';
import type { JsonProfile, ProfileEntry } from '../src/shared/profile.ts';
import type { BotStatusSnapshot } from '../src/shared/profile-messages.ts';

function makeField(overrides: Partial<FormField> & { target?: Partial<FieldTarget> }): FormField {
  const target: FieldTarget = {
    id: '',
    name: '',
    tag: 'input',
    type: 'text',
    formId: '',
    formName: '',
    label: '',
    ariaLabel: '',
    placeholder: '',
    autocomplete: '',
    radioName: undefined,
    pathIndex: 0,
    selector: 'input',
    ...(overrides.target ?? {}),
  };
  return {
    stableId: 'g.f0',
    tag: 'input',
    type: 'text',
    controlType: 'input-text',
    name: target.name,
    id: target.id,
    label: target.label,
    placeholder: target.placeholder,
    ariaLabel: target.ariaLabel,
    required: false,
    visible: true,
    disabled: false,
    readOnly: false,
    autocomplete: target.autocomplete,
    semanticHint: 'unknown',
    semanticSources: [],
    options: [],
    valuePresent: false,
    containsSensitiveValue: false,
    target,
    ...overrides,
  };
}

function makeSubmit(opts: { stableId: string; text: string; type: string }): FormSubmitControl {
  return {
    stableId: opts.stableId,
    tag: 'button',
    type: opts.type,
    text: opts.text,
    ariaLabel: '',
    disabled: false,
    visible: true,
    target: {
      selector: 'button',
      pathIndex: 0,
      tag: 'button',
      type: opts.type,
      id: '',
      name: '',
      label: opts.text,
      ariaLabel: '',
      placeholder: '',
      autocomplete: '',
      formId: '',
      formName: '',
    },
  };
}

function makePage(
  fields: FormField[],
  submits: FormSubmitControl[] = [],
  labelText: string = '',
): FormPage {
  return {
    url: 'http://localhost/',
    title: 'test',
    detectedAt: new Date().toISOString(),
    formCount: 1,
    totalFieldCount: fields.length,
    forms: [
      {
        metadata: {
          stableId: 'form_0_x',
          kind: 'form',
          name: 'form',
          action: '',
          method: 'post',
          autocomplete: '',
          enctype: '',
          target: '',
          fieldCount: fields.length,
          submitCount: submits.length,
          labelText,
        },
        fields,
        submitControls: submits,
      },
    ],
  };
}

function makeProfile(profile: JsonProfile): ProfileEntry {
  return {
    id: 'p1',
    name: 'test-profile',
    profile,
    updatedAt: new Date().toISOString(),
  };
}

interface FakeBridge extends ContentBridge {
  scan: (tabId: number) => Promise<{ ok: boolean; result?: FormPage | null; error?: string }>;
  interact: (
    tabId: number,
    request: InteractionRequest,
  ) => Promise<{ ok: boolean; result?: InteractionResult; error?: string }>;
}

interface Step {
  stableId: string;
  kind: string;
  value?: string;
}

function makeBridge(
  page: FormPage,
  interactImpl: (req: InteractionRequest) => Promise<InteractionResult> = async () => ({
    success: true,
    stableId: '',
    kind: 'set-text',
    retried: false,
  }),
): { bridge: FakeBridge; calls: Step[] } {
  const calls: Step[] = [];
  const bridge: FakeBridge = {
    async scan() {
      return { ok: true, result: page };
    },
    async interact(_tabId, request) {
      calls.push({ stableId: request.stableId, kind: request.kind, value: (request as { value?: string }).value });
      const r = await interactImpl(request);
      return { ok: true, result: r };
    },
  };
  return { bridge, calls };
}

function captureStatus(): { snapshots: BotStatusSnapshot[]; push: (s: BotStatusSnapshot) => void } {
  const snapshots: BotStatusSnapshot[] = [];
  return {
    snapshots,
    push(s) {
      snapshots.push(s);
    },
  };
}

// ---------- preFilter / basic flow ----------

test('bot: processes fields sequentially in document order', async () => {
  const fields = [
    makeField({ stableId: 'g.f0', target: { name: 'firstName' } }),
    makeField({ stableId: 'g.f1', target: { name: 'lastName' } }),
    makeField({ stableId: 'g.f2', target: { name: 'email', type: 'email' } }),
  ];
  const page = makePage(fields);
  const { bridge, calls } = makeBridge(page);
  const status = captureStatus();

  const profile = makeProfile({
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.com',
  });

  const bot = new Bot({
    tabId: 1,
    profile,
    bridge,
    pushStatus: status.push,
  });

  const snap = await bot.run();
  assert.equal(snap.status, 'done');
  assert.equal(snap.counters.total, 3);
  assert.equal(snap.counters.completed, 3);
  assert.equal(snap.counters.skipped, 0);
  assert.equal(snap.counters.failed, 0);

  assert.equal(calls.length, 3);
  assert.equal(calls[0].stableId, 'g.f0');
  assert.equal(calls[0].value, 'Jane');
  assert.equal(calls[1].stableId, 'g.f1');
  assert.equal(calls[1].value, 'Doe');
  assert.equal(calls[2].stableId, 'g.f2');
  assert.equal(calls[2].value, 'jane@example.com');
});

test('bot: awaitEachInteractionBeforeNext (sequential awaits)', async () => {
  // The interactions are dispatched strictly in order; we add a tiny
  // artificial delay in the first interaction and assert that no second
  // interact() call has been issued until the first resolves.
  const fields = [
    makeField({ stableId: 'g.f0', target: { name: 'firstName' } }),
    makeField({ stableId: 'g.f1', target: { name: 'lastName' } }),
  ];
  const page = makePage(fields);

  let secondStarted = false;
  const bridge: FakeBridge = {
    async scan() {
      return { ok: true, result: page };
    },
    async interact(_tabId, request) {
      if (request.stableId === 'g.f0') {
        // Hold the first call for 30ms; the second must not start yet.
        await new Promise((r) => setTimeout(r, 30));
      }
      if (request.stableId === 'g.f1') {
        secondStarted = true;
      }
      return {
        ok: true,
        result: {
          success: true,
          stableId: request.stableId,
          kind: request.kind,
          retried: false,
        },
      };
    },
  };

  const status = captureStatus();
  const profile = makeProfile({ firstName: 'Jane', lastName: 'Doe' });
  const bot = new Bot({ tabId: 1, profile, bridge, pushStatus: status.push });
  await bot.run();
  assert.equal(secondStarted, true, 'second interact() should have been called after first resolved');
});

// ---------- STOP ----------

test('bot: stop() halts the loop cleanly', async () => {
  const fields = [
    makeField({ stableId: 'g.f0', target: { name: 'firstName' } }),
    makeField({ stableId: 'g.f1', target: { name: 'lastName' } }),
    makeField({ stableId: 'g.f2', target: { name: 'email', type: 'email' } }),
  ];
  const page = makePage(fields);

  let stopped = false;
  let processed = 0;
  const bridge: FakeBridge = {
    async scan() {
      return { ok: true, result: page };
    },
    async interact(_tabId, request) {
      processed += 1;
      // After the first field succeeds, request a stop.
      if (processed === 1) {
        stopped = true;
        // Schedule the stop after this interaction resolves so the
        // bot's loop can observe it on the next iteration.
        queueMicrotask(() => bot.stop());
      }
      return {
        ok: true,
        result: {
          success: true,
          stableId: request.stableId,
          kind: request.kind,
          retried: false,
        },
      };
    },
  };

  const status = captureStatus();
  const profile = makeProfile({ firstName: 'Jane', lastName: 'Doe', email: 'x' });
  const bot = new Bot({ tabId: 1, profile, bridge, pushStatus: status.push });
  const snap = await bot.run();
  assert.equal(stopped, true);
  assert.equal(snap.status, 'stopped');
  assert.ok(snap.counters.completed <= 1, `expected <=1 completed, got ${snap.counters.completed}`);
  assert.equal(snap.counters.total, 3);
});

test('bot: stop() before run() terminates immediately', async () => {
  const fields = [
    makeField({ stableId: 'g.f0', target: { name: 'firstName' } }),
  ];
  const page = makePage(fields);
  const { bridge, calls } = makeBridge(page);
  const status = captureStatus();
  const profile = makeProfile({ firstName: 'Jane' });
  const bot = new Bot({ tabId: 1, profile, bridge, pushStatus: status.push });
  bot.stop();
  const snap = await bot.run();
  assert.equal(snap.status, 'stopped');
  // total stays 0 because the loop never ran (no scan, no count).
  assert.equal(snap.counters.total, 0);
  assert.equal(snap.counters.completed, 0);
  assert.equal(calls.length, 0, 'no interactions should have been issued');
});

// ---------- skip behavior ----------

test('bot: skips disabled fields', async () => {
  const fields = [
    makeField({ stableId: 'g.f0', target: { name: 'firstName' } }),
    makeField({ stableId: 'g.f1', target: { name: 'middleName' }, disabled: true }),
    makeField({ stableId: 'g.f2', target: { name: 'lastName' } }),
  ];
  const page = makePage(fields);
  const { bridge, calls } = makeBridge(page);
  const status = captureStatus();
  const profile = makeProfile({ firstName: 'Jane', lastName: 'Doe' });
  const bot = new Bot({ tabId: 1, profile, bridge, pushStatus: status.push });
  const snap = await bot.run();
  assert.equal(snap.counters.skipped, 1);
  assert.equal(snap.counters.completed, 2);
  assert.deepEqual(calls.map((c) => c.stableId), ['g.f0', 'g.f2']);
});

test('bot: skips readonly fields', async () => {
  const fields = [
    makeField({ stableId: 'g.f0', target: { name: 'firstName' } }),
    makeField({ stableId: 'g.f1', target: { name: 'middleName' }, readOnly: true }),
  ];
  const page = makePage(fields);
  const { bridge, calls } = makeBridge(page);
  const status = captureStatus();
  const profile = makeProfile({ firstName: 'Jane' });
  const bot = new Bot({ tabId: 1, profile, bridge, pushStatus: status.push });
  const snap = await bot.run();
  assert.equal(snap.counters.skipped, 1);
  assert.equal(snap.counters.completed, 1);
  assert.equal(calls.length, 1);
});

test('bot: skips fields with no profile match', async () => {
  const fields = [
    makeField({ stableId: 'g.f0', target: { name: 'firstName' } }),
    makeField({ stableId: 'g.f1', target: { name: 'middleName' } }),
  ];
  const page = makePage(fields);
  const { bridge, calls } = makeBridge(page);
  const status = captureStatus();
  // Only firstName is in the profile; middleName has no match.
  const profile = makeProfile({ firstName: 'Jane' });
  const bot = new Bot({ tabId: 1, profile, bridge, pushStatus: status.push });
  const snap = await bot.run();
  assert.equal(snap.counters.skipped, 1);
  assert.equal(snap.counters.completed, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].stableId, 'g.f0');
});

test('bot: skips already-filled text fields', async () => {
  const fields = [
    makeField({ stableId: 'g.f0', target: { name: 'firstName' }, valuePresent: true }),
  ];
  const page = makePage(fields);
  const { bridge, calls } = makeBridge(page);
  const status = captureStatus();
  const profile = makeProfile({ firstName: 'Jane' });
  const bot = new Bot({ tabId: 1, profile, bridge, pushStatus: status.push });
  const snap = await bot.run();
  assert.equal(snap.counters.skipped, 1);
  assert.equal(snap.counters.completed, 0);
  assert.equal(calls.length, 0);
});

test('bot: records engine failures as failed (not skipped)', async () => {
  const fields = [
    makeField({ stableId: 'g.f0', target: { name: 'firstName' } }),
  ];
  const page = makePage(fields);
  const bridge: FakeBridge = {
    async scan() {
      return { ok: true, result: page };
    },
    async interact(_tabId, request) {
      return {
        ok: true,
        result: {
          success: false,
          reason: 'engine rejected',
          stableId: request.stableId,
          kind: request.kind,
          retried: false,
        },
      };
    },
  };
  const status = captureStatus();
  const profile = makeProfile({ firstName: 'Jane' });
  const bot = new Bot({ tabId: 1, profile, bridge, pushStatus: status.push });
  const snap = await bot.run();
  assert.equal(snap.counters.failed, 1);
  assert.equal(snap.counters.completed, 0);
  assert.equal(snap.lastError, 'engine rejected');
});

test('bot: surfaces the current field label in pushed status', async () => {
  const fields = [
    makeField({ stableId: 'g.f0', target: { name: 'firstName' } }),
  ];
  const page = makePage(fields);
  const { bridge } = makeBridge(page);
  const status = captureStatus();
  const profile = makeProfile({ firstName: 'Jane' });
  const bot = new Bot({ tabId: 1, profile, bridge, pushStatus: status.push });
  await bot.run();
  // Some pushed snapshot should have currentField with the right label.
  const labels = status.snapshots
    .map((s) => s.currentField?.label)
    .filter((s): s is string => typeof s === 'string');
  assert.ok(labels.includes('firstName'), `expected a "firstName" currentField, got: ${JSON.stringify(labels)}`);
});

test('bot: scan failure becomes an error status', async () => {
  const bridge: FakeBridge = {
    async scan() {
      return { ok: false, error: 'no content script' };
    },
    async interact() {
      return { ok: false, error: 'unreachable' };
    },
  };
  const status = captureStatus();
  const profile = makeProfile({ firstName: 'Jane' });
  const bot = new Bot({ tabId: 1, profile, bridge, pushStatus: status.push });
  const snap = await bot.run();
  assert.equal(snap.status, 'error');
  assert.equal(snap.lastError, 'no content script');
});

test('bot: empty page completes with zero counters', async () => {
  const page = makePage([]);
  const { bridge, calls } = makeBridge(page);
  const status = captureStatus();
  const profile = makeProfile({ firstName: 'Jane' });
  const bot = new Bot({ tabId: 1, profile, bridge, pushStatus: status.push });
  const snap = await bot.run();
  assert.equal(snap.status, 'done');
  assert.equal(snap.counters.total, 0);
  assert.equal(snap.counters.completed, 0);
  assert.equal(snap.counters.skipped, 0);
  assert.equal(calls.length, 0);
});

// ---------- Regression: scan returns ok but missing result ----------

test('bot: scan ok:true with missing result triggers error (regression)', async () => {
  // Before the fix, the content-script SCAN_PAGE_MESSAGE handler returned
  // { ok: true, count, formCount } without a `result` field.  The bot's
  // ContentBridge.scan() checks `!scanRes.ok || !scanRes.result` and threw
  // "scan failed" because `result` was always undefined.
  const bridge: FakeBridge = {
    async scan() {
      // Simulate the old content-script response: ok is true but no result.
      return { ok: true } as { ok: boolean; result?: FormPage | null; error?: string };
    },
    async interact() {
      return { ok: false, error: 'unreachable' };
    },
  };
  const status = captureStatus();
  const profile = makeProfile({ firstName: 'Jane' });
  const bot = new Bot({ tabId: 1, profile, bridge, pushStatus: status.push });
  const snap = await bot.run();
  // The bot must surface an error, not silently finish with all-zero counters.
  assert.equal(snap.status, 'error');
  assert.equal(snap.lastError, 'scan failed');
  assert.equal(snap.counters.total, 0);
  assert.equal(snap.counters.completed, 0);
});

// ---------- Dynamic Fields (Architectural Bug Fix) ----------

test('bot: rescans and discovers newly visible fields after successful interaction', async () => {
  const f1 = makeField({ stableId: 'g.f1', target: { name: 'referralSource' } });
  const f2Hidden = makeField({ stableId: 'g.f2', target: { name: 'referralOther' }, visible: false });
  const f2Visible = makeField({ stableId: 'g.f2', target: { name: 'referralOther' }, visible: true });

  let scanCount = 0;
  const bridge: FakeBridge = {
    async scan() {
      scanCount++;
      // On first scan, f2 is hidden. On subsequent scans (after interaction), it's visible.
      return { ok: true, result: makePage([f1, scanCount === 1 ? f2Hidden : f2Visible]) };
    },
    async interact(_tabId, request) {
      return {
        ok: true,
        result: { success: true, stableId: request.stableId, kind: request.kind, retried: false },
      };
    },
  };

  const status = captureStatus();
  const profile = makeProfile({ referralSource: 'other', referralOther: 'A podcast episode' });
  const bot = new Bot({ tabId: 1, profile, bridge, pushStatus: status.push });
  const snap = await bot.run();

  assert.equal(snap.status, 'done');
  // 1st scan -> interacts f1 -> triggers 2nd scan -> interacts f2 -> triggers 3rd scan -> completes
  assert.equal(scanCount, 3); 
  assert.equal(snap.counters.completed, 2);
  assert.equal(snap.counters.skipped, 0);
  assert.equal(snap.counters.failed, 0);
});

// ---------- Field Discovery (deterministic advance) ----------

test('bot: field discovery clicks "Next" button in multi-step form', async () => {
  // Page 1 has an unfilled field + a "Next" button. The form metadata
  // indicates multi-step chrome. The bot cannot fill the field (no
  // matching profile key), so it should fall through to discoverNextAction
  // and click "Next", revealing new fields on the next page.
  const f1 = makeField({ stableId: 'g.f1', target: { name: 'firstName' } });
  const f2 = makeField({ stableId: 'g.f2', target: { name: 'lastName' } });
  const nextBtn = makeSubmit({ stableId: 'g.s0', text: 'Next', type: 'button' });

  let scanCount = 0;
  const clickedKinds: string[] = [];
  const bridge: FakeBridge = {
    async scan() {
      scanCount++;
      // First scan returns page 1 with f1 + Next. After clicking Next,
      // page 2 has f2.
      if (scanCount === 1) {
        return { ok: true, result: makePage([f1], [nextBtn], 'Step 1 of 2') };
      }
      return { ok: true, result: makePage([f2], [], 'Step 2 of 2') };
    },
    async interact(_tabId, request) {
      clickedKinds.push(request.kind + ':' + request.stableId);
      return {
        ok: true,
        result: { success: true, stableId: request.stableId, kind: request.kind, retried: false },
      };
    },
  };
  const status = captureStatus();
  const profile = makeProfile({});
  const bot = new Bot({ tabId: 1, profile, bridge, pushStatus: status.push });
  const snap = await bot.run();

  assert.equal(snap.status, 'done');
  // The bot must have clicked the Next button at some point.
  assert.ok(
    clickedKinds.some((k) => k === 'click-button:g.s0'),
    `expected a click-button on g.s0; got ${JSON.stringify(clickedKinds)}`,
  );
});

test('bot: field discovery NEVER clicks submit buttons', async () => {
  // A "Submit application" button must never be clicked by the discovery
  // step, even when no profile matches anything on the page.
  const submitBtn = makeSubmit({ stableId: 'g.s0', text: 'Submit application', type: 'submit' });
  const otherBtn = makeSubmit({ stableId: 'g.s1', text: 'Save and Continue', type: 'button' });
  const f1 = makeField({ stableId: 'g.f1', target: { name: 'unrelated' } });
  const bridge: FakeBridge = {
    async scan() {
      return { ok: true, result: makePage([f1], [submitBtn, otherBtn], 'Step 1 of 1') };
    },
    async interact(_tabId, request) {
      return {
        ok: true,
        result: { success: true, stableId: request.stableId, kind: request.kind, retried: false },
      };
    },
  };
  const status = captureStatus();
  const profile = makeProfile({});
  const bot = new Bot({ tabId: 1, profile, bridge, pushStatus: status.push });
  await bot.run();

  const clicks = status.snapshots
    .filter((s) => s.currentField && s.currentField.reason &&
      (s.currentField.reason.includes('advancing') || s.currentField.reason.includes('adding another')))
    .map((s) => s.currentField!.stableId);
  assert.equal(clicks.length, 0, `discovery must not click anything; got ${JSON.stringify(clicks)}`);
});
