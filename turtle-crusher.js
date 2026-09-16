import { TurtleRound, ROUND_MS } from './turtle-crusher-engine.mjs';

// The orchard is launched by the password gate, never by a public game link.
if (window.parent === window) {
  location.replace('./');
} else {
  let launched = false;
  window.addEventListener('message', event => {
    if (launched || event.source !== window.parent || event.origin !== location.origin || event.data !== 'turtle-crusher:launch') return;
    launched = true;
    boot();
  });
}

async function boot() {
  const game = new TurtleRound();
  const app = document.getElementById('game');
  const board = document.getElementById('board');
  const field = document.querySelector('.playfield');
  const overlay = document.getElementById('overlay');
  const play = document.getElementById('play');
  const pause = document.getElementById('pause');
  const score = document.getElementById('score');
  const time = document.getElementById('time');
  const timeBar = document.getElementById('timeBar');
  const status = document.getElementById('status');
  const cursor = document.getElementById('appleCursor');
  const effects = new Map();
  const bestKey = 'ots-turtle-crusher-best';
  let best = 0;
  let animation;
  let announcedEnd = false;
  try {
    const saved = Number(localStorage.getItem(bestKey));
    if (Number.isFinite(saved) && saved >= 0) best = saved;
  } catch {}
  document.getElementById('best').textContent = best;

  const holes = Array.from({ length: 9 }, (_, index) => {
    const hole = document.createElement('button');
    hole.type = 'button';
    hole.className = 'hole';
    hole.disabled = true;
    hole.innerHTML = `<span class="burrow"><img class="turtle" src="turtle.png" alt="" draggable="false"></span><span class="hole-number" aria-hidden="true">${index + 1}</span>`;
    hole.addEventListener('click', () => toss(index));
    board.append(hole);
    return hole;
  });

  function clearEffect(hole) {
    clearTimeout(effects.get(hole));
    effects.delete(hole);
    hole.classList.remove('bonked');
    hole.querySelectorAll('.projectile, .points').forEach(node => node.remove());
  }

  function toss(index) {
    if (game.state !== 'running') return;
    const hit = game.hit(index, performance.now());
    if (game.state === 'over') { render(); return; }
    const hole = holes[index];
    clearEffect(hole);
    const apple = document.createElement('img');
    apple.src = 'apple.png';
    apple.alt = '';
    apple.className = 'projectile';
    hole.append(apple);
    if (hit) {
      hole.classList.add('bonked');
      const points = document.createElement('span');
      points.className = 'points';
      points.textContent = '+10';
      points.setAttribute('aria-hidden', 'true');
      hole.append(points);
      status.textContent = `${game.hits === 1 ? 'Apple-solutely!' : 'Nice toss!'} ${game.hits} ${game.hits === 1 ? 'turtle' : 'turtles'} hit.`;
    } else {
      status.textContent = 'Just missed! Watch for the next turtle.';
    }
    effects.set(hole, setTimeout(() => clearEffect(hole), 650));
    render();
  }

  function showOverlay(label, title, text, button) {
    document.getElementById('overlayLabel').textContent = label;
    document.getElementById('overlayTitle').textContent = title;
    document.getElementById('overlayText').textContent = text;
    play.textContent = button;
    overlay.hidden = false;
    play.focus({ preventScroll: true });
  }

  function render() {
    const running = game.state === 'running';
    score.textContent = game.score;
    time.textContent = Math.ceil(game.remaining / 1000);
    timeBar.style.transform = `scaleX(${game.remaining / ROUND_MS})`;
    timeBar.classList.toggle('urgent', game.remaining <= 10_000);
    document.querySelector('.clock').classList.toggle('urgent', game.remaining <= 10_000);
    field.classList.toggle('playing', running);
    pause.disabled = !running && game.state !== 'paused';
    pause.textContent = game.state === 'paused' ? 'Resume' : 'Pause';
    holes.forEach((hole, i) => {
      const up = running && i === game.active;
      hole.classList.toggle('up', up);
      hole.disabled = !running;
      hole.setAttribute('aria-label', `${up ? 'Turtle in' : 'Empty'} hole ${i + 1}`);
    });
    if (game.state === 'over' && !announcedEnd) {
      announcedEnd = true;
      const newBest = game.score > best;
      best = Math.max(best, game.score);
      document.getElementById('best').textContent = best;
      try { localStorage.setItem(bestKey, String(best)); } catch {}
      const accuracy = game.tosses ? Math.round(game.hits / game.tosses * 100) : 0;
      const hitSummary = `${game.hits} ${game.hits === 1 ? 'turtle' : 'turtles'} hit`;
      showOverlay(newBest ? 'A FRESH HIGH SCORE!' : 'ROUND COMPLETE', `${game.score} points!`, `${hitSummary} · ${accuracy}% accuracy\nThe orchard is ready for another round.`, 'Play again');
      status.textContent = `Round complete. ${game.score} points. ${hitSummary}.`;
    }
  }

  function loop(now) {
    animation = undefined;
    game.tick(now);
    render();
    if (game.state === 'running') animation = requestAnimationFrame(loop);
  }

  function playRound() {
    if (game.state === 'running') return;
    const resuming = game.state === 'paused';
    if (resuming) game.resume(performance.now());
    else {
      holes.forEach(clearEffect);
      game.start(performance.now());
      announcedEnd = false;
    }
    overlay.hidden = true;
    status.textContent = resuming ? 'Back to the orchard!' : 'Turtles incoming. Make every apple count!';
    render();
    pause.focus({ preventScroll: true });
    if (animation === undefined) animation = requestAnimationFrame(loop);
  }

  function pauseRound() {
    if (game.state !== 'running') return;
    game.pause(performance.now());
    cancelAnimationFrame(animation);
    animation = undefined;
    render();
    if (game.state === 'paused') {
      showOverlay('TAKE A BREATHER', 'Orchard on hold', 'Your apples, turtles, and timer are waiting.', 'Keep tossing');
      status.textContent = 'Game paused.';
    }
  }

  play.addEventListener('click', playRound);
  pause.addEventListener('click', () => game.state === 'paused' ? playRound() : pauseRound());
  field.addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse') return;
    const bounds = field.getBoundingClientRect();
    cursor.style.left = `${event.clientX - bounds.left}px`;
    cursor.style.top = `${event.clientY - bounds.top}px`;
    field.classList.add('cursor-in');
  });
  field.addEventListener('pointerleave', () => field.classList.remove('cursor-in'));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      window.parent.postMessage('turtle-crusher:close', location.origin);
      return;
    }
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (/^[1-9]$/.test(event.key) && game.state === 'running') {
      event.preventDefault();
      toss(Number(event.key) - 1);
    } else if (event.key.toLowerCase() === 'p') {
      event.preventDefault();
      if (game.state === 'paused') playRound();
      else pauseRound();
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseRound(); });
  window.addEventListener('pagehide', () => {
    cancelAnimationFrame(animation);
    holes.forEach(clearEffect);
  });
  app.hidden = false;
  render();
  try {
    await Promise.all(Array.from(app.querySelectorAll('img'), img => img.decode()));
    play.disabled = false;
    play.textContent = "Let's play";
    play.focus({ preventScroll: true });
  } catch {
    status.textContent = 'The orchard could not load. Close the game and try again.';
    play.textContent = 'Artwork unavailable';
  }
}
