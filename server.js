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

// ─── Bezpečnostní hlavičky ───────────────────────────────────────────────────
// Cizí domény povolujeme jen ty, které web opravdu používá. Google Fonts zmizí,
// až budou písma uložená přímo na webu.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self' https://hook.eu1.make.com",
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

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }

  if (!authorized(req)) {
    res.writeHead(401, {
      'WWW-Authenticate': 'Basic realm="Karel Pospisilik", charset="UTF-8"',
      'Content-Type': 'text/plain; charset=utf-8',
    });
    return res.end('Authentication required.');
  }

  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400);
    return res.end();
  }
  if (urlPath.endsWith('/')) urlPath += 'index.html';

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
});
