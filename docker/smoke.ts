// ADR-0020 D8: the whole circuit once, inside the circuit container of `docker compose up`. It asks
// for the sample «normal», waits at Persona, approves it as the board would, and checks that the
// seven stations ended completed; station 7 writes in the CRM, so the CRM and its key are in it too.
// `docker compose exec -T circuit node docker/smoke.ts` exits 0 when it went through, 1 when not.
// It prints stations and states only: the sample's text and the CRM's data stay out of the log.

const STATIONS = ['intake', 'filter', 'classification', 'knowledge', 'crm', 'person', 'close'] as const;
/** Stations 1 to 5 run before the answer of POST /api/runs; 6 and 7 come with the decision. */
const BEFORE_THE_PERSON = 5;
const SAMPLE = 'normal';

interface Event {
  readonly station: string;
  readonly status: string;
  readonly outcome: string;
}

const port = process.env['CIRCUIT_PORT'] ?? '4020';
const board = `http://127.0.0.1:${port}`;
// What the board itself sends: its own origin and JSON (ADR-0012 A6).
const COMMAND_HEADERS = { 'content-type': 'application/json', origin: board };

async function json(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${board}${path}`, init);
  if (!response.ok) throw new Error(`${init?.method ?? 'GET'} ${path} respondió ${response.status}`);
  return response.json();
}

async function eventsOf(runId: number): Promise<readonly Event[]> {
  const body = (await json(`/api/runs/${runId}/events`)) as { events: readonly Event[] };
  return body.events;
}

function line(events: readonly Event[]): string {
  return events.map((event) => `${event.station}:${event.outcome}`).join(' → ');
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const { runId } = (await json('/api/runs', { method: 'POST', headers: COMMAND_HEADERS, body: JSON.stringify({ sample: SAMPLE }) })) as { runId: number };
  const waiting = await eventsOf(runId);
  console.log(`Corrida ${runId}, esperando a la persona: ${line(waiting)}`);
  check(waiting.length === BEFORE_THE_PERSON && waiting.every((event) => event.status === 'completed'), 'Las estaciones 1 a 5 no quedaron completas.');

  await json(`/api/runs/${runId}/decision`, { method: 'POST', headers: COMMAND_HEADERS, body: JSON.stringify({ decision: 'approved' }) });
  const closed = await eventsOf(runId);
  console.log(`Aprobada y cerrada: ${line(closed)}`);
  check(closed.map((event) => event.station).join() === STATIONS.join(), 'La corrida no pasó por las siete estaciones en orden.');
  check(closed.every((event) => event.status === 'completed'), 'Alguna estación no quedó completa.');
  console.log('El circuito se recorrió entero.');
}

try {
  await main();
} catch (error) {
  console.error(`La prueba de humo falló: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
