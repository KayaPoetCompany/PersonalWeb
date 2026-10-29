document.querySelector('.logo').addEventListener('click', function (e) {
  if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  history.replaceState(null, '', location.pathname + location.search);
});

(function () {
  var form = document.getElementById('contact-form');
  var thanks = document.getElementById('form-thanks');
  var messages = {
    jmeno: 'Vyplňte prosím jméno.',
    prijmeni: 'Vyplňte prosím příjmení.',
    email: 'Vyplňte prosím e-mail.',
    zprava: 'Napište prosím zprávu.'
  };

  function check(el) {
    var err = document.getElementById(el.getAttribute('aria-describedby'));
    var msg = '';
    if (!el.value.trim()) msg = messages[el.name];
    else if (el.type === 'email' && !el.validity.valid) msg = 'Zkontrolujte prosím tvar e-mailu.';
    err.textContent = msg;
    el.setAttribute('aria-invalid', msg ? 'true' : 'false');
    return !msg;
  }

  var ENDPOINT = '/api/kontakt';
  var FALLBACK = 'Zprávu se nepodařilo odeslat. Zkuste to prosím znovu, nebo napište na kayapoetcompany@gmail.com.';
  var button = form.querySelector('button[type="submit"]');
  var fields = form.querySelectorAll('.field input, .field textarea');
  var siteKey = form.getAttribute('data-recaptcha');
  var recaptcha = null;

  var sending = false;

  function loadRecaptcha() {
    if (!siteKey || recaptcha) return recaptcha;
    recaptcha = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = 'https://www.google.com/recaptcha/api.js?render=' + encodeURIComponent(siteKey);
      script.async = true;
      script.onload = function () { window.grecaptcha.ready(function () { resolve(window.grecaptcha); }); };
      script.onerror = reject;
      document.head.appendChild(script);
    });
    return recaptcha;
  }

  function getToken() {
    if (!siteKey) return Promise.resolve('');
    var token = loadRecaptcha()
      .then(function (g) { return g.execute(siteKey, { action: 'kontakt' }); })
      .catch(function () { return ''; });
    var timeout = new Promise(function (resolve) { setTimeout(function () { resolve(''); }, 10000); });
    return Promise.race([token, timeout]);
  }

  form.addEventListener('focusin', loadRecaptcha);

  function update() {
    var ok = true;
    fields.forEach(function (el) {
      if (!el.value.trim() || (el.type === 'email' && !el.validity.valid)) ok = false;
    });
    button.disabled = sending || !ok;
  }

  fields.forEach(function (el) {
    el.addEventListener('input', function () {
      el.dataset.touched = '1';
      if (el.getAttribute('aria-invalid') === 'true') check(el);
      update();
    });
    el.addEventListener('change', update);
    el.addEventListener('blur', function () { if (el.dataset.touched) check(el); });
  });
  update();

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var firstBad = null;
    fields.forEach(function (el) { if (!check(el) && !firstBad) firstBad = el; });
    if (firstBad) { thanks.textContent = ''; firstBad.focus(); return; }

    var data = new URLSearchParams(new FormData(form));
    sending = true;
    button.disabled = true;
    button.classList.add('is-sending');
    button.textContent = 'Odesílám…';
    thanks.textContent = '';

    getToken()
      .then(function (token) {
        data.set('token', token);
        return fetch(ENDPOINT, { method: 'POST', body: data });
      })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (!res.ok) throw { chyba: body.chyba };
        });
      })
      .then(function () {
        form.reset();
        fields.forEach(function (el) { el.removeAttribute('aria-invalid'); delete el.dataset.touched; });
        thanks.textContent = 'Díky za zprávu. Brzy se ozvu.';
      })
      .catch(function (err) {
        thanks.textContent = (err && err.chyba) || FALLBACK;
      })
      .then(function () {
        sending = false;
        button.classList.remove('is-sending');
        button.textContent = 'Odeslat';
        update();
      });
  });
})();
