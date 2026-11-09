// Give the separately deployed admin site a root entry as well as its explicit
// /admin-dashboard.html URL. Vite's generated assets use root-relative URLs.
import { copyFile } from 'node:fs/promises';
await copyFile('dist/admin-dashboard.html', 'dist/index.html');
