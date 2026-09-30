import { useNavigate } from 'react-router-dom';
import '../styles/dataSecurityStyles.css';

export default function DataSecurityScreen() {
    const navigate = useNavigate();

    return (
        <div className="ds-page">
            <button className="ds-back-btn" onClick={() => navigate(-1)}>← Back</button>
            <div className="ds-doc">

                <header className="ds-doc-header">
                    <p className="ds-eyebrow">Cashflow 2.0 — Security Overview</p>
                    <h1 className="ds-title">Your data security,<br />explained plainly</h1>
                    <p className="ds-lead">
                        This document explains what protections are in place, what information
                        the developer can technically access, and why that limitation is an
                        unavoidable property of how cloud apps work — not a gap that was
                        overlooked.
                    </p>
                </header>

                <section className="ds-section">
                    <h2 className="ds-section-title">The journey your data takes</h2>
                    <div className="ds-section-body">
                        <p>Every time you log in, upload a file, or view your transactions,
                        your data moves between your browser and a server. Here is what
                        happens at each step.</p>
                    </div>
                    <div className="ds-diagram-wrap">
                        <svg viewBox="0 0 660 210" width="660" height="210" xmlns="http://www.w3.org/2000/svg" style={{ fontFamily: "'Inter',system-ui,sans-serif" }}>
                            <defs>
                                <marker id="a-safe" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                                    <path d="M0,0 L0,6 L8,3 z" fill="#3a6b48"/>
                                </marker>
                                <marker id="a-blue" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                                    <path d="M0,0 L0,6 L8,3 z" fill="#2d6a9f"/>
                                </marker>
                                <marker id="a-warn" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                                    <path d="M0,0 L0,6 L8,3 z" fill="#8a5a1a"/>
                                </marker>
                            </defs>
                            <rect x="10" y="70" width="120" height="60" rx="8" fill="#e8f0f8" stroke="#2d6a9f" strokeWidth="1.5"/>
                            <text x="70" y="96" textAnchor="middle" fontSize="12" fontWeight="600" fill="#2d6a9f">Your Browser</text>
                            <text x="70" y="113" textAnchor="middle" fontSize="10" fill="#6b7f93">CSV file / login</text>
                            <line x1="133" y1="100" x2="207" y2="100" stroke="#3a6b48" strokeWidth="2" markerEnd="url(#a-safe)"/>
                            <text x="170" y="92" textAnchor="middle" fontSize="10" fontWeight="600" fill="#3a6b48">HTTPS</text>
                            <text x="170" y="116" textAnchor="middle" fontSize="9" fill="#6b7f93">encrypted transit</text>
                            <rect x="210" y="70" width="140" height="60" rx="8" fill="#e8f0f8" stroke="#2d6a9f" strokeWidth="1.5"/>
                            <text x="280" y="93" textAnchor="middle" fontSize="12" fontWeight="600" fill="#2d6a9f">Application</text>
                            <text x="280" y="109" textAnchor="middle" fontSize="10" fill="#6b7f93">validates · categorises</text>
                            <text x="280" y="122" textAnchor="middle" fontSize="10" fill="#6b7f93">sanitises input</text>
                            <line x1="353" y1="100" x2="427" y2="100" stroke="#2d6a9f" strokeWidth="2" markerEnd="url(#a-blue)"/>
                            <text x="390" y="92" textAnchor="middle" fontSize="10" fontWeight="600" fill="#2d6a9f">private</text>
                            <text x="390" y="116" textAnchor="middle" fontSize="9" fill="#6b7f93">server-only link</text>
                            <rect x="430" y="60" width="130" height="80" rx="8" fill="#f0ede6" stroke="#dbd8d0" strokeWidth="1.5"/>
                            <text x="495" y="89" textAnchor="middle" fontSize="12" fontWeight="600" fill="#1b2a3b">Database</text>
                            <text x="495" y="106" textAnchor="middle" fontSize="10" fill="#6b7f93">transactions · prefs</text>
                            <text x="495" y="121" textAnchor="middle" fontSize="10" fill="#3a6b48">passwords: hashed ✓</text>
                            <line x1="280" y1="131" x2="280" y2="165" stroke="#8a5a1a" strokeWidth="1.5" strokeDasharray="4 3" markerEnd="url(#a-warn)"/>
                            <rect x="210" y="167" width="140" height="30" rx="6" fill="#fdf0db" stroke="#8a5a1a" strokeWidth="1"/>
                            <text x="280" y="187" textAnchor="middle" fontSize="10" fill="#8a5a1a">Gemini API (descriptions only)</text>
                        </svg>
                    </div>
                </section>

                <section className="ds-section">
                    <h2 className="ds-section-title">What is protected, and how</h2>
                    <div className="ds-card-grid">
                        <div className="ds-card">
                            <span className="ds-card-icon">🔒</span>
                            <p className="ds-card-title">Passwords are never stored</p>
                            <p className="ds-card-body">Your password is run through <strong>bcrypt</strong> — a one-way
                            mathematical process — before anything is saved. The result cannot be reversed
                            back into your original password. Not by code, not by the developer, not by anyone.</p>
                        </div>
                        <div className="ds-card">
                            <span className="ds-card-icon">🌐</span>
                            <p className="ds-card-title">All traffic is encrypted</p>
                            <p className="ds-card-body">Every connection between your browser and the server uses{' '}
                            <strong>HTTPS with TLS</strong>. Your data is encrypted in transit — anyone
                            intercepting the network sees only scrambled noise.</p>
                        </div>
                        <div className="ds-card">
                            <span className="ds-card-icon">🍪</span>
                            <p className="ds-card-title">Login tokens stay out of reach</p>
                            <p className="ds-card-body">After you log in, your session is tracked with a short-lived{' '}
                            <strong>httpOnly cookie</strong> — invisible to JavaScript. A malicious script
                            cannot steal it. Tokens expire after 24 hours; refresh tokens after 30 days.</p>
                        </div>
                        <div className="ds-card">
                            <span className="ds-card-icon">🛡️</span>
                            <p className="ds-card-title">Input is sanitised</p>
                            <p className="ds-card-body">Every database query uses <strong>parameterised
                            placeholders</strong> — the standard method that makes SQL injection
                            impossible. Transaction descriptions are also stripped of formula-injection
                            characters before storage.</p>
                        </div>
                        <div className="ds-card">
                            <span className="ds-card-icon">⏱️</span>
                            <p className="ds-card-title">Login attempts are rate-limited</p>
                            <p className="ds-card-body">The login endpoint accepts at most{' '}
                            <strong>10 requests per minute</strong> per IP. A brute-force attack
                            trying thousands of passwords is blocked automatically.</p>
                        </div>
                        <div className="ds-card">
                            <span className="ds-card-icon">🤖</span>
                            <p className="ds-card-title">AI categorisation is minimal</p>
                            <p className="ds-card-body">When automatic matching cannot categorise a transaction,
                            only its <strong>description text</strong> is sent to Google's Gemini API.
                            No amounts, dates, or account details leave the server in that call.</p>
                        </div>
                    </div>
                </section>

                <hr className="ds-divider" />

                <section className="ds-section">
                    <h2 className="ds-section-title">What the developer can see</h2>
                    <div className="ds-section-body">
                        <p>This is the part most apps leave out of their security pages.
                        It deserves a straight answer.</p>
                        <p>The app's data lives in a <strong>PostgreSQL database hosted on Supabase</strong>.
                        As the developer, direct administrative access to that database exists.
                        That means the following is technically possible.</p>
                    </div>
                    <div className="ds-compare">
                        <div className="ds-compare-col ds-can">
                            <span className="ds-compare-label">Developer can see</span>
                            <ul className="ds-compare-list">
                                <li><span className="ds-ci">⚠️</span> Transaction descriptions, amounts, and dates you have uploaded</li>
                                <li><span className="ds-ci">⚠️</span> Your username</li>
                                <li><span className="ds-ci">⚠️</span> Which categories you have assigned</li>
                                <li><span className="ds-ci">⚠️</span> Names of files you have uploaded</li>
                            </ul>
                        </div>
                        <div className="ds-compare-col ds-cant">
                            <span className="ds-compare-label">Developer cannot see</span>
                            <ul className="ds-compare-list">
                                <li><span className="ds-ci">✅</span> Your password — stored only as an irreversible hash</li>
                                <li><span className="ds-ci">✅</span> Your active session token — short-lived, not persisted</li>
                                <li><span className="ds-ci">✅</span> Data from other apps or services</li>
                                <li><span className="ds-ci">✅</span> Full account numbers — bank exports typically contain only partial digits</li>
                            </ul>
                        </div>
                    </div>
                    <div className="ds-callout ds-callout-warn">
                        <span className="ds-callout-label">Honest note</span>
                        <p>This is the reality of any cloud-hosted application where the server
                        processes your data. The developer of Gmail can query your emails.
                        The developer of a cloud accounting tool can query your transactions.
                        Cashflow 2.0 is a commercial tool — the same transparency you would
                        expect from any financial software applies here. No data is sold,
                        shared with advertisers, or passed to third parties beyond the minimal
                        Gemini API call for categorisation.</p>
                    </div>
                </section>

                <section className="ds-section">
                    <h2 className="ds-section-title">Why this limitation cannot be removed</h2>
                    <div className="ds-section-body">
                        <p>The only technical way to prevent the server from ever reading your
                        data is <strong>client-side encryption</strong> — encrypting everything
                        in your browser before it is sent, so the server stores only ciphertext
                        it cannot read.</p>
                        <p>The problem: the server then cannot do anything useful with it.
                        Categorising transactions, running the matching pipeline, calling the
                        Gemini API — all of these require the server to actually read the
                        transaction descriptions. Encrypting the data before sending it would
                        mean the server processes nonsense, and the app stops working.</p>
                        <p>This is a fundamental property of server-side computation, not a design
                        choice. Any app that processes your data on a server — whether it is a
                        banking app, a budgeting tool, or a payroll system — has this same property.
                        The tradeoff is capability versus zero-knowledge storage: you cannot have
                        both at the same time.</p>
                    </div>
                    <div className="ds-callout ds-callout-safe">
                        <span className="ds-callout-label">The practical reality</span>
                        <p>The meaningful protection is not only technical — it is also contractual.
                        The Privacy Policy commits to not sharing or selling your data.
                        Your transaction data is not useful to misuse: it contains spending patterns,
                        not credentials that work anywhere else. And the developer is personally
                        identifiable and legally accountable — this is not an anonymous service.</p>
                    </div>
                </section>

                <hr className="ds-divider" />

                <section className="ds-section">
                    <h2 className="ds-section-title">Summary</h2>
                    <ul className="ds-fact-list">
                        <li><span className="ds-fi">🔐</span> Passwords are protected by one-way hashing and cannot be recovered by anyone.</li>
                        <li><span className="ds-fi">🌐</span> All data in transit is encrypted end-to-end with HTTPS.</li>
                        <li><span className="ds-fi">🍪</span> Session cookies are httpOnly and short-lived — invisible to JavaScript.</li>
                        <li><span className="ds-fi">🛡️</span> The database uses parameterised queries throughout — SQL injection is not possible.</li>
                        <li><span className="ds-fi">⚠️</span> Transaction data stored in the database is readable by the developer as the database administrator — this is true of all cloud-hosted applications.</li>
                        <li><span className="ds-fi">🚫</span> This cannot be removed without also removing the ability to process your data server-side.</li>
                        <li><span className="ds-fi">🤝</span> No data is sold, shared with advertisers, or passed to third parties beyond the minimal Gemini API call for categorisation.</li>
                    </ul>
                </section>

                <footer className="ds-footer">
                    <p>Cashflow 2.0 &nbsp;·&nbsp; Questions: <a href="mailto:khaitanarmaan@gmail.com">khaitanarmaan@gmail.com</a></p>
                </footer>

            </div>
        </div>
    );
}
