(function () {
  'use strict';

  var MERICI_ID = 'G-VRFBYQTWHL';
  var nacteno = false;

  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }

  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    wait_for_update: 500
  });

  function nactiGoogle() {
    if (nacteno) return;
    nacteno = true;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + MERICI_ID;
    document.head.appendChild(s);
    gtag('js', new Date());
    gtag('config', MERICI_ID);
  }

  function smazCookiesGoogle() {
    var domena = location.hostname.replace(/^www\./, '');
    document.cookie.split(';').forEach(function (kus) {
      var jmeno = kus.split('=')[0].trim();
      if (jmeno.indexOf('_ga') !== 0) return;
      ['/', location.pathname].forEach(function (cesta) {
        [null, domena, '.' + domena].forEach(function (d) {
          document.cookie = jmeno + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=' + cesta
            + (d ? '; domain=' + d : '');
        });
      });
    });
  }

  function podleSouhlasu(volba) {
    if (!volba.analytika) {
      if (nacteno) gtag('consent', 'update', { analytics_storage: 'denied' });
      smazCookiesGoogle();
      return;
    }
    gtag('consent', 'update', { analytics_storage: 'granted' });
    nactiGoogle();
  }

  window.kpUdalost = function (nazev, parametry) {
    if (!nacteno || !window.kpSouhlas || !window.kpSouhlas.stav('analytika')) return false;
    gtag('event', nazev, parametry || {});
    return true;
  };

  if (!MERICI_ID || !window.kpSouhlas) return;
  window.kpSouhlas.pripoj(podleSouhlasu);
})();
