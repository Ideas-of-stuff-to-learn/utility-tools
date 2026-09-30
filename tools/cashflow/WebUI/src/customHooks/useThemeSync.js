import { useEffect } from 'react';
import { useTransactions, useAuth } from '../appState';
import { updateCategory } from '../api';
import { getActiveThemeChartColors } from '../styles/themes/chartColors';

const STORAGE_KEY = 'appliedChartTheme';
const TRIED_KEY = 'chartThemeSyncTried';

function safeGet(store, key) { try { return store.getItem(key); } catch { return null; } }
function safeSet(store, key, value) { try { store.setItem(key, value); } catch {} }

// Pushes the active theme's chart colour palette to the server when the
// theme changed. Category colours are GLOBAL and category writes are capped at
// 20/day, so this must be quiet and idempotent:
//  - only categories whose colour actually differs from the palette are sent
//    (steady state = zero requests, and the "applied" flag is just recorded);
//  - sent one at a time and stopped at the first failure, instead of a burst
//    of parallel PATCHes that all hit the rate limit together;
//  - after a failure it is not retried until the next browser session, so a
//    429/403 can no longer repeat on every page load and eat the daily quota;
//  - skipped entirely for users without the recolour permission.
export function useThemeSync() {
    const { categories, setCategories } = useTransactions();
    const { userRole } = useAuth();
    const canRecolor = userRole?.role === 'owner' || (userRole?.permissions || []).includes('categories.recolor');

    useEffect(() => {
        if (!canRecolor || !categories || categories.length === 0) return;

        const themeName = getComputedStyle(document.documentElement)
            .getPropertyValue('--theme-name')
            .trim();

        if (!themeName) return;
        if (safeGet(localStorage, STORAGE_KEY) === themeName) return;
        if (safeGet(sessionStorage, TRIED_KEY) === themeName) return;

        const palette = getActiveThemeChartColors();
        const updates = categories
            .map((cat, i) => palette[i] && (cat.color || '').toLowerCase() !== palette[i].toLowerCase()
                ? { name: cat.name, color: palette[i] }
                : null)
            .filter(Boolean);

        if (updates.length === 0) {
            safeSet(localStorage, STORAGE_KEY, themeName);
            return;
        }

        safeSet(sessionStorage, TRIED_KEY, themeName);
        let cancelled = false;

        (async () => {
            const applied = {};
            try {
                for (const { name, color } of updates) {
                    if (cancelled) return;
                    await updateCategory(name, { color });
                    applied[name] = color;
                }
                safeSet(localStorage, STORAGE_KEY, themeName);
            } catch (err) {
                console.warn('Theme chart colour sync stopped:', err.message);
            } finally {
                if (Object.keys(applied).length > 0) {
                    setCategories(prev => prev.map(c => (applied[c.name] ? { ...c, color: applied[c.name] } : c)));
                }
            }
        })();

        return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [categories.length, canRecolor]);
}
