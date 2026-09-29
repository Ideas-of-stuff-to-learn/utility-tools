// components/ResponsiveGate.jsx
import { useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useIsMobile } from '../customHooks/useIsMobile';
import { MOBILE_BREAKPOINT_PX } from '../config/breakpoints';

const MOBILE_SCREENS = ['/home', '/charts'];
const DESKTOP_SCREEN = '/dashboard';
const APP_BASE = import.meta.env.PROD ? '/utility-tools/cashflow' : '';
const KNOWN_PATHS = new Set([
    '/dashboard', '/home', '/charts', '/contents', '/profile',
    '/privacy', '/terms', '/accessibility', '/cookies', '/data-security',
]);

function redirectTarget(pathname, isMobile) {
    if (pathname === '/') return isMobile ? '/home' : DESKTOP_SCREEN;
    if (isMobile && pathname === DESKTOP_SCREEN) return '/home';
    if (!isMobile && MOBILE_SCREENS.includes(pathname)) return DESKTOP_SCREEN;
    return null;
}

// Runs in main.jsx before React renders, so BrowserRouter starts on the final
// screen and first paint never depends on a post-mount redirect.
// Also restores deep links: GitHub Pages serves landing's 404.html for
// /utility-tools/cashflow/<path>, and landing hands them back as ?p=<path>.
// Only known app paths are accepted, so ?p= can't be used as a redirect.
export function normalizeEntryUrl() {
    const { pathname, search, hash } = window.location;
    const params = new URLSearchParams(search);
    const forwarded = params.get('p');
    let path = pathname.startsWith(APP_BASE) ? (pathname.slice(APP_BASE.length) || '/') : pathname;
    if (forwarded !== null) {
        params.delete('p');
        path = KNOWN_PATHS.has(forwarded) ? forwarded : '/';
    }
    const isMobile = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT_PX - 1}px)`).matches;
    const target = redirectTarget(path, isMobile) ?? path;
    if (target === path && forwarded === null) return;
    const query = params.toString();
    window.history.replaceState(window.history.state, '', `${APP_BASE}${target}${query ? `?${query}` : ''}${hash}`);
}

// The single owner of the mobile/desktop routing split, re-evaluated on
// every render so back/forward, history and resizing all land on the right
// screen for the CURRENT width.
//
// It always keeps rendering <Outlet/> and redirects from an effect. Returning
// <Navigate> instead rendered nothing for one commit, which unmounted Layout
// and the whole screen tree on every breakpoint crossing. Screen-level state
// that must survive the Dashboard ↔ Home/Charts swap lives in context
// (UploadSessionContext, ChartFilterContext).
//
// Must be a passive effect, like React Router's own <Navigate>: BrowserRouter
// subscribes to history in ITS layout effect, which on first mount runs after
// this child's layout effects — a navigate from a layout effect here changed
// the URL without the router noticing, leaving "/" rendered as a white screen.
export default function ResponsiveGate() {
    const isMobile = useIsMobile();
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const target = redirectTarget(pathname, isMobile);

    useEffect(() => {
        if (target) navigate(target, { replace: true });
    }, [target, navigate]);

    return <Outlet />;
}
