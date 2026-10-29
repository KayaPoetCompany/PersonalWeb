// Jednoduchý server pro statický web ze složky public/ – bez závislostí.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = path.join(__dirname, 'public');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

// ─── Dočasný zámek před spuštěním naostro ────────────────────────────────────
// Zapnutý, dokud je nastavená proměnná SITE_PASSWORD (jméno: preview). Až bude
// web připravený pro veřejnost, stačí proměnnou v Railway smazat — nic jiného se nemění.
const SITE_PASSWORD = process.env.SITE_PASSWORD;
const EXPECTED = SITE_PASSWORD
  ? Buffer.from('Basic ' + Buffer.from(`preview:${SITE_PASSWORD}`).toString('base64'))
  : null;

function authorized(req) {
  if (!EXPECTED) return true;
  const got = Buffer.from(req.headers.authorization || '');
  return got.length === EXPECTED.length && crypto.timingSafeEqual(got, EXPECTED);
}

// ─── Jedna adresa webu ───────────────────────────────────────────────────────
// Co nepřišlo na www (holá doména, *.railway.app), trvale přesměrujeme na stejnou
// cestu na www, ať vyhledávače znají jen jednu adresu. Lokální vývoj necháváme být.
const CANONICAL_HOST = 'www.karelpospisilik.cz';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function canonicalRedirect(req) {
  let host, url;
  try {
    host = new URL(`http://${req.headers.host}`).hostname;
    url = new URL(req.url, 'http://localhost');
  } catch {
    return null;
  }
  if (host === CANONICAL_HOST || LOCAL_HOSTS.has(host)) return null;
  return `https://${CANONICAL_HOST}${url.pathname}${url.search}`;
}

// ─── Kontaktní formulář ──────────────────────────────────────────────────────
// Zprávy jdou přes server: tady se hlídá počet pokusů, ověří se reCAPTCHA a teprve
// pak se zpráva přepošle na webhook v Make. Adresa webhooku ani tajný klíč reCAPTCHA
// se tak nedostanou do prohlížeče.
const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET;
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;
// Railway nastavuje RAILWAY_ENVIRONMENT_NAME sám. Lokálně chybí a formulář pak
// funguje i bez klíčů: reCAPTCHA se přeskočí a zpráva se jen vypíše do konzole.
const PRODUCTION = Boolean(process.env.RAILWAY_ENVIRONMENT_NAME);

const RECAPTCHA_MIN_SCORE = 0.5;
const RECAPTCHA_HOSTS = new Set([CANONICAL_HOST, 'localhost']);
// Zpráva o 5000 znacích s diakritikou má po zakódování kolem 30 kB.
const MAX_BODY = 64 * 1024;
const FIELD_LIMITS = { jmeno: 100, prijmeni: 100, email: 254, zprava: 5000 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Z jedné IP adresy nejvýš 5 zpráv za 10 minut a z celého světa 50 za hodinu,
// ať případný útok nevyčerpá operace v Make.
const PER_IP = { max: 5, windowMs: 10 * 60 * 1000 };
const OVERALL = { max: 50, windowMs: 60 * 60 * 1000 };
const attemptsByIp = new Map();
let allAttempts = [];

function rateLimited(ip, now = Date.now()) {
  allAttempts = allAttempts.filter((t) => now - t < OVERALL.windowMs);
  const mine = (attemptsByIp.get(ip) || []).filter((t) => now - t < PER_IP.windowMs);
  attemptsByIp.set(ip, mine);
  if (mine.length >= PER_IP.max || allAttempts.length >= OVERALL.max) return true;
  mine.push(now);
  allAttempts.push(now);
  return false;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, times] of attemptsByIp) {
    if (times.every((t) => now - t >= PER_IP.windowMs)) attemptsByIp.delete(ip);
  }
}, PER_IP.windowMs).unref();

// Railway posílá adresu návštěvníka v X-Real-IP, jinak bereme poslední záznam
// X-Forwarded-For. I kdyby šla adresa podvrhnout, pořád platí celkový limit.
function clientIp(req) {
  const forwarded = (req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  return req.headers['x-real-ip'] || forwarded.at(-1) || req.socket.remoteAddress;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) return req.destroy(new Error('Příliš velký požadavek'));
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function verifyRecaptcha(token, ip) {
  if (!RECAPTCHA_SECRET) return true;
  if (!token) return false;
  let result;
  try {
    const res = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      body: new URLSearchParams({ secret: RECAPTCHA_SECRET, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    result = await res.json();
  } catch (err) {
    // Výpadek Googlu zprávy neblokuje. Pořád je hlídá limit pokusů a past na roboty.
    console.error(`reCAPTCHA neodpověděla (${err.message}), zprávu pouštím dál.`);
    return true;
  }
  const ok = result.success === true
    && result.action === 'kontakt'
    && RECAPTCHA_HOSTS.has(result.hostname)
    && result.score >= RECAPTCHA_MIN_SCORE;
  if (!ok) {
    const { success, score, action, hostname } = result;
    console.warn('reCAPTCHA zprávu zamítla:', JSON.stringify({ success, score, action, hostname, chyby: result['error-codes'] }));
  }
  return ok;
}

async function forwardToMake(fields) {
  if (!MAKE_WEBHOOK_URL) {
    console.log('Zpráva z formuláře (Make není nastavený):', fields);
    return;
  }
  const res = await fetch(MAKE_WEBHOOK_URL, {
    method: 'POST',
    body: new URLSearchParams(fields),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Make odpověděl HTTP ${res.status}`);
}

async function handleContact(req, res) {
  const reply = (status, body) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  const writeToMe = 'Napište mi prosím na kayapoetcompany@gmail.com.';

  if (PRODUCTION && (!RECAPTCHA_SECRET || !MAKE_WEBHOOK_URL)) {
    console.error('Formulář je vypnutý: v Railway chybí RECAPTCHA_SECRET nebo MAKE_WEBHOOK_URL.');
    return reply(503, { chyba: `Formulář je dočasně mimo provoz. ${writeToMe}` });
  }
  if (!(req.headers['content-type'] || '').startsWith('application/x-www-form-urlencoded')) {
    return reply(415, { chyba: 'Nepodporovaný formát zprávy.' });
  }
  if (Number(req.headers['content-length']) > MAX_BODY) {
    return reply(413, { chyba: `Zpráva je příliš dlouhá. ${writeToMe}` });
  }

  const ip = clientIp(req);
  if (rateLimited(ip)) {
    return reply(429, { chyba: 'Za poslední chvíli odešlo příliš mnoho zpráv. Zkuste to prosím za pár minut, nebo mi napište na kayapoetcompany@gmail.com.' });
  }

  const params = new URLSearchParams(await readBody(req));

  // Past na roboty: člověk pole „web“ nevidí. Robotovi předstíráme úspěch, ať nezkouší jinak.
  if (params.get('web')) return reply(200, { ok: true });

  const fields = {};
  for (const [name, max] of Object.entries(FIELD_LIMITS)) {
    fields[name] = (params.get(name) || '').trim();
    if (!fields[name] || fields[name].length > max) {
      return reply(400, { chyba: 'Zkontrolujte prosím vyplněná pole.' });
    }
  }
  if (!EMAIL_RE.test(fields.email)) return reply(400, { chyba: 'Zkontrolujte prosím tvar e-mailu.' });

  if (!(await verifyRecaptcha(params.get('token'), ip))) {
    return reply(400, { chyba: `Zprávu se nepodařilo ověřit. ${writeToMe}` });
  }

  try {
    // Scénář v Make čeká i prázdné pole „web“, posíláme ho stejně jako dřív prohlížeč.
    await forwardToMake({ ...fields, web: '' });
  } catch (err) {
    console.error(`Zprávu se nepodařilo předat do Make: ${err.message}`);
    return reply(502, { chyba: `Zprávu se nepodařilo odeslat. ${writeToMe}` });
  }
  reply(200, { ok: true });
}

// ─── Bezpečnostní hlavičky ───────────────────────────────────────────────────
// Cizí domény povolujeme jen ty, které web opravdu používá. reCAPTCHA potřebuje
// skript, neviditelný rám a spojení na Google, Google Analytics (jen po souhlasu
// v liště) skript a odesílání měření.
const CSP = [
  "default-src 'self'",
  "script-src 'self' https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/ https://*.googletagmanager.com",
  "frame-src https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https://*.google-analytics.com https://*.googletagmanager.com",
  "connect-src 'self' https://www.google.com/recaptcha/ https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

// Nouzový vypínač: CSP_JEN_HLASIT=1 v Railway přepne CSP jen na hlášení do konzole
// prohlížeče, takže web nic neblokuje a nemusí se kvůli tomu znovu nasazovat.
const CSP_HEADER = process.env.CSP_JEN_HLASIT === '1'
  ? 'Content-Security-Policy-Report-Only'
  : 'Content-Security-Policy';

const SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=31536000',
  [CSP_HEADER]: CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
};

const server = http.createServer((req, res) => {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);

  // Přesměrování před zámkem, aby se heslo nezadávalo zvlášť pro každou adresu.
  const target = canonicalRedirect(req);
  if (target) {
    res.writeHead(301, { Location: target });
    return res.end();
  }

  if (!authorized(req)) {
    res.writeHead(401, {
      'WWW-Authenticate': 'Basic realm="Karel Pospisilik", charset="UTF-8"',
      'Content-Type': 'text/plain; charset=utf-8',
    });
    return res.end('Authentication required.');
  }

  if (req.url === '/api/kontakt') {
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' });
      return res.end();
    }
    return handleContact(req, res).catch((err) => {
      console.error(`Chyba formuláře: ${err.message}`);
      if (!res.headersSent) res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end('{}');
    });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }

  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400);
    return res.end();
  }
  // Podstránky mají adresu bez přípony: /gdpr → gdpr.html.
  if (urlPath.endsWith('/')) urlPath += 'index.html';
  else if (!path.extname(urlPath)) urlPath += '.html';

  // Nikdy nevydat nic mimo public/.
  const filePath = path.join(PUBLIC_DIR, urlPath);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end();
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Stránka nenalezena.');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      // HTML, CSS a JS vždy čerstvé, obrázky můžou chvíli zůstat v cache prohlížeče.
      'Cache-Control': ['.html', '.css', '.js'].includes(ext) ? 'no-cache' : 'public, max-age=86400',
      // Dokud je web zamčený, nechceme ho ve vyhledávačích.
      ...(EXPECTED ? { 'X-Robots-Tag': 'noindex, nofollow' } : {}),
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`Web běží na portu ${PORT}${EXPECTED ? ' (zamčeno heslem)' : ''}`);
  console.log(`Formulář: reCAPTCHA ${RECAPTCHA_SECRET ? 'nastavená' : 'CHYBÍ'}, Make ${MAKE_WEBHOOK_URL ? 'nastavený' : 'CHYBÍ'}`
    + (!PRODUCTION && !(RECAPTCHA_SECRET && MAKE_WEBHOOK_URL) ? ' (lokálně formulář funguje i bez nich)' : ''));
});
