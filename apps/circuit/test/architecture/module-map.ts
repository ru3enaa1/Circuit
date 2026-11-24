/**
 * The modules of apps/circuit and what each one may import (ADR-0003). The architecture test
 * reads this map, so changing a dependency means changing this file, where the diff shows it.
 *
 * Direction: the core declares the ports it needs (model, CRM, clock) and imports nobody;
 * adapters depend on the core, never the reverse (ADR-0001 D2, ADR-0003 M2).
 */

export const MODULE_NAMES = ['circuit', 'model', 'crm-client', 'approval', 'scenario'] as const;

export type ModuleName = (typeof MODULE_NAMES)[number];

export interface ModuleRule {
  /** Other modules it may import, always through their index.ts (ADR-0003 M1). */
  readonly modules: readonly ModuleName[];
  /** npm packages and Node built-ins (`node:fs`) it may import. Empty means none. */
  readonly packages: readonly string[];
}

export const MODULE_RULES: Readonly<Record<ModuleName, ModuleRule>> = {
  // The core orders the stations. No framework, no I/O, no SDK: that keeps it deterministic
  // and testable with the simulator alone.
  circuit: { modules: [], packages: [] },
  // Implements the core's model port: the simulator, and in F3 the Anthropic adapter.
  model: { modules: ['circuit'], packages: [] },
  // Implements the core's CRM port over HTTP, with the agent's key (ADR-0003 M3).
  'crm-client': { modules: ['circuit'], packages: [] },
  // Station 6: the mentor approves, corrects or rejects what station 5 proposed.
  approval: { modules: ['circuit'], packages: [] },
  // Loads the scenario package (synthetic data and documents) from scenarios/.
  scenario: { modules: ['circuit'], packages: [] },
};

/**
 * Packages that only one module may import, wherever the importing file lives. The model SDK
 * stays inside `model` even for the composition root (ADR-0001 D2).
 */
export const PACKAGE_OWNERS: Readonly<Record<string, ModuleName>> = {
  '@anthropic-ai/sdk': 'model',
};

/** The CRM simulator's workspace: apps/circuit reaches it only over HTTP (ADR-0003 M3). */
export const CRM_PACKAGE = '@circuit/crm';
