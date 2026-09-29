import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext';
import RoleBadge from './components/RoleBadge';
import StartupScreen from './components/StartupScreen';
import LoginScreen from './screens/LoginScreen';
import SignupScreen from './screens/SignupScreen';
import ForgotPasswordScreen from './screens/ForgotPasswordScreen';
import ResetPasswordScreen from './screens/ResetPasswordScreen';
import VerifyEmailScreen from './screens/VerifyEmailScreen';
import CancelDeletionScreen from './screens/CancelDeletionScreen';
import ProfileScreen from './screens/ProfileScreen';

const tools = [
  {
    id: 'cashflow',
    name: 'Cashflow',
    description: 'Track and categorize your bank transactions. Upload CSV or Excel statements and get instant spending breakdowns.',
    icon: '💸',
    status: 'live',
    href: import.meta.env.DEV ? 'http://localhost:5173' : '/utility-tools/cashflow/',
    accentColor: '#4f8ef7',
  },
  {
    id: 'utility-2',
    name: 'Utility 2',
    description: 'A new tool is on its way. Stay tuned for updates.',
    icon: '🔧',
    status: 'soon',
  },
  {
    id: 'utility-3',
    name: 'Utility 3',
    description: 'A new tool is on its way. Stay tuned for updates.',
    icon: '📊',
    status: 'soon',
  },
  {
    id: 'utility-4',
    name: 'Utility 4',
    description: 'A new tool is on its way. Stay tuned for updates.',
    icon: '📁',
    status: 'soon',
  },
  {
    id: 'utility-5',
    name: 'Utility 5',
    description: 'A new tool is on its way. Stay tuned for updates.',
    icon: '🔍',
    status: 'soon',
  },
  {
    id: 'utility-6',
    name: 'Utility 6',
    description: 'A new tool is on its way. Stay tuned for updates.',
    icon: '⚙️',
    status: 'soon',
  },
];

function ToolCard({ tool }) {
  const isLive = tool.status === 'live';

  const card = (
    <div
      className={`tool-card ${isLive ? 'tool-card--live' : 'tool-card--soon'}`}
      style={isLive ? { '--accent': tool.accentColor } : undefined}
    >
      {!isLive && <span className="badge">Coming soon</span>}
      <div className="tool-card__icon">{tool.icon}</div>
      <h2 className="tool-card__name">{tool.name}</h2>
      <p className="tool-card__desc">{tool.description}</p>
      {isLive && (
        <span className="tool-card__cta">
          Open <span className="cta-arrow">→</span>
        </span>
      )}
    </div>
  );

  if (isLive) {
    return <a href={tool.href} className="tool-card-link">{card}</a>;
  }
  return <div className="tool-card-link tool-card-link--disabled">{card}</div>;
}

function RequireAuth({ children }) {
  const { isLoggedIn, isChecking } = useAuth();
  if (isChecking) return <StartupScreen />;
  if (!isLoggedIn) return <Navigate to="/login" replace />;
  return children;
}

function LandingPage() {
  return (
    <div className="page">
      <header className="header">
        <div className="header__inner">
          <div className="header__brand">
            <span className="header__logo">⚡</span>
            <span className="header__title">Utility Tools</span>
          </div>
          <p className="header__sub">A growing collection of personal productivity tools.</p>
        </div>
        <div className="header__actions">
          <RoleBadge />
        </div>
      </header>

      <main className="main">
        <div className="grid">
          {tools.map((tool) => (
            <ToolCard key={tool.id} tool={tool} />
          ))}
        </div>
      </main>

      <footer className="footer">
        <p>© {new Date().getFullYear()} Utility Tools. All rights reserved.</p>
      </footer>
    </div>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginScreen />} />
      <Route path="/signup" element={<SignupScreen />} />
      <Route path="/forgot-password" element={<ForgotPasswordScreen />} />
      <Route path="/reset-password" element={<ResetPasswordScreen />} />
      <Route path="/verify-email" element={<VerifyEmailScreen />} />
      <Route path="/cancel-deletion" element={<CancelDeletionScreen />} />
      <Route path="/profile" element={<RequireAuth><ProfileScreen /></RequireAuth>} />
      <Route path="/" element={<RequireAuth><LandingPage /></RequireAuth>} />
      {/* Unknown paths (this app is also the site 404 page) go home instead of rendering nothing. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.PROD ? '/utility-tools' : '/'}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
