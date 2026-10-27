import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, NavLink, Outlet } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { loadKeys } from './lib/keys';
import { migrateHistory } from './lib/migrate';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Budget from './pages/Budget';
import Transactions from './pages/Transactions';
import Settings from './pages/Settings';
import KeySetup from './components/KeySetup';
import RecoveryUnlock from './components/RecoveryUnlock';

function RequireAuth({ session, children }: { session: Session | null, children: React.ReactNode }) {
  if (!session) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function KeyGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<'loading' | 'setup' | 'unlock' | 'ready'>('loading');
  const [expectedKey, setExpectedKey] = useState<string | null>(null);

  async function check() {
    setStatus('loading');
    const { data } = await supabase.from('profiles').select('public_key').single();
    const localKeys = loadKeys();
    
    if (!data?.public_key) {
      setStatus('setup');
    } else if (!localKeys || localKeys.publicKeyB64 !== data.public_key) {
      setExpectedKey(data.public_key);
      setStatus('unlock');
    } else {
      setStatus('ready');
      // Sweep up any plaintext rows KeySetup's one-time migration missed —
      // e.g. columns that gained E2EE after this user already had keys.
      // Idempotent: only touches rows with payload_enc null.
      migrateHistory().catch(() => {});
    }
  }

  useEffect(() => {
    check();
  }, []);

  if (status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <span className="font-display text-2xl text-faint">Tally</span>
      </div>
    );
  }
  if (status === 'setup') {
    return <KeySetup onDone={check} />;
  }
  if (status === 'unlock') {
    return <RecoveryUnlock expectedPublicKey={expectedKey!} onDone={check} />;
  }
  return <>{children}</>;
}

const TABS = [
  {
    to: '/', label: 'Budget', end: true,
    icon: <path d="M3 20h18M6 16V9m6 7V4m6 12v-6" strokeWidth="2.2" strokeLinecap="round" />,
  },
  {
    to: '/transactions', label: 'Activity', end: false,
    icon: <path d="M4 6h16M4 12h16M4 18h10" strokeWidth="2.2" strokeLinecap="round" />,
  },
  {
    to: '/settings', label: 'Settings', end: false,
    icon: (
      <>
        <circle cx="12" cy="12" r="3.2" strokeWidth="2" />
        <path d="M12 2.8v3m0 12.4v3M4.2 7.5l2.6 1.5m10.4 6l2.6 1.5m0-9l-2.6 1.5m-10.4 6l-2.6 1.5" strokeWidth="2" strokeLinecap="round" />
      </>
    ),
  },
];

function TabLayout() {
  return (
    <div className="min-h-screen bg-paper pb-[calc(env(safe-area-inset-bottom)+76px)]">
      <Outlet />
      <nav className="fixed bottom-0 inset-x-0 z-30 bg-white/85 backdrop-blur border-t border-line
                      pb-[calc(env(safe-area-inset-bottom)+6px)] pt-2">
        <div className="max-w-xl mx-auto flex">
          {TABS.map((tab) => (
            <NavLink key={tab.to} end={tab.end} to={tab.to}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center gap-0.5 py-1 text-[11px] font-medium transition-colors ${
                  isActive ? 'text-brand' : 'text-faint'
                }`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-6 h-6">{tab.icon}</svg>
              {tab.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <span className="font-display text-2xl text-faint">Tally</span>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route
          element={
            <RequireAuth session={session}>
              <KeyGate>
                <TabLayout />
              </KeyGate>
            </RequireAuth>
          }
        >
          <Route path="/" element={<Budget />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/settings" element={<Settings session={session!} />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
