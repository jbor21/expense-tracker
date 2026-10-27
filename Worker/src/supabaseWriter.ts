import type { ParsedCharge } from './parsing/types';
import { seal, type ReviewPayload, type TxPayload } from './crypto';

export interface SupabaseEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

function svcHeaders(env: SupabaseEnv): Record<string, string> {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function must(res: Response, what: string): Promise<Response> {
  if (!res.ok) throw new Error(`${what} failed: ${res.status} ${await res.text()}`);
  return res;
}

export interface Profile {
  id: string;
  email: string;
  // Base64 X25519 public key; null until the user's device creates one. When
  // present, all sensitive fields are sealed to it before insert.
  public_key: string | null;
}

export async function lookupProfileByAddress(
  env: SupabaseEnv, address: string,
): Promise<Profile | null> {
  const url = `${env.SUPABASE_URL}/rest/v1/profiles?select=id,email,public_key&forward_address=eq.${encodeURIComponent(address)}`;
  const rows = await (await must(await fetch(url, { headers: svcHeaders(env) }), 'profile lookup')).json() as Profile[];
  return rows[0] ?? null;
}

export async function insertTransactions(
  env: SupabaseEnv, userId: string, messageId: string, charges: ParsedCharge[],
  publicKey: string | null,
): Promise<void> {
  if (charges.length === 0) return;
  const url = `${env.SUPABASE_URL}/rest/v1/transactions?on_conflict=${encodeURIComponent('user_id,message_id,line_idx')}`;
  await must(await fetch(url, {
    method: 'POST',
    headers: { ...svcHeaders(env), Prefer: 'resolution=ignore-duplicates' },
    body: JSON.stringify(await Promise.all(charges.map(async (c, i) => {
      const shared = {
        user_id: userId,
        occurred_at: c.occurredAt.toISOString(),
        message_id: messageId,
        line_idx: i,
      };
      if (publicKey) {
        const payload: TxPayload = {
          merchant: c.merchantRaw,
          amountCents: c.amountCents,
          kind: c.kind,
          accountLast4: c.accountLast4,
        };
        return { ...shared, payload_enc: await seal(publicKey, payload) };
      }
      // Profile has no key yet (user hasn't opened the app since E2EE
      // shipped) — plaintext as before; the client encrypts these rows the
      // next time they log in.
      return {
        ...shared,
        amount_cents: c.amountCents,
        kind: c.kind,
        merchant_raw: c.merchantRaw,
        account_last4: c.accountLast4,
      };
    }))),
  }), 'transactions insert');
}

export async function insertReviewRow(
  env: SupabaseEnv, userId: string,
  row: { sender: string; subject: string; excerpt: string; receivedAt: Date },
  publicKey: string | null,
): Promise<void> {
  const shared = { user_id: userId, received_at: row.receivedAt.toISOString() };
  const payload: ReviewPayload = { sender: row.sender, subject: row.subject, excerpt: row.excerpt };
  const body = publicKey
    ? { ...shared, payload_enc: await seal(publicKey, payload) }
    : { ...shared, sender: row.sender, subject: row.subject, excerpt: row.excerpt };
  await must(await fetch(`${env.SUPABASE_URL}/rest/v1/review_queue`, {
    method: 'POST',
    headers: svcHeaders(env),
    body: JSON.stringify(body),
  }), 'review insert');
}

/** The caller's current forwarding address, or null if they have none yet. */
export async function getForwardAddress(
  env: SupabaseEnv, userId: string,
): Promise<string | null> {
  const url = `${env.SUPABASE_URL}/rest/v1/profiles?select=forward_address&id=eq.${encodeURIComponent(userId)}`;
  const rows = await (await must(await fetch(url, { headers: svcHeaders(env) }), 'forward_address lookup')).json() as { forward_address: string | null }[];
  return rows[0]?.forward_address ?? null;
}

export async function setForwardAddress(
  env: SupabaseEnv, userId: string, address: string,
): Promise<void> {
  await must(await fetch(`${env.SUPABASE_URL}/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: svcHeaders(env),
    body: JSON.stringify({ forward_address: address }),
  }), 'set forward_address');
}

export async function getUserFromJwt(
  env: SupabaseEnv, jwt: string,
): Promise<{ id: string } | null> {
  const res = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${jwt}` },
  });
  if (!res.ok) return null;
  const user = await res.json() as { id?: string };
  return user.id ? { id: user.id } : null;
}
