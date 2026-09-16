(() => {
  'use strict';
  const dialog = document.getElementById('secretGameDialog');
  const frame = document.getElementById('secretGameFrame');
  const title = document.getElementById('secretGameTitle');
  let launcher;
  let activeGame;
  function openGame(game, button) {
    if (dialog.open) return;
    launcher = button;
    activeGame = game;
    const turtles = game === 'turtle-crusher';
    title.textContent = turtles ? 'TURTLE CRUSHER' : 'ORBIT HOP';
    frame.title = turtles ? 'Turtle Crusher apple tossing game' : 'Orbit Hop space jumping game';
    frame.src = turtles ? 'turtle-crusher.html' : 'secret-game.html';
    dialog.showModal();
  }
  document.querySelectorAll('.delta-star').forEach(button => {
    button.addEventListener('click', () => openGame('orbit-hop', button));
  });
  document.addEventListener('turtle-crusher:open', () => {
    openGame('turtle-crusher', document.getElementById('passwordInput'));
  });
  frame.addEventListener('load', () => {
    if (dialog.open && activeGame === 'turtle-crusher') {
      frame.contentWindow.postMessage('turtle-crusher:launch', location.origin);
    }
  });
  document.getElementById('closeSecretGame').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    activeGame = null;
    frame.src = 'about:blank';
    launcher?.focus({ preventScroll: true });
  });
  // Keys outside the iframe must not reach the trainer's study shortcuts.
  dialog.addEventListener('keydown', event => event.stopPropagation());
  window.addEventListener('message', event => {
    if (dialog.open && event.origin === location.origin && event.source === frame.contentWindow && event.data === `${activeGame}:close`) dialog.close();
  });
})();
