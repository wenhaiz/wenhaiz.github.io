(function () {
  var root = document.documentElement;
  var systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
  var preference = null;
  var button;

  try {
    var saved = localStorage.getItem('site-theme');
    if (saved === 'light' || saved === 'dark') preference = saved;
  } catch (error) {
    // Theme switching still works when browser storage is unavailable.
  }

  function applyTheme() {
    var theme = preference || (systemTheme.matches ? 'dark' : 'light');
    root.dataset.theme = theme;
    if (button) {
      var label = theme === 'dark' ? button.dataset.lightLabel : button.dataset.darkLabel;
      button.setAttribute('aria-label', label);
      button.title = label;
    }
  }

  applyTheme();
  systemTheme.addEventListener('change', applyTheme);

  document.addEventListener('DOMContentLoaded', function () {
    button = document.querySelector('[data-theme-toggle]');
    if (!button) return;
    button.hidden = false;
    applyTheme();
    button.addEventListener('click', function () {
      preference = root.dataset.theme === 'dark' ? 'light' : 'dark';
      applyTheme();
      try {
        localStorage.setItem('site-theme', preference);
      } catch (error) {
        // Keep the selected theme for this page even if it cannot be saved.
      }
    });
  });
})();
