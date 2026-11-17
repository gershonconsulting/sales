// Footer version and asset cache-buster in public/index.html must match.
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = /APP_VERSION='v([\d.]+)'/.exec(html)?.[1];
const bust = [...html.matchAll(/\?v=([\d.]+)/g)].map(m => m[1]);
if (!app || !bust.length || bust.some(b => b !== app)) { console.error('FAIL version mismatch', app, bust); process.exit(1); }
console.log('ok: footer v' + app + ' == cache-buster ?v=' + bust.join(','));
