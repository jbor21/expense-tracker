import { supabase } from './supabase';
import { loadKeys } from './keys';
import { seal } from '../../../Worker/src/crypto';
import type { TxPayload, ReviewPayload } from '../../../Worker/src/crypto';

export async function migrateHistory(onProgress?: (done: number, total: number) => void): Promise<void> {
  const keys = loadKeys();
  if (!keys) throw new Error('No keys available for migration');

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('No user');

  const { data: txns } = await supabase
    .from('transactions')
    .select('id,amount_cents,kind,merchant_raw,account_last4')
    .is('payload_enc', null)
    .not('merchant_raw', 'is', null)
    .not('amount_cents', 'is', null)
    .not('kind', 'is', null);

  const { data: budgets } = await supabase
    .from('budgets')
    .select('id,amount_cents')
    .is('payload_enc', null)
    .not('amount_cents', 'is', null);

  const { data: reviews } = await supabase
    .from('review_queue')
    .select('id,sender,subject,excerpt')
    .is('payload_enc', null)
    .not('sender', 'is', null)
    .not('subject', 'is', null)
    .not('excerpt', 'is', null);

  const txRows = txns || [];
  const budgetRows = budgets || [];
  const reviewRows = reviews || [];
  const total = txRows.length + budgetRows.length + reviewRows.length;
  let done = 0;

  for (const row of txRows) {
    const payload: TxPayload = {
      merchant: row.merchant_raw,
      amountCents: row.amount_cents,
      kind: row.kind,
      accountLast4: row.account_last4,
    };
    const payload_enc = await seal(keys.publicKeyB64, payload);
    await supabase
      .from('transactions')
      .update({
        payload_enc,
        amount_cents: null,
        kind: null,
        merchant_raw: null,
        account_last4: null,
      })
      .eq('id', row.id);
    
    done++;
    if (onProgress) onProgress(done, total);
  }

  for (const row of budgetRows) {
    const payload_enc = await seal(keys.publicKeyB64, { amountCents: row.amount_cents });
    await supabase
      .from('budgets')
      .update({ payload_enc, amount_cents: null })
      .eq('id', row.id);

    done++;
    if (onProgress) onProgress(done, total);
  }

  for (const row of reviewRows) {
    const payload: ReviewPayload = {
      sender: row.sender,
      subject: row.subject,
      excerpt: row.excerpt,
    };
    const payload_enc = await seal(keys.publicKeyB64, payload);
    await supabase
      .from('review_queue')
      .update({
        payload_enc,
        sender: null,
        subject: null,
        excerpt: null,
      })
      .eq('id', row.id);
    
    done++;
    if (onProgress) onProgress(done, total);
  }
}
