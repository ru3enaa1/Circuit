# ADR-0012 · El mentor decide en la estación 6, y la estación 7 aplica en el CRM solo lo que quedó en ese evento, una vez y en orden

- **Fecha:** 2026-11-26 · **Estado:** aceptada el 2026-11-26. El dueño aceptó las cinco
  recomendaciones de «Preguntas abiertas» tal como están escritas («vamos con lo recomendado»).
  Se implementa después de ADR-0011, con la base del commit que la cierre.
- **Tarea:** F2.4 de `DEVELOPMENT_PLAN.md`: «aprobación del mentor». Terminado (parte de F2):
  aplicar en el CRM sin aprobación falla (ADR-0001 D4).
- **Retroactiva:** no. `approval/index.ts` y `crm-client/index.ts` solo tienen `export {};`
  (línea base: `docs/reviews/ADR-0012-baseline.md`).
- **Depende de:** ADR-0010 (los eventos, `CrmReader` y `CrmWriter`, las acciones de la
  estación 5) y ADR-0011 (el servidor en `127.0.0.1` y su revisión del `Host`).
- **Cita sin reescribir:** ADR-0001 D4; ADR-0007 D5 a D7 (el CRM firma `proposed_by` con la
  llave y exige `approval: { approvedBy, approvalRef }`, con la forma de `AUDIT_AUTHOR_PATTERN`
  y nunca `key-<n>`), y su «Daño a vigilar»: el CRM no puede comprobar que la aprobación es
  real («lo prueban los eventos de circuit, F2»), una propuesta puede quedar a medias y un
  reintento duplica; ADR-0008 D13 (la llave del agente no borra, no exporta y no ve otra
  cuenta); ADR-0009 (la llave del agente en `CRM_AGENT_KEY_FILE`).

## Contexto

Es la cláusula que justifica el proyecto: nada sale ni se escribe en el CRM sin que una
persona lo apruebe. El CRM ya rechaza una escritura sin la forma de una aprobación, pero no
puede saber si alguien aprobó de verdad: eso lo tiene que garantizar circuit. Las fuerzas:

- **La aprobación tiene que ser un hecho guardado**, no un valor que el código arma. Si
  cualquier función puede construir el objeto que habilita la escritura, la regla depende de
  la disciplina.
- **Una sola vez.** La API del CRM no tiene llave de idempotencia (ADR-0007, pregunta 6): dos
  aplicaciones de la misma decisión duplican notas y tareas, y no hay borrado para arreglarlo.
- **A medias.** Una propuesta de tres acciones son tres peticiones. Si la segunda falla, la
  primera ya quedó, y si el proceso muere en medio, nadie lo anota.
- **La ruta que decide vive en `127.0.0.1`.** Cualquier página abierta en el mismo equipo
  puede intentar un `POST` a ese puerto (CSRF). Con ADR-0011 B6 se cierra el *DNS rebinding*,
  no el envío desde otra página.
- **La llave del agente es un secreto.** Viaja en cada petición al CRM, y ni una redirección
  ni un error deben llevarla a otro lado.
- **No hay inicio de sesión.** La demostración es local y de una sola persona; el nombre del
  mentor sale de la configuración.

## Opciones consideradas

**Cómo se impide aplicar sin aprobación**

1. **Un tipo marcado `Approval`** que solo produce `approvalFrom(evento)` del núcleo, a partir
   del evento de la estación 6 leído del almacén. El `CrmWriter` exige ese tipo. La regla
   queda en el tipo y en la prueba que lo ejerce.
2. **Una revisión dentro del cliente HTTP.** Más fácil de saltar: otro adaptador no la tendría.
3. **Dejarlo al CRM.** El CRM no puede saber si hubo un mentor (ADR-0007).

**Cómo se aplica una sola vez**

1. **Una reserva en la base:** `circuit.apply_claims (run_id PRIMARY KEY)`, que la estación 7
   inserta antes de la primera petición al CRM. Una segunda inserción falla por la llave
   primaria, también después de reiniciar. Una reserva sin evento de la estación 7 es una
   aplicación interrumpida, y nunca se repite sola.
2. **Un candado en memoria por corrida.** Simple, pero se pierde al reiniciar y deja repetir.
3. **Mirar si ya existe el evento de la 7.** Dos peticiones simultáneas pasan las dos.

**Cómo llega la decisión**

1. **`POST /api/runs/:id/decision` con JSON**, que exige `Content-Type: application/json` (otro
   origen no puede mandarlo sin una consulta previa que el servidor nunca concede) y rechaza un
   `Origin` que no sea el del tablero. El mentor no se nombra en el cuerpo.
2. **Un formulario HTML.** Lo puede enviar cualquier página sin consulta previa.

## Decisión

Opciones 1, 1 y 1.

El mentor decide en el tablero: `approved` (aprueba todas las acciones de la estación 5),
`corrected` (aprueba una lista que él editó) o `rejected`. Circuit valida la decisión, la
guarda como el único evento de la estación 6 y sigue a la 7. Ese evento lleva `approvedBy`
(el mentor de `CIRCUIT_MENTOR`) y, si no es `rejected`, la lista exacta de acciones aprobadas.

La estación 7 vuelve a leer el evento de la 6 desde el almacén y obtiene de él un `Approval`
con `approvalFrom`. Inserta la reserva y aplica las acciones en orden, una petición por
acción, cada una con `approval: { approvedBy, approvalRef: 'run-<runId>' }`. No reintenta, se
detiene en el primer fallo y guarda un solo evento con el resultado de cada acción. Si la
decisión fue `rejected`, la 7 cierra sin tocar el CRM.

El cliente del CRM (`crm-client`) solo habla con `127.0.0.1` o `localhost`, no sigue
redirecciones y nunca registra ni guarda la llave.

## Cláusulas

| Id | Regla que el código cumple | Chequeo que lo prueba | Crítica |
|---|---|---|---|
| A1 | El `CrmWriter` del núcleo solo acepta un `Approval`, un tipo marcado que construye solo `approvalFrom(evento)` a partir de un evento de la estación 6 con decisión `approved` o `corrected`. Ningún otro código lo construye | `approval.test.ts`: `approvalFrom` con un evento de otra estación, con `rejected` o de otra corrida lanza; dos `@ts-expect-error` comprueban que un objeto literal no pasa por `Approval`. `git grep -n "as Approval" -- ':(glob)apps/circuit/src/**'` solo da la línea de `approvalFrom` | sí |
| A2 | **Aplicar sin aprobación falla**: la estación 7 lee el evento de la 6 desde el almacén, no de la memoria ni de la petición. Sin ese evento, con `rejected`, o con el evento de otra corrida, el CRM recibe 0 peticiones de escritura; sin evento, la 7 termina en `failed` con la razón `sin_aprobacion` | `apply-without-approval.test.ts`, con un CRM falso en `127.0.0.1` que cuenta peticiones: (a) aplicar una corrida sin evento de la 6, 0 escrituras y el evento `failed`; (b) la aprobación de la corrida A no aplica la B, 0; (c) `rejected`, 0 y la 7 en `completed`; (d) `approved`, exactamente las acciones aprobadas, en orden. M1 (la 7 usa las acciones de la 5 en memoria) y M2 (sin la revisión de la corrida) lo ponen en rojo | sí |
| A3 | Cada escritura lleva `approval: { approvedBy: <mentor>, approvalRef: 'run-<runId>' }`; el mentor nunca tiene la forma `key-<n>` | `apply-crm-e2e-db.test.ts`: levanta el CRM como un proceso aparte (sin importar su código, ADR-0003 M3) sobre una base desechable sembrada, corre el caso dorado `normal` hasta la 7 y lee `GET /accounts/:slug/audit` con la llave del agente: cada entrada nueva tiene `approvedBy` igual al mentor, `approvalRef` igual a `run-<id>` y `proposedBy` igual a `key-<id>` de la llave. Antes de la decisión, la bitácora no tiene ninguna entrada nueva | sí |
| A4 | La estación 7 inserta `circuit.apply_claims (run_id)` antes de su primera petición al CRM, y no aplica si la inserción falla. Una reserva sin evento de la 7 es una aplicación interrumpida: no se repite nunca sola, y la corrida queda marcada para revisar la bitácora del CRM con `approvalRef = run-<id>` | `apply-once-db.test.ts`: dos aplicaciones simultáneas de la misma corrida dan las escrituras una sola vez; una reserva plantada sin evento de la 7 y un reinicio del motor no mandan ninguna petición. La migración `0006` da a `circuit_service` solo `SELECT` e `INSERT` sobre `apply_claims`. M3 (sin la reserva) lo pone en rojo | sí |
| A5 | Las acciones se aplican en el orden aprobado, una petición cada una, sin reintentos; en el primer fallo se detiene. El evento de la 7 trae, por acción, su estado HTTP y el id que devolvió el CRM, y nada del cuerpo de la respuesta | `apply-without-approval.test.ts`: un CRM falso que falla la segunda de tres; la primera quedó, la tercera no se pidió, y el evento dice las tres. Un 500 no se repite (una sola petición) | sí |
| A6 | `POST /api/runs/:id/decision` acepta solo `Content-Type: application/json` (otro, 415); si viene `Origin`, debe ser el del tablero, `http://127.0.0.1:<puerto>` o `http://localhost:<puerto>` (otro, 403); sigue la revisión del `Host` de ADR-0011 B6. El cuerpo pasa por zod en modo estricto: `{ decision, actions? }`, sin `approvedBy`. Una decisión para una corrida que no espera en la 6 da 409. Ningún rechazo agrega un evento | `server-decision-db.test.ts`: `text/plain`, 415; `Origin: http://ejemplo.test`, 403; un cuerpo con `approvedBy`, 400; una segunda decisión, 409; un `__proto__`, 400 con `Object.prototype` intacto. En cada uno, el número de eventos no cambia. M4 (sin la revisión del `Origin`) lo pone en rojo | sí |
| A7 | El mentor es `CIRCUIT_MENTOR` (por defecto `mentor`; **ASUNCIÓN**, pregunta 1), con la forma de `AUDIT_AUTHOR_PATTERN` y nunca `key-<n>`; otro valor detiene el arranque con el nombre de la variable | `config.test.ts`: `key-7`, un correo, un espacio y 41 caracteres, cada uno salida 1 con el nombre | sí |
| A8 | Las acciones corregidas pasan por la misma validación del núcleo que las de la estación 5 (ADR-0010 D14): la lista cerrada de tipos y los límites de la API del CRM. El mentor no agrega un tipo nuevo | `approval.test.ts`: una corrección con `delete_contact`, con una nota de 4001 caracteres o con un campo de más da 400 y no guarda evento | sí |
| A9 | `crm-client` lee `CRM_URL` (por defecto `http://127.0.0.1:4010`) y solo acepta `http://127.0.0.1` o `http://localhost`; lee la llave de `CRM_AGENT_KEY_FILE` al arrancar; cada petición tiene un tiempo máximo de 5 s y `redirect: 'error'`. La llave no aparece en ningún evento, registro ni mensaje de error | `crm-client.test.ts`: `CRM_URL=http://ejemplo.test` falla al arrancar; un CRM falso que responde 302 hacia otro puerto: el otro puerto no recibe nada; una llave conocida no aparece en los eventos de una corrida ni en lo que escribió el registro. M5 (`redirect: 'follow'`) lo pone en rojo | sí |
| A10 | Ningún texto del catálogo con `tone: 'juego'` llega al CRM: los textos que se escriben salen de las acciones aprobadas | `apply-crm-e2e-db.test.ts`: ninguna escritura enviada contiene un texto `juego` del catálogo de ADR-0011 B9 | no |
| A11 | `apps/crm` no cambia; la única migración nueva es `0006` (`apply_claims`), con su hash en `migration-hashes.ts` en el mismo commit | `git diff --exit-code <commit de cierre de ADR-0011> -- apps/crm database/migrations/0000_init.sql database/migrations/0005_*.sql` da 0; `migration-files.test.ts` en verde | sí |

### Mutantes

| Id | Cláusula | Qué se planta |
|---|---|---|
| M1 | A2 | La 7 aplica las acciones de la 5 que quedaron en memoria |
| M2 | A2 | `approvalFrom` no compara la corrida |
| M3 | A4 | La 7 no inserta la reserva |
| M4 | A6 | Sin la revisión del `Origin` |
| M5 | A9 | `redirect: 'follow'` |
| M6 | A5 | Un reintento después de un 500 |

## Cerco

- **Puede cambiar:** `apps/circuit/src/modules/{approval,crm-client,circuit}/` (en el núcleo,
  solo `Approval`, `approvalFrom` y la estación 7); `apps/circuit/src/server/` (la ruta de la
  decisión); `apps/board/` (la tarjeta de aprobación); `database/migrations/0006_*.sql`, su
  `meta/`, `migration-hashes.ts` (agregar), `database/schema.sql` (regenerado) y
  `database/test/`; `.env.example` (`CIRCUIT_MENTOR`, `CRM_URL`); `CLAUDE.md`,
  `DEVELOPMENT_PLAN.md`, `README.md`.
- **No debe cambiar:** `apps/crm/`; las migraciones `0000` a `0005`; la tabla `CIRCUIT` y el
  formato de los eventos (ADR-0010); la revisión del `Host` y las cabeceras (ADR-0011); los
  permisos de la llave del agente.
- **Fuera de alcance:** enviar algo al participante (correo, mensaje); varios mentores,
  inicio de sesión o roles; deshacer una escritura en el CRM; aplicar una propuesta en una sola
  transacción del CRM; reconciliar a mano una aplicación interrumpida (queda a la vista, no se
  automatiza).

## Restricciones

- Todo en `127.0.0.1`. Las pruebas levantan el CRM como un proceso sobre una base desechable,
  con `PROCESS_TEST_TIMEOUT_MS` (CLAUDE.md §8).
- La llave del agente se lee del archivo que nombra `CRM_AGENT_KEY_FILE`; nunca se copia a
  otro lado.
- Los límites del CRM no cambian: 16 KiB por cuerpo, 5 s por sentencia.

## Daño a vigilar

- **Lo escrito en el CRM no se deshace:** no hay borrado. Una aplicación equivocada se
  corrige con otra escritura aprobada; la bitácora guarda las dos.
- **Cualquier proceso del mismo equipo puede decidir**: no hay inicio de sesión, y un
  programa local, a diferencia de una página web, sí puede mandar el `POST`. Es aceptable en
  una demostración local de una persona; no lo es en un despliegue (ADR-0002).
- **Una aplicación interrumpida** deja escrituras en el CRM sin evento de la 7. Queda visible
  por la reserva y se reconcilia leyendo la bitácora del CRM por `approvalRef`.
- **El `approvalRef` es el mismo para todas las acciones de una corrida:** sirve para
  encontrarlas, no para distinguirlas; las distingue el `row_id` de cada fila de la bitácora.

## Reversión

- El código se revierte con sus commits; `0006` es solo hacia adelante (respaldo antes,
  CLAUDE.md §7).
- Las escrituras ya hechas en el CRM y sus filas de bitácora se quedan, por diseño
  (ADR-0005 D9).

## Consecuencias

- «Aplicar sin aprobación falla» queda en el tipo, en el almacén y en una prueba con un CRM
  falso y otra con el CRM real.
- Una decisión no se puede repetir, ni siquiera después de reiniciar.
- Agregar un mentor de verdad (inicio de sesión) es otra ADR: cambia A6 y A7.

## Preguntas abiertas

Respondidas el 2026-11-26: el dueño aceptó cada recomendación como está escrita, así que cada
ASUNCIÓN queda como decisión.

1. **Nombre del mentor (A7).** Recomendación: `mentor` por defecto, cambiable con
   `CIRCUIT_MENTOR`. La propuesta privada deja abierto si se llama mentor o asesor.
2. **Aprobar por acción o todo junto (decisión).** Recomendación: `approved` aprueba todas;
   para quitar una, el mentor usa `corrected`.
3. **`approvalRef` (A3).** Recomendación: `run-<runId>`, que cabe en los 40 caracteres de la
   forma.
4. **Reserva en la base (A4).** Recomendación: sí, `circuit.apply_claims`, con la migración
   `0006`.
5. **Sin inicio de sesión (A6).** Recomendación: aceptado para la demostración local, escrito
   en el README.

## Enmienda A12 (2026-11-27, F2.4; la eligió Claude por CLAUDE.md §1b)

**«Probar una solicitud» es la segunda ruta que escribe.** `docs/diseno.md` §8 la pide con F2.4 y
esta ADR solo nombraba la de la decisión. `POST /api/runs` toma `{ sample }` (estricto, el id con
forma de slug) y arranca `startRun` con el texto de esa muestra; no acepta texto libre, así que la
misma entrada da la misma corrida con el simulador. Las muestras viven en el paquete,
`scenarios/<id>/samples.json` (id, rótulo y texto: los de los casos dorados), y las carga
`loadTryouts`, que también lee la cuenta del agente de `crm.json` (`agentAccount`). Sigue las mismas
reglas que A6: solo JSON (415), el `Origin` del tablero (403), la revisión del `Host` y 16 KiB
(413). `GET /api/circuit` suma `samples` (id y rótulo, nunca el texto) y `mentor`. Enmienda
ADR-0011 B13: estas dos son las únicas rutas que no son `GET`.

## Notas de implementación (F2.4, 2026-11-27)

Commits `48bcb18` (núcleo, `0006`, cliente, servidor) y `6f66116` (tablero). 1378 pruebas (una
solo en Linux), cobertura 93,53 / 87,07 / 93,64 / 95,7. M1–M7 en rojo (M7: sin la revisión del
`Content-Type`), y en el tablero D1–D4 (sin la tarjeta, dos órdenes a la vez, la corrección que no
mira «conservar», el tablero que no sigue la corrida nueva). D4 sobrevivió a la primera prueba
(la corrida elegida ya era la más nueva) y se corrigió la prueba.

- **El evento de la 7** trae `approvalRef` y, por acción, `status` (A5); los casos dorados
  `normal` y `complaint` se regeneraron. Un `rejected` no trae `approvalRef`: no escribe nada.
- **`applyDecision`** se exporta: es la 7 sobre lo que el almacén tenga, y la usan A2 (a) y el
  «reinicio» de A4. Sin evento de la 6 no reclama nada; con decisión, reclama siempre, también
  un `rejected`, así que ninguna 7 corre dos veces.
- **La reserva escapa de `settle`:** `ApplyAlreadyClaimed` extiende `Unrecorded`, que `settle`
  deja pasar, así que una segunda aplicación no guarda evento ni manda petición. Dos decisiones a
  la vez chocan en `station_events_run_seq`; `PgEventStore` lo traduce a `EventConflict` y el
  servidor responde 409.
- **El cliente** comprueba además que cada acción sea una de las del `Approval` (identidad), y
  traduce clave de etapa a id con `GET /stages`; `create_contact` entra en la etapa de menor
  posición. La forma de la llave se revisa holgada (`crmk_` y 43 caracteres): decide el CRM.
- **A6 y A8 se prueban en memoria** (`server-decision.test.ts`), no en un archivo con base: la
  ruta no toca la base distinta de la memoria. La carrera real va en `apply-once-db.test.ts`, con
  una escritura lenta para que las dos llamadas compitan por la reserva. Un 400 nombra un campo
  del esquema (`sample`, `actions`, `actions[0].body`) o la sección (`cuerpo`), nunca una clave que
  eligió quien envía.
- **`CRM_AGENT_KEY_FILE` es obligatoria para `circuit:start`**, y `CRM_URL` opcional.
- **Tablero:** la tarjeta y el menú no guardan estado: `<details>` nativo y un formulario cuyos
  campos se leen al enviarlo (`correction.ts`, puro). Lo único con estado sigue en
  `use-run-events.ts`: una orden a la vez, `sending` o `failed` con su motivo y su clase.
- **No probado:** un clic real en un navegador (Tab, Enter, Esc). Se probó con el CRM y circuit
  reales sobre la base de desarrollo (respaldada en `database/backups/20261127-143511Z-antes-0006/`
  y migrada a `0006`): la corrida 1 llegó a Persona leyendo a Lucía del CRM, la aprobación dio
  200 y tres escrituras firmadas `key-1` / `mentor` / `run-1`, la segunda decisión 409, otro
  `Origin` 403 y `text/plain` 415; y capturas de Chrome sin ventana de la sala de Persona y de
  Cierre.
