/**
 * Profile + bot message contract: the typed messages the popup sends to the
 * service worker to manage JSON profiles and to control the form-filling bot.
 *
 * The service worker owns the storage and the bot; the popup never touches
 * chrome.storage or chrome.tabs directly (except for the well-known page
 * detection messages handled in the service worker).
 *
 * Every response is wrapped in a `{ ok, result | error }` envelope so
 * the popup can handle failures uniformly.
 */

import type { JsonProfile, ProfileEntry, ProfileListEntry } from './profile';

export const PROFILE_LIST = 'AFA_PROFILE_LIST' as const;
export const PROFILE_GET = 'AFA_PROFILE_GET' as const;
export const PROFILE_SAVE = 'AFA_PROFILE_SAVE' as const;
export const PROFILE_DELETE = 'AFA_PROFILE_DELETE' as const;

export const BOT_START = 'AFA_BOT_START' as const;
export const BOT_STOP = 'AFA_BOT_STOP' as const;
export const BOT_STATUS = 'AFA_BOT_STATUS' as const;

export interface ProfileEnvelope<T> {
  ok: boolean;
  result?: T;
  error?: string;
}

export interface ProfileListRequest {
  type: typeof PROFILE_LIST;
}

export interface ProfileGetRequest {
  type: typeof PROFILE_GET;
  id: string;
}

export interface ProfileSaveRequest {
  type: typeof PROFILE_SAVE;
  id?: string;
  name: string;
  profile: JsonProfile;
}

export interface ProfileDeleteRequest {
  type: typeof PROFILE_DELETE;
  id: string;
}

// ---------- Bot ----------

export type BotStatus = 'idle' | 'running' | 'stopped' | 'done' | 'error';

export interface BotCounters {
  completed: number;
  skipped: number;
  failed: number;
  total: number;
}

export interface BotStatusSnapshot {
  status: BotStatus;
  tabId: number;
  profileId: string | null;
  profileName: string | null;
  currentField: {
    stableId: string;
    label: string;
    reason: string;
  } | null;
  counters: BotCounters;
  lastError: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface BotStartRequest {
  type: typeof BOT_START;
  tabId: number;
  profileId: string;
}

export interface BotStopRequest {
  type: typeof BOT_STOP;
  tabId: number;
}

/** Service worker -> popup status push. */
export interface BotStatusMessage {
  type: typeof BOT_STATUS;
  snapshot: BotStatusSnapshot;
}

export type ProfileMessage =
  | ProfileListRequest
  | ProfileGetRequest
  | ProfileSaveRequest
  | ProfileDeleteRequest
  | BotStartRequest
  | BotStopRequest;

export type ProfileListResponse = ProfileEnvelope<ProfileListEntry[]>;
export type ProfileGetResponse = ProfileEnvelope<ProfileEntry>;
export type ProfileSaveResponse = ProfileEnvelope<ProfileEntry>;
export type ProfileDeleteResponse = ProfileEnvelope<{ id: string }>;
export type BotStartResponse = ProfileEnvelope<BotStatusSnapshot>;
export type BotStopResponse = ProfileEnvelope<BotStatusSnapshot>;
export type BotStatusResponse = ProfileEnvelope<BotStatusSnapshot>;
export type ProfileMessageResponse =
  | ProfileListResponse
  | ProfileGetResponse
  | ProfileSaveResponse
  | ProfileDeleteResponse
  | BotStartResponse
  | BotStopResponse
  | BotStatusResponse;
