import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';

/** First-run pointer: shows on Budget until email forwarding is set up
 *  (or the user dismisses it for this device). */
export default function SetupNudge() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (localStorage.getItem('tally-nudge-dismissed')) return;
    supabase.from('profiles').select('forward_address').single().then(({ data }) => {
      if (data && !data.forward_address) setShow(true);
    });
  }, []);

  if (!show) return null;

  return (
    <div className="rounded-2xl border border-brand/30 bg-brand/5 px-4 py-3.5 flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-sm">Welcome to Tally 👋</p>
        <p className="text-sm text-faint mt-0.5">
          Hook up email forwarding once and your card charges will show up here by themselves.
        </p>
        <Link to="/settings" className="inline-block mt-2 text-sm font-semibold text-brand">
          Set it up →
        </Link>
      </div>
      <button
        aria-label="Dismiss"
        onClick={() => { localStorage.setItem('tally-nudge-dismissed', '1'); setShow(false); }}
        className="text-faint px-1 -mt-0.5">✕</button>
    </div>
  );
}
