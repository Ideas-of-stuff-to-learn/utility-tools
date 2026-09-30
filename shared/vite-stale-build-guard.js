/**
 * shared/vite-stale-build-guard.js
 *
 * Vite plugin used by all three sites (landing, cashflow, admin).
 *
 * The problem: the sites are static files on GitHub Pages. After a deploy, a
 * browser can keep running the OLD build (a tab left open, a cached
 * index.html, a prefetched page), and old code against new files/API is what
 * "misaligns".
 *
 * What this does, at build time only:
 *   1. stamps the build with an id (commit sha) and emits /version.json
 *   2. injects a tiny inline script at the top of every page that
 *        - compares the running build with the live version.json (a few
 *          seconds after load, when the tab is shown again, when back online,
 *          and every 10 minutes while visible)
 *        - on a newer build: reloads silently if the tab is HIDDEN and it is
 *          safe (no unsent writes, nothing in progress, no typed text),
 *          otherwise shows a small "New version available - Reload" pill
 *        - reloads once if a script/stylesheet under /assets/ fails to load or
 *          a lazy route chunk fails (the old page pointing at files that are
 *          gone), instead of leaving a blank screen
 *
 * Apps can veto an automatic reload and flush before one:
 *   window.__versionGuards  array of () => boolean   (false = not safe now)
 *   window.__versionFlush   () => Promise            (awaited, capped)
 *
 * A loop guard (sessionStorage) means a page never reloads twice for the same
 * build: if the reload still serves the old build (a stale CDN copy), it shows
 * the pill instead of looping.
 *
 * Keep the runtime below dependency-free ES5: it runs before anything else.
 */
import { execSync } from 'node:child_process';

function buildId() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 12);
  try {
    return execSync('git rev-parse --short=12 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch { /* not a git checkout */ }
  return String(Date.now());
}

function runtime(build, versionUrl) {
  return `(function () {
  var BUILD = ${JSON.stringify(build)};
  var VERSION_URL = ${JSON.stringify(versionUrl)};
  var RELOAD_KEY = 'vc:reloaded-for';
  var ASSET_KEY = 'vc:asset-reload-at';
  var CHECK_MIN_GAP_MS = 15000;
  var POLL_MS = 600000;
  var BOOT_DELAY_MS = 3000;
  var FLUSH_CAP_MS = 1700;
  var checking = false, lastCheck = 0, latest = null, dismissedFor = null, banner = null;

  function getKey(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function setKey(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }
  function delKey(k) { try { sessionStorage.removeItem(k); } catch (e) {} }

  // Never yank the page away from someone mid-task.
  function safeToReload() {
    try {
      var guards = window.__versionGuards || [];
      for (var i = 0; i < guards.length; i++) { if (guards[i]() === false) return false; }
      var fields = document.querySelectorAll('input, textarea');
      for (var j = 0; j < fields.length; j++) {
        var f = fields[j], t = (f.type || 'text').toLowerCase();
        if (f.readOnly || f.disabled) continue;
        if (t === 'file') { if (f.files && f.files.length) return false; continue; }
        if (t === 'hidden' || t === 'checkbox' || t === 'radio' || t === 'range' || t === 'button' || t === 'submit' || t === 'color') continue;
        if (f.value) return false;
      }
      return true;
    } catch (e) { return false; }
  }

  function reload(forBuild) {
    setKey(RELOAD_KEY, forBuild || '');
    var done = false;
    function go() { if (done) return; done = true; location.reload(); }
    try {
      var p = window.__versionFlush && window.__versionFlush();
      if (p && p.then) { p.then(go, go); setTimeout(go, FLUSH_CAP_MS); return; }
    } catch (e) {}
    go();
  }

  function hideBanner() { if (banner && banner.parentNode) banner.parentNode.removeChild(banner); banner = null; }

  function showBanner() {
    if (banner || dismissedFor === latest) return;
    if (!document.body) { document.addEventListener('DOMContentLoaded', showBanner); return; }
    banner = document.createElement('div');
    banner.setAttribute('role', 'status');
    banner.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483000;display:flex;align-items:center;gap:12px;max-width:calc(100vw - 32px);padding:10px 14px;border-radius:999px;background:#1f2430;color:#fff;font:500 14px/1.3 system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35)';
    var msg = document.createElement('span');
    msg.textContent = 'A new version is available.';
    var go = document.createElement('button');
    go.type = 'button'; go.textContent = 'Reload';
    go.style.cssText = 'border:0;border-radius:999px;padding:6px 12px;background:#fff;color:#1f2430;font:600 13px system-ui,sans-serif;cursor:pointer';
    go.onclick = function () { reload(latest); };
    var x = document.createElement('button');
    x.type = 'button'; x.setAttribute('aria-label', 'Dismiss'); x.textContent = '\\u00d7';
    x.style.cssText = 'border:0;background:transparent;color:#fff;font:400 18px/1 system-ui,sans-serif;cursor:pointer;padding:0 2px';
    x.onclick = function () { dismissedFor = latest; hideBanner(); };
    banner.appendChild(msg); banner.appendChild(go); banner.appendChild(x);
    document.body.appendChild(banner);
  }

  function onNewBuild(newBuild) {
    latest = newBuild;
    // Already reloaded for this build and still old: a stale copy is being
    // served. Do not loop; let the person decide.
    if (getKey(RELOAD_KEY) === newBuild) { showBanner(); return; }
    if (document.hidden && safeToReload()) { reload(newBuild); return; }
    showBanner();
  }

  function check(force) {
    var now = Date.now();
    if (checking || (!force && now - lastCheck < CHECK_MIN_GAP_MS)) return;
    checking = true; lastCheck = now;
    fetch(VERSION_URL + '?t=' + now, { cache: 'no-store', credentials: 'omit' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.build) return;
        if (j.build === BUILD) { delKey(RELOAD_KEY); latest = null; hideBanner(); }
        else onNewBuild(j.build);
      })
      .catch(function () {})
      .then(function () { checking = false; });
  }

  // Files of the old page that no longer exist: reload once instead of a blank screen.
  function reloadForBrokenAsset() {
    var last = Number(getKey(ASSET_KEY) || 0);
    if (Date.now() - last < 60000) return;
    setKey(ASSET_KEY, String(Date.now()));
    reload('');
  }
  window.addEventListener('error', function (e) {
    var t = e && e.target;
    if (!t || t === window || (t.tagName !== 'SCRIPT' && t.tagName !== 'LINK')) return;
    var src = t.src || t.href || '';
    if (src.indexOf(location.origin) === 0 && src.indexOf('/assets/') !== -1) reloadForBrokenAsset();
  }, true);
  window.addEventListener('vite:preloadError', function (e) { if (e && e.preventDefault) e.preventDefault(); reloadForBrokenAsset(); });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (latest && getKey(RELOAD_KEY) !== latest && safeToReload()) reload(latest);
    } else { check(false); }
  });
  window.addEventListener('focus', function () { check(false); });
  window.addEventListener('online', function () { check(false); });
  window.addEventListener('pageshow', function (e) { if (e && e.persisted) check(true); });
  setTimeout(function () { check(true); }, BOOT_DELAY_MS);
  setInterval(function () { if (!document.hidden) check(false); }, POLL_MS);
})();`;
}

export default function staleBuildGuard() {
  const build = buildId();
  let base = '/';
  return {
    name: 'stale-build-guard',
    apply: 'build',
    configResolved(config) { base = config.base || '/'; },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ build, builtAt: new Date().toISOString() }),
      });
    },
    transformIndexHtml() {
      return [{ tag: 'script', children: runtime(build, `${base}version.json`), injectTo: 'head-prepend' }];
    },
  };
}
