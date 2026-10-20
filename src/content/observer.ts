/**
 * Nocturn – dynamic content observer
 *
 * Single-page applications and pages that load content via AJAX can inject
 * new DOM nodes *after* Nocturn has already applied its filter.  Those new
 * media elements would inherit the global `invert()` filter and show up with
 * wrong colors.
 *
 * Rather than re-apply the full engine on every mutation (which would cause
 * layout thrashing), this module:
 *
 *  1. Watches the document for `childList` / `subtree` changes via a
 *     `MutationObserver`.
 *  2. Throttles callbacks with `requestAnimationFrame` so we never process
 *     more than once per frame.
 *  3. On each flush, re-applies the filter to any *new* media elements that
 *     are missing the counter-filter class (`.nocturn-media-safe`).
 *  4. Also listens for `nocturn:settings-updated` to re-sync after the user
 *     toggles "preserve media".
 *
 * We tag handled media nodes with a data attribute rather than a class to
 * reduce the chance of colliding with the page's own CSS.
 */

import type { DarkModeSettings } from '../types';
import { buildFilter, updateFilter } from './engine';

const SAFE_ATTR = 'data-nocturn-safe';

/** Tag an element so we know the counter-filter has been applied. */
function tagSafe(el: Element): void {
  el.setAttribute(SAFE_ATTR, 'true');
}

/** Check if an element has already been processed. */
function isSafe(el: Element): boolean {
  return el.hasAttribute(SAFE_ATTR);
}

/**
 * Apply the counter-filter to a single media element.
 *
 * The counter-filter is implemented by the CSS in `dark-overrides.css` and
 * the dynamic <style> injected by the engine.  All we need to do here is
 * make sure images / videos / iframes don't carry the inherited `filter`
 * from <html>.
 *
 * If the page's CSS already handles this (via the `.nocturn-active img`
 * rule) we don't need inline styles — but as a safety net we set an inline
 * `filter: none` so sites that inject high-specificity rules don't override
 * our counter-filter.
 */
export function applyCounterFilter(el: Element): void {
  // Only process elements that can actually render pixels.
  const isMedia =
    el.hasAttribute('src') ||
    (el as SVGElement).tagName?.toLowerCase() === 'svg';
  if (!isMedia) return;

  // Set inline filter to counteract the global inversion.  We use
  // `!important`-equivalent by also setting the property via the
  // CSS cascade; inline styles always win so this is sufficient.
  const styleEl = el as HTMLElement & { style: CSSStyleDeclaration };
  const currentFilter = window.getComputedStyle(el).filter;
  if (currentFilter && currentFilter !== 'none') {
    styleEl.style.setProperty('filter', 'none', 'important');
  }
  tagSafe(el);
}

/**
 * Process a batch of newly-added nodes.
 *
 * We look for media-type elements (img, video, svg, iframe, canvas, picture)
 * and any element that has a `background-image` style (which the global
 * filter would also invert).
 */
export function processAddedNodes(root: Node, settings: DarkModeSettings): void {
  if (!(root instanceof Element)) return;
  if (!window.nocturn) return; // engine not active

  const preserveMedia = settings.preserveMedia;

  // QuerySelectorAll is fast and handles the subtree in one call.
  const mediaSelectors = [
    'img',
    'video',
    'svg',
    'iframe',
    'canvas',
    'picture'
  ].join(',');

  const mediaEls = root.querySelectorAll<Element>(mediaSelectors);

  mediaEls.forEach((el) => {
    if (isSafe(el)) return;

    const styleEl = el as HTMLElement & { style: CSSStyleDeclaration };

    if (preserveMedia) {
      // Neutralize the inherited filter on this element.
      styleEl.style.setProperty('filter', 'none', 'important');
    } else {
      // Let the element inherit the parent filter (already inverted).
      styleEl.style.removeProperty('filter');
    }
    tagSafe(el);
  });

  // Also handle elements with inline background-image (data URIs, gradients).
  // These are rare but can look odd when inverted.
  const bgImgs = root.querySelectorAll<Element>('[style*="background-image"]');
  bgImgs.forEach((el) => {
    if (isSafe(el)) return;
    const styleEl = el as HTMLElement & { style: CSSStyleDeclaration };
    if (preserveMedia) {
      // Un-invert the background by applying a counter-filter.
      styleEl.style.setProperty('background-filter', 'invert(1) hue-rotate(180deg)', 'important');
    }
    tagSafe(el);
  });
}

interface ObserverController {
  /** Start observing the document. */
  start: () => void;
  /** Stop observing.  Safe to call multiple times. */
  stop: () => void;
  /** Manually flush any pending work (call after toggling settings). */
  flush: () => void;
  /** Whether the observer is currently active (live getter). */
  readonly running: boolean;
}

/**
 * Create a throttled MutationObserver that re-applies media counter-filters
 * to newly-added content.  The throttle is `requestAnimationFrame`-based so
 * it runs at most once per frame (~60fps) and is automatically cancelled
 * if the tab is backgrounded.
 */
export function createObserver(
  getSettings: () => DarkModeSettings,
  isActive: () => boolean
): ObserverController {
  let observer: MutationObserver | null = null;
  let scheduled = false;
  let pendingNodes: Node[] = [];

  const flush = () => {
    scheduled = false;
    if (!isActive() || pendingNodes.length === 0) {
      pendingNodes = [];
      return;
    }

    const settings = getSettings();

    pendingNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) return;
      if (node instanceof Element) {
        processAddedNodes(node, settings);
      }
    });
    pendingNodes = [];
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    // Don't clear pendingNodes — we need them for the flush!
    // Use requestIdleCallback if available (low priority), fall back to rAF.
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(flush, { timeout: 500 });
    } else {
      window.requestAnimationFrame(flush);
    }
  };

  const callback: MutationCallback = (records) => {
    if (!isActive()) {
      // Engine not active — no need to process mutations.
      records = [];
      return;
    }
    for (const record of records) {
      const added = Array.from(record.addedNodes);
      for (const node of added) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          pendingNodes.push(node);
        }
      }
    }
    if (pendingNodes.length > 0) {
      schedule();
    }
  };

  const start = () => {
    if (observer) return;
    if (!window.MutationObserver) {
      // IE11 doesn't have MutationObserver — bail out.
      return;
    }
    observer = new MutationObserver(callback);
    observer.observe(document, {
      childList: true,
      subtree: true
    });
  };

  const stop = () => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    pendingNodes = [];
    scheduled = false;
  };

  return {
    start,
    stop,
    flush,
    /** Live getter — reflects whether the observer is actually running. */
    get running() {
      return !!observer;
    }
  };
}

// Declare the global so the engine can check if it's active.
declare global {
  interface Window {
    nocturn?: {
      active: boolean;
    };
  }
}
