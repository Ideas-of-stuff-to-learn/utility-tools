// Admin-panel veto for the stale-build auto-reload.
//
// The stale-build guard (shared/vite-stale-build-guard.js) reloads a hidden
// tab when a newer build is deployed. Functions registered here return false
// to block the reload when it would lose something (unsent queue entries).
// Separate from the cashflow WebUI version — no shared imports.

export function addReloadGuard(fn) {
  if (typeof window === 'undefined') return () => {};
  const guards = (window.__versionGuards = window.__versionGuards || []);
  guards.push(fn);
  return () => {
    const i = guards.indexOf(fn);
    if (i !== -1) guards.splice(i, 1);
  };
}
