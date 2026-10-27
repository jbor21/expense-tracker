import { generateMnemonic, mnemonicToEntropy, entropyToMnemonic, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { deriveKeypair } from '../../../Worker/src/crypto';

export function newRecovery(): { phrase: string; entropy: Uint8Array } {
  const phrase = generateMnemonic(wordlist, 128);
  const entropy = mnemonicToEntropy(phrase, wordlist);
  return { phrase, entropy };
}

export function keysFromPhrase(phrase: string): { entropy: Uint8Array; privateKey: Uint8Array; publicKeyB64: string } | null {
  const normalized = phrase.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!validateMnemonic(normalized, wordlist)) {
    return null;
  }
  const entropy = mnemonicToEntropy(normalized, wordlist);
  const { privateKey, publicKeyB64 } = deriveKeypair(entropy);
  return { entropy, privateKey, publicKeyB64 };
}

export function storeEntropy(entropy: Uint8Array): void {
  const hex = Array.from(entropy).map(b => b.toString(16).padStart(2, '0')).join('');
  localStorage.setItem('tally-entropy', hex);
}

export function loadKeys(): { entropy: Uint8Array; privateKey: Uint8Array; publicKeyB64: string; phrase: string } | null {
  const hex = localStorage.getItem('tally-entropy');
  if (!hex || hex.length !== 32) return null;
  const entropy = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    entropy[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  const { privateKey, publicKeyB64 } = deriveKeypair(entropy);
  const phrase = entropyToMnemonic(entropy, wordlist);
  return { entropy, privateKey, publicKeyB64, phrase };
}

export function clearKeys(): void {
  localStorage.removeItem('tally-entropy');
}
