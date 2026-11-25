import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { API_KEY_SHAPE, generateApiKey, hashApiKey } from '../src/keys.ts';

// ADR-0008 D1 and D3: what a key is. The generated keys are checked against an encoding
// written here, not against API_KEY_SHAPE alone, so a shape and a generator that drift
// together still fail.

const GENERATED = 1000;
const PREFIX = 'crmk_';
const SECRET_BYTES = 32;

/** The prefix, then the base64url of exactly 32 bytes, and that encoding is the only one (RFC 4648 §5). */
function isCanonical(key: string): boolean {
  if (!key.startsWith(PREFIX)) return false;
  const tail = key.slice(PREFIX.length);
  const bytes = Buffer.from(tail, 'base64url');
  return bytes.length === SECRET_BYTES && bytes.toString('base64url') === tail;
}

/** A key built from fixed bytes, the way the generator encodes its random ones. */
const keyOf = (bytes: Buffer): string => `${PREFIX}${bytes.toString('base64url')}`;

describe('D1 · a key is crmk_ and 32 random bytes in base64url', () => {
  const keys = Array.from({ length: GENERATED }, () => generateApiKey());

  it('1000 generated keys have the shape, and no two are equal', () => {
    expect(keys.filter((key) => !API_KEY_SHAPE.test(key))).toEqual([]);
    expect(new Set(keys).size).toBe(GENERATED);
  });

  it('each one is the prefix and the canonical encoding of 32 bytes', () => {
    expect(keys.filter((key) => !isCanonical(key))).toEqual([]);
  });

  it('the shape takes the encoding of any 32 bytes (control)', () => {
    const edges = [Buffer.alloc(SECRET_BYTES, 0x00), Buffer.alloc(SECRET_BYTES, 0xff), Buffer.alloc(SECRET_BYTES, 0xfb)];
    expect(edges.map((bytes) => API_KEY_SHAPE.test(keyOf(bytes)))).toEqual([true, true, true]);
  });

  it('the shape refuses what is not that encoding', () => {
    const tail = keyOf(Buffer.alloc(SECRET_BYTES, 0x5a)).slice(PREFIX.length);
    const nearMisses = [
      `CRMK_${tail}`,
      tail,
      `crm_${tail}`,
      `${PREFIX}${tail.slice(0, 42)}`,
      `${PREFIX}${tail}A`,
      `${PREFIX}${tail}=`,
      `${PREFIX}+${tail.slice(1)}`,
      `${PREFIX}/${tail.slice(1)}`,
      // 43 characters carry 258 bits: the last one of 32 bytes leaves its two low bits at zero.
      `${PREFIX}${tail.slice(0, 42)}B`,
      `${PREFIX}${tail}\n`,
      ` ${PREFIX}${tail}`,
      keyOf(Buffer.alloc(16, 0x5a)),
    ];
    expect(nearMisses.filter((key) => API_KEY_SHAPE.test(key))).toEqual([]);
  });
});

describe('D3 · the hash of a key', () => {
  it('is the SHA-256 of the key, 32 bytes', () => {
    const key = generateApiKey();
    const hash = hashApiKey(key);
    expect(hash.length).toBe(32);
    expect(hash.equals(createHash('sha256').update(Buffer.from(key, 'utf8')).digest())).toBe(true);
  });

  it('reads the key as UTF-8, not as Latin-1', () => {
    // «ñ» is c3 b1 in UTF-8 and f1 in Latin-1, so the two hashes differ.
    expect(hashApiKey('ñ').equals(createHash('sha256').update(Buffer.from([0xc3, 0xb1])).digest())).toBe(true);
  });
});
