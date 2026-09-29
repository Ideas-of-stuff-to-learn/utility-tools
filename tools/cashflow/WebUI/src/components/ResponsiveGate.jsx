// components/ResponsiveGate.jsx
import { useLayoutEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useIsMobile } from '../customHooks/useIsMobile';

const MOBILE_SCREENS = ['/home', '/charts'];
const DESKTOP_SCREEN = '/dashboard';

function redirectTarget(pathname, isMobile) {
    if (pathname === '/') return isMobile ? '/home' : DESKTOP_SCREEN;
    if (isMobile && pathname === DESKTOP_SCREEN) return '/home';
    if (!isMobile && MOBILE_SCREENS.includes(pathname)) return DESKTOP_SCREEN;
    return null;
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
export default function ResponsiveGate() {
    const isMobile = useIsMobile();
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const target = redirectTarget(pathname, isMobile);

    useLayoutEffect(() => {
        if (target) navigate(target, { replace: true });
    }, [target, navigate]);

    return <Outlet />;
}
