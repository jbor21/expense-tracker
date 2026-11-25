import { supabase } from './supabase';
import { normalizeMerchant } from './categorizer';

export type MerchantMemoryRow = {
  id: string;
  normalized_merchant: string;
  category_id: string;
};

export async function fetchMerchantMemoryMap(): Promise<Map<string, string>> {
  const { data } = await supabase.from('merchant_memory').select('normalized_merchant, category_id');
  const map = new Map<string, string>();
  for (const row of data || []) {
    map.set(row.normalized_merchant, row.category_id);
  }
  return map;
}

/** Persist or update learned category for this merchant (future charges). */
export async function learnMerchantCategory(
  merchantRaw: string,
  categoryId: string,
  userId: string,
): Promise<void> {
  const key = normalizeMerchant(merchantRaw);
  if (!key) return;
  await supabase.from('merchant_memory').upsert(
    { user_id: userId, normalized_merchant: key, category_id: categoryId },
    { onConflict: 'user_id,normalized_merchant' },
  );
}

export async function forgetMerchantMemory(id: string): Promise<void> {
  await supabase.from('merchant_memory').delete().eq('id', id);
}

export async function updateMemoryCategory(id: string, categoryId: string): Promise<void> {
  await supabase.from('merchant_memory').update({ category_id: categoryId }).eq('id', id);
}

type TxRow = { id: string; merchant_raw?: string; category_id: string | null };

/** Set category_id on uncategorized rows when memory matches (client-side, post-decrypt). */
export async function applyLearnedCategories<T extends TxRow>(rows: T[]): Promise<T[]> {
  const pending = rows.filter(r => !r.category_id && r.merchant_raw?.trim());
  if (pending.length === 0) return rows;

  const memory = await fetchMerchantMemoryMap();
  if (memory.size === 0) return rows;

  const patches: { id: string; category_id: string }[] = [];
  for (const row of pending) {
    const key = normalizeMerchant(row.merchant_raw!);
    const categoryId = memory.get(key);
    if (categoryId) patches.push({ id: row.id, category_id: categoryId });
  }
  if (patches.length === 0) return rows;

  await Promise.all(
    patches.map(p => supabase.from('transactions').update({ category_id: p.category_id }).eq('id', p.id)),
  );

  const byId = new Map(patches.map(p => [p.id, p.category_id]));
  return rows.map(r => (byId.has(r.id) ? { ...r, category_id: byId.get(r.id)! } : r));
}

export function isAutoCategorized(
  merchantRaw: string | undefined,
  categoryId: string | null | undefined,
  memory: Map<string, string>,
): boolean {
  if (!merchantRaw || !categoryId) return false;
  return memory.get(normalizeMerchant(merchantRaw)) === categoryId;
}