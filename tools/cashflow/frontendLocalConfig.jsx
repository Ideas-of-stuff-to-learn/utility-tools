import backend from '../../backend-url.json';

export const local = import.meta.env.VITE_LOCAL_DEV === 'true';

export const url = local
    ? `http://${import.meta.env.VITE_LOCAL_IP}:${import.meta.env.VITE_BACKEND_PORT || '5050'}`
    : backend.url;
