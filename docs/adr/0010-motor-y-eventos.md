# ADR-0010 · El núcleo recorre el circuito con una tabla de transiciones, guarda un evento por estación en una tabla que solo crece, y el simulador responde desde el paquete del escenario

- **Fecha:** 2026-11-26 · **Estado:** aceptada el 2026-11-26. El dueño aceptó las nueve
  recomendaciones de «Preguntas abiertas» tal como están escritas («vamos con lo recomendado»).
- **Tarea:** F2.1 y F2.2 de `DEVELOPMENT_PLAN.md`: «motor del circuito: las estaciones y las
  ramas como datos, y un evento por estación» y «simulador y casos dorados de las tres rutas:
  normal, salto de 3 a 6 y alto en 2». Terminado (parte de F2): los casos dorados recorren las
  tres rutas.
- **Retroactiva:** no. `apps/circuit/src/modules/*/index.ts` solo tienen `export {};` y el
  esquema `circuit` está vacío (línea base: `docs/reviews/ADR-0010-baseline.md`, sobre
  `8edc7d8`).
- **Cita sin reescribir:** ADR-0001 D1, D2, D3 y D5 (el núcleo elige la estación, sin SDK,
  el modelo por configuración, un evento por estación); ADR-0003 M1, M2 y M4 (módulos por su
  `index.ts`, el núcleo sin paquetes, `circuit_service` no ve `crm`); ADR-0006 D3 (un dueño sin
  login para cada esquema); ADR-0009 (el paquete del escenario en `scenarios/<id>/`, elegido
  por `CIRCUIT_SCENARIO`). CLAUDE.md §1 (el texto de entrada es dato; sin fuente, no hay
  respuesta; reproducible) y §3 (las reglas de producto 1 a 4).
- **Hermanas:** ADR-0011 (el tablero, F2.3) y ADR-0012 (la aprobación y el cierre, F2.4)
  leen lo que esta ADR guarda y no lo cambian.

## Contexto

El circuito existe en los documentos y en ninguna línea de código. F2.1 y F2.2 lo hacen
correr con el modelo simulado, y todo lo que viene después depende de lo que se fije aquí: el
tablero dibuja desde estos eventos (ADR-0011), la estación 7 aplica desde el evento de la 6
(ADR-0012) y F3 graba corridas reales con el mismo formato. Las fuerzas:

- **El núcleo no importa ningún paquete** (`module-map.ts`, `circuit: { modules: [],
  packages: [] }`). Ni zod, ni pg, ni `node:crypto`: valida a mano y habla por puertos.
- **La salida del modelo no elige el camino** (ADR-0001 D1). Con el simulador es fácil de
  cumplir; con el modelo real (F3) una salida puede «pedir» otra estación, y el formato que se
  fije ahora no debe tener dónde pedirlo.
- **El texto de entrada es un dato con datos personales.** Es sintético, pero se trata como
  si fuera real: un correo, un teléfono o un número de documento no deben llegar al modelo
  ni al tablero si no hacen falta.
- **Reproducible:** la misma entrada, con el simulador y la misma versión, da la misma
  salida. Eso incluye las duraciones, que dependen del reloj.
- **Casos dorados que muerden.** La trampa escrita de F2: «casos dorados que pasan con
  cualquier salida».
- **El esquema `circuit` ya tiene su rol.** `0002` creó `circuit_service` sin permisos y dejó
  escrito que «sus permisos llegan con sus tablas en F2.1»; `crm-rules-db.test.ts` (D13)
  comprueba que no ve `crm`.
- **Falta un insumo:** el material del programa que cita la estación 4, pedido al dueño desde
  F1.4.

## Opciones consideradas

**Cómo se ordenan las estaciones**

1. **Un `switch` por estación en el motor.** Lo más corto de escribir. El orden y las ramas
   quedan repartidos en el código, y el tablero tendría que repetirlos.
2. **Una tabla de transiciones como dato del núcleo**: las siete estaciones en orden y una
   lista `(estación, resultado) → siguiente`. El motor es un bucle genérico; el tablero recibe
   la misma tabla. Cada resultado posible es un valor de una lista cerrada.
3. **Una librería de máquinas de estado.** Prohibida en el núcleo (ADR-0003 M2), y no aporta
   lo que la tabla no da.

**Dónde viven los eventos**

1. **Dos tablas en `circuit`**, `runs` y `station_events`, que solo crecen: el rol del
   servicio inserta y lee, nunca cambia ni borra. Una restricción única por corrida y estación
   impone en la base «un evento por estación».
2. **Archivos JSON por corrida.** Simple para grabar en F3, pero sin permisos, sin
   restricciones y sin consultas para el tablero.
3. **Solo en memoria.** Se pierde al reiniciar; contradice «el mapa se dibuja con eventos
   guardados».

**De dónde responde el simulador**

1. **De un archivo del paquete**, `scenarios/<id>/simulator.json`, con la respuesta fija de
   cada texto, buscada por el SHA-256 del texto ya delimitado; un texto desconocido recibe una
   respuesta por defecto. Determinista y cambiable con el escenario.
2. **De reglas por palabras clave en el código.** Mete el escenario en el núcleo genérico
   (regla 4).
3. **Una sola respuesta fija.** No puede recorrer tres rutas.

## Decisión

Opción 2, 1 y 1.

El núcleo (`apps/circuit/src/modules/circuit/`) declara `CIRCUIT`: las siete estaciones en
orden (`intake`, `filter`, `classification`, `knowledge`, `crm`, `person`, `close`, con su
número del 1 al 7) y la tabla de transiciones. Cada estación produce un **resultado** de una
lista cerrada, y el motor busca la siguiente estación en la tabla:

| Estación | Resultado | Siguiente |
|---|---|---|
| 1 `intake` | `ok` | 2 |
| 2 `filter` | `ok` | 3 |
| 2 `filter` | `injection` | fin, corrida detenida |
| 3 `classification` | `ok` | 4 |
| 3 `classification` | `complaint`, `out_of_scope`, `low_confidence` | 6 |
| 4 `knowledge` | `ok`, `no_source` | 5 |
| 5 `crm` | `ok` | 6 |
| 6 `person` | `approved`, `corrected`, `rejected` | 7 |
| 7 `close` | `done` | fin |

Un resultado que no está en la tabla para su estación es un error del núcleo, no una ruta.
Una estación que falla (un puerto que lanza, una salida que no pasa la validación) termina la
corrida con estado `failed` en su evento, y no corre ninguna estación más.

La estación 2 es código: delimita el texto, detecta la inyección con una lista fija de
patrones sobre el texto normalizado, saca el correo a un campo aparte y tacha el teléfono y el
documento. El modelo (estaciones 3, 4 y 5) solo recibe el texto delimitado y tachado.

Cada estación visitada deja exactamente un evento, que se guarda antes de empezar la
siguiente. Las estaciones saltadas no dejan evento: el tablero las deduce de la tabla. La
estación 6 tampoco deja un evento «esperando»: espera mientras su evento no existe, y el
tablero lo deduce del último evento guardado (ADR-0011). Su evento llega con la decisión del
mentor (ADR-0012).

Los eventos se guardan en `circuit.runs` y `circuit.station_events`, cuyo dueño es
`circuit_owner`, sin login. `circuit_service` solo lee e inserta. El servidor se conecta como
`circuit_app`, miembro solo de `circuit_service`, que crea `npm run db:users` como hace con
`crm_app`.

El simulador vive en el módulo `model`, se elige con `CIRCUIT_MODEL=simulator` (el valor por
defecto) y responde desde `scenarios/<id>/simulator.json`. Los casos dorados corren con el
simulador, un reloj fijo y un almacén en memoria, y comparan el archivo de eventos byte a
byte.

## Cláusulas

| Id | Regla que el código cumple | Chequeo que lo prueba | Crítica |
|---|---|---|---|
| D1 | `CIRCUIT` es un solo valor del núcleo, con las siete estaciones en el orden de la tabla de arriba y exactamente sus transiciones. El motor elige la siguiente estación solo con `CIRCUIT`: no compara el id de una estación para decidir a cuál ir | `circuit-definition.test.ts`: los ids y números en orden, y la lista de transiciones igual, entrada por entrada, a una copia escrita en la prueba; un resultado ajeno a su estación lanza. M1 (cambiar `complaint → person` por `complaint → knowledge` en `CIRCUIT`) pone en rojo el caso dorado de la queja | sí |
| D2 | La salida de un puerto del modelo no tiene dónde nombrar una estación, y el núcleo la valida antes de usarla: `intent` de una lista cerrada, `confidence` un número finito entre 0 y 1, los textos con su largo máximo. Un campo de más (`nextStation`, `goto`) se ignora y no cambia la ruta; un valor inválido termina la corrida en esa estación con `failed` | `engine.test.ts`: un modelo falso que responde `{ …, nextStation: 'close' }` y otro con `goto: 7` recorren la ruta normal entera (ADR-0001 D1); `confidence` de `1.5`, `NaN` y `-0.1`, e `intent: 'otra'` dejan un evento `failed` en la 3 y ninguno después. M10 (el motor lee `nextStation` de la salida) pone el primero en rojo | sí |
| D3 | Una clasificación con confianza menor que `LOW_CONFIDENCE_BELOW = 0.7` (constante con nombre y su razón) da `low_confidence` y va a la 6, aunque la intención sea normal; con 0.7 justo, sigue a la 4 (**ASUNCIÓN**, pregunta 1) | `engine.test.ts`: 0.69 → 6 y 0.7 → 4; el caso dorado `low-confidence`. M3 (`<=` en vez de `<`) pone el borde en rojo | no |
| D4 | El texto que reciben los puertos del modelo va dentro de `<solicitud>` y `</solicitud>`, y es el texto ya tachado. Ningún puerto recibe el texto crudo. Una apertura o un cierre de esa etiqueta dentro del texto de entrada, en cualquier mayúscula o con espacios dentro, cuenta como inyección | `filter.test.ts` y `engine.test.ts` con un modelo falso que guarda lo que recibe: lo que recibió empieza y termina con la etiqueta y no contiene el correo, el teléfono ni el documento de la entrada; `</ Solicitud >` en la entrada da `injection`. M4 (el filtro pasa el texto crudo) pone en rojo el primero | sí |
| D5 | La estación 2 normaliza el texto (NFKC, minúsculas, sin tildes, sin caracteres de ancho cero, espacios colapsados) y lo compara con la lista fija `INJECTION_PATTERNS` del núcleo (**ASUNCIÓN**, pregunta 2). Con una coincidencia, su evento sale con resultado `injection` y estado `stopped`, guarda el id del patrón y nunca el texto que coincidió, y no se llama a ningún puerto del modelo | `filter.test.ts`: un caso por patrón, más sus variantes en mayúsculas, con tildes, con U+200B en medio y en ancho completo; en cada uno, el contador de llamadas del modelo falso es 0 y el `detail` del evento no contiene el texto de la entrada. M2 (quitar un patrón) pone en rojo su caso y el caso dorado `injection` | sí |
| D6 | La estación 2 saca el primer correo a un campo aparte (lo necesita la estación 5 para buscar el contacto) y lo quita del texto, y reemplaza cada teléfono y cada número de documento por `[teléfono]` y `[documento]` (**ASUNCIÓN**, pregunta 3). Lo tachado no se guarda en ningún lado: ni en los eventos, ni en `runs`, ni en el registro. El texto crudo tampoco se guarda (**ASUNCIÓN**, pregunta 7) | `filter.test.ts`: correos, teléfonos con y sin separadores, y documentos de 6 a 10 cifras; un número de 3 cifras («35 personas») no se tacha. `golden.test.ts`: el JSON de los eventos de cada caso dorado no contiene ninguna de las cadenas personales que su `input.json` lista en `personal`. M11 (el filtro no tacha el teléfono) pone en rojo los dos | sí |
| D7 | Cada estación visitada deja exactamente un evento, y solo las visitadas. Sus campos: `runId`, `seq` (de 1 en adelante, sin huecos), `station`, `outcome`, `status` (`completed`, `stopped` o `failed`), `startedAt`, `durationMs`, `tokensIn`, `tokensOut`, `costMicroUsd`, `model` y `detail` | `engine.test.ts`, con el almacén en memoria: por cada ruta, la lista de estaciones de los eventos es exactamente la esperada (normal 1–7; queja 1, 2, 3, 6, 7; inyección 1 y 2) y `seq` es 1…n | no |
| D8 | El motor guarda el evento de una estación antes de llamar a la siguiente. Si el almacén falla, la corrida se detiene ahí: ninguna estación más corre y ningún puerto más se llama | `engine.test.ts`: un almacén que falla en la tercera inserción; los puertos del modelo y del CRM falsos no reciben ninguna llamada después. M5 (guardar al final de la corrida) lo pone en rojo | sí |
| D9 | Las medidas son enteros: `durationMs` sale del puerto `Clock` del núcleo y es ≥ 0; las estaciones de código (1, 2, 6 y 7) dan 0 tokens y 0 de costo; el simulador da `tokensIn`, `tokensOut` y `costMicroUsd` nulos y `model: 'simulator'`, porque no tiene de dónde sacar un número (**ASUNCIÓN**, pregunta 5). El costo nunca es decimal | `engine.test.ts` y `golden.test.ts`: las medidas de cada evento, comparadas; `circuit-events-db.test.ts`: la base rechaza una duración, un token o un costo negativos (23514) | no |
| D10 | La migración `0005` crea `circuit.runs` y `circuit.station_events`, con `circuit_owner` (sin login) como dueño, restricciones `CHECK` para `station`, `outcome`, `status` y las medidas, y `UNIQUE (run_id, seq)` y `UNIQUE (run_id, station)`. `circuit_service` recibe solo `USAGE` en el esquema, `SELECT` e `INSERT` en las dos tablas y el uso de sus secuencias: nunca `UPDATE`, `DELETE` ni `TRUNCATE`, y nada en `crm` | `circuit-events-db.test.ts`, conectado como `circuit_app` a una base desechable: insertar y leer, sí; `UPDATE`, `DELETE` y `TRUNCATE`, 42501; un segundo evento de la misma estación en la misma corrida, 23505; leer `crm.contacts`, 42501. Los dueños, como `crm-structure-db.test.ts`. M6 (`GRANT UPDATE`) y M7 (sin `UNIQUE (run_id, station)`) lo ponen en rojo | sí |
| D11 | `circuit_app` lo crea y actualiza `npm run db:users` con `CIRCUIT_DB_PASSWORD` de `.env`, como a `crm_app` (ADR-0006 D4, H10): miembro solo de `circuit_service`, sin `WITH ADMIN OPTION`, con un verificador SCRAM. Sin la variable, `db:users` falla nombrándola. Lo de `crm_app` no cambia | `users-db.test.ts` (o el archivo de `crm_app` que ya prueba esto, ampliado): los atributos y la única membresía de `circuit_app`; sin `CIRCUIT_DB_PASSWORD`, salida 1 con el nombre; las pruebas de `crm_app` siguen en verde sin cambios | sí |
| D12 | El simulador implementa el puerto del modelo en `model`, se elige con `CIRCUIT_MODEL` (sin valor o `simulator`; otro valor detiene el arranque con el nombre de la variable) y responde desde `scenarios/<id>/simulator.json`, buscando el SHA-256 del texto delimitado. Un texto que no está en el archivo recibe la respuesta por defecto: `out_of_scope` con confianza 0 (**ASUNCIÓN**, pregunta 4). No lee el reloj ni el azar | `simulator.test.ts`: la misma entrada 100 veces da salidas iguales; un texto desconocido da `out_of_scope`; `CIRCUIT_MODEL=otro` falla con el nombre. `git grep -nE "Math\.random\|Date\.now\|new Date\|randomUUID\|randomBytes" -- ':(glob)apps/circuit/src/modules/model/**'` da 0 líneas. M9 (el simulador usa `Date.now`) pone en rojo un caso dorado | no |
| D13 | La estación 4 responde solo con fuente: la respuesta cita un `documentId` que existe en `scenarios/<id>/documents/` y una `quote` que aparece tal cual en ese documento (con los espacios colapsados en los dos). Si falta la cita, el documento no existe o la cita no aparece, el resultado es `no_source`, la respuesta se descarta y el evento dice cuál de las tres razones fue | `knowledge.test.ts`: los tres casos y uno válido; el texto descartado no aparece en el evento. M8 (aceptar una cita que no aparece) pone en rojo su caso | sí |
| D14 | La estación 5 busca el contacto con el correo que sacó la estación 2, por el puerto `CrmReader`, y el modelo propone acciones de una lista cerrada (`create_contact`, `update_contact`, `add_note`, `create_task`, `move_stage`), que el núcleo valida con los límites de la API del CRM (ADR-0007 D9). El núcleo separa `CrmReader` de `CrmWriter`, y las estaciones 1 a 6 no reciben el `CrmWriter` | `engine.test.ts`, con un CRM falso que cuenta: después de las estaciones 1 a 6 de la ruta normal, el `CrmWriter` tiene 0 llamadas; una acción `delete_contact` o una nota de 4001 caracteres terminan la 5 en `failed`. La firma de la estación 5 recibe `CrmReader` (revisión de la auditoría) | sí |
| D15 | Los casos dorados son cuatro, en `apps/circuit/test/golden/<caso>/` con `input.json` y `events.json`: `normal`, `complaint` (salto de 3 a 6), `injection` (alto en 2) y `low-confidence` (salto de 3 a 6 por la regla 3). Corren con el simulador, un reloj fijo (cada lectura avanza 10 ms) y el almacén en memoria, y comparan `events.json` byte a byte, en LF. Además, cada caso compara su lista de estaciones con una constante escrita en la prueba, no leída del archivo. Si `events.json` falta o está vacío, la prueba falla. Solo `npm run golden:update` los reescribe; la prueba nunca | `golden.test.ts`: los cuatro casos, dos veces seguidas en el mismo proceso con salida idéntica. M1, M2, M3 y M9 ponen en rojo al menos un caso cada uno; M12 (la prueba reescribe el archivo) se detecta porque `golden.test.ts` no abre ningún archivo para escribir (`git grep -n "writeFile" -- apps/circuit/test/golden.test.ts` da 0) | sí |
| D16 | El caso dorado `normal` también corre contra una base desechable, conectado como `circuit_app`: lo que se lee de `circuit.station_events` es igual a su `events.json` | `golden-db.test.ts` | sí |
| D17 | El núcleo sigue sin importar ningún módulo ni paquete: la línea `circuit: { modules: [], packages: [] }` de `module-map.ts` no cambia. El nuevo módulo `event-store` implementa el puerto del almacén con `drizzle-orm` y `pg`, y solo importa el núcleo | `git diff 8edc7d8 -- apps/circuit/test/architecture/module-map.ts` no toca la línea de `circuit`; `architecture.test.ts` en verde, y la importación plantada de F0.3 en el núcleo lo sigue poniendo en rojo | sí |
| D18 | Dependencias nuevas, solo estas, exactas y verificadas en el registro el día que entran: en `apps/circuit`, `drizzle-orm` 0.45.4, `pg` 8.23.1 y `zod` 4.6.7 (las mismas versiones que `apps/crm`), y `@types/pg` si hiciera falta. `npm audit --audit-level=low` sigue en 0 | `git diff 8edc7d8 -- package.json apps/circuit/package.json`; `npm ls zod --all` muestra una sola versión; `npm audit --audit-level=low` sale con 0 | no |
| D19 | `apps/crm` y las migraciones `0000` a `0004` no cambian; `0005` agrega su SHA-256 a `migration-hashes.ts` en el mismo commit, y `database/schema.sql` se regenera con `npm run db:dump-schema` | `git diff --exit-code 8edc7d8 -- apps/crm database/migrations/0000_init.sql database/migrations/0001_crm_tables.sql database/migrations/0002_crm_security.sql database/migrations/0003_audit_author_format.sql database/migrations/0004_crm_owner.sql` da 0; `migration-files.test.ts` y `schema-dump-db.test.ts` en verde | sí |
| D20 | Toda prueba que aplica migraciones lleva un presupuesto con nombre como último argumento, y `hook-budget.test.ts` lo exige. Hoy «two disposable databases migrating at once › both apply every migration» (`migrations-db.test.ts:120`) corre con los 5 s por defecto y venció en 1 de 2 vueltas de la línea base; con `0005` y `0006` tardará más | `hook-budget.test.ts`, ampliado: una prueba que llama a `runMigrations` sin presupuesto lo pone en rojo; 10 vueltas seguidas de `npm run check` en 0 | sí |

### Mutantes

Cada uno se planta a mano, se comprueba en rojo en su prueba y se restaura comprobando el hash
(CLAUDE.md §8, PowerShell y la codificación).

| Id | Cláusula | Qué se planta |
|---|---|---|
| M1 | D1, D15 | `complaint → knowledge` en `CIRCUIT` |
| M2 | D5, D15 | Quitar un patrón de `INJECTION_PATTERNS` |
| M3 | D3, D15 | `<=` en vez de `<` en el umbral |
| M4 | D4 | El filtro pasa al modelo el texto crudo |
| M5 | D8 | El motor guarda todos los eventos al final |
| M6 | D10 | `GRANT UPDATE ON circuit.station_events TO circuit_service` |
| M7 | D10 | Sin `UNIQUE (run_id, station)` |
| M8 | D13 | Aceptar una cita que no aparece en el documento |
| M9 | D12, D15 | El simulador mezcla `Date.now()` en una respuesta |
| M10 | D2 | El motor usa `nextStation` si la salida lo trae |
| M11 | D6 | El filtro no tacha el teléfono |

## Cerco

- **Puede cambiar:** `apps/circuit/src/modules/{circuit,model,scenario}/` y el módulo nuevo
  `apps/circuit/src/modules/event-store/`; `apps/circuit/test/`; `module-map.ts`, solo para
  agregar `event-store` y los paquetes de `model`, `scenario` y `event-store`;
  `apps/circuit/package.json`, `package.json` (el script `golden:update`) y el lockfile (D18);
  `database/config.ts` (`SCHEMA_FILES`), `database/schema.ts` (el esquema `circuit` pasa al
  archivo de `event-store`), `database/migrations/0005_*.sql` y su `meta/`,
  `database/test/migration-hashes.ts` (solo agregar), `database/schema.sql` (regenerado),
  `database/users.ts` y `database/test/` (D11); `.env.example` (`CIRCUIT_DB_PASSWORD`,
  `CIRCUIT_MODEL`); `.github/workflows/ci.yml`, solo para generar `CIRCUIT_DB_PASSWORD` como
  ya genera las otras; `scenarios/escuela/simulator.json` y `scenarios/escuela/documents/`;
  `CLAUDE.md`, `DEVELOPMENT_PLAN.md` y `README.md`.
- **No debe cambiar:** `apps/crm/` entero; las migraciones `0000` a `0004` y sus hashes; los
  roles, permisos y políticas de `crm`; la línea del núcleo en `module-map.ts`; `compose.yaml`;
  `guards/`; el formato de `scenarios/<id>/crm.json` (`apps/crm/src/scenario.ts`).
- **Fuera de alcance:** el servidor HTTP de circuit y el tablero (ADR-0011); la decisión del
  mentor, la estación 7 y el cliente HTTP que escribe en el CRM (ADR-0012); el adaptador de
  Anthropic y la batería de contrato (F3.1, que cierra ADR-0001 D3); defensas de inyección más
  allá de la lista fija (F4); precios y costos reales (F3, con fuente y fecha); borrar o
  archivar corridas viejas.

## Restricciones

- Solo datos sintéticos. Las pruebas usan bases desechables; la base de desarrollo se migra a
  `0005` solo después de `npm run db:backup -- --label antes-0005` (CLAUDE.md §7).
- El núcleo sigue determinista: sin reloj (usa el puerto `Clock`), sin azar, sin E/S.
- Funciones de menos de 50 líneas y archivos de menos de 400 (CLAUDE.md §6).
- npm y Vitest en PowerShell (CLAUDE.md §8). Cada prueba con base lleva
  `DATABASE_HOOK_TIMEOUT_MS` en sus hooks y `SEED_TEST_TIMEOUT_MS` donde siembre
  (`hook-budget.test.ts`).

## Daño a vigilar

- **`db:users` cambia** para crear un segundo usuario: un error ahí puede dejar sin crear o mal
  configurado a `crm_app`, del que depende el CRM. Las pruebas de `crm_app` siguen en verde sin
  tocarlas (D11).
- **CI necesita `CIRCUIT_DB_PASSWORD`.** Sin ella, las pruebas de D10, D11 y D16 fallan con el
  nombre de la variable, no se saltan.
- **La lista de patrones es un piso, no una defensa.** Una inyección que no coincide pasa a la
  3; el modelo la recibe delimitada (D4) y su salida no puede cambiar la ruta (D2), pero no
  está detenida. F4 la mejora.
- **Lo que la estación 2 deja pasar queda guardado para siempre**: el nombre y el correo en las
  propuestas de la 5, en una tabla que nadie puede borrar. Con datos sintéticos no hay daño; con
  datos reales, sí.
- **`simulator.json` queda atado al filtro:** cambiar cómo se tacha cambia el SHA-256 del
  texto, y los casos caen en la respuesta por defecto. Los casos dorados lo detectan.

## Reversión

- El código se revierte con sus commits.
- `0005` no se deshace (solo hacia adelante): en la base de desarrollo, se restaura el respaldo
  de antes en una base nueva (`npm run db:restore`) o se dejan las tablas sin usar. Los eventos
  guardados no se pueden borrar con el rol del servicio, por diseño.

## Consecuencias

- El tablero y la estación 7 tienen un formato fijo del que leer; F3 graba corridas con el
  mismo formato y las reproduce.
- Agregar una rama es cambiar una fila de `CIRCUIT`, y por ADR-0001 eso pide otra ADR.
- No hay evento «esperando» ni evento de estación saltada: quien lee los eventos necesita la
  tabla de transiciones para dibujar.
- Con el simulador no hay tokens ni costo: el tablero mostrará «—» hasta las corridas grabadas
  de F3.

## Preguntas abiertas

Cada una tiene su **ASUNCIÓN** escrita en la cláusula. Respondidas el 2026-11-26: el dueño
aceptó cada recomendación como está escrita, así que cada ASUNCIÓN queda como decisión. La 8
sigue abierta en su segunda mitad: si el material del programa no llega antes de F2.2, Claude
escribe los tres documentos y el dueño los aprueba antes del commit.

1. **Umbral de confianza (D3).** Recomendación: menor que 0.7 va a la persona.
2. **Patrones de inyección (D5).** Recomendación: una lista corta en español y en inglés
   («ignora las instrucciones», «ignore previous instructions», «olvida lo anterior», «eres
   ahora», «actúa como», «system prompt», «mensaje del sistema», la etiqueta de delimitación y
   `system:` o `assistant:` al inicio de una línea), con su id, sabiendo que es un piso.
3. **Qué se tacha (D6).** Recomendación: el correo sale a un campo aparte porque la 5 lo
   necesita; el teléfono y el documento se tachan y se descartan.
4. **Simulador por SHA-256 con respuesta por defecto (D12).** Recomendación: sí; la respuesta
   por defecto es `out_of_scope` con confianza 0, que lleva a la persona.
5. **Tokens y costo del simulador (D9).** Recomendación: nulos («sin fuente, no hay número»),
   no inventados; las estaciones de código dan 0.
6. **Sin evento «esperando» en la 6 (decisión).** Es una lectura de ADR-0001 D5 («un evento por
   estación visitada»): la 6 deja un solo evento, con la decisión. Recomendación: sí.
7. **El texto crudo no se guarda (D6).** Recomendación: no se guarda; `runs` guarda su SHA-256
   para saber si dos corridas tuvieron la misma entrada.
8. **El material del programa (D13).** Lo necesita F2.2. Recomendación: si no llega antes de
   F2.2, Claude escribe tres documentos cortos y sintéticos, uno por programa, desde lo que ya
   dice la propuesta privada, y el dueño los aprueba antes del commit.
9. **Un cuarto caso dorado (D15).** Recomendación: `low-confidence`, porque la regla 3 es otra
   entrada a la misma rama.
