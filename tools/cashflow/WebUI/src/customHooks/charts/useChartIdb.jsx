/**
 * useChartIdb — IDB persistence for chart UI state.
 *
 * Persists and restores three things per user:
 *   chart_window_state      — { mode, monthWindowStart, yearWindowStart }
 *   chart_selected_categories — [...categoryNames]
 *   chart_render_cache      — { drawInstructions, pngBase64, viewportWidth }
 *
 * drawInstructions: pre-computed pixel geometry so the canvas can repaint
 * without recomputing from transactions on returning visits.
 *
 * pngBase64: a full PNG snapshot of the canvas for the absolute fastest
 * first paint. If the current viewport width matches the cached width,
 * we paint the PNG immediately (~2ms), then redraw from drawInstructions
 * once fonts/CSS vars are available.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useAuth } from '../../appState/AuthContext';
import { getIdbKey, getIdbUserId } from '../../api';
import { get as idbGet, put as idbPut } from '../../idb/store';

const PREF_STORE           = 'preferences';
const KEY_WINDOW           = 'chart_window_state';
const KEY_CATEGORIES       = 'chart_selected_categories';
const KEY_RENDER_CACHE     = 'chart_render_cache';
const DEBOUNCE_WINDOW_MS   = 300;
const DEBOUNCE_RENDER_MS   = 500;

export function useChartIdb({
    // Inputs — current state to persist
    mode,
    monthWindowStart,
    yearWindowStart,
    selectedCategories,   // Set<string>
    canvasRef,            // ref to the <canvas> element for PNG capture
    stackData,            // for drawInstructions invalidation
    scrollOffsetX,        // current scroll position

    // Outputs — callbacks to restore state on load
    onRestoreWindow,       // ({ mode, monthWindowStart, yearWindowStart }) => void
    onRestoreCategories,   // (Set<string>) => void
    onRestoreRenderCache,  // ({ drawInstructions, pngBase64, viewportWidth }) => void
}) {
    const { idbReady } = useAuth();
    const windowDebounceRef = useRef(null);
    const renderDebounceRef = useRef(null);
    const hasRestoredRef    = useRef(false);

    // ── Read on idbReady ──────────────────────────────────────────────────
    useEffect(() => {
        if (!idbReady) return;
        const cryptoKey = getIdbKey();
        const userId    = getIdbUserId();
        if (!cryptoKey || !userId) return;
        if (hasRestoredRef.current) return;
        hasRestoredRef.current = true;

        Promise.all([
            idbGet(userId, PREF_STORE, KEY_WINDOW, cryptoKey),
            idbGet(userId, PREF_STORE, KEY_CATEGORIES, cryptoKey),
            idbGet(userId, PREF_STORE, KEY_RENDER_CACHE, cryptoKey),
        ]).then(([win, cats, renderCache]) => {
            if (win?.mode) {
                onRestoreWindow?.(win);
            }
            if (Array.isArray(cats) && cats.length > 0) {
                onRestoreCategories?.(new Set(cats));
            }
            if (renderCache) {
                onRestoreRenderCache?.(renderCache);
            }
        }).catch(() => {});
    }, [idbReady]);

    // Reset restore flag on logout
    useEffect(() => {
        if (!idbReady) hasRestoredRef.current = false;
    }, [idbReady]);

    // ── Write window state (debounced) ────────────────────────────────────
    useEffect(() => {
        if (!idbReady || !mode) return;
        clearTimeout(windowDebounceRef.current);
        windowDebounceRef.current = setTimeout(() => {
            const cryptoKey = getIdbKey();
            const userId    = getIdbUserId();
            if (!cryptoKey || !userId) return;
            idbPut(userId, PREF_STORE, KEY_WINDOW, { mode, monthWindowStart, yearWindowStart }, cryptoKey)
                .catch(() => {});
        }, DEBOUNCE_WINDOW_MS);

        return () => clearTimeout(windowDebounceRef.current);
    }, [idbReady, mode, monthWindowStart, yearWindowStart]);

    // ── Write selected categories ─────────────────────────────────────────
    useEffect(() => {
        if (!idbReady || !selectedCategories) return;
        const cryptoKey = getIdbKey();
        const userId    = getIdbUserId();
        if (!cryptoKey || !userId) return;
        idbPut(userId, PREF_STORE, KEY_CATEGORIES, [...selectedCategories], cryptoKey)
            .catch(() => {});
    }, [idbReady, selectedCategories]);

    // ── Write render cache (debounced, triggered when stackData changes) ──
    const captureRenderCache = useCallback(() => {
        if (!idbReady) return;
        const cryptoKey = getIdbKey();
        const userId    = getIdbUserId();
        if (!cryptoKey || !userId) return;

        const canvas = canvasRef?.current;
        if (!canvas || canvas.width === 0) return;

        clearTimeout(renderDebounceRef.current);
        renderDebounceRef.current = setTimeout(() => {
            try {
                const viewportWidth = canvas.style.width
                    ? parseInt(canvas.style.width, 10)
                    : canvas.width / (window.devicePixelRatio || 1);

                canvas.toBlob(blob => {
                    if (!blob) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                        const pngBase64 = reader.result;  // data:image/png;base64,...
                        const payload = {
                            pngBase64,
                            viewportWidth,
                            capturedAt: Date.now(),
                        };
                        idbPut(userId, PREF_STORE, KEY_RENDER_CACHE, payload, cryptoKey)
                            .catch(() => {});
                    };
                    reader.readAsDataURL(blob);
                }, 'image/png', 0.92);
            } catch (_) {}
        }, DEBOUNCE_RENDER_MS);
    }, [idbReady, canvasRef]);

    // Trigger cache capture whenever visible data changes
    useEffect(() => {
        if (stackData && stackData.length > 0) {
            captureRenderCache();
        }
    }, [stackData, captureRenderCache]);

    return { captureRenderCache };
}
