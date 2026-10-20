/**
 * Nocturn – content script entry point
 *
 * This script runs at `document_start` (see manifest.json) on every page.
 * Its job is to orchestrate:
 *
 *  1. Load settings + site rules from storage.
 *  2. Run native-dark detection.
 *  3. Decide whether to enable Nocturn (honouring site rules + user prefs).
 *  4. Apply the engine if needed.
 *  5. Start the MutationObserver for dynamic content.
 *  6. Listen for messages from the background / popup and react.
 *
 * Because we run at `document_start`, we can set up the dark base styles
 * before the page paints, avoiding a flash of white content (FOUC).
 */

import type { DarkModeSettings, SiteRule, TabState } from '../types';
import { detectNativeDarkSupport, isNocturnActive } from './detection';
import { applyDarkMode, removeDarkMode, updateFilter } from './engine';
import { createObserver } from './observer';

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

/* ─── State ──────────────────────────────────────────────── */

let settings: DarkModeSettings = { ...DEFAULT_SETTINGS };
let siteRules: SiteRule[] = [];
let tabState: TabState = { ...TAB_STATE_DEFAULT };

/** Convenience for the observer. */
const getSettings = (): DarkModeSettings => settings;
const isActive = (): boolean => isNocturnActive();

/** Keep the `window.nocturn` debug flag in sync with the actual engine state. */
function setNocturnFlag(active: boolean): void {
  if (window.nocturn) {
    window.nocturn.active = active;
  }
}

const observer = createObserver(getSettings, isActive);

/* ─── Storage helpers ──────────────────────────────────────── */

/** Read settings + site rules from chrome.storage.sync (falls back to local). */
async function loadFromStorage(): Promise<void> {
  try {
    // chrome.storage.sync → synced across devices; fall back to local.
    // The `as any` is needed for Firefox's `browser` (WebExtension) API which
    // may not be in the @types/chrome scope.
    const chromeArea = (chrome as any)?.storage?.sync;
    const localArea = (chrome as any)?.storage?.local;
    const area = chromeArea ?? localArea ?? null;

    if (!area) {
      // No storage API (e.g. plain web page) — keep defaults.
      return;
    }

    const result = await area.get([STORAGE_KEYS.SETTINGS, STORAGE_KEYS.SITE_RULES]);

    if (result[STORAGE_KEYS.SETTINGS]) {
      settings = { ...DEFAULT_SETTINGS, ...(result[STORAGE_KEYS.SETTINGS] as DarkModeSettings) };
    }
    if (result[STORAGE_KEYS.SITE_RULES]) {
      siteRules = result[STORAGE_KEYS.SITE_RULES] as SiteRule[];
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[Nocturn] Failed to load settings from storage:', err);
  }
}

/** Persist settings to storage. */
async function saveSettings(updated: Partial<DarkModeSettings>): Promise<void> {
  settings = { ...settings, ...updated };
  await chrome.storage.sync.set({ [STORAGE_KEYS.SETTINGS]: settings });
  updateFilter(settings);
}

/* ─── Site-rule matching ───────────────────────────────────── */

/**
 * Match the current page URL against the site rules.
 * Returns the matched rule (if any) and its effective action.
 */
function matchSiteRule(): SiteRule | null {
  const url = window.location.href;
  for (const rule of siteRules) {
    if (urlMatchesPattern(url, rule.pattern)) {
      return rule;
    }
  }
  return null;
}

/**
 * Convert a Chrome-style match pattern (e.g. `https://*.wikipedia.org/*`)
 * into a RegExp and test it against a URL.
 *
 * This is a simplified but robust implementation that handles the common
 * cases: scheme, wildcard host, and path.
 */
function urlMatchesPattern(url: string, pattern: string): boolean {
  try {
    // Chrome match patterns: scheme://[host]/path
    // We convert to a regex.
    let p = pattern;

    // Escape special regex chars except * and /
    p = p.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

    // * in the host part → [^/]*  (any non-slash chars)
    p = p.replace(/\*/g, '.*');

    // Anchor to start and end
    const re = new RegExp('^' + p + '$');
    return re.test(url);
  } catch {
    // If the pattern is invalid, fall back to a simple includes check.
    return url.includes(pattern.replace(/\*/g, ''));
  }
}

/**
 * The effective action for this page based on site rules.
 * Returns 'auto' if no rule matches (meaning: normal Nocturn behavior).
 */
function getEffectiveAction(): SiteRule['action'] {
  const rule = matchSiteRule();
  return rule ? rule.action : 'auto';
}

/* ─── Activation logic ─────────────────────────────────────── */

/**
 * Decide and apply the correct state for this page.
 *
 * Evaluation order (first match wins):
 *  1. Site rule ('always-on' / 'always-off') — user-configured per-domain override
 *  2. Global settings (`enabled` flag) — master switch
 *  3. Auto-detection of native dark support — skip if the page already looks dark
 *
 * Note: direct user toggles (popup button, keyboard shortcut) bypass this
 * function entirely via the message handlers, so they take immediate effect.
 * However, the next call to evaluateAndApply (e.g. on tab visibility or
 * SPA navigation) will re-apply the site rule's priority.
 */
function evaluateAndApply(): void {
  const action = getEffectiveAction();

  // 1. Site rule 'always-on' → force enable regardless of detection.
  if (action === 'always-on') {
    tabState = { enabled: true, reason: 'site-rule' };
    applyDarkMode(settings);
    observer.start();
    setNocturnFlag(true);
    return;
  }

  // 2. Site rule 'always-off' → force disable.
  if (action === 'always-off') {
    tabState = { enabled: false, reason: 'site-rule' };
    removeDarkMode();
    observer.stop();
    setNocturnFlag(false);
    return;
  }

  // 3. Global settings disabled.
  if (!settings.enabled) {
    tabState = { enabled: false, reason: 'default' };
    removeDarkMode();
    observer.stop();
    setNocturnFlag(false);
    return;
  }

  // 4. Auto-detection — if the page already has native dark mode, skip.
  if (detectNativeDarkSupport().hasNativeDark) {
    tabState = { enabled: false, reason: 'default' };
    removeDarkMode();
    observer.stop();
    setNocturnFlag(false);
    // Still listen for OS-level changes and re-evaluate.
    listenForMediaChanges();
    return;
  }

  // 5. No native dark mode → apply Nocturn.
  tabState = { enabled: true, reason: 'auto' };
  applyDarkMode(settings);
  observer.start();
  setNocturnFlag(true);
  listenForMediaChanges();
}

/** Listen for OS-level dark-mode preference changes and re-evaluate. */
function listenForMediaChanges(): void {
  if (typeof window.matchMedia !== 'function') return;
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', () => {
    // Only re-evaluate if we were previously relying on auto-detection.
    if (tabState.reason === 'auto' || tabState.reason === 'default') {
      evaluateAndApply();
    }
  });
}

/* ─── Message handling ─────────────────────────────────────── */

/**
 * Receive commands from the background script / popup:
 *  - TOGGLE_DARK_MODE
 *  - ENABLE_DARK_MODE
 *  - DISABLE_DARK_MODE
 *  - GET_STATE
 *  - SETTINGS_UPDATED
 */
function setupMessageListener(): void {
  if (typeof chrome === 'undefined' || !chrome.runtime) return;

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    const { type, payload } = msg as { type: string; payload?: unknown };

    switch (type) {
      case 'TOGGLE_DARK_MODE': {
        const newActive = !isNocturnActive();
        if (newActive) {
          // User is force-enabling (override site rules).
          tabState = { enabled: true, reason: 'user' };
          applyDarkMode(settings);
          observer.start();
          setNocturnFlag(true);
        } else {
          tabState = { enabled: false, reason: 'user' };
          removeDarkMode();
          observer.stop();
          setNocturnFlag(false);
        }
        sendResponse({ enabled: newActive });
        return true;
      }

      case 'ENABLE_DARK_MODE': {
        tabState = { enabled: true, reason: 'user' };
        applyDarkMode(settings);
        observer.start();
        setNocturnFlag(true);
        sendResponse({ enabled: true });
        return true;
      }

      case 'DISABLE_DARK_MODE': {
        tabState = { enabled: false, reason: 'user' };
        removeDarkMode();
        observer.stop();
        setNocturnFlag(false);
        sendResponse({ enabled: false });
        return true;
      }

      case 'SETTINGS_UPDATED': {
        const newSettings = payload as Partial<DarkModeSettings>;
        settings = { ...settings, ...newSettings };
        if (isNocturnActive()) {
          updateFilter(settings);
        }
        sendResponse({ ok: true });
        return true;
      }

      case 'GET_STATE': {
        sendResponse({
          enabled: isNocturnActive(),
          state: tabState,
          settings,
          nativeDark: detectNativeDarkSupport().hasNativeDark
        });
        return true;
      }

      case 'RE_EVALUATE': {
        // Reload site rules from storage and re-decide based on current state.
        loadFromStorage().then(() => {
          evaluateAndApply();
          const newState = isNocturnActive();
          sendResponse({ enabled: newState, state: tabState });
        });
        return true;
      }

      case 'SAVE_SETTINGS': {
        const newSettings = payload as DarkModeSettings;
        settings = { ...settings, ...newSettings };
        if (isNocturnActive()) {
          updateFilter(settings);
        }
        sendResponse({ ok: true });
        return true;
      }
    }

    return false;
  });
}

/* ─── Initialization ───────────────────────────────────────── */

/**
 * Bootstrap the content script.
 *
 * We wait for storage to load before evaluating, since the decision to
 * enable depends on the user's settings and site rules.
 */
async function init(): Promise<void> {
  // ─── FOUC mitigation ────────────────────────────────────────────────
  // Apply a dark background immediately at document_start to prevent a flash
  // of white on light pages.  evaluateAndApply() will remove it if Nocturn
  // should NOT be active (native dark mode, site rule off, etc.).
  try {
    const root = document.documentElement;
    if (root) {
      root.style.setProperty('background-color', '#0e0e10', 'important');
      if (document.body) {
        document.body.style.setProperty('background-color', '#0e0e10', 'important');
      }
    }
  } catch {
    /* element might not exist yet — extremely rare at document_start */
  }

  await loadFromStorage();

  // Avoid double-initialisation (content script may be re-injected).
  if (window.nocturn) {
    // Settings changed since last run; update if active.
    if (isNocturnActive()) {
      updateFilter(settings);
    }
    return;
  }

  window.nocturn = { active: false };

  setupMessageListener();

  // Defer evaluation until the document is ready enough to inspect.
  // We use 'interactive' so that meta tags / early classes are present.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', evaluateAndApply, { once: true });
  } else {
    // Some pages are already interactive; evaluate now.
    evaluateAndApply();
  }

  // Also re-evaluate when the page becomes visible (user switched tabs).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      evaluateAndApply();
    }
  });

  // SPA support: re-evaluate on history navigation and hash changes.
  // Single-page applications change the URL without a full page load,
  // so we listen for popstate and hashchange events.
  window.addEventListener('popstate', () => {
    // Delay slightly to let the new page content render first.
    setTimeout(() => {
      // Only re-evaluate if the user hasn't manually overridden.
      if (tabState.reason === 'auto' || tabState.reason === 'default') {
        evaluateAndApply();
      }
    }, 100);
  });

  window.addEventListener('hashchange', () => {
    setTimeout(() => {
      if (tabState.reason === 'auto' || tabState.reason === 'default') {
        evaluateAndApply();
      }
    }, 100);
  });
}

// Run immediately — we're loaded at document_start.
init();
