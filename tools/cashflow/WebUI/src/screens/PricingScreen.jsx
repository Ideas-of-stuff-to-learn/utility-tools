import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBilling } from '../appState/BillingContext';
import { useAuth } from '../appState/AuthContext';
import { startTrial } from '../api';
import '../styles/billing.css';

const TRIAL_DAYS = 30; // shown in UI; real value comes from backend

export default function PricingScreen() {
    const navigate    = useNavigate();
    const { isLoggedIn } = useAuth();
    const { billing, hasPro, activeTrial, stripeConfig, stripeConfigLoading, ensureStripeConfig, refresh } = useBilling();

    const [loading, setLoading]   = useState(false);
    const [error, setError]       = useState(null);

    useEffect(() => { ensureStripeConfig(); }, [ensureStripeConfig]);

    const stripeEnabled   = stripeConfig?.stripe_enabled ?? false;
    const cardOnFile      = !!billing?.card_last4;
    // Card required = Stripe is configured. If Stripe not yet configured,
    // we still show the trial CTA but it leads to the "coming soon" flow.
    const cardRequired    = stripeEnabled;

    async function handleStartTrial() {
        if (!isLoggedIn) { navigate('/'); return; }
        setError(null);

        // If card is required and not on file, go collect card first
        if (cardRequired && !cardOnFile) {
            navigate('/card-setup?next=start-trial');
            return;
        }

        setLoading(true);
        try {
            await startTrial('cashflow');
            await refresh();
            navigate('/home');
        } catch (err) {
            if (err?.code === 'card_required') {
                navigate('/card-setup?next=start-trial');
                return;
            }
            if (err?.code === 'trial_cooldown') {
                setError(`Trial cooldown active — ${err.cooldown_days_remaining ?? 'some'} days remaining before you can start another trial.`);
                return;
            }
            setError(err?.message || 'Could not start trial. Please try again.');
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="pricing-page">
            <div className="pricing-header">
                <h1>Simple, transparent pricing</h1>
                <p className="pricing-subtitle">Start free. Upgrade when you need more.</p>
            </div>

            <div className="pricing-cards">
                {/* Base tier */}
                <div className="pricing-card">
                    <div className="pricing-card-header">
                        <span className="pricing-tier-name">Base</span>
                        <div className="pricing-price">
                            <span className="pricing-amount">Free</span>
                            <span className="pricing-period">forever</span>
                        </div>
                    </div>
                    <ul className="pricing-features">
                        <li className="pricing-feature">Account &amp; profile</li>
                        <li className="pricing-feature pricing-feature-muted">No tool access</li>
                        <li className="pricing-feature pricing-feature-muted">No data persistence</li>
                    </ul>
                    <div className="pricing-cta">
                        {isLoggedIn && !hasPro ? (
                            <span className="pricing-current-plan">Your current plan</span>
                        ) : (
                            <span className="pricing-feature-muted pricing-cta-label">Free account</span>
                        )}
                    </div>
                </div>

                {/* Pro tier */}
                <div className="pricing-card pricing-card-featured">
                    <div className="pricing-card-badge">Most popular</div>
                    <div className="pricing-card-header">
                        <span className="pricing-tier-name">Pro</span>
                        <div className="pricing-price">
                            <span className="pricing-amount">£9.99</span>
                            <span className="pricing-period">/ month</span>
                        </div>
                        <span className="pricing-yearly-hint">or £89.99 / year (save 25%)</span>
                    </div>
                    <ul className="pricing-features">
                        <li className="pricing-feature">Full Cashflow access</li>
                        <li className="pricing-feature">Transaction tracking &amp; charts</li>
                        <li className="pricing-feature">Auto-categorisation</li>
                        <li className="pricing-feature">Data persists across sessions</li>
                        <li className="pricing-feature">Cancel anytime</li>
                    </ul>

                    <div className="pricing-cta">
                        {hasPro ? (
                            <span className="pricing-current-plan">
                                {activeTrial
                                    ? `Trial active — ends ${new Date(activeTrial.ends_at).toLocaleDateString()}`
                                    : 'Your current plan'}
                            </span>
                        ) : (
                            <>
                                <button
                                    className="btn-primary pricing-trial-btn"
                                    onClick={handleStartTrial}
                                    disabled={loading || stripeConfigLoading}
                                >
                                    {loading ? 'Starting…' : `Start ${TRIAL_DAYS}-day free trial`}
                                </button>
                                {cardRequired && !cardOnFile && (
                                    <p className="pricing-card-hint">
                                        A card is required to start — you won't be charged during the trial.
                                    </p>
                                )}
                                {error && <p className="pricing-error">{error}</p>}
                            </>
                        )}
                    </div>
                </div>
            </div>

            {!stripeEnabled && (
                <p className="pricing-stripe-notice">
                    Payment processing is being set up — check back soon.
                </p>
            )}
        </div>
    );
}
