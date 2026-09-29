import { flushAll } from '../../idb/persistence';

export const TOOLS_URL = import.meta.env.PROD ? '/utility-tools/' : 'http://localhost:5174/';

// Hard navigation tears down the app, so pending local writes (IDB snapshot,
// debounced preference sync) are flushed first — capped so the button never
// feels stuck.
export async function goBackToTools() {
    await flushAll(1500);
    window.location.href = TOOLS_URL;
}

export function useLogout() {
    return { handleLogout: goBackToTools };
}
