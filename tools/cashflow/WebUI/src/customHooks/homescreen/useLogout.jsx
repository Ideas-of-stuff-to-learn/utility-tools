import { useAuth } from '../../appState';

export function useLogout() {
    const { endSession } = useAuth();
    const handleLogout = () => {
        endSession();
        window.location.href = import.meta.env.PROD ? '/utility-tools/' : 'http://localhost:5174/';
    };
    return { handleLogout };
}
