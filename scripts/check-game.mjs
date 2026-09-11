import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OrbitGame, WORLD } from '../space-jump-engine.mjs';
import { siteFiles } from './site-files.mjs';

function landing(type, boost = false) {
  const game = new OrbitGame(() => .5);
  game.platforms = [{ x: 100, y: 100, width: 80, type, vx: 0, boost }];
  Object.assign(game.player, { x: 124, y: 104, vy: -300 });
  game.step(1 / 60);
  return game;
}
for (const type of ['solid', 'moving', 'vanish']) {
  const game = landing(type);
  assert.equal(game.player.y, 100, `${type}: land on the platform surface`);
  assert.equal(game.player.vy, WORLD.jump, `${type}: bounce upward`);
  assert.equal(game.platforms.length, type === 'vanish' ? 0 : 1);
}
const fragile = landing('fragile');
assert(fragile.player.vy < 0, 'Fragile decoys must break without launching the player');
assert(fragile.events.some(event => event.type === 'break'));
assert.equal(landing('solid', true).player.vy, WORLD.boost, 'Center booster must give extra height');
const upward = new OrbitGame(() => .5);
upward.platforms = [{ x: 100, y: 100, width: 80, type: 'solid', vx: 0 }];
Object.assign(upward.player, { x: 124, y: 96, vy: 300 });
upward.step(1 / 30);
assert(upward.player.y > 100 && upward.player.vy < 300, 'Ascending players pass through platform undersides');
const wrapping = new OrbitGame(() => .5);
wrapping.player.x = WORLD.width + 1; wrapping.step(1 / 120);
assert(wrapping.player.x < 0, 'Right edge wraps to the left');
wrapping.player.x = -wrapping.player.width - 1; wrapping.step(1 / 120);
assert(wrapping.player.x > 0, 'Left edge wraps to the right');
const scrolling = new OrbitGame(() => .5);
scrolling.player.y = 1200; scrolling.step(1 / 120);
const highCamera = scrolling.camera, highScore = scrolling.score;
assert(highCamera > 0 && scrolling.platforms.some(p => p.y > highCamera + WORLD.height), 'Climbing generates more platforms above the view');
Object.assign(scrolling.player, { y: highCamera - 100, vy: -300 });
scrolling.step(1 / 120);
assert(scrolling.over, 'Falling below the camera ends the run');
assert.equal(scrolling.camera, highCamera, 'Camera never scrolls down');
assert.equal(scrolling.score, highScore, 'Falling must not subtract score');
scrolling.reset();
assert(!scrolling.over && scrolling.score === 0 && scrolling.camera === 0, 'Restart resets run state');

for (const file of ['index.html', 'secret-game.html', 'secret-game-launcher.css', 'space-jump.css']) {
  const raw = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const source = file.endsWith('.html') ? raw.replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/g, '$1$2') : raw;
  const paths = [...source.matchAll(/(?:src|href)="([^"]+)"|url\("([^\"]+)"\)/g)].map(match => match[1] || match[2]);
  for (const path of paths) if (!/^(?:https?:|about:|#)/.test(path)) assert(siteFiles.includes(path), `${file}: asset not in deployment: ${path}`);
}
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.equal((index.match(/class="delta-star"/g) || []).length, 2, 'Both trainer titles have star launchers');
console.log('Game checks passed: landing, boosters, fragile/vanishing platforms, wrapping, scrolling, game over, restart, and packaged assets.');
