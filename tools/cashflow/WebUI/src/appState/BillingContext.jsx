import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { getBillingConfig, getBillingStatus } from '../api';

const BillingContext = createContext();

// Cached Stripe config — fetched once per page load, not per user.
// publishableKey is safe to cache globally (it's public by design).
let _configCache = null;
let _configPromise = null;
function loadStripeConfig() {
    if (_configCache) return Promise.resolve(_configCache);
    if (!_configPromise) {
        _configPromise = getBillingConfig()
            .then(cfg => { _configCache = cfg; return cfg; })
            .catch(() => { _configPromise = null; return { stripe_enabled: false, publishable_key: null }; });
    }
    return _configPromise;
}

export function BillingProvider({ children }) {
    const { userRole, isLoggedIn } = useAuth();
    const [billing, setBilling]           = useState(null);
    const [stripeConfig, setStripeConfig] = useState(null);
    const [stripeConfigLoading, setStripeConfigLoading] = useState(false);

    // Seed billing from the /auth/me response whenever userRole changes.
    useEffect(() => {
        if (userRole?.billing) {
            setBilling(userRole.billing);
        } else if (!isLoggedIn) {
            setBilling(null);
            _configCache   = null;
            _configPromise = null;
        }
    }, [userRole, isLoggedIn]);

    // Re-fetch billing status from server (after a trial starts, payment, etc.)
    const refresh = useCallback(async () => {
        try {
            const data = await getBillingStatus();
            setBilling(data);
            return data;
        } catch {
            return billing;
        }
    }, [billing]);

    // Load Stripe config (publishable key + enabled flag). Called lazily
    // when any billing UI mounts — not on every page load.
    const ensureStripeConfig = useCallback(async () => {
        if (stripeConfig) return stripeConfig;
        setStripeConfigLoading(true);
        try {
            const cfg = await loadStripeConfig();
            setStripeConfig(cfg);
            return cfg;
        } finally {
            setStripeConfigLoading(false);
        }
    }, [stripeConfig]);

    // Derived state
    const tier          = billing?.tier ?? 'base';
    const activeTrial   = billing?.active_trial ?? null;
    const hasPro        = tier === 'pro' || !!activeTrial;
    const paymentFailed = billing?.payment_failed ?? false;

    return (
        <BillingContext.Provider value={{
            billing,
            tier,
            hasPro,
            activeTrial,
            paymentFailed,
            stripeConfig,
            stripeConfigLoading,
            refresh,
            ensureStripeConfig,
        }}>
            {children}
        </BillingContext.Provider>
    );
}

export function useBilling() {
    return useContext(BillingContext);
}
