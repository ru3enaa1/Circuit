/**
 * Every text of the board's interface (ADR-0011 B9, docs/diseno.md §13). Each one says its tone
 * and who reads it. Play lives only at the edges of the interface (the idle state, the help);
 * whatever reaches a participant or the CRM is serious, and the type refuses anything else.
 */

export type Tone = 'juego' | 'serio';
export type Audience = 'interfaz' | 'participante' | 'crm';

export type CatalogText =
  | { readonly text: string; readonly tone: Tone; readonly audience: 'interfaz' }
  | { readonly text: string; readonly tone: 'serio'; readonly audience: 'participante' | 'crm' };

const serio = (text: string): CatalogText => ({ text, tone: 'serio', audience: 'interfaz' });
const juego = (text: string): CatalogText => ({ text, tone: 'juego', audience: 'interfaz' });

export const STATION_NAMES: Readonly<Record<string, CatalogText>> = {
  intake: serio('Entrada'),
  filter: serio('Filtro'),
  classification: serio('Clasificación'),
  knowledge: serio('Conocimiento'),
  crm: serio('CRM'),
  person: serio('Persona'),
  close: serio('Cierre'),
};

/** What a state says next to its bubble; the color never goes alone (§5). */
export const STATUS_TEXTS = {
  pending: serio('pendiente'),
  waiting: serio('en curso'),
  waitingPerson: serio('espera a la persona'),
  completed: serio('hecha'),
  skipped: serio('saltada'),
  stopped: serio('detenida'),
  stoppedInjection: serio('detenida · inyección'),
  failed: serio('falló'),
} as const satisfies Record<string, CatalogText>;

/** The small label under a station's name, from its event's outcome (§5). */
export const OUTCOME_TAGS: Readonly<Record<string, CatalogText>> = {
  no_source: serio('sin fuente'),
  complaint: serio('queja'),
  out_of_scope: serio('fuera de alcance'),
  low_confidence: serio('confianza baja'),
  approved: serio('aprobado'),
  corrected: serio('corregido'),
  rejected: serio('rechazado'),
};

/** Why a failed station failed, from its event's detail.reason. */
export const FAILURE_REASONS: Readonly<Record<string, CatalogText>> = {
  invalid: serio('respuesta inválida'),
  port_error: serio('sin respuesta'),
};

export const RUN_TEXTS = {
  brand: serio('Circuit'),
  request: serio('Solicitud N.º'),
  running: serio('en curso'),
  waitingPerson: serio('espera a la persona'),
  done: serio('terminada'),
  stopped: serio('detenida en Filtro'),
  failed: serio('falló'),
  branch: serio('queja, fuera de alcance o duda'),
  latestRuns: serio('Últimas corridas'),
  noRuns: serio('Sin corridas todavía.'),
  inProgress: serio('en curso'),
  waitingSince: serio('espera desde'),
  duration: serio('duración'),
  tokens: serio('tok'),
  simulator: serio('simulador'),
  unmeasured: serio('sin medida'),
  tools: serio('Herramientas del CRM'),
  stations: serio('Estaciones'),
  stopLabel: serio('alto por inyección'),
  stopTitle: serio('Detenido en Filtro'),
  stopDetail: serio('instrucción dentro del texto · registrado'),
  reads: serio('lee'),
  writes: serio('escribe'),
  loading: serio('Cargando el circuito…'),
  unreachable: serio('No se pudo leer el circuito. Se vuelve a intentar solo.'),
  idle: juego('Nada por aquí. El equipo aprovecha para barrer.'),
} as const satisfies Record<string, CatalogText>;

/** Entering a station and coming back (docs/diseno.md §10, ADR-0013). */
export const ROOM_TEXTS = {
  circuit: serio('Circuito'),
  whereYouAre: serio('Dónde estás'),
  backTo: serio('Volver a'),
  help: juego('Esc o el portal te devuelven al circuito.'),
  helpAction: juego('Esc o el portal te devuelven a CRM.'),
  exits: serio('Salidas'),
  normalRoute: serio('ruta normal'),
  stopRoute: serio('alto'),
  endRoute: serio('salida'),
  endOfCircuit: serio('fin del circuito'),
  taken: serio('tomada'),
  received: serio('Texto recibido, ya tachado'),
  proposal: serio('Propuesta'),
  proposedActions: serio('Acciones propuestas'),
  nodes: serio('Lo que guardó'),
  decision: serio('Decisión'),
  notYet: serio('Todavía sin datos: la corrida no llegó aquí.'),
  dueOn: serio('vence'),
  waitingApproval: serio('espera aprobación'),
  approved: serio('aprobada'),
  corrected: serio('corregida'),
  rejected: serio('rechazada'),
  applied: serio('aplicada'),
  notApplied: serio('no aplicada'),
  action: serio('Acción'),
  ofTotal: serio('de'),
} as const satisfies Record<string, CatalogText>;

/** The model's name, as the header shows it. An unknown one is shown as stored. */
export const MODEL_NAMES: Readonly<Record<string, CatalogText>> = {
  simulator: serio('Simulador'),
};

export const NODE_TEXTS = {
  characters: serio('caracteres'),
  delimited: serio('delimitado'),
  noInjection: serio('sin inyección'),
  injection: serio('inyección'),
  noPersonal: serio('sin datos personales'),
  emailAside: serio('correo aparte'),
  phone: serio('teléfono'),
  phones: serio('teléfonos'),
  document: serio('documento'),
  documents: serio('documentos'),
  crossedOut: serio('tachados'),
  confidence: serio('confianza'),
  urgency: serio('urgencia'),
  noSource: serio('sin fuente'),
  log: serio('bitácora'),
  noActions: serio('sin acciones'),
  applied: serio('aplicada'),
  notApplied: serio('no aplicada'),
} as const satisfies Record<string, CatalogText>;

/**
 * The short name beside each node's bubble in the orbit, as boceto B1 writes it: what the node is,
 * never its value. The value is in the node's tooltip and, whole, inside the station's room.
 */
export const NODE_LABELS = {
  text: serio('texto'),
  delimit: serio('delimitar'),
  injection: serio('inyección'),
  personal: serio('datos pers.'),
  intent: serio('intención'),
  topic: serio('programa'),
  urgency: serio('urgencia'),
  confidence: serio('confianza'),
  document: serio('documento'),
  quote: serio('cita'),
  noSource: serio('sin fuente'),
  noActions: serio('sin acciones'),
  log: serio('bitácora'),
  notApplied: serio('no aplicada'),
} as const satisfies Record<string, CatalogText>;

/** The short name of each CRM action beside its node (B1: «contacto», «nota», «tarea», «etapa»). */
export const ACTION_LABELS: Readonly<Record<string, CatalogText>> = {
  create_contact: serio('contacto'),
  update_contact: serio('contacto'),
  add_note: serio('nota'),
  create_task: serio('tarea'),
  move_stage: serio('etapa'),
};

export const INTENTS: Readonly<Record<string, CatalogText>> = {
  request: serio('solicitud'),
  complaint: serio('queja'),
  out_of_scope: serio('fuera de alcance'),
};

export const URGENCIES: Readonly<Record<string, CatalogText>> = {
  low: serio('baja'),
  medium: serio('media'),
  high: serio('alta'),
};

/** The CRM actions of station 5, by type (ADR-0010, actions.ts). */
export const ACTION_NAMES: Readonly<Record<string, CatalogText>> = {
  create_contact: serio('contacto nuevo'),
  update_contact: serio('contacto actualizado'),
  add_note: serio('nota'),
  create_task: serio('tarea'),
  move_stage: serio('etapa'),
};

/** The three ways out of Persona (§7); the one taken is filled. */
export const DECISION_NODES: readonly { readonly outcome: string; readonly label: CatalogText }[] = [
  { outcome: 'approved', label: serio('aprobar') },
  { outcome: 'corrected', label: serio('corregir') },
  { outcome: 'rejected', label: serio('rechazar') },
];

/** The text of an entry, or the key itself for one the catalog lacks: data shown as it came. */
export function textOf(catalog: Readonly<Record<string, CatalogText>>, key: string): string {
  return catalog[key]?.text ?? key;
}

/** Every entry, for the test that walks the catalog. */
export const CATALOG: readonly Readonly<Record<string, CatalogText>>[] = [
  STATION_NAMES,
  STATUS_TEXTS,
  OUTCOME_TAGS,
  FAILURE_REASONS,
  RUN_TEXTS,
  ROOM_TEXTS,
  MODEL_NAMES,
  NODE_TEXTS,
  NODE_LABELS,
  ACTION_LABELS,
  INTENTS,
  URGENCIES,
  ACTION_NAMES,
  Object.fromEntries(DECISION_NODES.map((node) => [node.outcome, node.label])),
];
