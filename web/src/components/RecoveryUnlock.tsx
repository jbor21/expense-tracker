import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { keysFromPhrase, storeEntropy } from '../lib/keys';

export default function RecoveryUnlock({ expectedPublicKey, onDone }: { expectedPublicKey: string; onDone: () => void }) {
  const [phrase, setPhrase] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleUnlock() {
    setError(null);
    const keys = keysFromPhrase(phrase);
    if (!keys) {
      setError("That's not a valid 12-word phrase — check for typos.");
      return;
    }
    if (keys.publicKeyB64 !== expectedPublicKey) {
      setError("Those words don't match this account's key.");
      return;
    }
    storeEntropy(keys.entropy);
    onDone();
  }

  return (
    <div className="min-h-screen bg-paper flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <h1 className="font-display text-2xl font-semibold mb-2">Unlock your data</h1>
          <p className="text-sm text-faint">
            This device doesn't have your key yet. Enter your 12 recovery words to unlock your data here.
          </p>
        </div>

        <div>
          <textarea
            value={phrase}
            onChange={e => setPhrase(e.target.value)}
            placeholder="word word word..."
            className="w-full bg-white border border-line rounded-2xl p-4 text-ink outline-none focus:border-brand min-h-[120px] resize-none"
          />
          {error && <p className="text-sm text-over mt-2">{error}</p>}
        </div>

        <button
          onClick={handleUnlock}
          className="w-full py-3 rounded-2xl bg-brand text-white font-semibold active:bg-brand/90">
          Unlock
        </button>

        <div className="text-center">
          <button
            onClick={() => supabase.auth.signOut()}
            className="text-sm text-faint font-semibold p-2">
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
