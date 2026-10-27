import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { monthKey, monthRange, monthLabel } from '../lib/months';
import { formatCents, centsFromInput } from '../lib/money';
import MonthSwitcher from '../components/MonthSwitcher';
import PageHeader from '../components/PageHeader';
import TallyMeter from '../components/TallyMeter';
import SetupNudge from '../components/SetupNudge';
import { decryptTxRows, decryptBudgetRows, sealBudgetPayload } from '../lib/txcrypto';
import { effectiveBudgets } from '../lib/budgets';

export default function Budget() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [month, setMonth] = useState(() => monthKey(new Date(), tz));
  const [categories, setCategories] = useState<any[]>([]);
  const [budgets, setBudgets] = useState<any[]>([]);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingCatId, setEditingCatId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState('');

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { startISO, endISO } = monthRange(month, tz);
      const [{ data: cats }, { data: buds }, { data: txns }] = await Promise.all([
        supabase.from('categories').select('id,name').eq('archived', false).order('name'),
        // every row up to this month — carry-forward resolves the winner client-side
        supabase.from('budgets').select('category_id,month,amount_cents,payload_enc').lte('month', `${month}-01`),
        supabase.from('transactions').select('category_id,amount_cents,payload_enc')
          .gte('occurred_at', startISO).lt('occurred_at', endISO),
      ]);
      setCategories(cats || []);
      setBudgets(await decryptBudgetRows(buds || []));
      setTransactions(await decryptTxRows(txns || []));
      setLoading(false);
    }
    load();
  }, [month, tz]);

  async function handleSaveBudget(categoryId: string) {
    const cents = centsFromInput(editAmount);
    if (cents === null) {
      setEditingCatId(null);
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const payload_enc = await sealBudgetPayload({ amountCents: cents });
    await supabase.from('budgets').upsert({
      user_id: user.id,
      category_id: categoryId,
      month: `${month}-01`,
      amount_cents: null,
      payload_enc
    }, { onConflict: 'user_id,category_id,month' });

    setBudgets(prev => {
      const idx = prev.findIndex(b => b.category_id === categoryId && b.month === `${month}-01`);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], amount_cents: cents };
        return next;
      }
      return [...prev, { category_id: categoryId, month: `${month}-01`, amount_cents: cents }];
    });
    setEditingCatId(null);
  }

  const effective = effectiveBudgets(budgets, month);
  const rows = categories.map(cat => {
    const eff = effective.get(cat.id);
    const budget = eff?.amountCents || 0;
    const spent = transactions.filter(t => t.category_id === cat.id).reduce((sum, t) => sum + t.amount_cents, 0);
    return {
      id: cat.id, name: cat.name, budget, spent,
      carriedFrom: eff?.carriedFrom ?? null,
      isOver: budget > 0 && spent > budget,
    };
  });

  const uncatSpent = transactions.filter(t => t.category_id === null).reduce((sum, t) => sum + t.amount_cents, 0);
  const totalSpent = rows.reduce((s, r) => s + r.spent, 0) + uncatSpent;
  const totalBudget = rows.reduce((s, r) => s + r.budget, 0);

  return (
    <div>
      <PageHeader title={monthLabel(month)} accessory={<MonthSwitcher month={month} onChange={setMonth} />} />

      <main className="max-w-xl mx-auto px-4 py-4 space-y-3">
        <SetupNudge />
        {loading ? (
          <p className="text-center text-faint py-10">Loading…</p>
        ) : (
          <>
            {totalBudget > 0 && (
              <p className="font-display text-lg px-1 pb-1 leading-snug">
                <span className="amount font-semibold">{formatCents(totalSpent)}</span> spent of{' '}
                <span className="amount font-semibold">{formatCents(totalBudget)}</span> —{' '}
                {totalSpent <= totalBudget ? (
                  <span className="text-under">{formatCents(totalBudget - totalSpent)} left</span>
                ) : (
                  <span className="text-over">{formatCents(totalSpent - totalBudget)} over</span>
                )}
              </p>
            )}

            {rows.map(row => (
              <div key={row.id}
                className="bg-white rounded-2xl border border-line px-4 py-3.5 active:bg-paper/60 transition-colors"
                onClick={() => { setEditingCatId(row.id); setEditAmount(row.budget ? (row.budget / 100).toString() : ''); }}>
                <div className="flex justify-between items-baseline mb-2">
                  <span className="font-semibold">{row.name}</span>
                  <span className="amount text-sm text-faint">
                    <span className={`font-semibold text-[15px] ${row.isOver ? 'text-over' : 'text-ink'}`}>{formatCents(row.spent)}</span>
                    {row.budget > 0 && <> / {formatCents(row.budget)}</>}
                  </span>
                </div>
                <TallyMeter spent={row.spent} budget={row.budget} />
                {row.carriedFrom && editingCatId !== row.id && (
                  <p className="text-xs text-faint mt-1.5">Carried from {monthLabel(row.carriedFrom)}</p>
                )}
                {editingCatId === row.id && (
                  <div className="mt-3 flex gap-2" onClick={e => e.stopPropagation()}>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="Monthly budget"
                      value={editAmount}
                      onChange={e => setEditAmount(e.target.value)}
                      className="border border-line rounded-xl px-3 py-2 flex-1 min-w-0 bg-paper outline-none focus:border-brand amount"
                      autoFocus
                    />
                    <button onClick={() => handleSaveBudget(row.id)} className="bg-brand text-white px-4 rounded-xl font-semibold">Save</button>
                    <button onClick={() => setEditingCatId(null)} className="px-3 rounded-xl border border-line bg-white font-medium text-faint">✕</button>
                  </div>
                )}
              </div>
            ))}

            {uncatSpent !== 0 && (
              <div className="bg-white rounded-2xl border border-line px-4 py-3.5">
                <div className="flex justify-between items-baseline">
                  <span className="font-semibold">Uncategorized</span>
                  <span className="amount font-semibold text-[15px]">{formatCents(uncatSpent)}</span>
                </div>
                <p className="text-xs text-faint mt-1">Assign these in Activity so they count against a budget.</p>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
