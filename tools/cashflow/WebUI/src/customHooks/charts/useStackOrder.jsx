// WebUI/src/customHooks/charts/useStackOrder.jsx
import { useCallback } from 'react';
import { useUserPreferences } from '../../appState/UserPreferencesContext';

// Category stacking order for the charts. Derived from context on every
// render (not copied once at mount) so a remembered order still applies when
// preferences arrive after the chart mounts, and an unsaved session order
// survives Dashboard ↔ Charts remounts.
export function useStackOrder(categoryNames) {
    const {
        stackOrder: savedOrder, setStackOrder,
        stackPersist, setStackPersist,
        sessionStackOrder, setSessionStackOrder,
    } = useUserPreferences();

    const persist = stackPersist === true;
    const stackOrder = persist && savedOrder?.length ? savedOrder : sessionStackOrder;

    // A saved order only lists the categories that existed when it was saved. Any
    // category it doesn't mention (newly created, or renamed while the saved
    // order still held the old name) is appended, so it can never disappear
    // from the chart and its bar totals. Names that no longer exist are dropped.
    const defaultOrder = categoryNames.filter(n => n !== 'Income');
    const effectiveOrder = stackOrder
        ? [
            ...stackOrder.filter(n => categoryNames.includes(n)),
            ...defaultOrder.filter(n => !stackOrder.includes(n)),
        ]
        : defaultOrder;

    const updateOrder = useCallback((newOrder) => {
        setSessionStackOrder(newOrder);
        if (persist) setStackOrder(newOrder);
    }, [persist, setSessionStackOrder, setStackOrder]);

    const togglePersist = useCallback(async (value) => {
        setStackPersist(value);
        if (value && stackOrder) {
            setStackOrder(stackOrder);
        } else if (!value) {
            setSessionStackOrder(stackOrder);
            setStackOrder(null);
        }
    }, [stackOrder, setStackOrder, setStackPersist, setSessionStackOrder]);

    const resetOrder = useCallback(async () => {
        setSessionStackOrder(null);
        setStackOrder(null);
        setStackPersist(false);
    }, [setSessionStackOrder, setStackOrder, setStackPersist]);

    return {
        effectiveOrder,
        stackOrder,
        updateOrder,
        resetOrder,
        persist,
        togglePersist,
        isCustomOrder: stackOrder !== null,
    };
}
