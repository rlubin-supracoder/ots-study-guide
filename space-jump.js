import { OrbitGame, WORLD } from './space-jump-engine.mjs';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const stage = document.getElementById('stage');
const arena = document.getElementById('arena');
const overlay = document.getElementById('overlay');
const title = document.getElementById('overlayTitle');
const text = document.getElementById('overlayText');
const play = document.getElementById('play');
const pause = document.getElementById('pause');
const scoreLabel = document.getElementById('score');
const bestLabel = document.getElementById('best');
const instructions = document.getElementById('instructions');
const game = new OrbitGame();
const astronaut = new Image();
const inputs = new Map();
const particles = [];
let mode = 'loading', raf = 0, lastTime = 0, accumulator = 0, best = 0;
try { best = Math.max(0, Number(localStorage.getItem('orbit-hop-best-v1')) || 0); } catch {}
bestLabel.innerHTML = `${best} <small>m</small>`;

function resize() {
  const rect = arena.getBoundingClientRect();
  const scale = Math.max(.1, Math.min((rect.width - 20) / WORLD.width, rect.height / WORLD.height));
  stage.style.width = `${WORLD.width * scale}px`;
  stage.style.height = `${WORLD.height * scale}px`;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = WORLD.width * ratio;
  canvas.height = WORLD.height * ratio;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  draw();
}
new ResizeObserver(resize).observe(arena);
function sy(y) { return WORLD.height - (y - game.camera); }
function roundBox(x, y, width, height, radius = 4) {
  ctx.beginPath(); ctx.roundRect(x, y, width, height, radius); ctx.fill();
}
function drawPlatform(p) {
  const y = sy(p.y);
  const colors = { solid: '#6bdad9', moving: '#75a8ff', fragile: '#ef796e', vanish: '#c49bff' };
  const color = colors[p.type];
  ctx.fillStyle = '#172a3f'; roundBox(p.x, y, p.width, 13);
  ctx.strokeStyle = color; ctx.lineWidth = 1.5;
  ctx.setLineDash(p.type === 'vanish' ? [5, 4] : []);
  ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = color; roundBox(p.x + 5, y, p.width - 10, 3, 1);
  ctx.fillStyle = '#334963'; roundBox(p.x + 9, y + 8, 13, 3, 1); roundBox(p.x + p.width - 22, y + 8, 13, 3, 1);
  if (p.type === 'fragile') {
    ctx.strokeStyle = '#ef796e'; ctx.beginPath(); ctx.moveTo(p.x + p.width / 2 - 7, y);
    ctx.lineTo(p.x + p.width / 2 + 2, y + 5); ctx.lineTo(p.x + p.width / 2 - 4, y + 9); ctx.lineTo(p.x + p.width / 2 + 5, y + 13); ctx.stroke();
  }
  if (p.type === 'moving') {
    ctx.fillStyle = '#75a8ff';
    ctx.beginPath(); ctx.moveTo(p.x + p.width / 2 + Math.sign(p.vx) * 6, y + 7); ctx.lineTo(p.x + p.width / 2 - Math.sign(p.vx) * 3, y + 4); ctx.lineTo(p.x + p.width / 2 - Math.sign(p.vx) * 3, y + 10); ctx.fill();
  }
  if (p.boost) {
    ctx.strokeStyle = '#ff8278'; ctx.lineWidth = 2.5;
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(p.x + p.width / 2, y - 5 - i * 6, 10 - i * 2, 3, 0, 0, Math.PI * 2); ctx.stroke(); }
  }
}
function draw() {
  if (!ctx) return;
  ctx.clearRect(0, 0, WORLD.width, WORLD.height);
  for (const p of game.platforms) if (sy(p.y) > -20 && sy(p.y) < WORLD.height + 20) drawPlatform(p);
  for (const particle of particles) {
    ctx.globalAlpha = Math.max(0, particle.life / particle.duration);
    ctx.fillStyle = particle.color;
    ctx.fillRect(particle.x - 2, sy(particle.y), 3, 3);
  }
  ctx.globalAlpha = 1;
  const p = game.player;
  if (astronaut.complete && astronaut.naturalWidth) {
    ctx.save();
    ctx.translate(p.x + p.width / 2, sy(p.y) - 30);
    ctx.rotate(p.vx * .0005); ctx.scale(p.facing < 0 ? -1 : 1, 1);
    ctx.drawImage(astronaut, -36, -36, 72, 72);
    ctx.restore();
  }
}
function burst(event) {
  if (!event.x) return;
  const color = event.type === 'break' ? '#ef796e' : event.type === 'boost' ? '#ffaaa0' : '#7be4e7';
  for (let i = 0; i < (event.type === 'boost' ? 22 : 9); i++) {
    particles.push({ x: event.x, y: event.y, vx: (Math.random() - .5) * 150, vy: Math.random() * 90, life: .45, duration: .45, color });
  }
}
function clearInput() {
  inputs.clear();
  document.querySelectorAll('.pressed').forEach(button => button.classList.remove('pressed'));
}
function stopLoop() { cancelAnimationFrame(raf); raf = 0; accumulator = 0; clearInput(); }
function showOverlay(heading, description, label) {
  title.textContent = heading; text.textContent = description; play.textContent = label;
  overlay.hidden = false; play.disabled = false; play.focus({ preventScroll: true });
}
function finish() {
  mode = 'over'; stopLoop(); pause.disabled = true;
  if (game.score > best) {
    best = game.score;
    try { localStorage.setItem('orbit-hop-best-v1', String(best)); } catch {}
  }
  bestLabel.innerHTML = `${best} <small>m</small>`;
  instructions.hidden = false;
  showOverlay('MISSION COMPLETE', `You climbed ${game.score.toLocaleString()} m. Ready for another flight?`, 'Launch again');
}
function frame(time) {
  if (mode !== 'running') return;
  accumulator += Math.min((time - lastTime) / 1000, .06); lastTime = time;
  while (accumulator >= 1 / 120) {
    const values = [...inputs.values()];
    const direction = (values.includes(1) ? 1 : 0) - (values.includes(-1) ? 1 : 0);
    game.step(1 / 120, direction);
    game.events.forEach(burst);
    for (const particle of particles) { particle.x += particle.vx / 120; particle.y += particle.vy / 120; particle.vy -= 300 / 120; particle.life -= 1 / 120; }
    for (let i = particles.length - 1; i >= 0; i--) if (particles[i].life <= 0) particles.splice(i, 1);
    accumulator -= 1 / 120;
    if (game.over) { draw(); scoreLabel.innerHTML = `${game.score} <small>m</small>`; finish(); return; }
  }
  scoreLabel.innerHTML = `${game.score} <small>m</small>`;
  draw(); raf = requestAnimationFrame(frame);
}
function start() {
  if (mode === 'loading' || mode === 'error') return;
  if (mode !== 'paused') { game.reset(); particles.length = 0; }
  mode = 'running'; overlay.hidden = true; pause.disabled = false; pause.textContent = 'PAUSE'; pause.setAttribute('aria-label', 'Pause game');
  clearInput(); accumulator = 0; lastTime = performance.now(); canvas.focus({ preventScroll: true });
  cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
}
function pauseGame() {
  if (mode !== 'running') return;
  mode = 'paused'; stopLoop(); pause.textContent = 'RESUME'; pause.setAttribute('aria-label', 'Resume game');
  instructions.hidden = true;
  showOverlay('HOLDING ORBIT', 'Your flight is paused.', 'Resume flight');
}
play.addEventListener('click', start);
pause.addEventListener('click', () => mode === 'paused' ? start() : pauseGame());
const leftKeys = ['ArrowLeft', 'KeyA'], rightKeys = ['ArrowRight', 'KeyD'];
window.addEventListener('keydown', event => {
  if (leftKeys.includes(event.code) || rightKeys.includes(event.code)) {
    event.preventDefault(); if (mode === 'running') inputs.set(event.code, leftKeys.includes(event.code) ? -1 : 1);
  } else if (event.code === 'Space') {
    event.preventDefault(); if (!event.repeat) mode === 'running' ? pauseGame() : start();
  } else if (event.code === 'KeyP' && !event.repeat) {
    mode === 'paused' ? start() : pauseGame();
  } else if (event.code === 'Escape') {
    pauseGame(); window.parent.postMessage('orbit-hop:close', location.origin);
  }
});
window.addEventListener('keyup', event => inputs.delete(event.code));
for (const [id, direction] of [['left', -1], ['right', 1]]) {
  const button = document.getElementById(id);
  button.addEventListener('pointerdown', event => {
    event.preventDefault(); if (mode !== 'running') return;
    button.setPointerCapture(event.pointerId); inputs.set(event.pointerId, direction); button.classList.add('pressed');
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, event => { inputs.delete(event.pointerId); button.classList.remove('pressed'); });
}
window.addEventListener('blur', pauseGame);
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });
window.addEventListener('pagehide', stopLoop);
astronaut.onload = () => {
  mode = 'ready'; play.disabled = false; play.textContent = 'Launch'; resize();
};
astronaut.onerror = () => {
  mode = 'error'; title.textContent = 'CHECK CONNECTION'; text.textContent = 'Close the game and try again to load your astronaut.'; play.hidden = true;
};
astronaut.src = 'astronaut.png';
