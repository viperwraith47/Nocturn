# Nocturn

> **Dark Mode Enforcer for Legacy Sites** — Automatically applies a clean, customizable dark theme inversion to older or poorly styled text-heavy websites that lack native dark mode support.

## Features

1. **Automatic dark mode detection** — Only applies inversion when the site lacks native dark mode. Detection checks `<meta name="color-scheme">` tags, the CSS `color-scheme` property, dark-mode class names (e.g. `.dark`), embedded `@media (prefers-color-scheme: dark)` rules, inline background luminance, **and** the OS-level `prefers-color-scheme` preference *combined with* site CSS that actually responds to it (a bare OS preference alone does **not** skip the page).
2. **Per-site control** — Whitelist/blacklist with Chrome-style URL pattern matching (e.g. `https://*.wikipedia.org/*`).
3. **Customizable parameters** — Brightness, contrast, sepia/warmth, grayscale, and hue rotation sliders.
4. **Media handling toggle** — Option to invert images or keep them in original colors.
5. **Keyboard shortcuts** — `Ctrl+Shift+U` (toggle), `Ctrl+Shift+O` (enable), `Ctrl+Shift+P` (disable).
6. **Dynamic content support** — SPA and AJAX sites handled via a throttled `MutationObserver`.
7. **Lightweight** — No framework runtime, minimal DOM footprint, vanilla TypeScript.

## How It Works

The dark theme engine works in layers:

1. **Detection** — Checks for native dark mode support across multiple signals. If detected, Nocturn skips the page entirely. The OS-level `prefers-color-scheme` preference is only treated as native dark when the site *also* ships CSS that responds to it — a bare OS preference on a site with no dark-mode CSS will still be inverted.
2. **Root inversion** — Applies a CSS `filter()` to `<html>`: `invert(1) hue-rotate(180deg)` plus user-tunable brightness, contrast, sepia, grayscale, and hue-rotate values.
3. **Media restoration** — A counter-filter neutralizes the inversion on `img`, `video`, `iframe`, `svg`, and `canvas` elements so photos and illustrations keep their natural colors.
4. **CSS variable overrides** — Overrides common theme variables (`--bg`, `--text-color`, `--border-color`, etc.) for sites using CSS custom properties.
5. **Dynamic content** — A throttled `MutationObserver` watches for new DOM nodes and re-applies the media counter-filter to newly added elements.

## Project Structure

```
Nocturn/
├── manifest.json              # Extension manifest (Manifest V3)
├── package.json
├── tsconfig.json
├── vite.config.ts             # Vite build config with static file copying
├── README.md
├── styles/
│   └── dark-overrides.css     # Media counter-filter + variable overrides
├── assets/
│   └── icons/                 # Generated icons (16/32/48/128px)
├── scripts/
│   └── generate-icons.js      # Icon generation from SVG (uses sharp)
└── src/
    ├── types.ts               # Shared TypeScript types & defaults
    ├── background/
    │   └── index.ts           # Storage API, per-tab state, keyboard shortcuts
    ├── content/
    │   ├── index.ts           # Entry: orchestrate detection → engine → observer
    │   ├── detection.ts       # Detect existing dark mode support
    │   ├── engine.ts          # Core filter application + CSS overrides
    │   └── observer.ts        # Throttled MutationObserver for dynamic content
    ├── popup/
    │   ├── popup.html         # Quick toggle + per-site override
    │   └── popup.ts           # Popup interaction logic
    └── options/
        ├── options.html       # Full customization panel
        └── options.ts         # Options UI logic (sliders, site management)
```

## Development

### Prerequisites

- Node.js >= 18
- npm >= 8

### Install dependencies

```bash
npm install
```

### Build

```bash
npm run build
```

This compiles all TypeScript entry points and produces a ready-to-load extension in `dist/`.

### Load in Chrome

1. Go to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `dist/` folder

### Load in Firefox

1. Go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select any file inside the `dist/` folder

### Type-checking

```bash
npm run type-check
```

### Regenerate icons

```bash
node scripts/generate-icons.js
```

## Usage

- **Popup**: Click the Nocturn icon in your toolbar to toggle dark mode on/off and manage the current site.
- **Options**: Go to `chrome://extensions → Nocturn → Options` or click "Settings" in the popup for full customization.
- **Shortcuts**: `Ctrl+Shift+U` toggles, `Ctrl+Shift+O` enables, `Ctrl+Shift+P` disables.

## Changelog

### v1.0.2 — Apple Design Review
- **Accessibility**: Options-page toggles are now semantic `<button role="switch">` elements with `aria-checked` and full keyboard support (Space/Enter). Previously they were non-focusable `<div>`s that keyboard and screen-reader users could not operate.
- **Accessibility**: Both the popup and options page now respect `prefers-reduced-motion`, disabling all animations and transitions when the user requests reduced motion.
- **Accessibility**: Added visible `:focus-visible` outlines on every interactive control (buttons, selects, sliders, toggles).
- **Accessibility**: Converted all font sizes from fixed `px` to `rem` so text scales with the browser's root font size.
- **Fix**: The site-rule sliders' track-fill gradient was broken — the `--value` CSS custom property was referenced but never set. The fill now tracks the thumb in real time.
- **UX**: Removed the redundant "Save settings" button. Settings and site rules now auto-save on every change (as the inline note always claimed); the button was always disabled anyway.
- **UX**: The "Add rule" button now disables itself until a valid URL pattern is entered.
- **Design**: Refined the accent color from a generic system blue (#60a5fa) to a twilight indigo (#818cf8) that ties the UI to the crescent-moon icon and the night-time concept, giving the extension a more distinctive point of view.
- **Icons**: Regenerated all toolbar icons with the refined twilight-indigo accent.

### v1.0.1
- **Fix**: Native dark-mode detection no longer treats the OS-level `prefers-color-scheme: dark` media query as "native dark support" on its own. Previously, users with dark mode enabled in their OS settings would never get Nocturn applied — even on legacy text-heavy sites with no dark-mode CSS. The detection now requires the site to *also* ship CSS that responds to the dark media query (or one of the other signals: `color-scheme` meta/property, dark-mode class names, embedded dark CSS, or a dark rendered background).
- **Fix**: `window.nocturn.active` flag is now kept in sync with the actual engine state (was always `false`).
- **Improvement**: The MutationObserver's `running` property is now a live getter instead of a stale snapshot.
- **Test**: Added regression tests guarding against the OS-preference false-positive.

### v1.0.0
- Initial release: automatic detection, per-site rules, customizable CSS filters, media preservation, keyboard shortcuts, SPA dynamic-content support.

## License

MIT
