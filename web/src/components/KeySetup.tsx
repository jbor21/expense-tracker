import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { newRecovery, storeEntropy } from '../lib/keys';
import { migrateHistory } from '../lib/migrate';
import { deriveKeypair } from '../../../Worker/src/crypto';

export default function KeySetup({ onDone }: { onDone: () => void }) {
  const [keys] = useState(() => newRecovery());
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  async function handleContinue() {
    setBusy(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not logged in');

      const { publicKeyB64 } = deriveKeypair(keys.entropy);
      const { error: dbError } = await supabase
        .from('profiles')
        .update({ public_key: publicKeyB64 })
        .eq('id', user.id);
      
      if (dbError) throw dbError;

      storeEntropy(keys.entropy);

      await migrateHistory((done, total) => {
        setProgress({ done, total });
      });

      onDone();
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
      setBusy(false);
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(keys.phrase);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const words = keys.phrase.split(' ');

  return (
    <div className="min-h-screen bg-paper flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <h1 className="font-display text-2xl font-semibold mb-2">Your data gets a lock</h1>
          <p className="text-sm text-faint">
            Tally encrypts your charges so no one can read them — not even the person who runs this server. These 12 words are the only key. Screenshot them or save them in your password manager.
          </p>
        </div>

        <div className="bg-white rounded-2xl p-6 border border-line">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 mb-4 select-all">
            {words.map((word, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-faint w-4 text-right select-none">{i + 1}</span>
                <span className="font-semibold text-ink">{word}</span>
              </div>
            ))}
          </div>
          <button
            onClick={handleCopy}
            className="w-full py-2.5 rounded-xl bg-paper text-brand font-semibold text-sm transition-colors active:bg-brand/10">
            {copied ? 'Copied' : 'Copy words'}
          </button>
        </div>

        <p className="text-xs text-faint">
          If you lose your phone and these words, your data is gone for good. There's no reset — that's what makes it private.
        </p>

        <div>
          <button
            onClick={handleContinue}
            disabled={busy}
            className="w-full py-3 rounded-2xl bg-brand text-white font-semibold disabled:opacity-50">
            {busy ? 'Saving…' : 'I saved them — continue'}
          </button>
          {progress && progress.total > 0 && (
            <p className="text-center text-xs text-faint mt-2">
              Securing your existing data… {progress.done} of {progress.total}
            </p>
          )}
          {error && <p className="text-center text-sm text-over mt-2">{error}</p>}
        </div>
      </div>
    </div>
  );
}
