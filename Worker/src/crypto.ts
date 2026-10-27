// Sealed-box encryption for user data (E2EE): X25519 ephemeral ECDH →
// HKDF-SHA256 → AES-256-GCM. The Worker seals parsed rows to the user's
// public key before they touch Supabase; only the user's device (which holds
// the private key derived from their 12-word recovery phrase) can open them.
//
// The PWA imports this file via a relative path so both sides share one
// implementation — keep it free of Worker- or DOM-specific APIs.

import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

const INFO_PREFIX = 'tally-e2ee-v1';

export interface TxPayload {
  merchant: string;
  amountCents: number;
  kind: 'purchase' | 'refund';
  accountLast4: string | null;
}

export interface ReviewPayload {
  sender: string;
  subject: string;
  excerpt: string;
}

export function toB64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// The 12-word phrase's 128-bit entropy is the root secret; hashing it gives
// the 32-byte X25519 private key, so the same words always rebuild the same
// keypair on any device.
export function deriveKeypair(entropy: Uint8Array): { privateKey: Uint8Array; publicKeyB64: string } {
  const privateKey = sha256(entropy);
  return { privateKey, publicKeyB64: toB64(x25519.getPublicKey(privateKey)) };
}

// Binding the ephemeral and recipient public keys into the KDF info ties the
// AES key to this exact (sender, recipient) pair.
async function aesKey(shared: Uint8Array, epk: Uint8Array, recipient: Uint8Array): Promise<CryptoKey> {
  const info = new Uint8Array(INFO_PREFIX.length + epk.length + recipient.length);
  info.set(new TextEncoder().encode(INFO_PREFIX));
  info.set(epk, INFO_PREFIX.length);
  info.set(recipient, INFO_PREFIX.length + epk.length);
  const keyBytes = hkdf(sha256, shared, undefined, info, 32);
  return crypto.subtle.importKey('raw', keyBytes as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function seal(recipientPubB64: string, payload: unknown): Promise<string> {
  const recipient = fromB64(recipientPubB64);
  const ephPriv = x25519.utils.randomSecretKey();
  const epk = x25519.getPublicKey(ephPriv);
  const key = await aesKey(x25519.getSharedSecret(ephPriv, recipient), epk, recipient);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  return btoa(JSON.stringify({ v: 1, epk: toB64(epk), iv: toB64(iv), ct: toB64(new Uint8Array(ct)) }));
}

export async function open<T>(privateKey: Uint8Array, blob: string): Promise<T> {
  const { v, epk, iv, ct } = JSON.parse(atob(blob)) as { v: number; epk: string; iv: string; ct: string };
  if (v !== 1) throw new Error(`unsupported ciphertext version ${v}`);
  const epkBytes = fromB64(epk);
  const recipient = x25519.getPublicKey(privateKey);
  const key = await aesKey(x25519.getSharedSecret(privateKey, epkBytes), epkBytes, recipient);
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(iv) as BufferSource },
    key,
    fromB64(ct) as BufferSource,
  );
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}
