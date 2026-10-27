import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { newRecovery, keysFromPhrase, storeEntropy, loadKeys, clearKeys } from './keys';
import { deriveKeypair } from '../../../Worker/src/crypto';

describe('keys', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) || null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('newRecovery gives 12 words', () => {
    const { phrase } = newRecovery();
    expect(phrase.split(' ').length).toBe(12);
  });

  it('keysFromPhrase roundtrips', () => {
    const { phrase, entropy } = newRecovery();
    const keys = keysFromPhrase(phrase);
    expect(keys).not.toBeNull();
    expect(keys!.entropy).toEqual(entropy);
    
    const { publicKeyB64 } = deriveKeypair(entropy);
    expect(keys!.publicKeyB64).toBe(publicKeyB64);
  });

  it('keysFromPhrase normalizes input', () => {
    const { phrase, entropy } = newRecovery();
    const messy = `  ${phrase.toUpperCase().replace(/ /g, '  ')}  `;
    const keys = keysFromPhrase(messy);
    expect(keys).not.toBeNull();
    expect(keys!.entropy).toEqual(entropy);
  });

  it('keysFromPhrase handles invalid phrase', () => {
    const invalid = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon';
    expect(keysFromPhrase(invalid)).toBeNull();
    expect(keysFromPhrase('not twelve words')).toBeNull();
  });

  it('store and load keys', () => {
    expect(loadKeys()).toBeNull();
    const { phrase, entropy } = newRecovery();
    storeEntropy(entropy);
    const loaded = loadKeys();
    expect(loaded).not.toBeNull();
    expect(loaded!.phrase).toBe(phrase);
    expect(loaded!.entropy).toEqual(entropy);
    
    clearKeys();
    expect(loadKeys()).toBeNull();
  });
});
