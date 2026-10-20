/**
 * Nocturn – dark theme engine
 *
 * The engine is responsible for the actual visual transformation of the
 * page.  It works by:
 *
 *  1. Toggling the `.nocturn-active` class on <html> to activate the CSS
 *     overrides shipped in `styles/dark-overrides.css`.
 *
 *  2. Applying a `filter(...)` inline style to <html> that inverts and
 *     adjusts the entire document.
 *
 *  3. Re-applying a counter-filter (via the `.nocturn-invert-media` class
 *     logic in the CSS) to media elements so images / videos / iframes
 *     keep their natural colors.
 *
 *  4. Overriding common CSS custom properties (`--bg`, `--text-color`, …)
 *     that theme-aware sites rely on.
 *
 *  5. Forcing dark backgrounds on `body`/`html` and ensuring text contrast
 *     stays readable.
 *
 * The engine is **stateless** regarding *whether* it should run — that
 * decision lives in `content/index.ts` (which consults detection results,
 * settings, and site rules).  The engine simply applies or removes the
 * transformation.
 */

import type { DarkModeSettings } from '../types';
import { isNocturnActive } from './detection';

const HTML_CLASS_ACTIVE = 'nocturn-active';
const HTML_CLASS_INVERT_MEDIA = 'nocturn-invert-media';
const FILTER_PROP = '--nocturn-filter';
const STYLE_EL_ID = 'nocturn-style';

/** The <html> element (cached). */
function getRoot(): HTMLElement {
  return document.documentElement;
}

/**
 * Build the CSS filter string from the current settings.
 *
 * The base inversion flips all colors.  `hue-rotate(180deg)` compensates so
 * that skin tones and most UIs come out looking natural rather than
 * psychedelic.  The remaining parameters let the user fine-tune the result.
 *
 * NOTE: CSS filter order matters.  `invert(1)` is applied first so the
 * hue-rotate operates in the inverted space.
 */
export function buildFilter(settings: DarkModeSettings): string {
  const { brightness, contrast, sepia, grayscale, hueRotate } = settings;
  // Invert first, then hue-rotate to correct the color wheel, then
  // brightness/contrast/sepia/grayscale for fine-tuning.
  return (
    `invert(1) ` +
    `hue-rotate(${hueRotate}deg) ` +
    `brightness(${brightness}) ` +
    `contrast(${contrast}) ` +
    `sepia(${sepia}) ` +
    `grayscale(${grayscale})`
  );
}

/**
 * Create (or reuse) a <style> element in the document head that holds
 * the dynamically-generated CSS rules for :root variable overrides and
 * the media counter-filter.  Keeping these in a single <style> element
 * avoids re-querying the DOM and lets us update them efficiently.
 */
function ensureStyleEl(): HTMLStyleElement {
  let el = document.getElementById(STYLE_EL_ID) as HTMLStyleElement | null;
  if (el) return el;
  el = document.createElement('style');
  el.id = STYLE_EL_ID;
  el.setAttribute('data-nocturn', 'true');
  // Insert as early as possible so it overrides page styles.
  const head = document.head || document.documentElement;
  if (head && head.firstChild) {
    head.insertBefore(el, head.firstChild);
  } else if (head) {
    head.appendChild(el);
  }
  return el;
}

/**
 * The CSS rules injected via the dynamic <style> element.
 *
 * These complement `dark-overrides.css` (which is loaded as a content
 * stylesheet).  The injected rules are regenerated whenever settings change.
 */
function buildDynamicCSS(settings: DarkModeSettings): string {
  const mediaRestore = settings.preserveMedia
    ? `
html.nocturn-active img,
html.nocturn-active video,
html.nocturn-active svg,
html.nocturn-active picture,
html.nocturn-active canvas,
html.nocturn-active iframe,
html.nocturn-active .nocturn-media,
html.nocturn-active img *,
html.nocturn-active video *,
html.nocturn-active svg * {
  filter: none !important;
}`
    : '';

  const varOverrides = settings.overrideVariables
    ? `
:root {
  --nocturn-filter: ${buildFilter(settings)};
}
html.nocturn-active {
  --bg: #0e0e10 !important;
  --background: #0e0e10 !important;
  --text-color: #e2e2e2 !important;
  --text: #e2e2e2 !important;
  --fg: #e2e2e2 !important;
  --color: #e2e2e2 !important;
  --border-color: #2a2a2e !important;
  --border: #2a2a2e !important;
  --card-bg: #151517 !important;
  --card: #151517 !important;
  --input-bg: #1c1c1f !important;
  --input: #1c1c1f !important;
  --link-color: #60a5fa !important;
  --link: #60a5fa !important;
  --accent: #60a5fa !important;
  --primary: #60a5fa !important;
  --muted: #8a8a94 !important;
  --muted-color: #8a8a94 !important;
  --dropdown-bg: #1c1c1f !important;
  --navbar-bg: #0e0e10 !important;
  --sidebar-bg: #131315 !important;
}`
    : '';

  return `${mediaRestore}\n${varOverrides}`;
}

/** Update the dynamic <style> element with fresh rules from settings. */
function updateStyleEl(settings: DarkModeSettings): void {
  const el = ensureStyleEl();
  el.textContent = buildDynamicCSS(settings);
}

/**
 * Apply the dark theme to the page.
 *
 * @param settings  Current user settings.
 * @param skipDetection  If true, bypass the native-dark detection (used
 *   when the user force-enables per-site).
 */
export function applyDarkMode(settings: DarkModeSettings): void {
  const root = getRoot();

  // Update the dynamic <style> with fresh variable overrides / media rules.
  updateStyleEl(settings);

  // Apply the filter as an inline style on <html>.
  root.style.filter = buildFilter(settings);

  // Add classes to activate the CSS in dark-overrides.css.
  root.classList.add(HTML_CLASS_ACTIVE);

  // Media handling: if the user wants media preserved, we keep the
  // counter-filter active (default).  If they want media inverted, we
  // add the `.nocturn-invert-media` class so media inherits the parent
  // filter instead.
  if (!settings.preserveMedia) {
    root.classList.add(HTML_CLASS_INVERT_MEDIA);
  } else {
    root.classList.remove(HTML_CLASS_INVERT_MEDIA);
  }

  // Force dark background on the root / body.
  if (settings.forceDarkBackground) {
    root.style.setProperty('background-color', '#0e0e10', 'important');
    if (document.body) {
      document.body.style.setProperty('background-color', '#0e0e10', 'important');
    }
  }

  // Dispatch an event so other scripts (e.g. the observer) can react.
  window.dispatchEvent(new CustomEvent('nocturn:enabled', {
    detail: { settings }
  }));
}

/**
 * Remove the dark theme from the page.
 */
export function removeDarkMode(): void {
  const root = getRoot();

  // Remove the filter inline style.
  root.style.filter = '';

  // Remove activation classes.
  root.classList.remove(HTML_CLASS_ACTIVE);
  root.classList.remove(HTML_CLASS_INVERT_MEDIA);

  // Reset forced background.
  root.style.removeProperty('background-color');
  if (document.body) {
    document.body.style.removeProperty('background-color');
  }

  // Remove the dynamic style element.
  const styleEl = document.getElementById(STYLE_EL_ID);
  if (styleEl) styleEl.remove();

  window.dispatchEvent(new CustomEvent('nocturn:disabled'));
}

/**
 * Update the filter values on an already-active page (e.g. when the user
 * tweaks sliders in the options popup).  This avoids a full re-apply and
 * prevents layout thrashing.
 */
export function updateFilter(settings: DarkModeSettings): void {
  const root = getRoot();
  if (!isNocturnActive()) {
    // Not active — the filter won't be visible, but keep styleEl in sync
    // so that enabling later uses fresh values.
    updateStyleEl(settings);
    return;
  }
  root.style.filter = buildFilter(settings);
  updateStyleEl(settings);

  // Toggle media preservation class.
  if (!settings.preserveMedia) {
    root.classList.add(HTML_CLASS_INVERT_MEDIA);
  } else {
    root.classList.remove(HTML_CLASS_INVERT_MEDIA);
  }

  // Toggle forced background.
  if (settings.forceDarkBackground) {
    root.style.setProperty('background-color', '#0e0e10', 'important');
  } else {
    root.style.removeProperty('background-color');
  }

  window.dispatchEvent(new CustomEvent('nocturn:settings-updated', {
    detail: { settings }
  }));
}

/**
 * Query the current effective state of the engine on this page.
 */
export function getEngineState(): { active: boolean; filter: string | null } {
  const root = getRoot();
  return {
    active: isNocturnActive(),
    filter: root.style.filter || null
  };
}
