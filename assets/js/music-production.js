(() => {
  'use strict';
  const root = document.querySelector('.music-production');
  const dialog = document.getElementById('music-production-photo');
  if (!root || !dialog || typeof dialog.showModal !== 'function') return;

  const enlarged = dialog.querySelector('img');
  root.querySelectorAll('.moments-grid a').forEach((link) => {
    link.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      enlarged.src = link.href;
      enlarged.alt = link.querySelector('img').alt;
      dialog.showModal();
    });
  });
  dialog.querySelector('button').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
})();
