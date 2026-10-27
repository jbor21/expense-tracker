import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Session } from '@supabase/supabase-js';
import { decryptReviewRows, decryptTxRows } from '../lib/txcrypto';

const FILTER_QUERY = 'from:(alerts@chase.com OR no.reply.alerts@chase.com OR fidelityrewards.com)';
const TEST_SUBJECT = 'TestBank alert';
const TEST_BODY = 'You made a purchase of $1.00 at TEST MERCHANT.';

function CopyRow({ value, mono = true }: { value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 mt-1.5">
      <code className={`bg-paper px-3 py-2 rounded-xl flex-1 min-w-0 overflow-x-auto whitespace-nowrap text-[13px] select-all ${mono ? 'font-mono' : ''}`}>
        {value}
      </code>
      <button
        onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        className="text-brand text-sm font-semibold px-2 shrink-0">
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function Step({ n, done, title, children }: { n: number; done: boolean; title: string; children?: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <div className={`w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-xs font-bold mt-0.5
        ${done ? 'bg-under text-white' : 'bg-paper border border-line text-faint'}`}>
        {done ? '✓' : n}
      </div>
      <div className="min-w-0 flex-1 pb-4">
        <p className="font-semibold text-sm">{title}</p>
        <div className="text-sm text-faint mt-1">{children}</div>
      </div>
    </li>
  );
}

export default function ForwardingSetup({ session, address: initialAddress, onAddressAssigned }: { session: Session, address: string | null, onAddressAssigned: (a: string) => void }) {
  const [address, setAddress] = useState(initialAddress);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmLink, setConfirmLink] = useState<string | null>(null);
  const [testOk, setTestOk] = useState(false);

  async function provision() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${import.meta.env.VITE_WORKER_URL}/provision`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAddress(data.address);
        onAddressAssigned(data.address);
      } else {
        setError(`Couldn't get an address (error ${res.status}). Try again in a minute.`);
      }
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!address) return;

    const interval = setInterval(async () => {
      if (!confirmLink) {
        const { data } = await supabase.from('review_queue')
          .select('id,excerpt,payload_enc')
          .order('created_at', { ascending: false })
          .limit(5);
        if (data) {
          const decrypted = await decryptReviewRows(data);
          for (const row of decrypted) {
            const match = row.excerpt?.match(/https?:\/\/mail-settings\.google\.com\S+/);
            if (match) {
              setConfirmLink(match[0]);
              break;
            }
          }
        }
      }

      if (!testOk) {
        const { data } = await supabase.from('transactions')
          .select('id,merchant_raw,payload_enc')
          .order('created_at', { ascending: false })
          .limit(20);
        if (data) {
          const decrypted = await decryptTxRows(data);
          if (decrypted.some(r => r.merchant_raw === 'TEST MERCHANT')) {
            setTestOk(true);
          }
        }
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [address, confirmLink, testOk]);

  return (
    <section className="bg-white rounded-2xl border border-line p-4">
      <h3 className="font-display text-lg font-semibold mb-1">Automatic charges</h3>
      <p className="text-sm text-faint mb-4">
        Tally reads your banks' alert emails. Gmail forwards them to your private Tally address; charges show up on their own.
      </p>

      {!address ? (
        <>
          <button onClick={provision} disabled={busy}
            className="w-full bg-brand text-white rounded-xl py-3 font-semibold disabled:opacity-50">
            {busy ? 'Setting up…' : 'Start setup'}
          </button>
          {error && <p className="text-sm text-over mt-2">{error}</p>}
        </>
      ) : (
        <ol className="mt-1">
          <Step n={1} done title="Your private Tally address">
            <CopyRow value={address} />
          </Step>

          <Step n={2} done={!!confirmLink} title="Tell Gmail about it">
            On a computer: Gmail → ⚙️ → <b>See all settings</b> → <b>Forwarding and POP/IMAP</b> → <b>Add a forwarding address</b> → paste the address above.
            {confirmLink ? (
              <a href={confirmLink} target="_blank" rel="noreferrer"
                className="mt-2 block bg-under text-white px-4 py-2.5 rounded-xl font-semibold text-center">
                Google asked to confirm — tap here
              </a>
            ) : (
              <p className="mt-2 italic">Once you do, Google's confirmation appears here automatically (keep this page open).</p>
            )}
          </Step>

          <Step n={3} done={false} title="Forward only bank alerts">
            In Gmail search, paste this, then <b>Show search options → Create filter → Forward it to</b> your Tally address:
            <CopyRow value={FILTER_QUERY} />
          </Step>

          <Step n={4} done={testOk} title="Send a test charge">
            Email yourself this (from your own address), and the filter will forward it:
            <p className="mt-2 text-xs font-semibold text-ink">Subject</p>
            <CopyRow value={TEST_SUBJECT} />
            <p className="mt-2 text-xs font-semibold text-ink">Body</p>
            <CopyRow value={TEST_BODY} />
            {testOk ? (
              <p className="mt-2 text-under font-semibold">✓ It works — a $1.00 TEST MERCHANT charge came through the whole pipeline.</p>
            ) : (
              <p className="mt-2 italic">Watching for it…</p>
            )}
          </Step>
        </ol>
      )}
    </section>
  );
}
