import { mkdir, copyFile, cp } from 'node:fs/promises';
const out = new URL('../public/vendor/', import.meta.url);
await mkdir(out, { recursive: true });
for (const name of ['leaflet.js', 'leaflet.css']) {
  await copyFile(new URL(`../node_modules/leaflet/dist/${name}`, import.meta.url), new URL(name, out));
}
await copyFile(new URL('../node_modules/leaflet/LICENSE', import.meta.url), new URL('leaflet-LICENSE.txt', out));
await cp(new URL('../node_modules/leaflet/dist/images/', import.meta.url), new URL('images/', out), { recursive: true });
console.log('Local map assets ready.');
