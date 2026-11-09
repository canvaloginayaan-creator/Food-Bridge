import { defineConfig } from 'vite';
import { resolve } from 'node:path';

const publicPages = [
  'index', 'about', 'impact', 'login', 'register', 'application',
  'donor-dashboard', 'receiver-dashboard', 'centers',
  // Old demo URLs are retained as safe redirects, not as public demo forms.
  'add-food', 'explore', 'food-details', 'my-requests', 'marketplace', 'cart'
];

export function makeConfig(pages) {
  return {
    server: { host: '0.0.0.0', allowedHosts: ['.e2b.app'] },
    preview: { host: '0.0.0.0', allowedHosts: ['.e2b.app'] },
    build: {
      rollupOptions: {
        input: Object.fromEntries(pages.map((page) => [page, resolve(import.meta.dirname, `${page}.html`)]))
      }
    },
    test: { environment: 'jsdom' }
  };
}

// The public build intentionally does not contain the administration page.
export default defineConfig(makeConfig(publicPages));
