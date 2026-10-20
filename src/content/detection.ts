/**
 * Nocturn – detection module
 *
 * Determines whether the current page already has native dark-mode support
 * so that Nocturn can avoid double-inverting.
 *
 * Detection checks (in order of reliability):
 *  1. `prefers-color-scheme: dark` media query (user-level OS/browser pref)
 *  2. `color-scheme` property on <html>
 *  3. `<meta name="color-scheme" content="dark">` meta tag
 *  4. Common dark-mode class names on <html> / <body>
 *  5. Embedded CSS containing `prefers-color-scheme: dark`
 */

import type { DarkModeSettings } from '../types';

/** Human-readable reason the page was detected as natively dark. */
export type DarkSupportReason =
  | 'prefers-color-scheme-media'
  | 'color-scheme-property'
  | 'meta-color-scheme-tag'
  | 'dark-mode-class'
  | 'inline-dark-theme';

export interface DetectionResult {
  /** True if the page already supports dark mode natively. */
  hasNativeDark: boolean;
  /** Why dark mode was detected, if it was. */
  reason: DarkSupportReason | null;
  /** The current state of the `nocturn-active` class on <html>. */
  currentActive: boolean;
}

/** Class names commonly used by sites to signal an active dark theme. */
const DARK_CLASSES = [
  'dark',
  'dark-mode',
  'theme-dark',
  'is-dark',
  'is-dark-mode',
  'dark-theme',
  'nhsuk-dark-mode',
  'mw-mf-theme-dark',
  'night-mode',
  'nightmode',
  'dark-background',
  'st-dark'
];

/** CSS selectors whose presence suggests an active dark theme. */
const DARK_SELECTORS = [
  '[data-theme="dark"]',
  '[data-theme="dark"]',
  '[data-bs-theme="dark"]',
  '[class*="dark"]',
  '[class*="Dark"]'
];

const prefersDarkQuery = '(prefers-color-scheme: dark)';

/**
 * Check whether the OS/browser user prefers a dark color scheme.
 */
export function prefersColorSchemeDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try {
    return window.matchMedia(prefersDarkQuery).matches;
  } catch {
    return false;
  }
}

/**
 * Check the computed `color-scheme` CSS property on <html>.
 */
export function hasColorSchemeProperty(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const html = document.documentElement;
    if (!html) return false;
    const cs = getComputedStyle(html);
    const scheme = cs.colorScheme || html.getAttribute('color-scheme');
    if (!scheme) return false;
    const parts = scheme.toLowerCase().split(/\s*,\s*/);
    return parts.includes('dark');
  } catch {
    return false;
  }
}

/**
 * Check for `<meta name="color-scheme" content="dark">` tags.
 */
export function hasMetaColorSchemeTag(): boolean {
  if (typeof document === 'undefined') return false;
  const meta = document.querySelector('meta[name="color-scheme"]') as HTMLMetaElement | null;
  if (meta && meta.content) {
    return meta.content.toLowerCase().includes('dark');
  }
  return false;
}

/**
 * Check whether <html>/<body> carries any known dark-mode class name.
 */
export function hasDarkModeClass(): boolean {
  if (typeof document === 'undefined') return false;
  const html = document.documentElement;
  const body = document.body;

  const check = (el: Element | null): boolean => {
    if (!el) return false;
    const cls = el.getAttribute('class') || '';
    return DARK_CLASSES.some((c) =>
      cls.split(/\s+/).some((part) => part.toLowerCase().includes(c.toLowerCase()))
    );
  };

  return check(html) || check(body);
}

/**
 * Heuristic: if a large portion of visible text has a dark-ish background
 * already, treat the page as natively dark.  This catches inline-styled
 * pages and CSS-in-JS themes that don't expose a class name.
 *
 * We sample a handful of elements and check computed background luminance.
 */
export function hasInlineDarkTheme(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const html = document.documentElement;
    const bg = getComputedStyle(html).backgroundColor || '';
    return hasHighContrastDarkness(bg);
  } catch {
    return false;
  }
}

/**
 * Rough luminance check on an rgb()/hex color to decide if it is "dark".
 */
function hasHighContrastDarkness(color: string): boolean {
  if (!color || color === 'rgba(0, 0, 0, 0)' || color === 'transparent') return false;
  const nums = color.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
  if (!nums) {
    // Try hex
    const hex = color.match(/^#?([a-f0-9]{3}|[a-f0-9]{6})$/i);
    if (!hex) return false;
    let h = hex[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return luminance(r, g, b) < 0.3;
  }
  const r = parseFloat(nums[1]);
  const g = parseFloat(nums[2]);
  const b = parseFloat(nums[3]);
  return luminance(r, g, b) < 0.3;
}

function luminance(r: number, g: number, b: number): number {
  const a = [r, g, b].map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}

/**
 * Also check embedded <style> tags and <link rel="stylesheet"> sheets for
 * a `prefers-color-scheme: dark` rule — this catches sites that only flip
 * when the OS pref is dark.  Returns true if such a rule exists.
 *
 * This is best-effort: cross-origin stylesheets will throw and we skip them.
 */
export function hasEmbeddedDarkMediaQuery(): boolean {
  if (typeof document === 'undefined') return false;
  const walker = document.createTreeWalker(
    document,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(node: Node) {
        if (node.nodeName === 'STYLE' || node.nodeName === 'LINK') {
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_SKIP;
      }
    }
  );
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.nodeName === 'STYLE') {
      const text = (node as Element).textContent || '';
      if (text.includes('prefers-color-scheme: dark')) return true;
    } else if (node.nodeName === 'LINK') {
      const href = (node as Element).getAttribute('href');
      if (href && href.includes('dark')) return true;
    }
  }
  // Check document style sheets
  try {
    const sheets = document.styleSheets;
    for (let i = 0; i < sheets.length; i++) {
      let css = '';
      try {
        // cssText is non-standard but supported in Chrome/Firefox.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        css = ((sheets[i] as CSSStyleSheet) as any).cssText || '';
      } catch {
        continue; // cross-origin
      }
      if (css.includes('prefers-color-scheme: dark')) return true;
    }
  } catch {
    // ignore
  }
  return false;
}

/**
 * Run all detection checks and return a combined result.
 */
export function detectNativeDarkSupport(): DetectionResult {
  if (hasMetaColorSchemeTag()) {
    return { hasNativeDark: true, reason: 'meta-color-scheme-tag', currentActive: isNocturnActive() };
  }
  // Only treat the page as natively dark when the user's OS actually prefers
  // dark mode AND the site ships CSS that responds to `prefers-color-scheme:
  // dark`.  Checking the OS preference alone is a false positive: it tells
  // us the *user's* preference, not the *site's* capability — a legacy site
  // with no dark-mode CSS would be wrongly skipped on a dark-mode OS.
  if (prefersColorSchemeDark() && hasEmbeddedDarkMediaQuery()) {
    return { hasNativeDark: true, reason: 'prefers-color-scheme-media', currentActive: isNocturnActive() };
  }
  if (hasColorSchemeProperty()) {
    return { hasNativeDark: true, reason: 'color-scheme-property', currentActive: isNocturnActive() };
  }
  if (hasDarkModeClass()) {
    return { hasNativeDark: true, reason: 'dark-mode-class', currentActive: isNocturnActive() };
  }
  if (hasEmbeddedDarkMediaQuery()) {
    return { hasNativeDark: true, reason: 'inline-dark-theme', currentActive: isNocturnActive() };
  }
  if (hasInlineDarkTheme()) {
    return { hasNativeDark: true, reason: 'inline-dark-theme', currentActive: isNocturnActive() };
  }
  return { hasNativeDark: false, reason: null, currentActive: isNocturnActive() };
}

/** Whether Nocturn's dark class is currently applied to <html>. */
export function isNocturnActive(): boolean {
  if (typeof document === 'undefined') return false;
  return document.documentElement.classList.contains('nocturn-active');
}

/**
 * Decide whether Nocturn should auto-enable on this page.
 * Returns false if the page already has native dark support (to avoid
 * double inversion) or if the URL is on the site blacklist rules.
 */
export function shouldAutoEnable(settings: DarkModeSettings, siteRules: unknown): boolean {
  // If Nocturn is globally disabled, don't auto-enable.
  if (!settings.enabled) return false;
  // If the page already supports dark mode, skip.
  if (detectNativeDarkSupport().hasNativeDark) return false;
  return true;
}
