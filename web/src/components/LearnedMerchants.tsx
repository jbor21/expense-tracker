import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export default function LearnedMerchants({ categories }: { categories: { id: string; name: string; archived?: boolean }[] }) {
  const [rows, setRows] = useState<{ id: string; normalized_merchant: string; category_id: string }[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('merchant_memory')
      .select('id, normalized_merchant, category_id')
      .order('normalized_merchant');
    setRows(data || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function onCategoryChange(id: string, categoryId: string) {
    await supabase.from('merchant_memory').update({ category_id: categoryId }).eq('id', id);
    setRows(prev => prev.map(r => (r.id === id ? { ...r, category_id: categoryId } : r)));
  }

  async function onForget(id: string) {
    await supabase.from('merchant_memory').delete().eq('id', id);
    setRows(prev => prev.filter(r => r.id !== id));
  }

  const activeCategories = categories.filter(c => !c.archived);

  return (
    <div>
      <p className="text-sm text-faint mb-3">
        Places Tally will categorize automatically. Changing here affects future charges only.
      </p>
      {loading ? (
        <p className="text-sm text-faint">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-faint">
          Nothing learned yet. On Activity, pick a category for a charge — future charges from that place will match.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map(row => (
            <li key={row.id} className="flex items-center gap-2">
              <span className="flex-1 min-w-0 text-sm font-medium truncate" title={row.normalized_merchant}>
                {row.normalized_merchant}
              </span>
              <select
                value={row.category_id}
                onChange={e => onCategoryChange(row.id, e.target.value)}
                className="border border-line rounded-xl px-2 py-1.5 bg-paper text-sm max-w-[42%] outline-none focus:border-brand">
                {activeCategories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => onForget(row.id)}
                className="text-xs px-2 py-1.5 rounded-xl border border-line text-faint shrink-0">
                Forget
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}