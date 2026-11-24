import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const LOCAL_ENV_FILE = fileURLToPath(new URL('../.env', import.meta.url));

// A file saved by Windows PowerShell 5.1 starts with a BOM, which would otherwise become
// part of the first variable's name.
const BYTE_ORDER_MARK = /^﻿/;

export type Env = Readonly<Record<string, string | undefined>>;

/**
 * The environment for local tooling: the git-ignored `.env` at the repository root, with
 * the process environment taking precedence (CI copies `.env.example` and passes the password
 * it generates for the run through the environment).
 * Nothing is written to `process.env`, so one caller cannot change what another one reads.
 * The parameters exist for the tests; callers use the defaults.
 */
export function readLocalEnv(envFile: string = LOCAL_ENV_FILE, processEnv: Env = process.env): Env {
  const fromFile = existsSync(envFile)
    ? parseEnv(readFileSync(envFile, 'utf8').replace(BYTE_ORDER_MARK, ''))
    : {};
  return { ...fromFile, ...processEnv };
}
