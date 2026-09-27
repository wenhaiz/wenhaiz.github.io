(function () {
  var container = document.querySelector('[data-home-sections]');
  var nav = document.querySelector('[data-home-nav]');
  if (!container || !nav) return;
  document.documentElement.classList.add('has-js');

  var sections = Array.from(container.querySelectorAll('[data-home-section]'));
  var links = Array.from(nav.querySelectorAll('[data-section-link]'));
  var sectionIds = sections.map(function (section) { return section.id; });
  var activeSection = 'articles';

  function updateSection() {
    var requested = window.location.hash.slice(1);
    var target = requested && document.getElementById(requested);
    var parentSection = target && target.closest('[data-home-section]');
    if (!requested || requested === 'recent' || requested === 'archive') {
      activeSection = 'articles';
    } else if (parentSection) {
      activeSection = parentSection.id;
    }

    sections.forEach(function (section) {
      section.hidden = section.id !== activeSection;
    });
    links.forEach(function (link) {
      if (link.dataset.sectionLink === activeSection) {
        link.setAttribute('aria-current', 'page');
      } else {
        link.removeAttribute('aria-current');
      }
    });
  }

  links.forEach(function (link) {
    link.addEventListener('click', function (event) {
      event.preventDefault();
      var section = link.dataset.sectionLink;
      if (window.location.hash !== '#' + section) {
        window.history.pushState(null, '', '#' + section);
      }
      updateSection();
      window.scrollTo(0, 0);
    });
  });

  window.addEventListener('popstate', updateSection);
  window.addEventListener('hashchange', updateSection);
  updateSection();
  if (sectionIds.indexOf(window.location.hash.slice(1)) !== -1) {
    window.addEventListener('load', function () { window.scrollTo(0, 0); }, { once: true });
  }
})();
