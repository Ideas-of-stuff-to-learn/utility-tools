import { useState, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useBilling } from '../appState/BillingContext';
import { createSetupIntent, confirmCardSetup, startTrial, subscribePro } from '../api';
import '../styles/billing.css';

export default function CardSetupScreen() {
    const navigate       = useNavigate();
    const [searchParams] = useSearchParams();
    const next           = searchParams.get('next'); // e.g. 'start-trial'

    const { stripeConfig, stripeConfigLoading, ensureStripeConfig, refresh } = useBilling();
    const stripeEnabled = stripeConfig?.stripe_enabled ?? false;

    const [stripe, setStripe]               = useState(null);
    const [elements, setElements]           = useState(null);
    const [clientSecret, setClientSecret]   = useState(null);
    const [loading, setLoading]             = useState(false);
    const [initError, setInitError]         = useState(null);
    const [submitError, setSubmitError]     = useState(null);
    const [stripeLoaded, setStripeLoaded]   = useState(false);
    const cardRef = useRef(null);

    // Load Stripe.js dynamically — only when stripe is configured.
    useEffect(() => {
        ensureStripeConfig();
    }, [ensureStripeConfig]);

    useEffect(() => {
        if (!stripeConfig?.stripe_enabled || !stripeConfig?.publishable_key) return;
        if (stripeLoaded) return;

        // Load Stripe.js from their CDN
        const script = document.createElement('script');
        script.src   = 'https://js.stripe.com/v3/';
        script.async = true;
        script.onload = () => setStripeLoaded(true);
        script.onerror = () => setInitError('Failed to load payment library. Please refresh.');
        document.head.appendChild(script);
        return () => { try { document.head.removeChild(script); } catch {} };
    }, [stripeConfig, stripeLoaded]);

    // Init Stripe + create SetupIntent once Stripe.js is loaded
    useEffect(() => {
        if (!stripeLoaded || !stripeConfig?.publishable_key) return;
        let cancelled = false;

        async function init() {
            try {
                const stripeInstance = window.Stripe(stripeConfig.publishable_key);
                const { client_secret } = await createSetupIntent();
                if (cancelled) return;

                setClientSecret(client_secret);
                const els = stripeInstance.elements({ clientSecret: client_secret });
                const card = els.create('card', {
                    style: {
                        base: {
                            fontSize: '16px',
                            color: getComputedStyle(document.documentElement)
                                .getPropertyValue('--text-primary').trim() || '#1a1a2e',
                            '::placeholder': { color: '#aab' },
                        },
                    },
                    hidePostalCode: true,
                });
                if (cardRef.current) card.mount(cardRef.current);
                setStripe(stripeInstance);
                setElements(els);
            } catch (err) {
                if (!cancelled) setInitError(err?.message || 'Could not initialize payment form.');
            }
        }

        init();
        return () => { cancelled = true; };
    }, [stripeLoaded, stripeConfig]);

    async function handleSubmit(e) {
        e.preventDefault();
        if (!stripe || !elements || !clientSecret) return;
        setSubmitError(null);
        setLoading(true);

        try {
            const cardElement = elements.getElement('card');
            const { setupIntent, error } = await stripe.confirmCardSetup(clientSecret, {
                payment_method: { card: cardElement },
            });

            if (error) {
                setSubmitError(error.message);
                return;
            }

            await confirmCardSetup(setupIntent.payment_method, 'cashflow');

            if (next === 'start-trial') {
                await startTrial('cashflow');
            } else if (next === 'subscribe' || next === 'subscribe-yearly') {
                await subscribePro(next === 'subscribe-yearly' ? 'yearly' : 'monthly');
            }

            await refresh();
            navigate('/home');
        } catch (err) {
            setSubmitError(err?.message || 'Something went wrong. Please try again.');
        } finally {
            setLoading(false);
        }
    }

    // ── Stripe not configured ─────────────────────────────────────────────────
    if (!stripeConfigLoading && !stripeEnabled) {
        return (
            <div className="card-setup-page">
                <div className="card-setup-card card-setup-disabled">
                    <div className="card-setup-icon">🔒</div>
                    <h2>Payment setup coming soon</h2>
                    <p>Payment processing is being configured. Check back shortly.</p>
                    <button className="btn-secondary" onClick={() => navigate(-1)}>Go back</button>
                </div>
            </div>
        );
    }

    return (
        <div className="card-setup-page">
            <div className="card-setup-card">
                <h2>Add your card</h2>
                <p className="card-setup-subtitle">
                    {next === 'start-trial'
                        ? 'Your card is required to start the free trial. You won\'t be charged until the trial ends.'
                        : (next === 'subscribe' || next === 'subscribe-yearly')
                            ? 'Your card will be charged when you confirm. You can cancel anytime from your profile.'
                            : 'Your card details are stored securely with Stripe. You can remove them at any time.'}
                </p>

                {initError ? (
                    <div className="card-setup-error">{initError}</div>
                ) : (
                    <form onSubmit={handleSubmit} className="card-setup-form">
                        <div className="card-setup-field-label">Card details</div>
                        <div
                            ref={cardRef}
                            className={`card-setup-stripe-field ${(!stripe || stripeConfigLoading) ? 'card-setup-stripe-field--loading' : ''}`}
                        >
                            {(!stripe && !initError) && (
                                <span className="card-setup-placeholder">Loading secure card field…</span>
                            )}
                        </div>

                        {submitError && <p className="card-setup-error">{submitError}</p>}

                        <div className="card-setup-actions">
                            <button
                                type="submit"
                                className="btn-primary card-setup-submit"
                                disabled={!stripe || loading}
                            >
                                {loading
                                    ? 'Saving…'
                                    : next === 'start-trial'
                                        ? 'Save card & start trial'
                                        : (next === 'subscribe' || next === 'subscribe-yearly')
                                            ? 'Save card & subscribe'
                                            : 'Save card'
                                }
                            </button>
                            <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => navigate(-1)}
                                disabled={loading}
                            >
                                Cancel
                            </button>
                        </div>

                        <p className="card-setup-stripe-badge">
                            Secured by Stripe — we never see your card number
                        </p>
                    </form>
                )}
            </div>
        </div>
    );
}
