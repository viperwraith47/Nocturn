/**
 * Nocturn – options page script
 *
 * Provides the full customization UI:
 *  - Global toggle switches
 *  - Filter sliders (brightness, contrast, sepia, grayscale, hue-rotate)
 *  - A live CSS-filter preview string
 *  - Per-site rule management (add / delete / reset to defaults)
 *
 * Storage: chrome.storage.sync (synced across devices).
 * Live updates: when the user tweaks a slider, the new settings are sent
 * to the active tab's content script so the page updates in real time.
 */

/// <reference types="chrome" />

import type { DarkModeSettings, SiteRule } from '../types';

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
// ────────────────────────────────────────────────────────────────────────────────

/* ─── Cached DOM ──────────────────────────────────────────────── */

const el = <T extends HTMLElement>(id: string): T | null =>
  document.getElementById(id) as T | null;

const toggleEnabled = el<HTMLDivElement>('toggle-enabled');
const togglePreserveMedia = el<HTMLDivElement>('toggle-preserve-media');
const toggleOverrideVars = el<HTMLDivElement>('toggle-override-vars');
const toggleForceBg = el<HTMLDivElement>('toggle-force-bg');

const sliders = {
  brightness: el<HTMLInputElement>('brightness'),
  contrast: el<HTMLInputElement>('contrast'),
  sepia: el<HTMLInputElement>('sepia'),
  grayscale: el<HTMLInputElement>('grayscale'),
  hueRotate: el<HTMLInputElement>('hue-rotate')
};

const sliderValues = {
  brightness: el<HTMLSpanElement>('brightness-value'),
  contrast: el<HTMLSpanElement>('contrast-value'),
  sepia: el<HTMLSpanElement>('sepia-value'),
  grayscale: el<HTMLSpanElement>('grayscale-value'),
  hueRotate: el<HTMLSpanElement>('hue-rotate-value')
};

const filterPreview = el<HTMLSpanElement>('filter-preview');
const rulesBody = el<HTMLTableSectionElement>('rules-body');
const rulePatternInput = el<HTMLInputElement>('rule-pattern');
const ruleActionSelect = el<HTMLSelectElement>('rule-action');
const addRuleBtn = el<HTMLButtonElement>('add-rule-btn');
const resetDefaultsBtn = el<HTMLButtonElement>('reset-defaults');

/* ─── State ──────────────────────────────────────────────────── */

let settings: DarkModeSettings = { ...DEFAULT_SETTINGS };
let siteRules: SiteRule[] = [...DEFAULT_SITE_RULES];

/* ─── Slider configs ──────────────────────────────────────────── */
/*
 * Each slider stores a value in its own native range on the HTML input,
 * but the settings object uses normalized floats (brightness: 0.5–2.0,
 * sepia: 0–1, etc.).  These configs map between the two.
 */
interface SliderConfig {
  key: keyof DarkModeSettings;
  min: number;
  max: number;
  step: number;
  /** Convert slider (input) value → settings value. */
  toSetting: (v: number) => number;
  /** Convert settings value → slider (input) value. */
  toSlider: (v: number) => number;
  /** Convert settings value → display string. */
  format: (v: number) => string;
}

const SLIDER_CONFIGS: Record<keyof typeof sliders, SliderConfig> = {
  brightness: {
    key: 'brightness', min: 50, max: 200, step: 1,
    toSetting: (v) => v / 100,
    toSlider: (v) => v * 100,
    format: (v) => v.toFixed(2)
  },
  contrast: {
    key: 'contrast', min: 50, max: 150, step: 1,
    toSetting: (v) => v / 100,
    toSlider: (v) => v * 100,
    format: (v) => v.toFixed(2)
  },
  sepia: {
    key: 'sepia', min: 0, max: 100, step: 1,
    toSetting: (v) => v / 100,
    toSlider: (v) => v * 100,
    format: (v) => v.toFixed(2)
  },
  grayscale: {
    key: 'grayscale', min: 0, max: 100, step: 1,
    toSetting: (v) => v / 100,
    toSlider: (v) => v * 100,
    format: (v) => v.toFixed(2)
  },
  hueRotate: {
    key: 'hueRotate', min: 0, max: 360, step: 1,
    toSetting: (v) => v,
    toSlider: (v) => v,
    format: (v) => `${v}°`
  }
};

/** Drive the filled portion of a range slider's track via the --value property. */
function updateSliderFill(input: HTMLInputElement, config: SliderConfig): void {
  const settingVal = settings[config.key] as number;
  const pct = ((config.toSlider(settingVal) - config.min) / (config.max - config.min)) * 100;
  input.style.setProperty('--value', `${pct}%`);
}

/* ─── Storage helpers ──────────────────────────────────────────── */

async function loadSettings(): Promise<void> {
  try {
    const result = await chrome.storage.sync.get([STORAGE_KEYS.SETTINGS, STORAGE_KEYS.SITE_RULES]);
    if (result[STORAGE_KEYS.SETTINGS]) {
      settings = { ...DEFAULT_SETTINGS, ...(result[STORAGE_KEYS.SETTINGS] as DarkModeSettings) };
    }
    if (result[STORAGE_KEYS.SITE_RULES]) {
      siteRules = result[STORAGE_KEYS.SITE_RULES] as SiteRule[];
    }
  } catch (err) {
    console.error('[Nocturn] Failed to load settings:', err);
  }
  render();
}

async function saveSettings(): Promise<void> {
  try {
    await chrome.storage.sync.set({
      [STORAGE_KEYS.SETTINGS]: settings,
      [STORAGE_KEYS.SITE_RULES]: siteRules
    });
  } catch (err) {
    console.error('[Nocturn] Failed to save settings:', err);
  }
}

/** Send updated settings to the active tab's content script (live preview). */
async function pushToActiveTab(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await chrome.tabs.sendMessage(tab.id, {
        type: 'SETTINGS_UPDATED',
        payload: settings
      });
    }
  } catch {
    /* tab may not have a content script (e.g. chrome://) */
  }
}

/* ─── Rendering ──────────────────────────────────────────────── */

function toggleClass(el: HTMLElement | null, active: boolean): void {
  if (!el) return;
  el.classList.toggle('active', active);
  // Keep the semantic switch in sync with its visual state.
  if (el.getAttribute('role') === 'switch') {
    el.setAttribute('aria-checked', String(active));
  }
}

function render(): void {
  // Toggles
  toggleClass(toggleEnabled, settings.enabled);
  toggleClass(togglePreserveMedia, settings.preserveMedia);
  toggleClass(toggleOverrideVars, settings.overrideVariables);
  toggleClass(toggleForceBg, settings.forceDarkBackground);

  // Sliders
  for (const key of Object.keys(SLIDER_CONFIGS) as Array<keyof typeof sliders>) {
    const config = SLIDER_CONFIGS[key];
    const input = sliders[key];
    const valueLabel = sliderValues[key];
    if (!input) continue;

    // Set the input's range attributes.
    input.min = String(config.min);
    input.max = String(config.max);
    input.step = String(config.step);

    // Convert the settings value to the slider's native range.
    const settingVal = settings[config.key] as number;
    input.value = String(config.toSlider(settingVal));

    // Display the formatted value.
    if (valueLabel) valueLabel.textContent = config.format(settingVal);

    // Drive the track fill (CSS uses var(--value)).
    updateSliderFill(input, config);
  }

  // Rules table
  renderRules();
}

function renderRules(): void {
  if (!rulesBody) return;
  rulesBody.innerHTML = '';

  if (siteRules.length === 0) {
    const row = document.createElement('tr');
    row.innerHTML = '<td colspan="3" style="text-align:center;color:var(--nocturn-muted)">No rules configured yet.</td>';
    rulesBody.appendChild(row);
    return;
  }

  for (const rule of siteRules) {
    const row = document.createElement('tr');
    const badge = getBadge(rule.action);
    row.innerHTML = `
      <td>${escapeHtml(rule.pattern)}</td>
      <td>
        <span class="rule-action">
          <span class="badge ${badge.class}">${badge.label}</span>
        </span>
      </td>
      <td>
        <button class="icon-btn danger" title="Remove rule" data-id="${rule.id}">&times;</button>
      </td>
    `;
    rulesBody.appendChild(row);
  }

  // Attach delete listeners to all delete buttons.
  rulesBody.querySelectorAll<HTMLButtonElement>('.danger').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      if (id) deleteRule(id);
    });
  });
}

function getBadge(action: SiteRule['action']): { class: string; label: string } {
  switch (action) {
    case 'always-on':
      return { class: 'badge-on', label: 'Always on' };
    case 'always-off':
      return { class: 'badge-off', label: 'Always off' };
    case 'auto':
    default:
      return { class: 'badge-auto', label: 'Auto-detect' };
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* ─── Interactions ───────────────────────────────────────────── */

function handleToggle(toggle: HTMLElement | null, settingKey: keyof DarkModeSettings): void {
  if (!toggle) return;
  toggle.addEventListener('click', () => {
    const currentValue = settings[settingKey];
    settings[settingKey] = !currentValue as never;
    toggleClass(toggle, Boolean(settings[settingKey]));
    saveSettings();
    pushToActiveTab();
    updateFilterPreview();
  });
}

function handleSlider(key: keyof typeof sliders): void {
  const input = sliders[key];
  const config = SLIDER_CONFIGS[key];
  if (!input) return;

  input.addEventListener('input', () => {
    // Convert the slider's native value to the settings range.
    const sliderVal = parseFloat(input.value);
    const settingVal = config.toSetting(sliderVal);

    settings[config.key] = settingVal as never;

    // Update the displayed value.
    const valueLabel = sliderValues[key];
    if (valueLabel) valueLabel.textContent = config.format(settingVal);

    // Drive the track fill.
    updateSliderFill(input, config);

    saveSettings();
    pushToActiveTab();
    updateFilterPreview();
  });
}

function updateFilterPreview(): void {
  if (!filterPreview) return;
  filterPreview.textContent = buildFilterString(settings);
}

function buildFilterString(s: DarkModeSettings): string {
  return `invert(1) hue-rotate(${s.hueRotate}deg) brightness(${s.brightness.toFixed(2)}) contrast(${s.contrast.toFixed(2)}) sepia(${s.sepia.toFixed(2)}) grayscale(${s.grayscale.toFixed(2)})`;
}

async function handleAddRule(): Promise<void> {
  if (!rulePatternInput || !ruleActionSelect) return;
  const pattern = rulePatternInput.value.trim();
  if (!pattern) return;

  if (!isValidPattern(pattern)) {
    alert('Invalid URL pattern. Use format like: https://*.example.com/*');
    return;
  }

  const rule: SiteRule = {
    id: Date.now().toString(36),
    pattern,
    action: ruleActionSelect.value as SiteRule['action'],
    label: extractHostname(pattern)
  };
  siteRules.push(rule);
  rulePatternInput.value = '';
  renderRules();
  await saveSettings();
}

function isValidPattern(pattern: string): boolean {
  return /^https?:\/\/|^https?:\/\/\*/.test(pattern) || /^\*:\/\*/.test(pattern);
}

function extractHostname(pattern: string): string {
  try {
    if (pattern.startsWith('http')) {
      return new URL(pattern.replace('/*', '')).hostname;
    }
    return pattern;
  } catch {
    return pattern;
  }
}

async function deleteRule(id: string): Promise<void> {
  siteRules = siteRules.filter((r) => r.id !== id);
  renderRules();
  await saveSettings();
}

async function resetDefaults(): Promise<void> {
  if (!confirm('Reset all settings to Nocturn defaults? This cannot be undone.')) return;
  settings = { ...DEFAULT_SETTINGS };
  siteRules = [...DEFAULT_SITE_RULES];
  await saveSettings();
  pushToActiveTab();
  render();
  updateFilterPreview();
}

/* ─── Event binding ────────────────────────────────────────────── */

function bindEvents(): void {
  handleToggle(toggleEnabled, 'enabled');
  handleToggle(togglePreserveMedia, 'preserveMedia');
  handleToggle(toggleOverrideVars, 'overrideVariables');
  handleToggle(toggleForceBg, 'forceDarkBackground');

  // Bind all sliders.
  (Object.keys(sliders) as Array<keyof typeof sliders>).forEach((key) => {
    handleSlider(key);
  });

  addRuleBtn?.addEventListener('click', () => handleAddRule());
  rulePatternInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleAddRule();
  });
  // Enable the Add button only once a valid pattern has been typed.
  const updateAddBtn = () => {
    const pattern = rulePatternInput?.value.trim() ?? '';
    if (addRuleBtn) addRuleBtn.disabled = !pattern || !isValidPattern(pattern);
  };
  rulePatternInput?.addEventListener('input', updateAddBtn);
  updateAddBtn();

  resetDefaultsBtn?.addEventListener('click', resetDefaults);
}

/* ─── Init ─────────────────────────────────────────────────────── */

bindEvents();
loadSettings();
