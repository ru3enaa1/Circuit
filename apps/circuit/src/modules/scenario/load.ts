import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { SourceDocument } from '../circuit/index.ts';

/**
 * Loads what circuit needs from a scenario package, scenarios/<id>/ (CLAUDE.md §3, rule 4;
 * ADR-0009): the documents station 4 cites and the raw simulator.json, which the model module
 * checks. The code names no scenario: CIRCUIT_SCENARIO chooses it.
 */

/** The same shape as a CRM slug and as ADR-0009's scenario ids, so it is never a path. */
export const SCENARIO_ID_PATTERN = /^[a-z0-9-]{1,40}$/;
const DOCUMENT_FILE = /^([a-z0-9-]{1,40})\.md$/;
const TITLE_LINE = /^# (.+)$/m;
/** A document longer than this is not a program summary; the model would get it whole. */
export const DOCUMENT_MAX_LENGTH = 20_000;

export interface ScenarioPackage {
  readonly id: string;
  readonly documents: readonly SourceDocument[];
  /** simulator.json as parsed JSON, not yet checked. */
  readonly simulator: unknown;
}

export class InvalidScenario extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidScenario';
  }
}

export function loadScenario(scenariosDir: string, id: string): ScenarioPackage {
  if (!SCENARIO_ID_PATTERN.test(id)) throw new InvalidScenario('CIRCUIT_SCENARIO debe ser de 1 a 40 minúsculas, dígitos o «-».');
  const root = join(scenariosDir, id);
  return { id, documents: readDocuments(join(root, 'documents')), simulator: readJson(join(root, 'simulator.json'), 'simulator.json') };
}

/** Every .md of the folder, in name order: the id is the file name, the title its first heading. */
function readDocuments(dir: string): SourceDocument[] {
  const names = readdirSync(dir).filter((name) => name.endsWith('.md')).sort();
  if (names.length === 0) throw new InvalidScenario('El paquete no trae documentos en documents/.');
  return names.map((name) => {
    const id = DOCUMENT_FILE.exec(name)?.[1];
    if (id === undefined) throw new InvalidScenario(`El documento «${name}» no tiene un nombre de 1 a 40 minúsculas, dígitos o «-».`);
    const text = readFileSync(join(dir, name), 'utf8');
    const title = TITLE_LINE.exec(text)?.[1]?.trim();
    if (title === undefined || text.length > DOCUMENT_MAX_LENGTH) throw new InvalidScenario(`El documento «${name}» no tiene título o es demasiado largo.`);
    return { id, title, text };
  });
}

function readJson(path: string, label: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    // The parser's message quotes the file; the name is enough to find it.
    throw new InvalidScenario(`No se pudo leer ${label} del paquete.`);
  }
}
