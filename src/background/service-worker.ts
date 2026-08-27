import {
  FORM_DETECTED_MESSAGE,
  SCAN_PAGE_MESSAGE,
  GET_DETECTION_MESSAGE,
  type FormDetectedMessage,
  type FormPage,
} from '../shared/types';
import {
  PROFILE_LIST,
  PROFILE_GET,
  PROFILE_SAVE,
  PROFILE_DELETE,
  BOT_START,
  BOT_STOP,
  type ProfileMessage,
  type ProfileMessageResponse,
  type BotStartResponse,
  type BotStopResponse,
} from '../shared/profile-messages';
import { ProfileStore } from './profile-store';
import { BotRunner, createChromeContentBridge, type PopupPush } from './bot';

interface RuntimeMessage {
  type: string;
}

interface TabState {
  lastDetection: FormPage | null;
  updatedAt: number;
}

const tabStates = new Map<number, TabState>();

const profileStore = new ProfileStore();

const popupPush: PopupPush = {
  sendToPopup(message) {
    try {
      chrome.runtime.sendMessage(message).catch(() => {});
    } catch {
      // popup may be closed
    }
  },
};

const botRunner = new BotRunner({
  bridge: createChromeContentBridge(),
  push: popupPush,
  loadProfile: (id) => profileStore.get(id),
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('[AFA] extension installed');
});

function isProfileMessage(message: RuntimeMessage): message is ProfileMessage {
  if (!message || typeof message !== 'object') return false;
  const t = (message as { type?: unknown }).type;
  return (
    t === PROFILE_LIST ||
    t === PROFILE_GET ||
    t === PROFILE_SAVE ||
    t === PROFILE_DELETE ||
    t === BOT_START ||
    t === BOT_STOP
  );
}

async function handleProfileMessage(msg: ProfileMessage): Promise<ProfileMessageResponse> {
  try {
    switch (msg.type) {
      case PROFILE_LIST: {
        const items = await profileStore.list();
        return { ok: true, result: items };
      }
      case PROFILE_GET: {
        const entry = await profileStore.get(msg.id);
        if (!entry) {
          return { ok: false, error: `profile "${msg.id}" not found` };
        }
        return { ok: true, result: entry };
      }
      case PROFILE_SAVE: {
        const entry = await profileStore.save({
          id: msg.id,
          name: msg.name,
          profile: msg.profile,
        });
        return { ok: true, result: entry };
      }
      case PROFILE_DELETE: {
        await profileStore.delete(msg.id);
        return { ok: true, result: { id: msg.id } };
      }
      case BOT_START: {
        try {
          const snapshot = await botRunner.start({
            tabId: msg.tabId,
            profileId: msg.profileId,
          });
          const out: BotStartResponse = { ok: true, result: snapshot };
          return out;
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }
      case BOT_STOP: {
        const snapshot = botRunner.stop(msg.tabId);
        if (!snapshot) {
          return { ok: false, error: 'no bot running for this tab' };
        }
        const out: BotStopResponse = { ok: true, result: snapshot };
        return out;
      }
      default: {
        const _exhaustive: never = msg;
        void _exhaustive;
        return { ok: false, error: 'unknown message type' };
      }
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  if (!message || typeof message !== 'object') return;

  if (message.type === FORM_DETECTED_MESSAGE) {
    const payload = (message as FormDetectedMessage).payload;
    if (sender.tab?.id != null) {
      tabStates.set(sender.tab.id, { lastDetection: payload, updatedAt: Date.now() });
    }
    return false;
  }

  if (message.type === SCAN_PAGE_MESSAGE || message.type === GET_DETECTION_MESSAGE) {
    const tabId = sender.tab?.id;
    if (tabId == null) {
      sendResponse({ ok: false, error: 'no_active_tab' });
      return false;
    }
    const state = tabStates.get(tabId);
    sendResponse({ ok: true, result: state?.lastDetection ?? null });
    return false;
  }

  if (isProfileMessage(message)) {
    handleProfileMessage(message)
      .then((response) => sendResponse(response))
      .catch((err: unknown) =>
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      );
    return true;
  }

  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabStates.delete(tabId);
  const bot = botRunner.status(tabId);
  if (bot) {
    // best-effort: the bot's pending interact() will fail, which it
    // surfaces via lastError; nothing else to do here.
    void bot;
  }
});
