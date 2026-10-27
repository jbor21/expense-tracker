import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export default function Signup() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await supabase.auth.signUp({
      email, password,
      options: { data: { invite_code: inviteCode.trim().toUpperCase() } },
    });
    setBusy(false);
    if (error) {
      // Supabase reports invite-trigger rejections as an opaque DB error.
      setError(/database error/i.test(error.message)
        ? "That invite key didn't work — double-check it with whoever sent it and try again."
        : error.message);
      return;
    }
    nav('/');
  }

  const field = 'w-full rounded-xl border border-line bg-white px-4 py-3 outline-none focus:border-brand';

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-paper px-6 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <img src="/icon-192.png" alt="" className="w-16 h-16 rounded-2xl mb-4" />
      <h1 className="font-display text-4xl font-semibold mb-1">Tally</h1>
      <p className="text-faint text-sm mb-8">Every charge, counted.</p>
      <form onSubmit={submit} className="w-full max-w-sm space-y-3">
        <input className={field} type="email" required placeholder="Email" autoComplete="email"
          value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className={field} type="password" required minLength={8}
          placeholder="Password (8+ characters)" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <input className={`${field} uppercase tracking-[0.25em]`}
          placeholder="Invite key" value={inviteCode} maxLength={6}
          onChange={(e) => setInviteCode(e.target.value)} />
        <p className="text-xs text-faint px-1">Get a key from whoever runs this Tally. Setting up the very first account? Leave it blank.</p>
        {error && <p className="text-sm text-over">{error}</p>}
        <button disabled={busy} className="w-full rounded-xl bg-brand py-3 font-semibold text-white disabled:opacity-50">
          Create account
        </button>
        <p className="text-sm text-center text-faint pt-2">Have an account? <Link className="text-brand font-semibold" to="/login">Log in</Link></p>
      </form>
    </div>
  );
}
