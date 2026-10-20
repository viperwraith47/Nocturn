import { defineConfig, type PluginOption } from 'vite';
import { resolve } from 'node:path';
import fs from 'node:fs';

/**
 * Vite configuration for the Nocturn browser extension (Manifest V3).
 *
 * Entry points:
 *  - background/index.ts  → background/index.js (MV3 service worker)
 *  - content/index.ts     → content/index.js (content script, runs at document_start)
 *  - popup/popup.ts       → popup/popup.js
 *  - options/options.ts   → options/options.js
 *
 * The static `manifest.json`, `styles/dark-overrides.css`, and `assets/icons/`
 * are copied into `dist/` via a small plugin so the output is a ready-to-load
 * extension package.
 */
const srcRoot = resolve(__dirname, 'src');
const staticRoot = __dirname;

function copyStaticFiles(): PluginOption {
  const filesToCopy = [
    { src: 'manifest.json', dest: 'manifest.json' },
    { src: 'styles/dark-overrides.css', dest: 'styles/dark-overrides.css' },
    { src: 'src/popup/popup.html', dest: 'popup/popup.html' },
    { src: 'src/options/options.html', dest: 'options/options.html' },
  ];
  const iconFiles = fs.readdirSync(resolve(staticRoot, 'assets/icons'));
  for (const icon of iconFiles) {
    filesToCopy.push({ src: `assets/icons/${icon}`, dest: `assets/icons/${icon}` });
  }

  return {
    name: 'copy-static-extension-files',
    closeBundle() {
      const outDir = resolve(staticRoot, 'dist');
      for (const { src, dest } of filesToCopy) {
        const from = resolve(staticRoot, src);
        const to = resolve(outDir, dest);
        if (fs.existsSync(from)) {
          fs.mkdirSync(resolve(outDir, dest.includes('/') ? dest.split('/').slice(0, -1).join('/') : '.'), {
            recursive: true
          });
          fs.copyFileSync(from, to);
        }
      }
      console.log('\n✓ Copied manifest.json, HTML pages, styles, and icons to dist/');
    }
  };
}

export default defineConfig(({ mode }) => {
  const isServe = mode === 'serve';
  return {
    base: './',
    resolve: {
      alias: {
        '@': srcRoot,
        '@styles': resolve(staticRoot, 'styles')
      }
    },
    server: {
      port: 5173,
      strictPort: true
    },
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      sourcemap: true,
      minify: !isServe,
      rollupOptions: {
        input: {
          background: resolve(srcRoot, 'background/index.ts'),
          'content/index': resolve(srcRoot, 'content/index.ts'),
          'popup/popup': resolve(srcRoot, 'popup/popup.ts'),
          'options/options': resolve(srcRoot, 'options/options.ts')
        },
        output: {
          // ES format — each entry point is self-contained because runtime
          // constants are duplicated per entry (no shared runtime imports).
          // This avoids cross-chunk imports that browser extensions can't
          // resolve in content scripts, service workers, and popups.
          entryFileNames: '[name].js',
          chunkFileNames: '[name].js',
          assetFileNames: '[name].[ext]'
        }
      }
    },
    plugins: [copyStaticFiles()]
  };
});
