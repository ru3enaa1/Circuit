import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { InvalidScenario, SCENARIO_ID_PATTERN } from './load.ts';

/**
 * What the board offers under «Probar una solicitud» (docs/diseno.md §8, ADR-0012 A12): the
 * scenario's sample requests, which are the simulator's cases, and the CRM account the agent's key
 * works in. Both are data of the package (CLAUDE.md §3, rule 4); the code names neither.
 */

/** The same shape as a simulator case name, so a sample and its reply share an id. */
export const SAMPLE_ID_PATTERN = /^[a-z0-9-]{1,40}$/;
const LABEL_MAX_LENGTH = 60;
/** The core's MAX_INPUT_LENGTH: a longer sample would fail at station 1. */
const SAMPLE_TEXT_MAX_LENGTH = 4000;
/** A list a person reads at a glance, under one button. */
const MAX_SAMPLES = 10;

export interface Sample {
  readonly id: string;
  /** Interface text, in Spanish: what the request is about, never who wrote it. */
  readonly label: string;
  /** The raw text, as a person would send it. It never leaves the server (A12). */
  readonly text: string;
}

export interface Tryouts {
  /** The account of crm.json the agent's key belongs to (ADR-0009 D22). */
  readonly agentAccount: string;
  readonly samples: readonly Sample[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

function readJson(path: string, label: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    // The parser's message quotes the file; the name is enough to find it.
    throw new InvalidScenario(`No se pudo leer ${label} del paquete.`);
  }
}

function sampleOf(value: unknown, index: number, seen: Set<string>): Sample {
  const where = `samples.json, muestra ${index + 1}`;
  if (!isRecord(value) || Object.keys(value).some((key) => key !== 'id' && key !== 'label' && key !== 'text')) throw new InvalidScenario(`${where}: campos de más o de menos.`);
  const { id, label, text } = value;
  if (typeof id !== 'string' || !SAMPLE_ID_PATTERN.test(id) || seen.has(id)) throw new InvalidScenario(`${where}: el id no es válido o se repite.`);
  if (typeof label !== 'string' || label.trim() === '' || label.length > LABEL_MAX_LENGTH) throw new InvalidScenario(`${where}: el rótulo no es válido.`);
  if (typeof text !== 'string' || text.trim() === '' || text.length > SAMPLE_TEXT_MAX_LENGTH) throw new InvalidScenario(`${where}: el texto no es válido.`);
  seen.add(id);
  return Object.freeze({ id, label, text });
}

export function loadTryouts(scenariosDir: string, id: string): Tryouts {
  if (!SCENARIO_ID_PATTERN.test(id)) throw new InvalidScenario('CIRCUIT_SCENARIO debe ser de 1 a 40 minúsculas, dígitos o «-».');
  const root = join(scenariosDir, id);
  const crm = readJson(join(root, 'crm.json'), 'crm.json');
  const agentAccount = isRecord(crm) ? crm['agentAccount'] : undefined;
  if (typeof agentAccount !== 'string' || !SCENARIO_ID_PATTERN.test(agentAccount)) throw new InvalidScenario('crm.json no nombra la cuenta del agente.');
  const file = readJson(join(root, 'samples.json'), 'samples.json');
  const list = isRecord(file) && Object.keys(file).length === 1 ? file['samples'] : undefined;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_SAMPLES) throw new InvalidScenario(`samples.json debe traer de 1 a ${MAX_SAMPLES} muestras.`);
  const seen = new Set<string>();
  return Object.freeze({ agentAccount, samples: Object.freeze(list.map((entry: unknown, index) => sampleOf(entry, index, seen))) });
}
