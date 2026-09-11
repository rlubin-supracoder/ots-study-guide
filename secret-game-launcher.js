(() => {
  'use strict';
  const dialog = document.getElementById('secretGameDialog');
  const frame = document.getElementById('secretGameFrame');
  let launcher;
  document.querySelectorAll('.delta-star').forEach(button => {
    button.addEventListener('click', () => {
      if (dialog.open) return;
      launcher = button;
      frame.src = 'secret-game.html';
      dialog.showModal();
    });
  });
  document.getElementById('closeSecretGame').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    frame.src = 'about:blank';
    launcher?.focus({ preventScroll: true });
  });
  // Keys outside the iframe must not reach the trainer's study shortcuts.
  dialog.addEventListener('keydown', event => event.stopPropagation());
  window.addEventListener('message', event => {
    if (event.origin === location.origin && event.source === frame.contentWindow && event.data === 'orbit-hop:close') dialog.close();
  });
})();
