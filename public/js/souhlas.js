(function () {
  'use strict';

  var KLIC = 'kp-souhlas';
  var VERZE = 1;
  var PLATNOST_DNI = 365;

  var KATEGORIE = [
    { klic: 'nezbytne', nazev: 'Nezbytné', vzdy: true,
      popis: 'Potřebné k&nbsp;tomu, aby web fungoval, třeba zapamatování téhle volby nebo ochrana formuláře před roboty.' },
    { klic: 'analytika', nazev: 'Analytické', vzdy: false,
      popis: 'Statistika návštěvnosti přes Google Analytics. Pomáhá mi zjistit, co lidi na webu zajímá a&nbsp;co nefunguje.' }
  ];

  function nactiVolbu() {
    try {
      var v = JSON.parse(localStorage.getItem(KLIC));
      if (!v || v.verze !== VERZE) return null;
      if (Date.now() - v.cas > PLATNOST_DNI * 86400000) return null;
      return v;
    } catch (e) { return null; }
  }

  function ulozVolbu(volba) {
    volba.verze = VERZE;
    volba.cas = Date.now();
    try { localStorage.setItem(KLIC, JSON.stringify(volba)); } catch (e) {}
    ohlas(volba);
  }

  function ohlas(volba) {
    window.kpSouhlas.volba = volba;
    document.dispatchEvent(new CustomEvent('kp-souhlas', { detail: volba }));
  }

  function vytvorListu(existujiciVolba) {
    var lista = document.createElement('div');
    lista.className = 'kp-souhlas';
    lista.setAttribute('role', 'dialog');
    lista.setAttribute('aria-label', 'Nastavení cookies');

    var vnitrek = document.createElement('div');
    vnitrek.className = 'kp-souhlas-vnitrek';
    lista.appendChild(vnitrek);

    var text = document.createElement('p');
    text.innerHTML = 'Rád bych měřil návštěvnost, abych věděl, co lidi na webu zajímá. '
      + 'Bez vašeho souhlasu se ale nic navíc nespustí. '
      + 'Podrobnosti najdete v&nbsp;<a href="/gdpr#cookies">zásadách ochrany osobních údajů</a>.';
    vnitrek.appendChild(text);

    var tlacitka = document.createElement('div');
    tlacitka.className = 'kp-souhlas-tlacitka';
    vnitrek.appendChild(tlacitka);

    var detail = null;

    function tlacitko(popis, trida, akce) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = popis;
      if (trida) b.className = trida;
      b.addEventListener('click', akce);
      tlacitka.appendChild(b);
      return b;
    }

    function zavri() { lista.remove(); }

    function vse(hodnota) {
      var volba = {};
      KATEGORIE.forEach(function (k) { volba[k.klic] = k.vzdy ? true : hodnota; });
      ulozVolbu(volba);
      zavri();
    }

    tlacitko('Přijmout vše', '', function () { vse(true); });
    tlacitko('Odmítnout vše', '', function () { vse(false); });

    var prepinac = tlacitko('Nastavení', 'kp-odkaz', function () {
      if (detail) { detail.remove(); detail = null; prepinac.textContent = 'Nastavení'; return; }
      detail = vytvorDetail(existujiciVolba, function (volba) { ulozVolbu(volba); zavri(); });
      vnitrek.appendChild(detail);
      prepinac.textContent = 'Skrýt nastavení';
    });

    document.body.appendChild(lista);
  }

  function vytvorDetail(existujiciVolba, hotovo) {
    var obal = document.createElement('div');
    obal.className = 'kp-souhlas-detail';
    var policka = {};

    KATEGORIE.forEach(function (k) {
      var radek = document.createElement('label');
      radek.className = 'kp-souhlas-radek';

      var pole = document.createElement('input');
      pole.type = 'checkbox';
      pole.checked = k.vzdy || !!(existujiciVolba && existujiciVolba[k.klic]);
      pole.disabled = k.vzdy;
      policka[k.klic] = pole;

      var popis = document.createElement('div');
      popis.innerHTML = '<b>' + k.nazev + (k.vzdy ? ' (vždy zapnuté)' : '') + '</b><span>' + k.popis + '</span>';

      radek.appendChild(pole);
      radek.appendChild(popis);
      obal.appendChild(radek);
    });

    var ulozit = document.createElement('button');
    ulozit.type = 'button';
    ulozit.className = 'kp-hlavni';
    ulozit.textContent = 'Uložit volbu';
    ulozit.addEventListener('click', function () {
      var volba = {};
      KATEGORIE.forEach(function (k) { volba[k.klic] = k.vzdy ? true : policka[k.klic].checked; });
      hotovo(volba);
    });
    obal.appendChild(ulozit);
    return obal;
  }

  function doplnPrepinac() {
    var paticka = document.querySelector('.site-footer .footer-left');
    if (!paticka || paticka.querySelector('.kp-nastaveni')) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'kp-nastaveni';
    b.textContent = 'Nastavení cookies';
    b.addEventListener('click', function () { window.kpSouhlas.otevri(); });
    paticka.appendChild(b);
  }

  window.kpSouhlas = {
    volba: null,
    stav: function (kategorie) {
      var v = window.kpSouhlas.volba;
      return !!(v && v[kategorie]);
    },
    otevri: function () {
      if (document.querySelector('.kp-souhlas')) return;
      vytvorListu(nactiVolbu());
    },
    pripoj: function (fn) {
      if (window.kpSouhlas.volba) fn(window.kpSouhlas.volba);
      document.addEventListener('kp-souhlas', function (e) { fn(e.detail); });
    }
  };

  function start() {
    doplnPrepinac();
    var volba = nactiVolbu();
    if (volba) ohlas(volba);
    else vytvorListu(null);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
