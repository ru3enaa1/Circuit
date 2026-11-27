/**
 * The CRM's tools as the agent's key sees them (ADR-0011 B8): a list of data that the board
 * paints as it gets it, so the board never keeps its own. Each one is an action of the core's
 * closed list (actions.ts), plus the one read station 5 does; there is no delete, no archive and
 * no export, which the CRM refuses to the agent's key anyway (ADR-0008 D10–D13).
 */

export type ToolAccess = 'read' | 'write';

export interface CrmTool {
  readonly name: string;
  /** Interface text, in Spanish. */
  readonly label: string;
  readonly access: ToolAccess;
}

export const CRM_TOOLS: readonly CrmTool[] = Object.freeze(
  [
    { name: 'find_contact', label: 'Buscar contacto', access: 'read' },
    { name: 'create_contact', label: 'Crear contacto', access: 'write' },
    { name: 'update_contact', label: 'Actualizar contacto', access: 'write' },
    { name: 'add_note', label: 'Anotar', access: 'write' },
    { name: 'create_task', label: 'Crear tarea', access: 'write' },
    { name: 'move_stage', label: 'Mover de etapa', access: 'write' },
  ].map((tool) => Object.freeze(tool as CrmTool)),
);
