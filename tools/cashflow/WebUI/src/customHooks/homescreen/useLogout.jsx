export function useLogout() {
    const handleLogout = () => {
        window.location.href = import.meta.env.PROD ? '/utility-tools/' : 'http://localhost:5174/';
    };
    return { handleLogout };
}
