import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { AppStateProvider } from './appState';
import RequireAuth from './components/RequiresAuth';
import ResponsiveGate from './components/ResponsiveGate';
import Layout from './components/Layout';
import ManualReviewGate from './components/manualReview/ManualReviewGate';
import ToolGate from './components/ToolGate';

import HomeScreen from './screens/HomeScreen';
import DashboardScreen from './screens/Dashboard';
import PrivacyScreen from './screens/PrivacyScreen';
import TermsScreen from './screens/TermsScreen';
import AccessibilityScreen from './screens/AccessibilityScreen';
import CookiesScreen from './screens/CookiesScreen';
import DataSecurityScreen from './screens/DataSecurityScreen';
import ProfileScreen from './screens/ProfileScreen';
import PricingScreen from './screens/PricingScreen';
import CardSetupScreen from './screens/CardSetupScreen';

const ChartsScreen = lazy(() => import('./screens/ChartsScreen'));
const ContentsScreen = lazy(() => import('./screens/ContentsScreen'));

function AppContent() {
  return (
    <BrowserRouter basename={import.meta.env.PROD ? '/utility-tools/cashflow' : '/'}>
      <Routes>
        <Route path="/privacy" element={<PrivacyScreen />} />
        <Route path="/terms" element={<TermsScreen />} />
        <Route path="/accessibility" element={<AccessibilityScreen />} />
        <Route path="/cookies" element={<CookiesScreen />} />
        <Route path="/data-security" element={<DataSecurityScreen />} />

        <Route element={<ResponsiveGate />}>
          <Route path="/" element={null} />
          <Route element={<Layout />}>
            <Route path="/pricing"    element={<RequireAuth><PricingScreen /></RequireAuth>} />
            <Route path="/card-setup" element={<RequireAuth><CardSetupScreen /></RequireAuth>} />
            <Route path="/dashboard"  element={<RequireAuth><ToolGate><DashboardScreen /></ToolGate></RequireAuth>} />
            <Route path="/home"       element={<RequireAuth><ToolGate><HomeScreen /></ToolGate></RequireAuth>} />
            <Route path="/charts"     element={<RequireAuth><ToolGate><Suspense fallback={null}><ChartsScreen /></Suspense></ToolGate></RequireAuth>} />
            <Route path="/contents"   element={<RequireAuth><ToolGate><Suspense fallback={null}><ContentsScreen /></Suspense></ToolGate></RequireAuth>} />
            <Route path="/profile"    element={<RequireAuth><ProfileScreen /></RequireAuth>} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <AppStateProvider>
      <ManualReviewGate />
      <AppContent />
    </AppStateProvider>
  );
}
