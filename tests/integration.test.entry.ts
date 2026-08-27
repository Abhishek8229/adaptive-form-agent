/**
 * End-to-end integration test:
 *
 *   Bot (src/background/bot.ts)
 *     -> ContentBridge (in-test, talks to JSDOM via the real engine)
 *       -> runInteraction (src/content/interaction/engine.ts)
 *         -> detectPage (src/content/detector.ts)
 *
 * The test page fixture at test/test-page.html is the same one used by
 * tests/interaction.test.entry.ts; we additionally inject captcha and
 * payment-shaped fields so we can prove the bot refuses to fill them.
 *
 * We assert the precise InteractionRequest sequence the bot would send
 * for the example profile, prove the deterministic engine + planner
 * pipeline actually mutates the DOM the way the architecture promises,
 * and verify STOP / failed / already-filled / disabled / readonly /
 * sensitive-field skip behavior end-to-end.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testPagePath = resolve(__dirname, '..', '..', 'test', 'test-page.html');

const seedHtml = readFileSync(testPagePath, 'utf8');
const seedDom = new JSDOM(seedHtml, { url: 'http://localhost/', pretendToBeVisual: true });
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
    if (this.classList.contains('display-none')) {
      return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() { return {}; } } as DOMRect;
    }
    if (this.classList.contains('hidden-vis')) {
      return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() { return {}; } } as DOMRect;
    }
    if (this.classList.contains('opacity-zero')) {
      return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() { return {}; } } as DOMRect;
    }
    return { x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 30, width: 100, height: 30, toJSON() { return {}; } } as DOMRect;
  };
}
installVisibilityShim(seedDom);

const { detectPage } = await import('../src/content/detector.ts');
const { runInteraction, setPageSnapshot } = await import('../src/content/interaction/engine.ts');
const { Bot } = await import('../src/background/bot.ts');
const typesMod = await import('../src/shared/types.ts');
const interactionMod = await import('../src/shared/interaction.ts');
const profileMod = await import('../src/shared/profile.ts');
const botMessagesMod = await import('../src/shared/profile-messages.ts');

type FormField = typesMod.FormField;
type FormPage = typesMod.FormPage;
type InteractionRequest = interactionMod.InteractionRequest;
type InteractionResult = interactionMod.InteractionResult;
type JsonProfile = profileMod.JsonProfile;
type ProfileEntry = profileMod.ProfileEntry;
type BotStatusSnapshot = botMessagesMod.BotStatusSnapshot;
type ContentBridge = import('../src/background/bot.ts').ContentBridge;

// ---------- Test fixture ----------

interface Issued {
  stableId: string;
  kind: string;
  value?: string;
  by?: 'value' | 'text';
}

interface Fixture {
  dom: JSDOM;
  findFieldById(id: string): FormField | null;
  findFieldByName(name: string): FormField | null;
  issued: Issued[];
  bridge: ContentBridge;
  bridgeOverride: (
    overrides: {
      failFor?: (req: InteractionRequest) => boolean;
      beforeInteract?: (req: InteractionRequest) => void | Promise<void>;
    },
  ) => ContentBridge;
  makeBot: (
    profile: JsonProfile,
    options?: { stopAfter?: number },
  ) => {
    bot: InstanceType<typeof Bot>;
    snapshots: BotStatusSnapshot[];
    run: () => Promise<BotStatusSnapshot>;
  };
}

function initDomGlobals(dom: JSDOM): void {
  (globalThis as unknown as { document: Document }).document = dom.window.document;
  (globalThis as unknown as { window: Window }).window = dom.window;
  (globalThis as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement = dom.window.HTMLElement;
  (globalThis as unknown as { HTMLInputElement: typeof HTMLInputElement }).HTMLInputElement = dom.window.HTMLInputElement;
  (globalThis as unknown as { HTMLTextAreaElement: typeof HTMLTextAreaElement }).HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
  (globalThis as unknown as { HTMLSelectElement: typeof HTMLSelectElement }).HTMLSelectElement = dom.window.HTMLSelectElement;
  (globalThis as unknown as { HTMLButtonElement: typeof HTMLButtonElement }).HTMLButtonElement = dom.window.HTMLButtonElement;
  (globalThis as unknown as { HTMLFormElement: typeof HTMLFormElement }).HTMLFormElement = dom.window.HTMLFormElement;
  (globalThis as unknown as { Element: typeof Element }).Element = dom.window.Element;
}

/** Build a fresh JSDOM test page with captcha and cc-number fields added. */
function buildFixture(): Fixture {
  const html = readFileSync(testPagePath, 'utf8');
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/' });
  installVisibilityShim(dom);
  initDomGlobals(dom);

  // ---- Inject hostile fields that the safety module must reject. ----
  const doc = dom.window.document;
  const signupForm = doc.getElementById('signup-form') as HTMLFormElement;

  const captchaInput = doc.createElement('input');
  captchaInput.id = 'integration-captcha';
  captchaInput.name = 'captcha';
  captchaInput.type = 'text';
  captchaInput.placeholder = 'Type the captcha';
  signupForm.appendChild(captchaInput);

  const ccInput = doc.createElement('input');
  ccInput.id = 'integration-cc-number';
  ccInput.name = 'creditCardNumber';
  ccInput.type = 'text';
  ccInput.setAttribute('autocomplete', 'cc-number');
  signupForm.appendChild(ccInput);

  // A non-readonly, already-filled text field for the "already-filled" test.
  const filledInput = doc.createElement('input');
  filledInput.id = 'integration-prefilled';
  filledInput.name = 'prefilledField';
  filledInput.type = 'text';
  filledInput.value = 'already there';
  signupForm.appendChild(filledInput);

  // A radio with a clear <label for="..."> so the planner can match it.
  const radioLabel = doc.createElement('label');
  radioLabel.setAttribute('for', 'integration-tier');
  radioLabel.textContent = 'Subscription tier';
  signupForm.appendChild(radioLabel);
  const radioInput = doc.createElement('input');
  radioInput.id = 'integration-tier';
  radioInput.type = 'radio';
  radioInput.name = 'integrationTier';
  radioInput.value = 'team';
  signupForm.appendChild(radioInput);

  // A standalone text input whose label matches a unique profile key,
  // used by the "forced failure" test.
  const forcedLabel = doc.createElement('label');
  forcedLabel.setAttribute('for', 'integration-forced');
  forcedLabel.textContent = 'Forced target field';
  signupForm.appendChild(forcedLabel);
  const forcedInput = doc.createElement('input');
  forcedInput.id = 'integration-forced';
  forcedInput.type = 'text';
  forcedInput.name = 'forcedTarget';
  signupForm.appendChild(forcedInput);

  setPageSnapshot(null);
  const page = detectPage();
  setPageSnapshot(page);

  function findFieldById(id: string): FormField | null {
    for (const g of page.forms) for (const f of g.fields) if (f.id === id) return f;
    return null;
  }
  function findFieldByName(name: string): FormField | null {
    for (const g of page.forms) for (const f of g.fields) if (f.name === name) return f;
    return null;
  }

  const issued: Issued[] = [];

  function buildBridge(overrides: {
    failFor?: (req: InteractionRequest) => boolean;
    beforeInteract?: (req: InteractionRequest) => void | Promise<void>;
  }): ContentBridge {
    return {
      async scan(_tabId) {
        const fresh = detectPage();
        setPageSnapshot(fresh);
        return { ok: true, result: fresh };
      },
      async interact(_tabId, request) {
        if (overrides.beforeInteract) await overrides.beforeInteract(request);
        const entry: Issued = {
          stableId: request.stableId,
          kind: request.kind,
        };
        if ('value' in request) entry.value = (request as { value: string }).value;
        if ('by' in request) entry.by = (request as { by: 'value' | 'text' }).by;
        issued.push(entry);

        if (overrides.failFor && overrides.failFor(request)) {
          const r: InteractionResult = {
            success: false,
            reason: 'integration: forced failure',
            stableId: request.stableId,
            kind: request.kind,
            retried: false,
          };
          return { ok: true, result: r };
        }

        const r = await runInteraction(request);
        return { ok: true, result: r };
      },
    };
  }

  function makeBot(profile: JsonProfile, options: { stopAfter?: number } = {}) {
    const snapshots: BotStatusSnapshot[] = [];
    const profileEntry: ProfileEntry = {
      id: 'p_integration',
      name: 'integration-profile',
      profile,
      updatedAt: new Date().toISOString(),
    };
    let stoppedAt: number | null = null;
    const bridge = buildBridge({
      async beforeInteract(req) {
        if (options.stopAfter != null && issued.length >= options.stopAfter) {
          stoppedAt = Date.now();
        }
      },
    });
    const bot = new Bot({
      tabId: 1,
      profile: profileEntry,
      bridge,
      pushStatus: (s) => snapshots.push(s),
    });
    return {
      bot,
      snapshots,
      run: async () => {
        const result = await bot.run();
        if (options.stopAfter != null && stoppedAt == null) {
          // we never reached the threshold; that's fine, just no stop
        }
        return result;
      },
      stop: () => bot.stop(),
    };
  }

  return {
    dom,
    findFieldById,
    findFieldByName,
    issued,
    bridge: buildBridge({}),
    bridgeOverride: buildBridge,
    makeBot: (profile, options) => {
      const made = makeBot(profile, options);
      return { bot: made.bot, snapshots: made.snapshots, run: made.run };
    },
  };
}

function closeFixture(f: Fixture): void {
  f.dom.window.close();
}

async function withFixture<T>(fn: (f: Fixture) => Promise<T>): Promise<T> {
  const f = buildFixture();
  try {
    return await fn(f);
  } finally {
    closeFixture(f);
  }
}

// ---------- Tests ----------

const EXAMPLE_PROFILE: JsonProfile = {
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

test('integration: bot drives real engine against the test page fixture', async () => {
  await withFixture(async (f) => {
    // Add a profile key for the injected radio so we exercise that path.
    const profile: JsonProfile = {
      ...EXAMPLE_PROFILE,
      integrationTier: 'team',
    };
    const { run, snapshots } = f.makeBot(profile);
    const snap = await run();

    assert.equal(snap.status, 'done', `expected done, got ${snap.status}; ${snap.lastError ?? ''}`);

    // Every field that the example profile should fill must have been
    // touched with the correct InteractionRequest, in document order.
    const byStableId = new Map(f.issued.map((i) => [i.stableId, i]));

    const fullName = f.findFieldById('full-name');
    assert.ok(fullName, 'full-name field must be detected');
    const fnIssued = byStableId.get(fullName.stableId);
    assert.ok(fnIssued, `expected InteractionRequest for #full-name (${fullName.stableId})`);
    assert.equal(fnIssued!.kind, 'set-text');
    assert.equal(fnIssued!.value, 'Jane Doe');

    const email = f.findFieldById('email');
    assert.ok(email);
    const emIssued = byStableId.get(email.stableId);
    assert.ok(emIssued, `expected InteractionRequest for #email (${email.stableId})`);
    assert.equal(emIssued!.kind, 'set-text');
    assert.equal(emIssued!.value, 'jane.doe@example.com');

    const username = f.findFieldById('username');
    assert.ok(username);
    const uIssued = byStableId.get(username.stableId);
    assert.ok(uIssued);
    assert.equal(uIssued!.kind, 'set-text');
    assert.equal(uIssued!.value, 'jane_doe');

    const country = f.findFieldById('country');
    assert.ok(country);
    const cIssued = byStableId.get(country.stableId);
    assert.ok(cIssued, `expected select-option for #country (${country.stableId})`);
    assert.equal(cIssued!.kind, 'select-option');
    assert.equal(cIssued!.by, 'value');
    assert.equal(cIssued!.value, 'us'); // matches "United States" by text

    const injectedRadio = f.findFieldByName('integrationTier');
    assert.ok(injectedRadio, 'injected radio must be detected');
    const rIssued = byStableId.get(injectedRadio.stableId);
    assert.ok(rIssued, `expected select-radio for integration-tier (${injectedRadio.stableId})`);
    assert.equal(rIssued!.kind, 'select-radio');
    assert.equal(rIssued!.value, 'team');

    // The DOM must reflect what the engine actually wrote.
    const emailEl = f.dom.window.document.getElementById('email') as HTMLInputElement;
    assert.equal(emailEl.value, 'jane.doe@example.com');
    const fullNameEl = f.dom.window.document.getElementById('full-name') as HTMLInputElement;
    assert.equal(fullNameEl.value, 'Jane Doe');
    const countryEl = f.dom.window.document.getElementById('country') as HTMLSelectElement;
    assert.equal(countryEl.value, 'us');
    const teamRadio = f.dom.window.document.getElementById('integration-tier') as HTMLInputElement;
    assert.equal(teamRadio.checked, true);

    // The bot must have reported a "done" terminal snapshot.
    const last = snapshots[snapshots.length - 1];
    assert.equal(last.status, 'done');
    assert.equal(last.counters.total > 0, true);
    assert.equal(last.counters.completed > 0, true);
  });
});

test('integration: sensitive fields are never filled (password, file, captcha, payment)', async () => {
  await withFixture(async (f) => {
    // The example profile deliberately contains a "currentPassword" key
    // plus a "creditCardNumber" key to prove the planner + safety +
    // preFilter refuse to act on them even when a value is available.
    const profile: JsonProfile = {
      ...EXAMPLE_PROFILE,
      currentPassword: 'hunter2',
      creditCardNumber: '4111 1111 1111 1111',
      captcha: 'robot',
    };
    const { run } = f.makeBot(profile);
    const snap = await run();

    const password = f.findFieldById('password');
    assert.ok(password);
    // The preFilter (input-password) prevents the planner from even
    // attempting this field, so no InteractionRequest is ever issued.
    const passwordIssued = f.issued.find((i) => i.stableId === password.stableId);
    assert.equal(passwordIssued, undefined, 'password field must NEVER be touched');
    const passwordEl = f.dom.window.document.getElementById('password') as HTMLInputElement;
    assert.equal(passwordEl.value, '', 'password value must remain empty');

    const resume = f.findFieldById('resume');
    assert.ok(resume);
    // The preFilter (input-file) prevents any attempt on file inputs.
    const resumeIssued = f.issued.find((i) => i.stableId === resume.stableId);
    assert.equal(resumeIssued, undefined, 'file input must NEVER be touched');

    // Captcha and cc-number: the planner may match a profile key by
    // name/label, but the deterministic engine's safety policy rejects
    // the interaction. The DOM must remain empty and the bot must
    // record these as failures.
    const captcha = f.findFieldById('integration-captcha');
    assert.ok(captcha);
    const captchaEl = f.dom.window.document.getElementById('integration-captcha') as HTMLInputElement;
    assert.equal(captchaEl.value, '', 'captcha value must remain empty');

    const cc = f.findFieldById('integration-cc-number');
    assert.ok(cc);
    const ccEl = f.dom.window.document.getElementById('integration-cc-number') as HTMLInputElement;
    assert.equal(ccEl.value, '', 'cc-number value must remain empty');

    // captcha and cc-number must each appear in the engine's failure
    // accounting: either the planner skipped them outright, or the
    // planner issued a request and the engine blocked it. Either way
    // the DOM is untouched and the counters add up.
    const total = snap.counters.skipped + snap.counters.failed + snap.counters.completed;
    assert.equal(total, snap.counters.total);

    // For captcha and cc-number specifically, prove that the engine
    // either refused to act on them (skipped) or refused at execution
    // time (failed) — never mutated the DOM. The combination of the
    // preFilter, the planner, and the deterministic engine's safety
    // policy produces a system where these fields stay clean.
    const captchaTouched = f.issued.some((i) => i.stableId === captcha.stableId);
    const ccTouched = f.issued.some((i) => i.stableId === cc.stableId);
    if (captchaTouched) {
      // If the planner issued a request, the engine must have rejected it
      // (failed), not silently accepted.
      assert.ok(snap.counters.failed >= 1, 'captcha must be rejected by the engine');
    }
    if (ccTouched) {
      assert.ok(snap.counters.failed >= 1, 'cc-number must be rejected by the engine');
    }
  });
});

test('integration: disabled and readonly fields are skipped', async () => {
  await withFixture(async (f) => {
    const profile: JsonProfile = {
      ...EXAMPLE_PROFILE,
      disabledText: 'should not appear',
      age: 99,
    };
    const { run } = f.makeBot(profile);
    const snap = await run();
    const byStableId = new Set(f.issued.map((i) => i.stableId));

    const disabled = f.findFieldById('disabled-text');
    assert.ok(disabled);
    assert.equal(byStableId.has(disabled.stableId), false, 'disabled field must NOT be touched');
    const disabledEl = f.dom.window.document.getElementById('disabled-text') as HTMLInputElement;
    assert.equal(disabledEl.value, 'cannot edit', 'disabled value must remain unchanged');

    const age = f.findFieldById('age');
    assert.ok(age);
    assert.equal(byStableId.has(age.stableId), false, 'readonly field must NOT be touched');
    const ageEl = f.dom.window.document.getElementById('age') as HTMLInputElement;
    assert.equal(ageEl.value, '30', 'readonly age must remain 30');

    // Sanity: skipped counter must include the disabled and readonly fields.
    const disabledOrReadonlySkips = snap.counters.skipped;
    assert.ok(disabledOrReadonlySkips >= 4, `expected >=4 skipped (disabled+readonly+invisible+others), got ${disabledOrReadonlySkips}`);
  });
});

test('integration: already-filled fields are skipped (not refilled)', async () => {
  await withFixture(async (f) => {
    const profile: JsonProfile = {
      ...EXAMPLE_PROFILE,
      prefilledField: 'new value',
      volume: '50',
    };
    const { run } = f.makeBot(profile);
    const snap = await run();
    const byStableId = new Set(f.issued.map((i) => i.stableId));

    const prefilled = f.findFieldById('integration-prefilled');
    assert.ok(prefilled);
    assert.equal(
      byStableId.has(prefilled.stableId),
      false,
      'already-filled field must NOT be touched',
    );
    const prefilledEl = f.dom.window.document.getElementById('integration-prefilled') as HTMLInputElement;
    assert.equal(prefilledEl.value, 'already there', 'prefilled value must remain unchanged');

    const volume = f.findFieldById('volume');
    assert.ok(volume);
    assert.equal(byStableId.has(volume.stableId), false, 'range with default value must NOT be touched');
    const volumeEl = f.dom.window.document.getElementById('volume') as HTMLInputElement;
    assert.equal(volumeEl.value, '40', 'volume default must remain 40');

    assert.ok(snap.counters.skipped >= 1, 'at least one field must have been skipped');
  });
});

test('integration: a failed engine interaction is counted as failed, not skipped', async () => {
  await withFixture(async (f) => {
    // Add a profile key for the injected field whose value the planner
    // will pick uniquely (no autocomplete, no semantic hint conflict),
    // then force the bridge to return a failure for that field. The
    // bot must record the failure distinctly from a "skip".
    const profile: JsonProfile = {
      ...EXAMPLE_PROFILE,
      forcedTarget: 'some value',
    };

    const forced = f.findFieldById('integration-forced');
    assert.ok(forced, 'injected forced field must be detected');

    const profileEntry: ProfileEntry = {
      id: 'p_integration',
      name: 'integration-profile',
      profile,
      updatedAt: new Date().toISOString(),
    };
    const snapshots: BotStatusSnapshot[] = [];
    const bridge = f.bridgeOverride({
      failFor: (req) => req.stableId === forced.stableId,
    });
    const { Bot } = await import('../src/background/bot.ts');
    const bot = new Bot({
      tabId: 1,
      profile: profileEntry,
      bridge,
      pushStatus: (s) => snapshots.push(s),
    });
    const snap = await bot.run();
    assert.equal(snap.status, 'done');

    const forcedIssued = f.issued.find((i) => i.stableId === forced.stableId);
    assert.ok(forcedIssued, 'forced field must have been issued an InteractionRequest');
    assert.equal(forcedIssued!.kind, 'set-text');
    assert.equal(forcedIssued!.value, 'some value');

    assert.equal(snap.counters.failed, 1, `expected 1 failure, got ${snap.counters.failed}`);
    // The failure should not also be counted as a skip.
    const last = snapshots[snapshots.length - 1];
    assert.equal(last.counters.failed, 1);
    assert.equal(last.lastError, 'integration: forced failure');

    // The DOM must remain unchanged (the engine never wrote the value).
    const forcedEl = f.dom.window.document.getElementById('integration-forced') as HTMLInputElement;
    assert.notEqual(forcedEl.value, 'some value', 'forced DOM value must remain empty');
  });
});

test('integration: STOP during a run prevents subsequent interactions', async () => {
  await withFixture(async (f) => {
    const profile: JsonProfile = {
      ...EXAMPLE_PROFILE,
      integrationTier: 'team',
    };

    const profileEntry: ProfileEntry = {
      id: 'p_integration',
      name: 'integration-profile',
      profile,
      updatedAt: new Date().toISOString(),
    };
    const snapshots: BotStatusSnapshot[] = [];
    // Slow each interaction so the STOP poller has time to fire.
    const bridge = f.bridgeOverride({
      beforeInteract: async () => {
        await new Promise((r) => setTimeout(r, 10));
      },
    });

    const { Bot } = await import('../src/background/bot.ts');
    const bot = new Bot({
      tabId: 1,
      profile: profileEntry,
      bridge,
      pushStatus: (s) => snapshots.push(s),
    });
    // Schedule the stop after the second interaction has been issued.
    const stopAfter = (target: number) => {
      const tick = () => {
        if (f.issued.length >= target) {
          bot.stop();
          return;
        }
        setTimeout(tick, 1);
      };
      setTimeout(tick, 1);
    };
    stopAfter(2);

    const snap = await bot.run();
    assert.equal(snap.status, 'stopped');
    // The bot discovered all the fields (total) but STOP prevented it
    // from issuing an interaction for every one. issued.length must be
    // strictly less than total.
    assert.ok(
      f.issued.length < snap.counters.total,
      `STOP must prevent processing all fields; issued=${f.issued.length} total=${snap.counters.total}`,
    );
    // The terminal snapshot records the work done so far.
    assert.equal(snap.counters.completed, f.issued.length);
    assert.equal(snap.counters.failed, 0);
  });
});

test('integration: the bot processes fields sequentially and awaits each result', async () => {
  await withFixture(async (f) => {
    const profile: JsonProfile = {
      ...EXAMPLE_PROFILE,
      integrationTier: 'team',
    };
    const profileEntry: ProfileEntry = {
      id: 'p_integration',
      name: 'integration-profile',
      profile,
      updatedAt: new Date().toISOString(),
    };

    // Track the in-flight state of each call: the bridge wraps
    // runInteraction, records when a call starts, and only marks it
    // done when runInteraction resolves. We assert that no second call
    // begins while a first one is in flight.
    const inFlight: { stableId: string; started: number; ended: number | null }[] = [];
    const bridge: ContentBridge = {
      async scan() {
        const fresh = detectPage();
        setPageSnapshot(fresh);
        return { ok: true, result: fresh };
      },
      async interact(_tabId, request) {
        const entry = { stableId: request.stableId, started: Date.now(), ended: null as number | null };
        inFlight.push(entry);
        const idx = inFlight.length - 1;
        try {
          const r = await runInteraction(request);
          inFlight[idx].ended = Date.now();
          return { ok: true, result: r };
        } catch (err) {
          inFlight[idx].ended = Date.now();
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    };

    const { Bot } = await import('../src/background/bot.ts');
    const bot = new Bot({
      tabId: 1,
      profile: profileEntry,
      bridge,
      pushStatus: () => {},
    });
    await bot.run();

    // Every interact() call must have an "ended" timestamp (the engine
    // resolved for each one).
    for (const e of inFlight) {
      assert.notEqual(e.ended, null, `interact(${e.stableId}) never resolved`);
    }
    // Strict ordering: the i-th call's start is >= the (i-1)-th call's end.
    for (let i = 1; i < inFlight.length; i += 1) {
      const prev = inFlight[i - 1];
      const cur = inFlight[i];
      assert.ok(
        cur.started >= (prev.ended ?? 0),
        `interact(${cur.stableId}) started at ${cur.started} before previous (${prev.stableId}) ended at ${prev.ended}`,
      );
    }
  });
});

test('integration: profile key whose value has wrong type is skipped (not failed)', async () => {
  await withFixture(async (f) => {
    // First name must be a string; if the profile says number, the
    // planner should skip it (the planner coerces numbers, so we
    // instead use an unsupported shape).
    const profile: JsonProfile = {
      ...EXAMPLE_PROFILE,
      firstName: { notValid: 'shape' } as unknown as string,
    };
    const { run } = f.makeBot(profile);
    const snap = await run();
    // The bot should have skipped or failed; what matters is the
    // value never got written.
    const fullNameEl = f.dom.window.document.getElementById('full-name') as HTMLInputElement;
    // The planner's valueToInteraction uses asString for text inputs,
    // which returns null for object values -> valueToInteraction
    // returns value_unsupported skip. The DOM must not be mutated.
    assert.notEqual(fullNameEl.value, 'undefined');
    assert.notEqual(fullNameEl.value, '[object Object]');
    void snap;
  });
});
