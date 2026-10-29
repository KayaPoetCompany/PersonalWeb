(function () {
  var sections = document.querySelectorAll('details.acc');
  var toolbar = document.querySelector('.legal-toolbar');

  toolbar.hidden = false;
  toolbar.querySelectorAll('button').forEach(function (button) {
    button.addEventListener('click', function () {
      var open = button.getAttribute('data-acc') === 'open';
      sections.forEach(function (section) { section.open = open; });
    });
  });

  function openFromHash() {
    var target = location.hash && document.getElementById(location.hash.slice(1));
    if (target && target.tagName === 'DETAILS') {
      target.open = true;
      target.scrollIntoView();
    }
  }
  openFromHash();
  window.addEventListener('hashchange', openFromHash);
})();
