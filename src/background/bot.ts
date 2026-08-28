/**
 * Bot driver: orchestrates the per-tab form-filling loop.
 *
 * The bot owns NO DOM logic. Its only jobs are:
 *   - request a fresh FormPage from the content script,
 *   - iterate fields sequentially,
 *   - ask the planner for an InteractionRequest,
 *   - dispatch the request to the content script and await the result,
 *   - track completed/skipped/failed counters,
 *   - honour a STOP flag,
 *   - emit status snapshots via a push callback.
 *
 * The bot is dependency-injectable so tests can drive it with a fake
 * content bridge and a fake clock.
 */

import {
  SCAN_PAGE_MESSAGE,
  INTERACT_MESSAGE,
  GET_VISUAL_CONTEXT_MESSAGE,
  type ScanPageMessage,
  type InteractMessage,
  type GetVisualContextMessage,
  type FormPage,
  type InteractionRequest,
  type InteractionResult,
  type FieldVisualContext,
  type FormField,
} from '../shared/types';
import type { JsonProfile, ProfileEntry } from '../shared/profile';
import {
  BOT_STATUS,
  type BotStatusSnapshot,
  type BotCounters,
  type BotStatus,
} from '../shared/profile-messages';
import { planField, type PlanResult } from './agent';
import { discoverNextAction } from './field-discovery';
import type { LocalLLMProvider } from './llm-provider';
import type { VisionProvider } from './vision-provider';
import type { OCRProvider } from './ocr-provider';
import { captureCroppedScreenshot } from './screenshot';

export interface ContentBridge {
  /** Force the content script to re-scan and return the latest FormPage. */
  scan(tabId: number): Promise<{ ok: boolean; result?: FormPage | null; error?: string }>;
  /** Send an interaction to the content script; resolve to the engine's InteractionResult. */
  interact(
    tabId: number,
    request: InteractionRequest,
  ): Promise<{ ok: boolean; result?: InteractionResult; error?: string }>;
  /** Lazily capture visual context for an unresolved field. */
  getVisualContext(
    tabId: number,
    stableId: string,
  ): Promise<{ ok: boolean; result?: FieldVisualContext; error?: string }>;
}

interface RuntimeContentBridgeOptions {
  /**
   * Optional override for tests / instrumentation. Defaults to
   * `chrome.tabs.sendMessage`.
   */
  sendMessage?: (
    tabId: number,
    message: unknown,
  ) => Promise<unknown>;
}

export function createChromeContentBridge(
  opts: RuntimeContentBridgeOptions = {},
): ContentBridge {
  const send = opts.sendMessage ?? defaultChromeTabsSendMessage;
  return {
    async scan(tabId) {
      const msg: ScanPageMessage = { type: SCAN_PAGE_MESSAGE };
      const r = (await send(tabId, msg)) as
        | { ok: boolean; result?: FormPage | null; error?: string }
        | undefined;
      if (!r) return { ok: false, error: 'no_response' };
      return r;
    },
    async interact(tabId, request) {
      const msg: InteractMessage = { type: INTERACT_MESSAGE, payload: request };
      const r = (await send(tabId, msg)) as
        | { ok: boolean; result?: InteractionResult; error?: string }
        | undefined;
      if (!r) return { ok: false, error: 'no_response' };
      return r;
    },
    async getVisualContext(tabId, stableId) {
      const msg: GetVisualContextMessage = { type: GET_VISUAL_CONTEXT_MESSAGE, stableId };
      const r = (await send(tabId, msg)) as
        | { ok: boolean; result?: FieldVisualContext; error?: string }
        | undefined;
      if (!r) return { ok: false, error: 'no_response' };
      return r;
    },
  };
}

async function defaultChromeTabsSendMessage(
  tabId: number,
  message: unknown,
): Promise<unknown> {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, message, (response: unknown) => {
        const err = chrome.runtime.lastError;
        if (err) {
          resolve({ ok: false, error: err.message ?? 'sendMessage failed' });
          return;
        }
        resolve(response);
      });
    } catch (e) {
      resolve({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
}

// ---------- Bot state ----------

export interface BotRunOptions {
  tabId: number;
  profile: ProfileEntry;
  bridge: ContentBridge;
  pushStatus: (snapshot: BotStatusSnapshot) => void;
  clock?: () => Date;
  /**
   * Pre-computed detection cache; when present, the bot uses it instead
   * of calling bridge.scan for the first tick (useful for tests).
   */
  initialPage?: FormPage | null;
  llmProvider?: LocalLLMProvider;
  visionProvider?: VisionProvider;
  ocrProvider?: OCRProvider;
}

export interface BotRunHandle {
  snapshot(): BotStatusSnapshot;
  stop(): void;
  /** Resolves when the loop terminates for any reason. */
  done: Promise<BotStatusSnapshot>;
}

function emptyCounters(): BotCounters {
  return { completed: 0, skipped: 0, failed: 0, total: 0 };
}

export class Bot {
  private readonly tabId: number;
  private readonly profile: ProfileEntry;
  private readonly bridge: ContentBridge;
  private readonly pushStatus: (snapshot: BotStatusSnapshot) => void;
  private readonly clock: () => Date;
  private readonly llmProvider?: LocalLLMProvider;
  private readonly visionProvider?: VisionProvider;
  private readonly ocrProvider?: OCRProvider;

  private status: BotStatus = 'idle';
  private counters: BotCounters = emptyCounters();
  private currentField: BotStatusSnapshot['currentField'] = null;
  private lastError: string | null = null;
  private startedAt: string | null = null;
  private finishedAt: string | null = null;
  private stopRequested = false;
  private donePromise: Promise<BotStatusSnapshot>;
  private resolveDone!: (snapshot: BotStatusSnapshot) => void;

  constructor(opts: BotRunOptions) {
    this.tabId = opts.tabId;
    this.profile = opts.profile;
    this.bridge = opts.bridge;
    this.pushStatus = opts.pushStatus;
    this.clock = opts.clock ?? (() => new Date());
    this.llmProvider = opts.llmProvider;
    this.visionProvider = opts.visionProvider;
    this.ocrProvider = opts.ocrProvider;
    this.donePromise = new Promise<BotStatusSnapshot>((resolve) => {
      this.resolveDone = resolve;
    });
  }

  snapshot(): BotStatusSnapshot {
    return {
      status: this.status,
      tabId: this.tabId,
      profileId: this.profile.id,
      profileName: this.profile.name,
      currentField: this.currentField,
      counters: { ...this.counters },
      lastError: this.lastError,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
    };
  }

  stop(): void {
    if (this.status === 'running' || this.status === 'idle') {
      this.stopRequested = true;
      this.status = 'stopped';
      this.emit();
    }
  }

  get done(): Promise<BotStatusSnapshot> {
    return this.donePromise;
  }

  private emit(): void {
    try {
      this.pushStatus(this.snapshot());
    } catch {
      // never let a status push kill the run
    }
  }

  /**
   * Public entry point: start the loop. Resolves when the loop
   * terminates; also resolvable via the `done` property.
   */
  async run(): Promise<BotStatusSnapshot> {
    if (this.status === 'running') {
      return this.donePromise;
    }
    this.status = 'running';
    this.startedAt = this.clock().toISOString();
    this.finishedAt = null;
    this.lastError = null;
    this.counters = emptyCounters();
    this.currentField = null;
    this.emit();

    // Honour a stop request that arrived before run() was called.
    if (this.stopRequested) {
      this.status = 'stopped';
      this.finishedAt = this.clock().toISOString();
      this.emit();
      this.resolveDone(this.snapshot());
      return this.snapshot();
    }

    try {
      await this.loop();
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.status = 'error';
      this.finishedAt = this.clock().toISOString();
      this.emit();
    }

    this.resolveDone(this.snapshot());
    return this.snapshot();
  }

    private async tryAddAnother(page: FormPage, fields: FormField[]): Promise<boolean> {
    const maxSeenIndex = new Map<string, number>();
    for (const f of fields) {
      if (f.repeatingGroup) {
         const { baseName, index } = f.repeatingGroup;
         const current = maxSeenIndex.get(baseName) ?? -1;
         if (index > current) maxSeenIndex.set(baseName, index);
      }
    }

    let targetBaseName: string | null = null;
    for (const [key, val] of Object.entries(this.profile.profile)) {
      if (Array.isArray(val)) {
         const maxSeen = maxSeenIndex.get(key) ?? -1;
         if (val.length > maxSeen + 1) {
            targetBaseName = key;
            break;
         }
      }
    }

    if (!targetBaseName) return false;
    
    const readable = targetBaseName.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
    const regex = new RegExp(`add.*(?:${targetBaseName}|${readable})`, 'i');
    
    for (const group of page.forms) {
       for (const btn of group.submitControls) {
          if (btn.text && regex.test(btn.text)) {
             this.currentField = { stableId: btn.stableId, label: btn.text, reason: 'adding another instance' };
             this.emit();
             const res = await this.bridge.interact(this.tabId, { kind: 'click-button', stableId: btn.stableId });
             return res.ok && res.result?.success === true;
          }
       }
    }
    return false;
  }

  /**
   * Discovery-driven advance: when the inner field loop made no progress,
   * look for a deterministic "advance" action (Next/Continue for multi-step
   * forms, or Add X for an under-filled section) and click it. Returns
   * true iff an advance action was actually performed and a new scan
   * should reveal more fields.
   */
  private async tryAdvance(
    page: FormPage,
    clickedActionStableIds: Set<string>,
  ): Promise<boolean> {
    const action = discoverNextAction(
      page,
      this.profile.profile,
      clickedActionStableIds,
    );
    if (!action) return false;

    clickedActionStableIds.add(action.stableId);
    this.currentField = {
      stableId: action.stableId,
      label: page.forms
        .flatMap((g) => g.submitControls)
        .find((s) => s.stableId === action.stableId)?.text ?? action.stableId,
      reason: action.reason,
    };
    this.emit();
    const res = await this.bridge.interact(this.tabId, {
      kind: 'click-button',
      stableId: action.stableId,
    });
    return !!(res.ok && res.result?.success === true);
  }

  private async loop(): Promise<void> {
    const attemptedStableIds = new Set<string>();
    const skippedStableIds = new Set<string>();
    const clickedActionStableIds = new Set<string>();
    let progress = true;

    while (progress && !this.stopRequested) {
      progress = false;

      // 1. Fresh scan before processing.
      const scanRes = await this.bridge.scan(this.tabId);
      if (!scanRes.ok || !scanRes.result) {
        throw new Error(scanRes.error ?? 'scan failed');
      }
      const page = scanRes.result;
      if (!page) {
        break;
      }

      const fields = flattenFields(page);
      
      this.counters.total = fields.length;
      this.emit();

      for (const field of fields) {
        if (this.stopRequested) {
          break;
        }

        if (attemptedStableIds.has(field.stableId)) {
          continue;
        }

        const skip = preFilter(field);
        if (skip !== null) {
          skippedStableIds.add(field.stableId);
          this.currentField = {
            stableId: field.stableId,
            label: fieldLabel(field),
            reason: skip,
          };
          this.counters.skipped = skippedStableIds.size;
          this.emit();
          continue;
        }

        // Ask the planner.
        let effectiveProfile: any = this.profile.profile;
        if (field.repeatingGroup) {
          const arr = this.profile.profile[field.repeatingGroup.baseName];
          if (Array.isArray(arr)) effectiveProfile = arr[field.repeatingGroup.index];
        }
        if (!effectiveProfile) {
          skippedStableIds.add(field.stableId);
          this.counters.skipped = skippedStableIds.size;
          continue;
        }

        const plan: PlanResult = await planField(
          field,
          effectiveProfile,
          this.llmProvider,
          this.visionProvider,
          this.ocrProvider,
          async () => {
            const res = await this.bridge.getVisualContext(this.tabId, field.stableId);
            if (res.ok && res.result) {
              const ctx = res.result;
              if (ctx.visibility !== 'hidden' && ctx.visibility !== 'outside-viewport' && ctx.boundingBox) {
                const screenshot = await captureCroppedScreenshot(this.tabId, ctx.boundingBox);
                if (screenshot) {
                  ctx.screenshot = screenshot;
                }
              }
              return ctx;
            }
            return undefined;
          }
        );
        if (!plan.ok) {
          skippedStableIds.add(field.stableId);
          this.currentField = {
            stableId: field.stableId,
            label: fieldLabel(field),
            reason: plan.reason,
          };
          this.counters.skipped = skippedStableIds.size;
          this.emit();
          continue;
        }

        attemptedStableIds.add(field.stableId);

        this.currentField = {
          stableId: field.stableId,
          label: fieldLabel(field),
          reason: `filling via "${plan.profileKey}" (${plan.match})`,
        };
        this.emit();

        // Dispatch and await the engine's result before moving on.
        const ir = await this.bridge.interact(this.tabId, plan.request);
        if (!ir.ok || !ir.result) {
          this.counters.failed += 1;
          this.lastError = ir.error ?? 'interact returned no result';
          this.emit();
          continue;
        }
        if (ir.result.success) {
          this.counters.completed += 1;
          progress = true;
          break;
        } else {
          // Engine rejected (resolver/safety/validity). Treat as skip with
          // the engine's reason, but count as failure so the user sees it.
                      this.counters.failed += 1;
            this.lastError = ir.result.reason ?? 'interact failed';
            this.emit();
          }
        }

        if (!progress && !this.stopRequested) {
          progress = await this.tryAddAnother(page, fields);
          if (!progress) {
            progress = await this.tryAdvance(page, clickedActionStableIds);
          }
        }
      }

      this.currentField = null;
    this.status = this.stopRequested ? 'stopped' : 'done';
    this.finishedAt = this.clock().toISOString();
    this.emit();
  }
}

function fieldLabel(f: FormField): string {
  return f.label || f.ariaLabel || f.placeholder || f.name || f.id || f.stableId;
}

function flattenFields(page: FormPage): FormField[] {
  const out: FormField[] = [];
  for (const g of page.forms) {
    for (const f of g.fields) {
      out.push(f);
    }
  }
  return out;
}

/**
 * Pre-filter using only the field's static metadata. This is the
 * deterministic, profile-free gate before the planner runs.
 *  - disabled/readOnly: never touch
 *  - already filled (valuePresent) with non-checkbox non-radio fields: skip
 *  - safety-sensitive control types: skip
 *  - already-blocked-by-engine fields: skip (e.g. password, file)
 *  - submit/reset/button/image: not form-fillable
 */
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

// ---------- Service-worker side runner ----------

/**
 * The service worker holds a single BotRunner that owns the per-tab bot
 * instances. The runner:
 *   - starts a bot on AFA_BOT_START,
 *   - stops the running bot (if any) on AFA_BOT_STOP,
 *   - pushes AFA_BOT_STATUS messages to the popup tab whenever state
 *     changes.
 */
export interface PopupPush {
  sendToPopup(message: { type: typeof BOT_STATUS; snapshot: BotStatusSnapshot }): void;
}

export interface BotRunnerOptions {
  bridge: ContentBridge;
  push: PopupPush;
  loadProfile: (id: string) => Promise<ProfileEntry | null>;
  getActiveTabId?: () => Promise<number | null>;
  clock?: () => Date;
  llmProvider?: LocalLLMProvider;
  visionProvider?: VisionProvider;
  ocrProvider?: OCRProvider;
}

export class BotRunner {
  private readonly bridge: ContentBridge;
  private readonly push: PopupPush;
  private readonly loadProfile: (id: string) => Promise<ProfileEntry | null>;
  private readonly getActiveTabId: () => Promise<number | null>;
  private readonly clock: () => Date;
  private readonly llmProvider?: LocalLLMProvider;
  private readonly visionProvider?: VisionProvider;
  private readonly ocrProvider?: OCRProvider;

  private running: Map<number, Bot> = new Map();

  constructor(opts: BotRunnerOptions) {
    this.bridge = opts.bridge;
    this.push = opts.push;
    this.loadProfile = opts.loadProfile;
    this.getActiveTabId = opts.getActiveTabId ?? defaultGetActiveTabId;
    this.clock = opts.clock ?? (() => new Date());
    this.llmProvider = opts.llmProvider;
    this.visionProvider = opts.visionProvider;
    this.ocrProvider = opts.ocrProvider;
  }

  async start(args: { tabId?: number; profileId: string }): Promise<BotStatusSnapshot> {
    const tabId = args.tabId ?? (await this.getActiveTabId());
    if (tabId == null) {
      throw new Error('no active tab');
    }
    const existing = this.running.get(tabId);
    if (existing) {
      existing.stop();
      this.running.delete(tabId);
    }
    const profile = await this.loadProfile(args.profileId);
    if (!profile) {
      throw new Error(`profile "${args.profileId}" not found`);
    }
    const bot = new Bot({
      tabId,
      profile,
      bridge: this.bridge,
      pushStatus: (snapshot) => this.push.sendToPopup({ type: BOT_STATUS, snapshot }),
      clock: this.clock,
      llmProvider: this.llmProvider,
      visionProvider: this.visionProvider,
      ocrProvider: this.ocrProvider,
    });
    this.running.set(tabId, bot);
    // Fire and forget: status updates flow via pushStatus, completion
    // resolves `bot.done`.
    void bot.done.then(() => {
      if (this.running.get(tabId) === bot) this.running.delete(tabId);
    });
    // Kick off the run, but don't block the caller.
    void bot.run();
    return bot.snapshot();
  }

  stop(tabId: number): BotStatusSnapshot | null {
    const bot = this.running.get(tabId);
    if (!bot) return null;
    bot.stop();
    return bot.snapshot();
  }

  status(tabId: number): BotStatusSnapshot | null {
    return this.running.get(tabId)?.snapshot() ?? null;
  }
}

async function defaultGetActiveTabId(): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        resolve(tabs?.[0]?.id ?? null);
      });
    } catch {
      resolve(null);
    }
  });
}

// Re-export JsonProfile for convenience in callers that build their own ProfileEntry.
export type { JsonProfile };
