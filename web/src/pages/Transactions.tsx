import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { monthKey, monthRange, monthLabel } from '../lib/months';
import { formatCents } from '../lib/money';
import MonthSwitcher from '../components/MonthSwitcher';
import PageHeader from '../components/PageHeader';
import AddTransaction from '../components/AddTransaction';
import { decryptTxRows } from '../lib/txcrypto';

export default function Transactions() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [month, setMonth] = useState(() => monthKey(new Date(), tz));
  const [transactions, setTransactions] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { startISO, endISO } = monthRange(month, tz);
    const [{ data: txns }, { data: cats }] = await Promise.all([
      supabase.from('transactions').select('*, categories(name)').gte('occurred_at', startISO).lt('occurred_at', endISO).order('occurred_at', { ascending: false }),
      supabase.from('categories').select('id,name').eq('archived', false).order('name')
    ]);
    setTransactions(await decryptTxRows(txns || []));
    setCategories(cats || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, [month, tz]);

  async function updateCategory(txnId: string, categoryId: string) {
    await supabase.from('transactions').update({ category_id: categoryId || null }).eq('id', txnId);
    setTransactions(prev => prev.map(t => {
      if (t.id === txnId) {
        const cat = categories.find(c => c.id === categoryId);
        return { ...t, category_id: categoryId || null, categories: cat ? { name: cat.name } : null };
      }
      return t;
    }));
    setEditingId(null);
  }

  async function deleteTxn(txnId: string) {
    await supabase.from('transactions').delete().eq('id', txnId);
    setTransactions(prev => prev.filter(t => t.id !== txnId));
    setEditingId(null);
    setConfirmDeleteId(null);
  }

  function toggleRow(txnId: string) {
    setEditingId(prev => (prev === txnId ? null : txnId));
    setConfirmDeleteId(null);
  }

  const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: tz });

  return (
    <div>
      <PageHeader title={monthLabel(month)} accessory={<MonthSwitcher month={month} onChange={setMonth} />} />

      <main className="max-w-xl mx-auto px-4 py-4">
        {loading ? (
          <p className="text-center text-faint py-10">Loading…</p>
        ) : transactions.length === 0 ? (
          <div className="text-center py-14 px-6">
            <p className="font-display text-xl mb-1">Nothing yet</p>
            <p className="text-sm text-faint">Charges land here on their own once email forwarding is set up — or add one below.</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-line divide-y divide-line overflow-hidden">
            {transactions.map(txn => (
              <div key={txn.id} className="px-4 py-3 cursor-pointer" onClick={() => toggleRow(txn.id)}>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{txn.merchant_raw}</div>
                    <div className="text-xs text-faint mt-0.5">
                      {dateFmt.format(new Date(txn.occurred_at))}
                      {txn.account_last4 && <> · ••{txn.account_last4}</>}
                      {txn.kind === 'refund' && <> · refund</>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span
                      className={`text-xs px-2.5 py-1 rounded-full border ${
                        txn.category_id ? 'border-line bg-paper text-faint' : 'border-brand/40 bg-brand/5 text-brand'
                      }`}>
                      {txn.categories?.name ?? 'Categorize'}
                    </span>
                    <span className={`amount font-semibold ${txn.amount_cents < 0 ? 'text-under' : ''}`}>
                      {formatCents(txn.amount_cents)}
                    </span>
                  </div>
                </div>
                {editingId === txn.id && (
                  <div className="flex flex-wrap gap-1.5 mt-2.5" onClick={e => e.stopPropagation()}>
                    <button onClick={() => updateCategory(txn.id, '')}
                      className={`text-xs px-2.5 py-1.5 rounded-full border ${!txn.category_id ? 'border-ink bg-ink text-white' : 'border-line bg-white text-faint'}`}>
                      None
                    </button>
                    {categories.map(c => (
                      <button key={c.id} onClick={() => updateCategory(txn.id, c.id)}
                        className={`text-xs px-2.5 py-1.5 rounded-full border ${txn.category_id === c.id ? 'border-ink bg-ink text-white' : 'border-line bg-white'}`}>
                        {c.name}
                      </button>
                    ))}
                    <button
                      onClick={() => (confirmDeleteId === txn.id ? deleteTxn(txn.id) : setConfirmDeleteId(txn.id))}
                      className={`text-xs px-2.5 py-1.5 rounded-full border ml-auto ${
                        confirmDeleteId === txn.id ? 'border-over bg-over text-white' : 'border-over/40 bg-white text-over'
                      }`}>
                      {confirmDeleteId === txn.id ? 'Tap again to delete' : 'Delete'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <button onClick={() => setShowAdd(true)}
          className="mt-4 w-full rounded-2xl border border-dashed border-faint/40 text-faint py-3 font-medium active:bg-white">
          + Add by hand
        </button>
      </main>

      {showAdd && (
        <AddTransaction
          categories={categories}
          onClose={() => setShowAdd(false)}
          onSave={() => { setShowAdd(false); load(); }}
        />
      )}
    </div>
  );
}
