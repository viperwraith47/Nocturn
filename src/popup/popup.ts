/**
 * Nocturn – popup script
 *
 * Runs inside the extension popup (320px wide).  Provides:
 *  - A quick on/off toggle for the current page.
 *  - Per-site override controls (auto / always-on / always-off).
 *  - Buttons to jump to the full Options page and the Site Rules manager.
 *
 * Communication:
 *  - popup ↔ background service worker: `chrome.runtime.sendMessage`
 *  - popup ↔ content script:            via `chrome.tabs.sendMessage` (relayed
 *    by the background when needed)
 */

/// <reference types="chrome" />

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

const toggleBtn = document.getElementById('toggle-btn') as HTMLButtonElement | null;
const toggleSwitch = toggleBtn?.querySelector('.toggle-switch') as HTMLElement | null;
const toggleLabel = toggleBtn?.querySelector('.toggle-label') as HTMLElement | null;
const siteLabel = document.getElementById('site-label') as HTMLElement | null;
const statusEl = document.getElementById('status') as HTMLElement | null;
const statusDot = statusEl?.querySelector('.status-dot') as HTMLElement | null;
const statusText = statusEl?.querySelector('.status-text') as HTMLElement | null;
const loadingEl = document.getElementById('loading') as HTMLElement | null;
const mainEl = document.getElementById('main') as HTMLElement | null;
const errorEl = document.getElementById('error') as HTMLElement | null;
const errorText = errorEl?.querySelector('.error-text') as HTMLElement | null;
const openOptionsBtn = document.getElementById('open-options') as HTMLButtonElement | null;
const openSiteRulesBtn = document.getElementById('open-site-rules') as HTMLButtonElement | null;
const siteActionSelect = document.getElementById('site-action') as HTMLSelectElement | null;

type PageState = 'loading' | 'ready' | 'error';

/* ─── DOM helpers ──────────────────────────────────────────────── */

function setState(state: PageState): void {
  loadingEl?.classList.toggle('hidden', state !== 'loading');
  mainEl?.classList.toggle('hidden', state !== 'ready');
  errorEl?.classList.toggle('hidden', state !== 'error');
}

function setLoading(loading: boolean): void {
  setState(loading ? 'loading' : 'ready');
}

function setStatus(message: string, type: 'info' | 'warning' | 'error' = 'info'): void {
  if (!statusEl || !statusDot || !statusText) return;
  statusEl.classList.remove('hidden');
  statusText.textContent = message;

  if (type === 'error') {
    statusDot.style.background = 'var(--nocturn-popup-danger)';
  } else if (type === 'warning') {
    statusDot.style.background = 'var(--nocturn-popup-warning)';
  } else {
    statusDot.style.background = 'var(--nocturn-popup-accent)';
  }
}

function clearStatus(): void {
  statusEl?.classList.add('hidden');
}

/**
 * Show a single, clear explanatory message in the error state, replacing the
 * whole popup content. Used instead of a separate status line so the page is
 * never showing two overlapping messages at once.
 */
function setError(message: string): void {
  if (errorText) errorText.textContent = message;
  setState('error');
}

/* ─── Communication with background / content script ──────────── */

/** Send a message to the background service worker. */
function sendMessage(type: string, payload?: unknown): Promise<unknown> {
  return chrome.runtime.sendMessage({ type, payload });
}

/** Send a message to the content script(s) in the active tab. */
async function sendToTab(type: string, payload?: unknown): Promise<unknown> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;
  return chrome.tabs.sendMessage(tab.id, { type, payload });
}

/* ─── Initialization ─────────────────────────────────────────────── */

let currentSettings: DarkModeSettings = { ...DEFAULT_SETTINGS };
let currentSiteRules: SiteRule[] = [...DEFAULT_SITE_RULES];
let currentTabState: TabState = { ...TAB_STATE_DEFAULT };
let currentPageUrl: string = '';
let matchedRule: SiteRule | null = null;

async function init(): Promise<void> {
  setLoading(true);

  try {
    // 1. Get the active tab to know the current URL.
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) {
      setError('Nocturn is not active on this page.');
      return;
    }
    currentPageUrl = tab.url;

    // 2. Load settings + site rules from storage.
    const results = await chrome.storage.sync.get([STORAGE_KEYS.SETTINGS, STORAGE_KEYS.SITE_RULES]);
    if (results[STORAGE_KEYS.SETTINGS]) {
      currentSettings = { ...DEFAULT_SETTINGS, ...(results[STORAGE_KEYS.SETTINGS] as DarkModeSettings) };
    }
    if (results[STORAGE_KEYS.SITE_RULES]) {
      currentSiteRules = results[STORAGE_KEYS.SITE_RULES] as SiteRule[];
    }

    // 3. Match the current URL against site rules.
    matchedRule = findMatchingRule(currentPageUrl, currentSiteRules);
    updateSiteLabel();

    // 4. Ask the content script for its current state.
    const tabState = await sendToTab('GET_STATE') as
      | { enabled: boolean; state: TabState; settings: DarkModeSettings; nativeDark: boolean }
      | null;

    if (!tabState) {
      // Content script not available (e.g. chrome:// or extension page).
      updateToggle(false, false);
      if (siteActionSelect) siteActionSelect.disabled = true;
      setError("Nocturn can't run on this page.");
      return;
    }

    // Sync settings in case they differ.
    if (tabState.settings) {
      currentSettings = tabState.settings;
    }

    currentTabState = tabState.state || { ...TAB_STATE_DEFAULT };

    // 5. Update the UI.
    updateToggle(tabState.enabled, tabState.nativeDark);
    updateSiteSelect(matchedRule);

    if (tabState.nativeDark) {
      setStatus('Uses native dark mode', 'info');
    } else {
      clearStatus();
    }

    setState('ready');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[Nocturn popup] Init error:', err);
    setError('Something went wrong. Try reloading.');
  } finally {
    setLoading(false);
  }
}

/* ─── UI updates ─────────────────────────────────────────────────── */

/**
 * Update the toggle button to reflect the current enabled state.
 * @param enabled  Whether dark mode is currently applied.
 * @param nativeDark  Whether the page has native dark mode (disables toggle).
 */
function updateToggle(enabled: boolean, nativeDark = false): void {
  if (!toggleBtn) return;
  toggleBtn.classList.toggle('toggle-btn--on', enabled);
  toggleBtn.disabled = nativeDark;
  // Communicate state to assistive tech; the label itself stays static.
  toggleBtn.setAttribute('aria-checked', String(enabled));
  toggleBtn.setAttribute('aria-disabled', String(nativeDark));
  if (toggleSwitch) toggleSwitch.classList.toggle('active', enabled);
  // The label is static — state is conveyed by the switch position and the
  // accent tint, which keeps the text legible on the dark surface.
  if (toggleLabel) toggleLabel.textContent = 'Dark mode';
}

function updateSiteLabel(): void {
  if (!siteLabel) return;
  try {
    const url = new URL(currentPageUrl);
    siteLabel.textContent = url.hostname || url.pathname;
  } catch {
    siteLabel.textContent = currentPageUrl || 'unknown site';
  }
}

/**
 * Update the "this site" dropdown to match the current rule (or lack thereof).
 * Uses value matching, so if there's no rule we select "auto".
 */
function updateSiteSelect(rule: SiteRule | null): void {
  if (!siteActionSelect) return;
  siteActionSelect.value = rule ? rule.action : 'auto';
  siteActionSelect.disabled = !matchedRule;
}

/* ─── Site rule matching ─────────────────────────────────────────── */

function findMatchingRule(url: string, rules: SiteRule[]): SiteRule | null {
  for (const rule of rules) {
    if (urlMatchesPattern(url, rule.pattern)) {
      return rule;
    }
  }
  return null;
}

function urlMatchesPattern(url: string, pattern: string): boolean {
  try {
    let p = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*');
    const re = new RegExp('^' + p + '$');
    return re.test(url);
  } catch {
    return url.includes(pattern.replace(/\*/g, ''));
  }
}

/* ─── Event handlers ─────────────────────────────────────────────── */

async function handleToggle(): Promise<void> {
  const newState = !currentTabState.enabled;
  const response = await sendToTab(
    newState ? 'ENABLE_DARK_MODE' : 'DISABLE_DARK_MODE'
  );
  const tabState: TabState | null = response as TabState | null;

  if (tabState) {
    currentTabState = tabState;
    updateToggle(currentTabState.enabled);
  }
}

async function handleSiteActionChange(): Promise<void> {
  if (!siteActionSelect) return;
  const action = siteActionSelect.value as SiteRule['action'];

  if (action === 'auto') {
    // Remove any existing rule for this site.
    currentSiteRules = currentSiteRules.filter((r) => !urlMatchesPattern(currentPageUrl, r.pattern));
    matchedRule = null;
    siteActionSelect.disabled = true;
    await chrome.storage.sync.set({ [STORAGE_KEYS.SITE_RULES]: currentSiteRules });

    // Re-evaluate: tell the content script to re-check detection.
    await sendToTab('RE_EVALUATE');
  } else {
    // Create or update the rule for this site.
    // Derive a pattern from the current URL.
    const pattern = derivePattern(currentPageUrl);
    if (matchedRule) {
      matchedRule.action = action;
    } else {
      // Create a new rule.
      matchedRule = {
        id: Date.now().toString(36),
        pattern,
        action,
        label: extractHostname(currentPageUrl)
      };
      currentSiteRules.push(matchedRule);
    }
    siteActionSelect.disabled = false;
    await chrome.storage.sync.set({ [STORAGE_KEYS.SITE_RULES]: currentSiteRules });
    // Notify background to broadcast to content scripts.
    await sendMessage('SAVE_SITE_RULES', currentSiteRules);
    // Re-apply on the current tab.
    if (action === 'always-on') {
      await sendToTab('ENABLE_DARK_MODE');
    } else if (action === 'always-off') {
      await sendToTab('DISABLE_DARK_MODE');
    }
  }
}

function derivePattern(url: string): string {
  try {
    const u = new URL(url);
    // e.g. https://en.wikipedia.org/wiki/Foo → https://en.wikipedia.org/*
    return `${u.protocol}//${u.host}/*`;
  } catch {
    return '*://*/*';
  }
}

function extractHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function handleOpenOptions(): void {
  chrome.runtime.openOptionsPage();
}

function handleOpenSiteRules(): void {
  // Both buttons open the options page — the user can navigate to the
  // Site Rules section from there.
  chrome.runtime.openOptionsPage();
}

/* ─── Wire up ───────────────────────────────────────────────────── */

function handleToggleError(err: unknown): void {
  // eslint-disable-next-line no-console
  console.error('[Nocturn popup] Toggle error:', err);
  setStatus("Couldn't reach the page. Try reloading.", 'error');
}

function attachListeners(): void {
  toggleBtn?.addEventListener('click', () => {
    handleToggle().catch(handleToggleError);
  });

  siteActionSelect?.addEventListener('change', () => {
    handleSiteActionChange().catch((err) => {
      console.error('[Nocturn popup] Site action error:', err);
      setStatus("Couldn't save site rule.", 'error');
    });
  });

  openOptionsBtn?.addEventListener('click', handleOpenOptions);
  openSiteRulesBtn?.addEventListener('click', handleOpenSiteRules);
}

attachListeners();
init();
