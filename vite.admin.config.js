import { defineConfig } from 'vite';
import { makeConfig } from './vite.config.js';

// Deployed as a separate Vercel project using the same Firebase project.
export default defineConfig(makeConfig(['admin-dashboard']));
