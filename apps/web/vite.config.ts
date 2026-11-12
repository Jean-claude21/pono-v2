import { fileURLToPath, URL } from 'node:url';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export const paraglide = paraglideVitePlugin({
  project: './project.inlang',
  outdir: './src/paraglide',
  outputStructure: 'message-modules',
  cookieName: 'pono_locale',
  // The explicit choice (cookie), then the browser, then French (FR-009).
  strategy: ['cookie', 'preferredLanguage', 'baseLocale'],
});

export default defineConfig({
  plugins: [paraglide, tanstackStart(), react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
});
