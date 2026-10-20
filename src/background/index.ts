/**
 * Nocturn – background service worker (Manifest V3)
 *
 * Responsibilities:
 *  - Persist & sync user settings across devices (chrome.storage.sync).
 *  - Manage per-tab state (enabled/disabled + reason).
 *  - Relay keyboard-shortcut commands to the active tab.
 *  - Expose helpers that the popup reads via `chrome.runtime.getBackgroundPage`
 *    or `chrome.runtime.sendMessage`.
 *
 * In Manifest V3 the service worker is event-driven and may be torn down
 * between events, so we store all mutable state in storage rather than in
 * module-level variables.
 */

import type { DarkModeSettings, SiteRule, TabState } from '../types';

// ─── nocturn-constants (duplicated per entry point for self-contained bundles) ───
const DEFAULT_SETTINGS: DarkModeSettings = {
  enabled: true,
  brightness: 1.15,
  contrast: 0.95,
  sepia: 0.15,
  grayscale: 0.05,
  hueRotate: 180,
  preserveMedia: true,
  overrideVariables: true,
  forceDarkBackground: false
};

const DEFAULT_SITE_RULES: SiteRule[] = [
  { id: '1', pattern: 'https://*.google.com/*', action: 'always-off', label: 'Google search' },
  { id: '2', pattern: 'https://*.mail.google.com/*', action: 'always-off', label: 'Gmail' },
  { id: '3', pattern: 'https://*.github.com/*', action: 'always-off', label: 'GitHub' },
  { id: '4', pattern: 'https://*.youtube.com/*', action: 'always-off', label: 'YouTube' },
  { id: '5', pattern: 'https://*.reddit.com/*', action: 'always-off', label: 'Reddit' },
  { id: '6', pattern: 'https://*.twitter.com/*', action: 'always-off', label: 'X / Twitter' },
  { id: '7', pattern: 'https://*.x.com/*', action: 'always-off', label: 'X' },
  { id: '8', pattern: 'https://*.facebook.com/*', action: 'always-off', label: 'Facebook' }
];

const STORAGE_KEYS = {
  SETTINGS: 'nocturn_settings',
  SITE_RULES: 'nocturn_site_rules',
  TAB_STATE: 'nocturn_tab_state',
  HAS_SEEN_INTRO: 'nocturn_has_seen_intro'
} as const;

const TAB_STATE_DEFAULT: TabState = {
  enabled: false,
  reason: 'default'
};
// ────────────────────────────────────────────────────────────────────────────────

/* ─── Storage helpers ─────────────────────────────────────────── */

/** Resolve which storage area to use (sync preferred, local fallback). */
function storageArea(): chrome.storage.StorageArea {
  // Firefox / MV2 compatibility: fall back to local if sync isn't available.
  // Chrome MV3 supports both.
  if (chrome?.storage?.sync) return chrome.storage.sync;
  return chrome.storage.local;
}

/** Name of whatever storage area `storageArea()` returns. */
function storageAreaName(): 'sync' | 'local' {
  return chrome?.storage?.sync ? 'sync' : 'local';
}

async function getSettings(): Promise<DarkModeSettings> {
  const area = storageArea();
  const result = await area.get(STORAGE_KEYS.SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(result[STORAGE_KEYS.SETTINGS] as DarkModeSettings | undefined) };
}

async function saveSettings(settings: DarkModeSettings): Promise<void> {
  const area = storageArea();
  await area.set({ [STORAGE_KEYS.SETTINGS]: settings });
}

async function getSiteRules(): Promise<SiteRule[]> {
  const area = storageArea();
  const result = await area.get(STORAGE_KEYS.SITE_RULES);
  return (result[STORAGE_KEYS.SITE_RULES] as SiteRule[] | undefined) ?? DEFAULT_SITE_RULES;
}

async function saveSiteRules(rules: SiteRule[]): Promise<void> {
  const area = storageArea();
  await area.set({ [STORAGE_KEYS.SITE_RULES]: rules });
}

/** Get the per-tab state for a specific tabId. */
async function getTabState(tabId: number): Promise<TabState> {
  const area = storageArea();
  const result = await area.get(STORAGE_KEYS.TAB_STATE);
  const states = result[STORAGE_KEYS.TAB_STATE] as Record<string, TabState> | undefined;
  return states?.[String(tabId)] ?? { ...TAB_STATE_DEFAULT };
}

async function saveTabState(tabId: number, state: TabState): Promise<void> {
  const area = storageArea();
  const result = await area.get(STORAGE_KEYS.TAB_STATE);
  const states: Record<string, TabState> =
    (result[STORAGE_KEYS.TAB_STATE] as Record<string, TabState> | undefined) ?? {};
  states[String(tabId)] = state;
  await area.set({ [STORAGE_KEYS.TAB_STATE]: states });
}

/* ─── Command handling ─────────────────────────────────────────── */

/**
 * Send a message to the content script(s) running in a specific tab.
 * Returns the response (or null if the tab has no content script / is closed).
 */
function sendMessageToTab(
  tabId: number,
  message: { type: string; payload?: unknown }
): Promise<unknown> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        // Tab may not have a content script injected (e.g. chrome:// pages).
        resolve(null);
      } else {
        resolve(response);
      }
    });
  });
}

/** Handle the three command shortcuts: toggle, enable, disable. */
async function handleCommand(command: string): Promise<void> {
  // `_command_*` are our custom shortcuts; `_execute_action` opens the popup.
  if (!command.startsWith('_command_')) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  const action = command.replace('_command_', '');
  const msgType = action === 'toggle'
    ? 'TOGGLE_DARK_MODE'
    : action === 'enable'
    ? 'ENABLE_DARK_MODE'
    : 'DISABLE_DARK_MODE';

  const response = await sendMessageToTab(tab.id, { type: msgType });

  // Update per-tab state from the response.
  const tabState = (response ?? null) as TabState | null;
  if (tabState) {
    await saveTabState(tab.id, {
      enabled: tabState.enabled,
      reason: 'user'
    });
  }

  // Update the toolbar icon to reflect the new state.
  await updateIcon(tab.id, tabState?.enabled ?? false);
}

/* ─── Icon management ──────────────────────────────────────────── */

/**
 * Show the active (colored) icon when Nocturn is on, the muted (gray)
 * icon when off.
 */
async function updateIcon(tabId: number, enabled: boolean): Promise<void> {
  const suffix = enabled ? '' : '-off';
  const path = (size: number) => `assets/icons/icon-${size}${suffix}.png`;
  await chrome.action.setIcon({
    tabId,
    path: {
      '16': path(16),
      '32': path(32),
      '48': path(48)
    }
  });
}

/** Set the icon based on whether Nocturn is active in the active tab. */
async function updateIconForActiveTab(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  // Ask the content script for its current state.
  const response = await sendMessageToTab(tab.id, { type: 'GET_STATE' });
  if (response && typeof response === 'object') {
    const data = response as { enabled: boolean };
    await updateIcon(tab.id, data.enabled);
  }
}

/* ─── Lifecycle ────────────────────────────────────────────────── */

/** Initialise defaults on first install. */
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') {
    const area = storageArea();
    await area.set({
      [STORAGE_KEYS.SETTINGS]: DEFAULT_SETTINGS,
      [STORAGE_KEYS.SITE_RULES]: DEFAULT_SITE_RULES,
      [STORAGE_KEYS.HAS_SEEN_INTRO]: false
    });
    console.log('[Nocturn] Installed — defaults set.');
  }

  // Listen for settings changes (from options page) and broadcast to tabs.
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== storageAreaName()) return;

    if (changes[STORAGE_KEYS.SETTINGS]) {
      // Broadcast the new settings to all tabs.
      chrome.tabs.query({}, (tabs) => {
        for (const tab of tabs) {
          if (tab.id) {
            sendMessageToTab(tab.id, {
              type: 'SETTINGS_UPDATED',
              payload: changes[STORAGE_KEYS.SETTINGS].newValue
            }).catch(() => {
              /* ignore */
            });
          }
        }
      });
    }
  });
});

/** On startup, update icons for the active tab. */
chrome.runtime.onStartup.addListener(() => {
  updateIconForActiveTab().catch(() => { /* ignore */ });
});

/** Keep icons in sync when tabs are activated / updated. */
chrome.tabs.onActivated.addListener(() => {
  updateIconForActiveTab().catch(() => { /* ignore */ });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' && tabId) {
    // Reset per-tab state on navigation so we don't carry stale state.
    saveTabState(tabId, { ...TAB_STATE_DEFAULT }).catch(() => { /* ignore */ });
  }
});

/** Handle keyboard shortcuts (toggle / enable / disable dark mode). */
if (chrome.commands) {
  chrome.commands.onCommand.addListener((command) => {
    handleCommand(command).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[Nocturn] Command handler error:', err);
    });
  });
}

/* ─── Message API for popup ────────────────────────────────────── */

/**
 * The popup uses `chrome.runtime.sendMessage` to talk to this service worker.
 * We expose the storage getters/setters here.
 */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const { type, payload } = msg as { type: string; payload?: unknown };

  const asyncResponse = async (): Promise<unknown> => {
    switch (type) {
      case 'GET_SETTINGS':
        return await getSettings();

      case 'SAVE_SETTINGS':
        await saveSettings(payload as DarkModeSettings);
        return { ok: true };

      case 'GET_SITE_RULES':
        return await getSiteRules();

      case 'SAVE_SITE_RULES':
        await saveSiteRules(payload as SiteRule[]);
        // Broadcast the updated rules to all tabs so content scripts
        // can re-evaluate their site-rule matching.
        chrome.tabs.query({}, (tabs) => {
          for (const tab of tabs) {
            if (tab.id) {
              sendMessageToTab(tab.id, { type: 'RE_EVALUATE' }).catch(() => {
                /* ignore */
              });
            }
          }
        });
        return { ok: true };

      case 'GET_TAB_STATE': {
        const tabId = payload as number;
        return await getTabState(tabId);
      }

      case 'SAVE_TAB_STATE': {
        const { tabId, state } = payload as { tabId: number; state: TabState };
        await saveTabState(tabId, state);
        return { ok: true };
      }

      case 'TOGGLE_DARK_MODE':
      case 'ENABLE_DARK_MODE':
      case 'DISABLE_DARK_MODE': {
        // Forward to the active tab's content script.
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab?.id) {
          return null;
        }
        return await sendMessageToTab(tab.id, { type, payload });
      }

      default:
        return null;
    }
  };

  // Use async response pattern.
  asyncResponse().then((response) => {
    sendResponse(response);
  });

  return true; // keep the message channel open for async response
});

// Expose for debugging in devtools console.
// (In production this is a no-op since the service worker context is limited.)

export {};
