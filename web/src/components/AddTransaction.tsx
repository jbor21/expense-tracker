import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { centsFromInput } from '../lib/money';
import { sealTxPayload } from '../lib/txcrypto';
import type { TxPayload } from '../../../Worker/src/crypto';

export default function AddTransaction({ categories, onClose, onSave }: { categories: any[], onClose: () => void, onSave: () => void }) {
  const [kind, setKind] = useState<'purchase' | 'refund'>('purchase');
  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  const isValid = centsFromInput(amount) !== null && merchant.trim().length > 0;

  async function handleSave() {
    if (!isValid) return;
    setBusy(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const cents = centsFromInput(amount)!;
    const amountCents = kind === 'refund' ? -cents : cents;
    const payload: TxPayload = {
      merchant: merchant.trim(),
      amountCents,
      kind,
      accountLast4: null,
    };
    const payload_enc = await sealTxPayload(payload);

    await supabase.from('transactions').insert({
      user_id: user.id,
      payload_enc,
      category_id: categoryId || null,
      occurred_at: new Date(`${date}T12:00:00`).toISOString(),
      message_id: `manual:${crypto.randomUUID()}`,
      line_idx: 0,
    });
    setBusy(false);
    onSave();
  }

  const field = 'w-full border border-line rounded-xl px-3 py-2.5 bg-paper outline-none focus:border-brand';

  return (
    <div className="fixed inset-0 bg-ink/40 z-50 flex items-end sm:items-center sm:justify-center" onClick={onClose}>
      <div
        className="bg-white w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl p-5 pb-[calc(env(safe-area-inset-bottom)+20px)] space-y-4"
        onClick={e => e.stopPropagation()}>
        <div className="mx-auto w-10 h-1 rounded-full bg-line sm:hidden" />
        <h2 className="font-display text-xl font-semibold">Add a charge</h2>

        <div className="flex gap-1 p-1 bg-paper rounded-xl">
          <button className={`flex-1 py-2 rounded-lg font-semibold text-sm transition-colors ${kind === 'purchase' ? 'bg-white shadow-sm' : 'text-faint'}`} onClick={() => setKind('purchase')}>Purchase</button>
          <button className={`flex-1 py-2 rounded-lg font-semibold text-sm transition-colors ${kind === 'refund' ? 'bg-white shadow-sm' : 'text-faint'}`} onClick={() => setKind('refund')}>Refund</button>
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="block text-xs font-semibold text-faint mb-1">Amount</label>
            <input type="text" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)}
              className={`${field} amount text-lg`} placeholder="0.00" autoFocus />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-semibold text-faint mb-1">Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)} className={field} />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-faint mb-1">Merchant</label>
          <input type="text" value={merchant} onChange={e => setMerchant(e.target.value)} className={field} placeholder="Coffee shop" />
        </div>

        <div>
          <label className="block text-xs font-semibold text-faint mb-1">Category</label>
          <select value={categoryId} onChange={e => setCategoryId(e.target.value)} className={field}>
            <option value="">Uncategorized</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="flex-1 py-3 rounded-xl border border-line font-semibold text-faint">Cancel</button>
          <button onClick={handleSave} disabled={!isValid || busy}
            className="flex-1 py-3 rounded-xl bg-brand text-white font-semibold disabled:opacity-40">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
