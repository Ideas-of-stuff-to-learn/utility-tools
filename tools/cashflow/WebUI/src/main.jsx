import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/theme.css';
import { initTheme } from './theme';
import { primeGetMe } from './api';
import App from './App';

initTheme();
// Start /auth/me in-flight before React renders — AuthContext reuses this
// promise so the response arrives sooner on return visits.
primeGetMe();

createRoot(document.getElementById('root')).render(
    <App />
);
