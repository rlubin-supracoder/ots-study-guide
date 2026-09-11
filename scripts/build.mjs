import './check.mjs';
import './check-game.mjs';
import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { siteFiles } from './site-files.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'dist');
mkdirSync(output, { recursive: true });
for (const name of siteFiles) copyFileSync(resolve(root, name), resolve(output, name));
console.log(`Static site ready in dist/ (${siteFiles.length} files).`);
