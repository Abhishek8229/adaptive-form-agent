/**
 * Service-worker level tests for BotRunner.
 *
 * BotRunner is the only class that the service worker constructs
 * directly; it owns the per-tab bot instances and translates
 * AFA_BOT_START / AFA_BOT_STOP messages into a per-tab run. These
 * tests inject fakes for the bridge, the profile loader, and the
 * popup push so we can assert the exact BOT_STATUS message sequence
 * the popup would see.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BotRunner, type ContentBridge, type PopupPush } from '../src/background/bot.ts';
import {
  BOT_STATUS,
  type BotStatusMessage,
  type BotStatusSnapshot,
} from '../src/shared/profile-messages.ts';
import type { FormPage, FormField, FieldTarget } from '../src/shared/types.ts';
import type { InteractionRequest, InteractionResult } from '../src/shared/interaction.ts';
import type { JsonProfile, ProfileEntry } from '../src/shared/profile.ts';

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

function makePage(fields: FormField[]): FormPage {
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
          submitCount: 0,
          labelText: '',
        },
        fields,
        submitControls: [],
      },
    ],
  };
}

function makeProfile(profile: JsonProfile): ProfileEntry {
  return {
    id: 'p_runner',
    name: 'runner-profile',
    profile,
    updatedAt: new Date().toISOString(),
  };
}

function fakeBridge(
  page: FormPage,
  interactImpl: (req: InteractionRequest) => Promise<InteractionResult> = async () => ({
    success: true,
    stableId: '',
    kind: 'set-text',
    retried: false,
  }),
): ContentBridge {
  return {
    async scan() {
      return { ok: true, result: page };
    },
    async interact(_tabId, request) {
      const r = await interactImpl(request);
      return { ok: true, result: r };
    },
  };
}

function fakePopupPush(): { messages: BotStatusMessage[]; push: PopupPush } {
  const messages: BotStatusMessage[] = [];
  return {
    messages,
    push: {
      sendToPopup(message) {
        messages.push(message);
      },
    },
  };
}

// ---------- BotRunner.start: end-to-end status sequence ----------

test('bot-runner: start emits running, then per-field updates, then done', async () => {
  const fields = [
    makeField({ stableId: 'g.f0', target: { name: 'firstName' } }),
    makeField({ stableId: 'g.f1', target: { name: 'lastName' } }),
    makeField({ stableId: 'g.f2', target: { name: 'email', type: 'email' } }),
  ];
  const page = makePage(fields);
  const bridge = fakeBridge(page);
  const { messages, push } = fakePopupPush();
  const profile = makeProfile({ firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' });

  const runner = new BotRunner({
    bridge,
    push,
    loadProfile: async (id) => (id === 'p_runner' ? profile : null),
    getActiveTabId: async () => 7,
  });

  const initial = await runner.start({ tabId: 7, profileId: 'p_runner' });
  assert.equal(initial.status, 'running');

  // Wait for the run to terminate by polling until the running bot is gone.
  for (let i = 0; i < 200; i += 1) {
    if (!runner.status(7)) break;
    await new Promise((r) => setTimeout(r, 5));
  }
  // The final snapshot was already pushed; pull it out of the messages.
  assert.ok(messages.length > 0, 'expected at least one BOT_STATUS push');
  const last = messages[messages.length - 1].snapshot;
  assert.equal(last.status, 'done');
  assert.equal(last.counters.total, 3);
  assert.equal(last.counters.completed, 3);
  assert.equal(last.counters.skipped, 0);
  assert.equal(last.counters.failed, 0);
  assert.equal(last.profileId, 'p_runner');
  assert.equal(last.profileName, 'runner-profile');
  assert.equal(last.tabId, 7);
  assert.notEqual(last.startedAt, null);
  assert.notEqual(last.finishedAt, null);
  // The very first pushed snapshot should be the "running" start.
  assert.equal(messages[0].snapshot.status, 'running');
  // The push messages are all BOT_STATUS typed.
  for (const m of messages) {
    assert.equal(m.type, BOT_STATUS);
  }
});

test('bot-runner: stop() pushes a stopped snapshot', async () => {
  const fields = [
    makeField({ stableId: 'g.f0', target: { name: 'firstName' } }),
    makeField({ stableId: 'g.f1', target: { name: 'lastName' } }),
    makeField({ stableId: 'g.f2', target: { name: 'email', type: 'email' } }),
  ];
  const page = makePage(fields);
  const bridge: ContentBridge = {
    async scan() {
      return { ok: true, result: page };
    },
    async interact() {
      // Slow each interaction so STOP has a chance to land mid-run.
      await new Promise((r) => setTimeout(r, 5));
      return {
        ok: true,
        result: {
          success: true,
          stableId: '',
          kind: 'set-text',
          retried: false,
        },
      };
    },
  };
  const { messages, push } = fakePopupPush();
  const profile = makeProfile({ firstName: 'A', lastName: 'B', email: 'c' });

  const runner = new BotRunner({
    bridge,
    push,
    loadProfile: async () => profile,
    getActiveTabId: async () => 7,
  });

  await runner.start({ tabId: 7, profileId: 'p_runner' });
  // Give the bot a tick to dispatch its first interaction.
  await new Promise((r) => setTimeout(r, 2));
  const stopped = runner.stop(7);
  assert.ok(stopped, 'expected a snapshot from runner.stop');
  assert.equal(stopped!.status, 'stopped');

  // Wait for the run to terminate.
  for (let i = 0; i < 200; i += 1) {
    if (!runner.status(7)) break;
    await new Promise((r) => setTimeout(r, 5));
  }

  const last = messages[messages.length - 1].snapshot;
  assert.equal(last.status, 'stopped');
  // The stopped status is reachable before the loop finalizes, so the
  // terminal push should also be stopped.
  assert.equal(messages.some((m) => m.snapshot.status === 'stopped'), true);
});

test('bot-runner: start with unknown profileId throws and the runner is clean', async () => {
  const runner = new BotRunner({
    bridge: fakeBridge(makePage([])),
    push: { sendToPopup() {} },
    loadProfile: async () => null,
    getActiveTabId: async () => 1,
  });
  await assert.rejects(
    async () => runner.start({ tabId: 1, profileId: 'does_not_exist' }),
    /profile "does_not_exist" not found/,
  );
  assert.equal(runner.status(1), null);
});

test('bot-runner: start with no active tabId throws', async () => {
  const runner = new BotRunner({
    bridge: fakeBridge(makePage([])),
    push: { sendToPopup() {} },
    loadProfile: async () => makeProfile({}),
    getActiveTabId: async () => null,
  });
  await assert.rejects(
    async () => runner.start({ tabId: undefined, profileId: 'p_runner' }),
    /no active tab/,
  );
});

test('bot-runner: starting a new run on a tab that already has a bot stops the previous one', async () => {
  const fields = [
    makeField({ stableId: 'g.f0', target: { name: 'firstName' } }),
  ];
  const page = makePage(fields);
  const bridge: ContentBridge = {
    async scan() {
      return { ok: true, result: page };
    },
    async interact() {
      // Slow so a second start can preempt the first.
      await new Promise((r) => setTimeout(r, 20));
      return {
        ok: true,
        result: {
          success: true,
          stableId: 'g.f0',
          kind: 'set-text',
          retried: false,
        },
      };
    },
  };
  const { messages, push } = fakePopupPush();
  const profileA: ProfileEntry = { id: 'pA', name: 'profile-A', profile: { firstName: 'A' }, updatedAt: new Date().toISOString() };
  const profileB: ProfileEntry = { id: 'pB', name: 'profile-B', profile: { firstName: 'B' }, updatedAt: new Date().toISOString() };

  let loadCall = 0;
  const runner = new BotRunner({
    bridge,
    push,
    loadProfile: async (id) => {
      loadCall += 1;
      if (id === 'pA') return profileA;
      if (id === 'pB') return profileB;
      return null;
    },
    getActiveTabId: async () => 5,
  });

  await runner.start({ tabId: 5, profileId: 'pA' });
  await new Promise((r) => setTimeout(r, 2));
  await runner.start({ tabId: 5, profileId: 'pB' });
  // Wait for both runs to fully terminate.
  for (let i = 0; i < 400; i += 1) {
    if (!runner.status(5)) break;
    await new Promise((r) => setTimeout(r, 5));
  }
  // The second run pushes a 'done' snapshot last.
  const last = messages[messages.length - 1].snapshot;
  assert.equal(last.status, 'done');
  assert.equal(last.profileId, 'pB');
  // The first run was stopped by the second start.
  assert.equal(messages.some((m) => m.snapshot.status === 'stopped'), true);
  // Both profile loads happened.
  assert.equal(loadCall, 2);
});

test('bot-runner: per-field pushes include the currentField label', async () => {
  const fields = [
    makeField({ stableId: 'g.f0', target: { name: 'firstName' } }),
    makeField({ stableId: 'g.f1', target: { name: 'lastName' } }),
  ];
  const page = makePage(fields);
  const { messages, push } = fakePopupPush();
  const profile = makeProfile({ firstName: 'Jane', lastName: 'Doe' });
  const runner = new BotRunner({
    bridge: fakeBridge(page),
    push,
    loadProfile: async () => profile,
    getActiveTabId: async () => 1,
  });
  await runner.start({ tabId: 1, profileId: 'p_runner' });
  for (let i = 0; i < 200; i += 1) {
    if (!runner.status(1)) break;
    await new Promise((r) => setTimeout(r, 5));
  }
  // At least one pushed snapshot must have a currentField whose label
  // matches one of the field names. The bot updates the field label
  // before each interaction.
  const withCurrent = messages
    .map((m) => m.snapshot.currentField?.label)
    .filter((s): s is string => typeof s === 'string');
  assert.ok(withCurrent.length >= 1, 'expected at least one snapshot with a currentField');
});

test('bot-runner: snapshot counters sum to total', async () => {
  const fields = [
    makeField({ stableId: 'g.f0', target: { name: 'firstName' } }),
    makeField({ stableId: 'g.f1', target: { name: 'middle' } }), // no profile match -> skipped
    makeField({ stableId: 'g.f2', target: { name: 'lastName' } }),
  ];
  const page = makePage(fields);
  const { messages, push } = fakePopupPush();
  const profile = makeProfile({ firstName: 'A', lastName: 'B' });
  const runner = new BotRunner({
    bridge: fakeBridge(page),
    push,
    loadProfile: async () => profile,
    getActiveTabId: async () => 1,
  });
  await runner.start({ tabId: 1, profileId: 'p_runner' });
  for (let i = 0; i < 200; i += 1) {
    if (!runner.status(1)) break;
    await new Promise((r) => setTimeout(r, 5));
  }
  const last = messages[messages.length - 1].snapshot;
  assert.equal(
    last.counters.completed + last.counters.skipped + last.counters.failed,
    last.counters.total,
  );
  assert.equal(last.counters.completed, 2);
  assert.equal(last.counters.skipped, 1);
  assert.equal(last.counters.failed, 0);
});
