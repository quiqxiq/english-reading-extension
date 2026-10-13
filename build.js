import { build } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

async function buildAll() {
  const outDir = path.resolve('dist');

  console.log('🚀 1. Building Popup & Options HTML pages...');
  await build({
    root: '.',
    build: {
      outDir,
      emptyOutDir: true,
      rollupOptions: {
        input: {
          popup: path.resolve('src/popup/popup.html'),
          options: path.resolve('src/options/options.html'),
        },
      },
    },
  });

  console.log('🚀 2. Building Content Script (IIFE)...');
  await build({
    root: '.',
    build: {
      outDir,
      emptyOutDir: false,
      lib: {
        entry: path.resolve('src/content/content.ts'),
        name: 'EIRContent',
        formats: ['iife'],
        fileName: () => 'content.js',
      },
      rollupOptions: {
        output: {
          extend: true,
        },
      },
    },
  });

  console.log('🚀 3. Building Background Script (IIFE)...');
  await build({
    root: '.',
    build: {
      outDir,
      emptyOutDir: false,
      lib: {
        entry: path.resolve('src/background/background.ts'),
        name: 'EIRBackground',
        formats: ['iife'],
        fileName: () => 'background.js',
      },
      rollupOptions: {
        output: {
          extend: true,
        },
      },
    },
  });

  console.log('📋 4. Copying manifest, CSS, and icons...');
  // Copy content style CSS
  fs.copyFileSync(
    path.resolve('src/content/style.css'),
    path.resolve(outDir, 'content.css')
  );

  // Copy icons
  const distIconsDir = path.resolve(outDir, 'icons');
  if (!fs.existsSync(distIconsDir)) fs.mkdirSync(distIconsDir, { recursive: true });
  for (const size of [16, 48, 128]) {
    fs.copyFileSync(
      path.resolve(`icons/icon${size}.png`),
      path.resolve(distIconsDir, `icon${size}.png`)
    );
  }

  // Create dist/manifest.json
  const manifest = {
    manifest_version: 3,
    name: 'English Immersion Reader',
    version: '1.0.0',
    description: 'Smart English reading immersion tool with Custom AI Prompts and AnkiConnect integration',
    browser_specific_settings: {
      gecko: {
        id: 'english-immersion-reader@local',
      },
    },
    permissions: ['activeTab', 'storage'],
    host_permissions: [
      'http://127.0.0.1:8765/*',
      'http://localhost:8765/*',
      'https://api.dictionaryapi.dev/*',
      'https://openrouter.ai/*',
      'https://generativelanguage.googleapis.com/*',
      'https://translate.googleapis.com/*',
      'https://dictionary.cambridge.org/*',
      'https://www.oxfordlearnersdictionaries.com/*',
    ],
    background: {
      scripts: ['background.js'],
    },
    content_scripts: [
      {
        matches: ['<all_urls>'],
        js: ['content.js'],
        css: ['content.css'],
        run_at: 'document_idle',
      },
    ],
    action: {
      default_popup: 'src/popup/popup.html',
      default_icon: {
        '16': 'icons/icon16.png',
        '48': 'icons/icon48.png',
        '128': 'icons/icon128.png',
      },
    },
    options_ui: {
      page: 'src/options/options.html',
      open_in_tab: true,
    },
    commands: {
      'toggle-reading-mode': {
        suggested_key: {
          default: 'Alt+R',
        },
        description: 'Toggle Reading Mode',
      },
    },
    icons: {
      '16': 'icons/icon16.png',
      '48': 'icons/icon48.png',
      '128': 'icons/icon128.png',
    },
  };

  fs.writeFileSync(
    path.resolve(outDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2)
  );

  console.log('✅ Build complete! Bundle ready in dist/');
}

buildAll().catch((err) => {
  console.error('❌ Build failed:', err);
  process.exit(1);
});
