import { describe, expect, it } from 'vitest';

import { CATALOG, STATION_NAMES, textOf, type CatalogText } from '../src/texts.ts';

// ADR-0011 B9: every text of the interface says its tone and its audience, and whatever reaches
// a participant or the CRM is serious. The type refuses the rest; the test walks the catalog.

const TONES = ['juego', 'serio'];
const AUDIENCES = ['interfaz', 'participante', 'crm'];

describe('B9 · the catalog of texts', () => {
  const entries = CATALOG.flatMap((group) => Object.values(group));

  it('is not empty, and every entry has a text, a tone and an audience', () => {
    expect(entries.length).toBeGreaterThan(50);
    for (const entry of entries) {
      expect(entry.text.length, JSON.stringify(entry)).toBeGreaterThan(0);
      expect(TONES).toContain(entry.tone);
      expect(AUDIENCES).toContain(entry.audience);
    }
  });

  it('a text for anyone but the interface is serious', () => {
    for (const entry of entries.filter((item) => item.audience !== 'interfaz')) expect(entry.tone).toBe('serio');
  });

  it('play appears only in the interface, and only in a few places (the idle state)', () => {
    const play = entries.filter((entry) => entry.tone === 'juego');

    expect(play.length).toBeGreaterThan(0);
    expect(play.every((entry) => entry.audience === 'interfaz')).toBe(true);
  });

  it('the type refuses a play text for the CRM or a participant', () => {
    // @ts-expect-error: a text the CRM receives is serious (B9).
    const forCrm: CatalogText = { text: 'x', tone: 'juego', audience: 'crm' };
    // @ts-expect-error: a text a participant receives is serious (B9).
    const forParticipant: CatalogText = { text: 'x', tone: 'juego', audience: 'participante' };
    const serious: CatalogText = { text: 'x', tone: 'serio', audience: 'crm' };

    expect([forCrm, forParticipant, serious]).toHaveLength(3);
  });

  it('names the seven stations, and shows an unknown key as it came', () => {
    expect(Object.keys(STATION_NAMES)).toEqual(['intake', 'filter', 'classification', 'knowledge', 'crm', 'person', 'close']);
    expect(textOf(STATION_NAMES, 'otra')).toBe('otra');
  });
});
