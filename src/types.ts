/**
 * Nocturn – shared type definitions.
 *
 * This file contains **only** TypeScript types (interfaces, type aliases).
 * Runtime constants (DEFAULT_SETTINGS, STORAGE_KEYS, etc.) are defined
 * locally in each entry-point bundle to keep extension bundles
 * self-contained — browser extension content scripts and service workers
 * cannot resolve shared ES-module chunks.
 *
 * To keep the constants in sync, search for `// nocturn-constants` in each
 * entry point file.
 */

/** Tunable parameters that control how the dark theme inversion looks. */
export interface DarkModeSettings {
  /** Master on/off switch. */
  enabled: boolean;
  /** Page brightness (0.5–2.0). Higher = brighter. */
  brightness: number;
  /** Page contrast (0.5–1.5). */
  contrast: number;
  /** Sepia / warmth (0–1). Higher = warmer/oranger. */
  sepia: number;
  /** Grayscale (0–1). Higher = more desaturated. */
  grayscale: number;
  /** Hue rotation in degrees (0–360). */
  hueRotate: number;
  /** Whether to keep images/videos in their original colors. */
  preserveMedia: boolean;
  /** Whether to also apply CSS variable overrides for sites using custom props. */
  overrideVariables: boolean;
  /** Whether to force dark backgrounds even on sites that set their own. */
  forceDarkBackground: boolean;
}

/** Storage keys used by the extension. */
export type StorageKeys = Record<string, string>;

/** A per-site rule that overrides the global behavior for a URL pattern. */
export type SiteRuleAction = 'always-on' | 'always-off' | 'auto';

export interface SiteRule {
  id: string;
  /** URL pattern, e.g. "https://*.wikipedia.org/*" */
  pattern: string;
  /** The action to take when this site matches. */
  action: SiteRuleAction;
  /** Human-readable label (optional). */
  label?: string;
}

/** Message types passed between background, popup, and content scripts. */
export type MessageType =
  | 'TOGGLE_DARK_MODE'
  | 'ENABLE_DARK_MODE'
  | 'DISABLE_DARK_MODE'
  | 'GET_STATE'
  | 'SETTINGS_UPDATED'
  | 'SAVE_SETTINGS'
  | 'REQUEST_STATE'
  | 'RE_EVALUATE'
  | 'GET_SETTINGS'
  | 'SAVE_SITE_RULES'
  | 'GET_SITE_RULES'
  | 'GET_TAB_STATE'
  | 'SAVE_TAB_STATE';

export interface ExtensionMessage {
  type: MessageType;
  payload?: unknown;
}

/** The resolved effective state for a single tab. */
export interface TabState {
  /** Whether dark mode is currently applied on this tab. */
  enabled: boolean;
  /** Why dark mode is on/off – used to decide if auto-detection should run. */
  reason: 'user' | 'auto' | 'site-rule' | 'default';
}
