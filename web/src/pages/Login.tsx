import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithPassword({
      email, password,
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    nav('/');
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-paper px-6 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <img src="/icon-192.png" alt="" className="w-16 h-16 rounded-2xl mb-4" />
      <h1 className="font-display text-4xl font-semibold mb-1">Tally</h1>
      <p className="text-faint text-sm mb-8">Every charge, counted.</p>
      <form onSubmit={submit} className="w-full max-w-sm space-y-3">
        <input className="w-full rounded-xl border border-line bg-white px-4 py-3 outline-none focus:border-brand" type="email" required placeholder="Email" autoComplete="email"
          value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="w-full rounded-xl border border-line bg-white px-4 py-3 outline-none focus:border-brand" type="password" required minLength={8}
          placeholder="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="text-sm text-over">{error}</p>}
        <button disabled={busy} className="w-full rounded-xl bg-brand py-3 font-semibold text-white disabled:opacity-50">
          Log in
        </button>
        <p className="text-sm text-center text-faint pt-2">New here? <Link className="text-brand font-semibold" to="/signup">Create an account</Link></p>
      </form>
    </div>
  );
}
