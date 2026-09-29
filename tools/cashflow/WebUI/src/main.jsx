import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/theme.css';
import { initTheme } from './theme';
import { bootstrapSession } from './api';
import { prefetchBootSnapshot } from './idb/bootSnapshot';
import { normalizeEntryUrl } from './components/ResponsiveGate';
import App from './App';

normalizeEntryUrl();
initTheme();
// Both start before React renders: /auth/me (for the IDB key) and the
// still-encrypted IDB snapshot read run in parallel, so decryption can
// begin the instant the key arrives.
bootstrapSession().catch(() => {});
prefetchBootSnapshot();

createRoot(document.getElementById('root')).render(
    <App />
);
