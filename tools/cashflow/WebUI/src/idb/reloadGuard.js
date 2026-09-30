// Lets the app veto the automatic "new version available" reload.
//
// The stale-build guard (shared/vite-stale-build-guard.js) injects a script
// into every page that reloads a hidden tab when a newer build is deployed.
// It asks the functions registered here first: return false when reloading
// right now would lose something (unsent writes, an upload in progress).

export function addReloadGuard(fn) {
    if (typeof window === 'undefined') return () => {};
    const guards = (window.__versionGuards = window.__versionGuards || []);
    guards.push(fn);
    return () => {
        const i = guards.indexOf(fn);
        if (i !== -1) guards.splice(i, 1);
    };
}
