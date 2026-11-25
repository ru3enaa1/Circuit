# ADR-0009 · El respaldo sale del contenedor y se prueba restaurándolo; la semilla carga un paquete de datos una vez por cuenta, firma `seed` y deja la llave del agente en un archivo que git ignora

- **Fecha:** 2026-11-25
- **Estado:** aceptada el 2026-11-25. El dueño aceptó las diez recomendaciones de
  «Preguntas abiertas» tal como están escritas («vamos con lo recomendado»). Al aceptarla se
  corrigieron dos chequeos de D4 y D7 que, como estaban escritos, no leían lo que decían
  (ver «Notas de implementación»).
- **Tarea:** F1.5 de `DEVELOPMENT_PLAN.md`, con R6 como primer paso. El pedido del dueño, tal
  cual: «un script de respaldo de la base de desarrollo (pg_dump dentro del contenedor, no
  por la tubería de PowerShell) con una restauración probada; después, una semilla
  idempotente y reproducible que carga las cuentas, empresas, contactos, etapas, notas y
  tareas sintéticas del escenario como un paquete cambiable (regla de producto 4), firma con
  proposed_by = approved_by = 'seed' (ADR-0005, H13) y emite la llave del agente
  {read,write} con el emisor de ADR-0008, decidiendo dónde queda para circuit sin entrar a
  git».
- **Retroactiva:** no. No hay script de respaldo, ni semilla, ni carpeta `scenarios/` (línea
  base: `docs/reviews/ADR-0009-baseline.md`, sobre `52e015d`).
- **Cita sin reescribir:** ADR-0003 (`scenarios/` en la raíz, con «datos sintéticos y
  material del programa (cambiable)», y su ejemplo `scenarios/escuela/`); ADR-0005 D5, D7–D11,
  la respuesta 7 y H13 (la semilla firma `seed`, sin llave); ADR-0006 D3 y D4 (`crm_owner` es
  dueño de todo `crm`; `crm_app` lo crea `db:users`); ADR-0008 D1, D3, D5 y D6 (la forma, el
  hash, toda llave con `read`, la llave solo después del `COMMIT`) y D13 (los tres «no»).
  CLAUDE.md §1 (datos sintéticos, reproducible, local sin llave) y §7 (respaldo → migrar →
  probar → verificar).
- **Enmienda, si el dueño acepta la pregunta 1:** la frase de secretos de CLAUDE.md §1.

## Contexto

**R6.** Los tres respaldos de `database/backups/` se hicieron a mano. Del de antes de `0004`,
la auditoría de ADR-0006 dejó escrito que su restauración no se pudo verificar. La línea base
midió por qué R6 pide el volcado dentro del contenedor: un volcado de 41 435 bytes, copiado con
`docker compose cp`, llega con el SHA-256 que tenía adentro; el mismo archivo, redirigido con
`>` en PowerShell 5.1, llega con 42 466 bytes, otro hash y código de salida 0. La corrupción
no avisa.

**La semilla.** La base de desarrollo tiene sus 5 migraciones y 0 filas en `crm`, así que
`db:keys issue` no tiene cuenta donde emitir. F1 entrega «datos sintéticos del escenario
cargados desde una semilla», y su trampa es «semillas que se ejecutan dos veces». Desde F2 esa
base recibe escrituras del agente que aprobó el mentor: volver a correr la semilla no puede
deshacerlas ni duplicarlas. La regla 4 pide que el escenario sea un paquete cambiable, así que
el código no puede saber qué escuela carga. ADR-0005 ya decidió ids `bigint` de identidad, para
que una base nueva dé los mismos ids, y que la semilla firme `seed`.

**La llave del agente.** ADR-0008 dejó a esta fase emitirla con el emisor real y decidir dónde
queda. No puede entrar a git. CLAUDE.md §1 dice «Secretos solo en variables de entorno». F6
pide que un `docker compose up` levante todo, y Compose lee `.env` al crear los contenedores,
antes de que corra cualquier semilla.

## Opciones consideradas

**Cómo sale el volcado**

1. **`pg_dump --format=custom` dentro del contenedor**, a un temporal; `pg_restore --list`
   dentro; `docker compose cp` afuera; y el SHA-256 de adentro comparado con el de afuera.
   Cuatro órdenes, y cada una prueba algo.
2. **`pg_dump` a la salida estándar**, capturada por Node como bytes. También llega exacta (la
   línea base lo midió con un binario de 504 656 bytes), pero el host no tiene `pg_restore`:
   leer el índice obligaría a meter el archivo otra vez al contenedor.
3. **Redirigir en PowerShell:** corrompe sin avisar (medido). Descartada.
4. **`pg_dumpall` con los roles:** el volcado llevaría el verificador SCRAM de `crm_app` y el
   del administrador. Descartada: los roles los recrean las migraciones y `db:users`.

**Dónde se restaura**

1. **Solo en una base nueva**, que el comando crea; si el nombre existe, no hace nada. Pasar
   a usar la restaurada es una decisión del dueño: apuntar `POSTGRES_DB` a ella.
2. **Encima de la base de desarrollo:** un solo comando para el desastre, pero un error borra
   la única copia. Descartada.

**Qué es un paquete**

1. **Datos en JSON**, `scenarios/<id>/crm.json`, validados con zod en modo estricto antes de
   conectarse. Cargar un paquete nunca corre código.
2. **Un módulo TypeScript que exporta los datos:** trae los tipos, pero cambiar de paquete
   sería correr código ajeno.
3. **Un `.sql`:** directo, pero sin validación propia y atado a los nombres de las columnas.

**Qué hace la segunda corrida**

1. **Una vez por cuenta:** una cuenta que no existe nace con todas sus filas en la misma
   transacción; una que ya existe (por su `slug`) se salta entera. Lo que escribió el agente
   sobrevive.
2. **Converger al paquete (upsert):** pisa lo que aprobó el mentor, y notas y tareas no
   tienen clave natural, así que pediría una migración.
3. **Borrar y recargar:** la bitácora no se borra (ADR-0005 D9) y quedaría apuntando a filas
   que ya no existen.

**Dónde queda la llave**

1. **En un archivo que git ignora**, nombrado por `CRM_AGENT_KEY_FILE` (en `.env.example`,
   `.secrets/crm-agent-key`). Se escribe después del `COMMIT`, de una vez (un temporal y un
   renombrado) y con modo `0600`. En F2 lo lee circuit; en F6 la variable puede apuntar a un
   volumen que comparten la semilla y circuit. Pide cambiar la frase de §1.
2. **La semilla escribe `CRM_AGENT_KEY=` en `.env`:** cumple §1 al pie de la letra, pero una
   herramienta reescribiría el archivo que guarda la contraseña del administrador. Además, una
   variable exportada en la terminal le gana a `.env` (`database/env.ts`) y taparía la llave
   nueva. Y en F6, Compose ya leyó `.env` cuando la semilla corre.
3. **Se imprime una vez y el dueño la pega en `.env`**, como hace `db:keys`: cada semilla
   nueva pide un paso a mano, y F6 deja de ser un solo comando.

## Decisión

La primera opción de cada grupo.

- **R6 (D1–D6):** `npm run db:backup` y `npm run db:restore`, en `database/`, como el
  administrador de `.env` y con las herramientas del contenedor. Un respaldo se da por bueno
  solo si su índice se lee y su hash coincide. Una restauración crea su base o no deja nada.
  La prueba de restauración compara el volcado completo del original y de la copia, y usa la
  copia como `crm_app`.
- **El paquete (D7–D10):** `scenarios/<id>/crm.json`, elegido por `CIRCUIT_SCENARIO`. El
  formato vive en `apps/crm/src/scenario.ts`: zod ya es dependencia del CRM, así que no entra
  ninguna nueva. Las reglas de datos sintéticos valen para todo paquete. El primero es
  `scenarios/escuela/`, el nombre que ya usa ADR-0003.
- **La semilla (D11–D17):** `npm run db:seed` (`database/seed.ts`), como administrador, en una
  transacción y bajo un candado. Siembra una vez por cuenta, firma `seed` y toma las fechas
  del paquete.
- **La llave (D18–D22):** la emite el paso de emitir de `database/keys.ts`, dentro de la misma
  transacción, con `{read,write}` y la etiqueta `agente`, fijados en el código. La semilla
  converge: si el archivo ya tiene la llave viva, no toca nada; si no, revoca las `agente`
  vivas de esa cuenta y emite otra.

## Cláusulas

`<base>` es `52e015d`. Las pruebas con base usan bases desechables
(`database/test/disposable-db.ts`), con `DATABASE_HOOK_TIMEOUT_MS` en cada hook (ADR-0007 A4),
y ninguna abre la base de desarrollo. Lo que escriben (respaldos, llaves) va a una carpeta
temporal del sistema, nunca a `database/backups/` ni a `.secrets/`. Los nombres de los archivos
de prueba son una propuesta; lo que cuenta es que cada chequeo exista y muerda.

### R6 · Respaldo y restauración

| Id | Regla | Chequeo | Crítica |
|---|---|---|---|
| D1 | `npm run db:backup -- --label <etiqueta>` corre `pg_dump --format=custom` dentro del contenedor `db` (`docker compose exec -T`), hacia un temporal del contenedor con un sufijo al azar, y lo copia con `docker compose cp` a `database/backups/<AAAAMMDD-HHMMSS>Z-<etiqueta>/circuit.dump`, con la hora en UTC. Lee la base de `POSTGRES_DB`; `--database` existe para las pruebas. La etiqueta tiene la forma de `SLUG_PATTERN` y se valida antes de correr nada. Nunca escribe en una carpeta que ya existe. El temporal del contenedor se borra al terminar, bien o mal (**ASUNCIÓN**, pregunta 9) | `backup-db.test.ts`, sobre una base desechable sembrada y con la salida en un temporal: sale con 0 y deja `circuit.dump` y `circuit.dump.sha256`; con la carpeta ya creada, sale con 1 y su contenido no cambia; con `--label "Antes semilla"`, sale con 1 sin llamar a docker (un ejecutor que falla si se lo llama); después de una corrida buena y de una que falla, `docker compose exec -T db ls /tmp` no muestra ningún temporal del respaldo | sí |
| D2 | Un respaldo se da por bueno solo si `pg_restore --list` lee el temporal dentro del contenedor y el SHA-256 que da `sha256sum` adentro es el del archivo del host. Ese hash queda en `circuit.dump.sha256`. Si algo falla, sale con 1 y borra la carpeta que creó: no queda un respaldo a medias | `backup-db.test.ts`: el hash del archivo del host es el de `sha256sum` en el contenedor; con un `cp` inyectado que cambia un byte, sale con 1 y la carpeta no existe | sí |
| D3 | El respaldo no lleva secretos, y ninguna orden los lleva. `pg_dump` entra por el socket local del contenedor (`trust`, ADR-0005 «Restricciones»), así que ninguna orden ni variable que recibe docker lleva `POSTGRES_PASSWORD`. No se usa `pg_dumpall`: el volcado no trae roles ni verificadores | `backup-db.test.ts`: las órdenes que registra el ejecutor no contienen la contraseña; el volcado de una base desechable, con `crm_app` en el servidor, no contiene `SCRAM-SHA-256$` ni la contraseña | sí |
| D4 | `npm run db:restore -- --file <circuit.dump> --into <base>` restaura solo en una base nueva que crea. El nombre cumple `^[a-z][a-z0-9_]{0,62}$`. Si la base ya existe (la de desarrollo, `postgres`, las plantillas u otra), sale con 1 sin tocarla. Antes de crear nada compara el archivo con su `.sha256`, si lo hay, y uno que no coincide sale con 1. Ningún comando del repositorio borra ni renombra la base de desarrollo (**ASUNCIÓN**, pregunta 2) | `restore-db.test.ts`: `--into` una base desechable que ya existe sale con 1, y su volcado es el mismo antes y después; un byte cambiado en el respaldo sale con 1 y la base nueva no existe; `git grep -n -E "DROP DATABASE\|RENAME TO" -- ':(glob)database/*.ts'` da solo la línea que borra la base que el mismo `db:restore` creó (D5) | sí |
| D5 | `pg_restore` corre dentro del contenedor con `--exit-on-error --single-transaction`. Si falla, `db:restore` borra la base que creó en esa corrida, y solo esa: no deja una base a medias | `restore-db.test.ts`: un respaldo truncado, con su `.sha256` recalculado para que pase D4, sale con 1 y `pg_database` no tiene la base | sí |
| D6 | La restauración está probada. Una base desechable migrada, con `seedReadFixture` (filas en las ocho tablas, archivadas y una llave revocada), se respalda con `db:backup` y se restaura con `db:restore` en otra. El `pg_dump --restrict-key=circuit` en texto, con dueños y permisos (sin `--no-owner`), de las dos bases es igual byte a byte. Como `crm_app`, en la copia: sin cuenta se ven 0 contactos; con la cuenta A, los de A; y `crm.resolve_api_key` devuelve la llave del agente de A y nada para la revocada | `restore-db.test.ts` | sí |

### El paquete del escenario

| Id | Regla | Chequeo | Crítica |
|---|---|---|---|
| D7 | Un escenario es la carpeta `scenarios/<id>/`; su parte del CRM es `crm.json`, solo datos. La semilla lo lee con `readFile` y `JSON.parse`, y nunca importa ni corre un archivo del paquete. Lo elige `CIRCUIT_SCENARIO`, que `.env.example` pone en `escuela`; sin ella, la semilla sale con 1 y la nombra, sin conectarse. El código no nombra ningún escenario: de un paquete a otro cambia solo el paquete (regla 4; **ASUNCIÓN**, pregunta 6) | `git grep -n -E "import\(\|require\(" -- database/seed.ts apps/crm/src/scenario.ts` da 0 líneas; `git grep -n -i -E "andamio\|diagn[oó]stico\|escuela" -- ':(glob)database/*.ts' ':(glob)apps/*/src/**'` da 0 líneas; `seed-db.test.ts` siembra un segundo paquete de prueba, con otras cuentas y otras etapas, y la base sigue a ese paquete sin cambiar el código | no |
| D8 | `apps/crm/src/scenario.ts` valida el paquete entero antes de conectarse. Es estricto: una clave desconocida, `__proto__` incluida, se rechaza (H9 de la auditoría de ADR-0006). Usa los límites de `schema.ts`: `slug` y clave de etapa con `SLUG_PATTERN`; nombres y títulos hasta 200 caracteres; notas hasta 4000; correo hasta 254, ya en minúsculas y con la forma de `input.ts`; ningún U+0000; `dueOn`, una fecha válida que no es del año 0000. Las etapas de una cuenta tienen claves distintas y posiciones de 0 a n−1. Cada contacto apunta a una etapa y, si tiene, a una empresa de su misma cuenta. Los correos no se repiten dentro de una cuenta. Hay exactamente una cuenta del agente, y está en el paquete. Un rechazo nombra la ruta (`accounts[0].contacts[2].email`), nunca el valor | `scenario.test.ts`, con una fábrica de conexiones que falla si se la llama: un caso por regla, cada uno con salida 1, 0 conexiones, la ruta en el mensaje y el valor fuera de las dos salidas | sí |
| D9 | Todo paquete es sintético por construcción (CLAUDE.md §1). El dominio de cada correo termina en `.test` o en `.example`, reservados para esto (RFC 2606 §2; RFC 6761 §6.2). Todo `revenueRange` lleva la marca «(ficticio)». Y un paquete no puede declarar llaves, permisos, autores ni ids (**ASUNCIÓN**, pregunta 7) | `scenario.test.ts`: `persona@gmail.com`, un rango sin la marca y un paquete con `keys`, `permissions`, `proposedBy` o `id`, cada uno rechazado antes de conectarse | sí |
| D10 | El primer paquete, `scenarios/escuela/crm.json`, trae los insumos de F1 que el dueño entregó el 2026-11-24. La cuenta `escuela-andamio` es la del agente, con las seis etapas en este orden: `nueva`, `diagnostico`, `programa-propuesto`, `conversacion-agendada`, `inscrita` y `descartada`. Tiene entre cuatro y cinco empresas con sector, tamaño y facturación ficticia, y sus contactos, notas y tareas. Trae también una segunda cuenta, `cuenta-vecina`, con al menos un contacto, para que el aislamiento se vea en la base real (**ASUNCIÓN**, pregunta 3). Las dos listas de frases prohibidas, la pública y la local, pasan limpias sobre `scenarios/` | `scenario-content.test.ts` lee el paquete real: las claves de etapa en orden, el número de empresas y sus tres campos, la cuenta del agente y la vecina. `bash guards/check-forbidden-phrases.sh forbidden-phrases.txt README.md apps database scenarios` da 0 (el paso de CI suma `scenarios`); `git ls-files -z \| xargs -0 bash guards/check-forbidden-phrases.sh forbidden-phrases.local.txt` da 0 | no |

### La semilla

| Id | Regla | Chequeo | Crítica |
|---|---|---|---|
| D11 | `npm run db:seed` corre como el administrador de `.env`, sobre la base de `POSTGRES_DB`, en una sola transacción. Si falta `crm.accounts`, porque la base no se migró, sale con 1 y dice «corre npm run db:migrate antes», sin escribir nada | `seed-db.test.ts`: sobre una base desechable sin migrar, salida 1 y ese mensaje | no |
| D12 | Cada escritura de la semilla firma `proposed_by = approved_by = 'seed'`, con `api_key_id` y `approval_ref` nulos (ADR-0005, respuesta 7 y H13; **ASUNCIÓN** para `approval_ref`, pregunta 8). La semilla nunca escribe en `audit_log`: cada fila la escribe el trigger | `seed-db.test.ts`: después de sembrar, `audit_log` tiene tantas filas como empresas, contactos, notas y tareas se sembraron, todas `insert` y con esos cuatro valores; `git grep -n -i -E "(INSERT INTO\|UPDATE) crm.audit_log" -- database/seed.ts` da 0 líneas | sí |
| D13 | Una vez por cuenta. Una cuenta del paquete que no existe nace con todas sus filas; una cuyo `slug` ya existe se salta entera, y ninguna de sus filas se escribe ni cambia, tenga lo que tenga. Una segunda corrida sobre la misma base no cambia ningún conteo de las ocho tablas (**ASUNCIÓN**, pregunta 4) | `seed-db.test.ts`: sembrar, anotar por la API con la llave del agente, sembrar otra vez. Los conteos son los de antes de la segunda corrida, la nota sigue y no hay filas repetidas; la salida dice «ya estaba» por cada cuenta | sí |
| D14 | Todo o nada: si cualquier sentencia falla, incluido el `COMMIT`, quedan 0 filas en las ocho tablas, ninguna llave y ningún archivo de llave | `seed-db.test.ts`, con un conector que falla en la primera sentencia de la segunda cuenta, y con otro cuyo `COMMIT` falla: los conteos siguen en 0, y ni el archivo ni su temporal existen | sí |
| D15 | Reproducible. En dos bases nuevas, el mismo paquete da las mismas filas, ids incluidos, en todas las columnas menos tres: `audit_log.occurred_at`, que es el momento en que se escribió, y `api_keys.key_hash` y `api_keys.created_at`, que son de la llave. Cada `created_at` sale del paquete: el de la fila si trae uno, o si no el del paquete entero (**ASUNCIÓN**, pregunta 5). El orden de inserción es fijo: las cuentas en el orden del paquete y, dentro de cada una, las etapas por posición, las empresas, los contactos, sus notas y sus tareas, cada lista en el orden del paquete | `seed-db.test.ts`: dos bases desechables sembradas con el paquete real; el `to_jsonb` de cada fila, ordenadas por id y sin esas columnas, es igual en las dos; el id de la primera empresa del paquete es el menor de su tabla | no |
| D16 | Dos semillas a la vez sobre la misma base terminan igual que una. La semilla toma un candado de sesión (`pg_advisory_lock`) antes de su transacción y lo suelta después de escribir el archivo de la llave | `seed-db.test.ts`: dos corridas con `Promise.all` sobre una base nueva salen con 0; queda un solo juego de filas y una sola llave `agente` viva, y el archivo tiene esa llave | no |
| D17 | La salida dice, por cada cuenta, «sembrada» o «ya estaba» con sus conteos, y la ruta del archivo de la llave. Nunca muestra un nombre, un correo ni la llave. Un error se describe con su SQLSTATE y su restricción, o con un mensaje propio; nunca con el mensaje ni el `detail` de PostgreSQL, que traen valores (como `db:keys`, ADR-0008 D6) | `seed-db.test.ts`: ninguna salida de una corrida buena, ni de una que choca con el índice de correos, contiene un correo, un nombre del paquete ni la llave. El choque se arma con un paquete ya parseado que salta la validación (23505), y la prueba comprueba primero que su `detail` sí trae el correo | sí |

### La llave del agente

| Id | Regla | Chequeo | Crítica |
|---|---|---|---|
| D18 | La semilla emite la llave del agente con el paso de emitir de `database/keys.ts`, el mismo que usa `db:keys issue` (`generateApiKey`, la forma de `API_KEY_SHAPE` y `hashApiKey`), dentro de su transacción y en la cuenta del agente del paquete. La etiqueta es `agente` y los permisos, exactamente `{read,write}`, fijados en el código (`AGENT_KEY_LABEL`, `AGENT_KEY_PERMISSIONS`) y no en el paquete. `db:keys` no cambia de conducta: lo único que cambia es que exporta ese paso | `git grep -n "INSERT INTO crm.api_keys" -- database/seed.ts` da 0 líneas. `seed-db.test.ts`: una sola llave viva `agente`, `{read,write}`, en `escuela-andamio`, y ninguna en `cuenta-vecina`. `keys-command`, `keys-db` y `keys-process` siguen con 20, 11 y 2 pruebas, sin cambios y en verde | sí |
| D19 | La llave converge. Si el archivo tiene una llave con la forma de ADR-0008 D1 cuyo hash es el de una llave `agente` viva, `{read,write}`, de la cuenta del agente, la semilla no toca `api_keys` ni el archivo. Si no la tiene (no hay archivo, tiene otra forma, la llave está revocada o es de otra base), revoca toda llave `agente` viva de esa cuenta, emite una nueva y la escribe. Las llaves con otra etiqueta no se tocan | `seed-db.test.ts`, en tres corridas. La primera emite una. La segunda deja la misma fila, y el archivo con los mismos bytes. Sin el archivo, la tercera revoca la anterior (la fila sigue, con `revoked_at`) y deja una nueva, viva y en el archivo. Una llave `mentor` emitida con `db:keys` sigue viva en las tres | sí |
| D20 | La llave se escribe solo después del `COMMIT`, en la ruta de `CRM_AGENT_KEY_FILE` (relativa a la raíz del repositorio, o absoluta), de una vez: un temporal en la misma carpeta y un renombrado. El archivo tiene la llave y un salto de línea, nada más, y nace con modo `0600`. La llave nunca sale por la salida estándar ni por la de errores | `seed-db.test.ts`: el archivo es una llave que cumple `API_KEY_SHAPE`, seguida de `\n`; en Linux (CI), `(mode & 0o077) === 0`; con el `COMMIT` que falla de D14, no queda archivo ni temporal; ninguna salida contiene la llave | sí |
| D21 | El lugar por omisión no entra a git: `.gitignore` suma `.secrets/`, y `.env.example` trae `CRM_AGENT_KEY_FILE=.secrets/crm-agent-key` (**ASUNCIÓN**, pregunta 1). Sin la variable, la semilla sale con 1 y la nombra, sin conectarse | `git check-ignore -q .secrets/crm-agent-key` sale con 0 (en la línea base, 1). Después de sembrar la base de desarrollo, `bash guards/check-secrets.sh` da 0 con el archivo presente. `check-secrets.test.sh` suma un control: la misma llave en un archivo nuevo que git no ignora sale con 1 | sí |
| D22 | El criterio de F1, sobre los datos sembrados. Contra el servidor real y una base desechable sembrada con el paquete real, la llave que la semilla dejó en su archivo lee un contacto de `escuela-andamio` (200) y anota (201); al archivar recibe 403 «borrado», al exportar 403 «exportación», y en `cuenta-vecina`, que existe y tiene contactos, 403 `cuenta_ajena`. En los tres 403, los conteos de `contacts`, `notes` y `audit_log` no cambian | `seed-agent-key-db.test.ts`, en `apps/crm/test/`, como `agent-key-db.test.ts` | sí |

### Lo que no cambia

| Id | Regla | Chequeo | Crítica |
|---|---|---|---|
| D23 | F1.5 no agrega migraciones ni dependencias, no cambia el esquema ni los permisos, y no toca `compose.yaml` ni el código de `apps/circuit`. De `apps/circuit` cambia solo el comentario de `src/modules/scenario/index.ts`, que hoy dice que el cargador llega en F1.5 | `git diff --exit-code 52e015d -- database/migrations database/test/migration-hashes.ts database/schema.sql apps/crm/src/db/schema.ts package-lock.json compose.yaml` sale con 0; `git diff --stat 52e015d -- apps/circuit` muestra solo ese archivo; `npm ls --workspace @circuit/crm --depth=0` lista las cuatro de ADR-0006 D2; `npm audit --audit-level=low` da 0 | sí |
| D24 | Nada de ADR-0005 a ADR-0008 se debilita. Los conteos por archivo de la línea base no bajan, y ninguna prueba existente cambia, salvo lo que nombra el cerco. La API del CRM no cambia. `.github/workflows/ci.yml` cambia solo para sumar `scenarios` al paso de frases prohibidas. Ningún archivo pasa de 400 líneas | Los conteos de la línea base, archivo por archivo; `git diff --exit-code 52e015d -- apps/crm/src/routes apps/crm/src/server apps/crm/src/db apps/crm/src/keys.ts apps/crm/src/main.ts` sale con 0; `git diff 52e015d -- .github/workflows/ci.yml` muestra solo esa línea; `git ls-files '*.ts' \| xargs wc -l \| awk '$1 > 400 && $2 != "total"'` no da ninguna línea | sí |
| D25 | Los comandos reales funcionan. `node database/backup.ts` con una etiqueta inválida, y `node database/seed.ts` sin `CIRCUIT_SCENARIO`, salen con 1 y su motivo, sin llamar a docker ni conectarse. `db:backup` y `db:seed` contra una base desechable salen con 0 | `backup-process.test.ts` y `seed-process.test.ts`, con el proceso real y `PROCESS_TEST_TIMEOUT_MS` | no |
| D26 | La base de desarrollo pasa por el ritual de CLAUDE.md §7: un respaldo (`db:backup -- --label antes-semilla`); su restauración en `circuit_verifica_semilla`, que después se borra a mano; la semilla; una segunda semilla que no cambia nada; y la app real: con `crm:start` y la llave del archivo, `GET /accounts/escuela-andamio/stages` da 200 y `cuenta-vecina` da 403. También se restaura una vez `2026-11-24-1921-antes-0004/circuit.dump` en una base que después se borra, para cerrar lo que la auditoría de ADR-0006 dejó sin verificar (**ASUNCIÓN**, pregunta 10) | Las salidas de «En la base de desarrollo», abajo, registradas en el estado del plan | no |

### Chequeos, tal como se corren

En PowerShell (CLAUDE.md §8), con la base levantada y `CRM_DB_PASSWORD` en `.env`:

```powershell
docker compose up -d --wait db
npm run check; echo $LASTEXITCODE                                   # todo, con el piso de cobertura: 0
npx vitest run --project database backup restore                    # D1–D6
npx vitest run --project database scenario seed                     # D7–D17 y D25
npx vitest run --project '@circuit/crm' seed-agent-key keys         # D18–D22, y el emisor sin cambios
npm ls --workspace @circuit/crm --depth=0                           # D23
npm audit --audit-level=low                                         # D23: 0
```

En Git Bash:

```sh
git diff --exit-code 52e015d -- database/migrations database/test/migration-hashes.ts database/schema.sql apps/crm/src/db/schema.ts package-lock.json compose.yaml; echo $?   # D23: 0
git diff --exit-code 52e015d -- apps/crm/src/routes apps/crm/src/server apps/crm/src/db apps/crm/src/keys.ts apps/crm/src/main.ts; echo $?   # D24: 0
git check-ignore -q .secrets/crm-agent-key; echo $?                                     # D21: 0
git grep -n -E "import\(|require\(" -- database/seed.ts apps/crm/src/scenario.ts | wc -l   # D7: 0
git grep -n -i -E "andamio|diagn[oó]stico|escuela" -- ':(glob)database/*.ts' ':(glob)apps/*/src/**' | wc -l   # D7: 0
git grep -n -E "DROP DATABASE|RENAME TO" -- ':(glob)database/*.ts'                       # D4: solo la línea de restore.ts
git grep -n "INSERT INTO crm.api_keys" -- database/seed.ts | wc -l                       # D18: 0
bash guards/check-forbidden-phrases.sh forbidden-phrases.txt README.md apps database scenarios; echo $?   # D10: 0
git ls-files -z | xargs -0 bash guards/check-forbidden-phrases.sh forbidden-phrases.local.txt; echo $?   # D10: 0
bash guards/check-secrets.test.sh; echo $?                                               # D21: 0
bash guards/check-secrets.sh; echo $?                                                    # D21: 0, también con el archivo de la llave presente
git ls-files '*.ts' | xargs wc -l | awk '$1 > 400 && $2 != "total"'                      # D24: ninguna línea
```

### En la base de desarrollo (D26)

Solo después de que el dueño acepte la ADR y de que todo lo anterior dé 0. En PowerShell:

```powershell
npm run db:backup -- --label antes-semilla             # 0: la carpeta y su SHA-256
npm run db:restore -- --file database\backups\<carpeta>\circuit.dump --into circuit_verifica_semilla   # 0
npm run db:seed                                        # 0: escuela-andamio y cuenta-vecina «sembrada», y la ruta de la llave
npm run db:seed                                        # 0: las dos «ya estaba»; la llave sin cambios
npm run db:keys -- list --account escuela-andamio      # una llave agente, read,write, sin revocar
npm run crm:start                                      # en otra terminal, lo de abajo; Ctrl+C lo detiene
$k = (Get-Content .secrets\crm-agent-key -Raw).Trim(); Invoke-WebRequest -UseBasicParsing -Headers @{ Authorization = "Bearer $k" } http://127.0.0.1:4010/accounts/escuela-andamio/stages   # 200
```

La base de verificación se borra a mano, dentro del contenedor:
`docker compose exec -T db psql -U <admin> -d postgres -c "DROP DATABASE circuit_verifica_semilla"`.

### Mutantes

Cada uno se planta en el código real, se restaura después (comprobado por hash) y debe poner en
rojo su prueba. Nunca en un worktree con enlaces al clon (CLAUDE.md §8).

| Id | Cláusula | Mutante |
|---|---|---|
| M1 | D1 | El respaldo escribe en una carpeta que ya existe |
| M2 | D1 | El temporal del contenedor no se borra cuando algo falla |
| M3 | D2 | La copia pasa por la salida estándar leída como texto UTF-8: el hash dejaría de coincidir |
| M4 | D2 | Sin la comparación de hashes: el `cp` que cambia un byte saldría con 0 |
| M5 | D3 | `pg_dump` recibe la contraseña en `PGPASSWORD` |
| M6 | D4 | `db:restore` sin la comprobación de que la base no existe |
| M7 | D5 | Sin `--single-transaction` y sin borrar la base al fallar: quedaría una base a medias |
| M8 | D6 | `pg_dump --no-owner`: la copia tendría otro dueño |
| M9 | D6 | `pg_dump --no-acl`: la copia perdería los permisos |
| M10 | D8 | El formato acepta claves desconocidas (`z.object` en vez de `z.strictObject`) |
| M11 | D9 | Sin la regla de los dominios reservados |
| M12 | D12 | La semilla firma `approved_by = 'mentor'` |
| M13 | D13 | Sin la regla de una vez por cuenta: la segunda corrida chocaría con 23505 o duplicaría |
| M14 | D14 | Una transacción por cuenta: la falla en la segunda dejaría la primera |
| M15 | D15 | `created_at` con `now()` en vez de la fecha del paquete |
| M16 | D17 | La descripción del error suma el `detail` de PostgreSQL |
| M17 | D18 | La semilla inserta la llave por su cuenta, con `{read,write,export}` |
| M18 | D19 | La semilla siempre rota: la segunda corrida cambiaría la llave |
| M19 | D19 | La rotación revoca toda llave viva de la cuenta, no solo las `agente` |
| M20 | D20 | El archivo se escribe antes del `COMMIT` |
| M21 | D21 | `.gitignore` sin `.secrets/` |
| M22 | D16 | Sin el candado: una de las dos corridas a la vez saldría con 1 |

## Cerco

- **Puede cambiar:**
  - `database/backup.ts`, `database/restore.ts` y `database/seed.ts`, nuevos, y los scripts
    `db:backup`, `db:restore` y `db:seed` de `package.json`.
  - `database/keys.ts`: solo para exportar el paso de emitir (y el de revocar, si la semilla
    lo usa), sin cambio de conducta (D18).
  - `apps/crm/src/scenario.ts`, nuevo: el formato del paquete, con zod.
  - `scenarios/escuela/crm.json`, nuevo.
  - `database/test/` y `apps/crm/test/`: pruebas nuevas y paquetes de prueba. A
    `disposable-db.ts` se le puede sumar un ayudante que borre una base `circuit_test_…` que
    una prueba nombró, sin cambiar lo que ya hace.
  - `.gitignore` (`.secrets/`) y `.env.example` (`CIRCUIT_SCENARIO`, `CRM_AGENT_KEY_FILE`).
  - `.github/workflows/ci.yml`: solo `scenarios` en el paso de frases prohibidas (D24).
  - `guards/check-secrets.test.sh`: el control de D21. La guarda misma no cambia.
  - El comentario de `apps/circuit/src/modules/scenario/index.ts` (D23).
  - Los documentos: `README.md` (respaldar, restaurar, sembrar y dónde queda la llave),
    `CLAUDE.md` (§1 si se acepta la pregunta 1; §2, §4, §7, §8 con la trampa de la tubería de
    PowerShell, y §9), `DEVELOPMENT_PLAN.md` (R6 cerrada y el estado de F1.5), esta ADR, su
    línea base y su auditoría.
- **No debe cambiar:**
  - `database/migrations/`, `database/test/migration-hashes.ts`, `database/schema.sql` y
    `apps/crm/src/db/schema.ts` (D23).
  - Las dependencias y el lockfile (D23).
  - `compose.yaml` y el código de `apps/circuit` (D23).
  - La API del CRM: `apps/crm/src/routes/`, `server/`, `db/`, `keys.ts` y `main.ts` (D24).
  - `database/users.ts`, los roles, sus permisos y sus políticas.
  - `guards/check-secrets.sh` y el hook de `pre-push`.
  - Las pruebas existentes, `crm-fixture.ts` incluido: se les puede sumar, no cambiar.
- **Fuera de alcance:**
  - Que circuit lea la llave (F2) y los documentos de la estación 4, que llegan a la misma
    carpeta del paquete (F2).
  - Correr la semilla dentro de Compose (F6).
  - Restaurar en un servidor nuevo, sin los roles: los recrean `db:migrate` y `db:users`.
  - Respaldos automáticos, programados, cifrados o con rotación.
  - Cambiar la base de desarrollo por la restaurada con un script.
  - Volver a sembrar una cuenta que cambió en el paquete: pide una base nueva (pregunta 4).
  - Filas archivadas en el paquete, y llaves que no sean la del agente.

## Restricciones

- **Herramientas:** Docker Desktop encendido. `pg_dump`, `pg_restore` y `sha256sum` (18.7)
  existen solo dentro del contenedor; el host no tiene `psql` (CLAUDE.md §5). npm y Vitest
  corren en PowerShell (§8). Los comandos de docker corren desde la raíz del repositorio,
  como `schema-dump-db.test.ts`, porque Compose busca ahí su proyecto.
- **El `/tmp` del contenedor** tiene 947 GB libres (línea base). Los temporales llevan un
  sufijo al azar para que dos corridas no choquen.
- **Datos personales:** un respaldo trae nombres y correos, sintéticos, y los hashes de las
  llaves. Queda en `database/backups/`, que git ignora, y nunca se imprime.
- **Windows:** en NTFS, Node solo traduce el modo `0600` al bit de solo lectura. La prueba del
  modo corre en Linux, en CI; en la máquina del dueño, el archivo queda bajo su perfil.
- **Fechas:** las carpetas de respaldo, en UTC y con `Z`; las del paquete, en ISO 8601 con `Z`.
- **Límites:** los de ADR-0005 (200, 4000 y 254 caracteres; `SLUG_PATTERN`), los mismos que
  usa la API.
- **Tamaño:** el paquete tiene decenas de filas. No hace falta otro presupuesto de tiempo que
  `DATABASE_HOOK_TIMEOUT_MS` y `PROCESS_TEST_TIMEOUT_MS`.

## Daño a vigilar

- **La base de desarrollo:** la primera semilla escribe ahí, y sus filas de bitácora no se
  borran nunca (ADR-0005 D9). Un paquete malo, una vez sembrado, solo se deshace con una base
  nueva. Por eso D26 respalda antes de sembrar.
- **La `.env` del dueño no trae `CIRCUIT_SCENARIO` ni `CRM_AGENT_KEY_FILE`:** `db:seed` sale
  con 1 y las nombra. El README dice cómo sumarlas.
- **Una rotación de la llave (D19) deja sin acceso a un circuit que ya la leyó (F2):** circuit
  la lee al arrancar, así que se reinicia.
- **`.secrets/` mal ignorada metería la llave a git:** lo vigilan `git check-ignore` (D21) y la
  guarda de secretos, en el hook de `pre-push` y en CI.
- **Las restauraciones de verificación se acumulan en el servidor de desarrollo:** D26 borra
  la suya a mano.
- **Las pruebas pueden dejar bases `circuit_test_…` o temporales en el `/tmp` del
  contenedor:** después de `npm run check`, `SELECT datname FROM pg_database` y `ls /tmp`
  dentro del contenedor no muestran ninguno.
- **El candado de sesión (D16):** si el proceso muere, PostgreSQL lo suelta al cerrarse la
  conexión.

## Reversión

Revertir los commits quita los comandos, el paquete y sus pruebas. No hay migración, así que el
esquema no tiene nada que deshacer.

Las filas que siembra la semilla en la base de desarrollo no se pueden borrar por la API, y no
deben borrarse a mano: la bitácora quedaría apuntando a filas que no existen. Para volver
atrás, se restaura el respaldo de antes de la semilla en una base nueva y se apunta
`POSTGRES_DB` a ella; o se recrea la base (`docker compose down -v`, `db:migrate`,
`db:users`), que lo borra todo. La llave se revoca con `npm run db:keys -- revoke --id <id>`, y
se borra `.secrets/crm-agent-key`.

Lo que no se deshace: después del push, el paquete es público. Es sintético.

## Consecuencias

- F1 queda con todo lo que entrega. Cerrarla e integrarla a `main` lo decide el dueño.
- F2 tiene datos estables, ids y fechas, para sus casos dorados; una llave en un archivo que
  su cliente lee; y la carpeta del paquete donde suma los documentos de la estación 4.
- R6 se cierra, y cada migración futura sobre la base de desarrollo empieza con `db:backup`.
- Cambiar el paquete de una cuenta ya sembrada pide una base nueva. Es el precio de no pisar
  lo que escribió el agente.
- F6 puede correr la semilla dentro de Compose, con `CRM_AGENT_KEY_FILE` en un volumen. Se
  decide en F6.
- Si se acepta la pregunta 1, la frase de secretos de §1 admite un archivo que git ignora.

## Notas para implementar

En este orden, un commit por paso, con `npm run check` en 0 antes de cada uno:

1. **R6 (D1–D6):** `backup.ts`, `restore.ts`, sus scripts y sus pruebas, con el fixture de
   siempre. R6 no espera al paquete.
2. **El paquete (D7–D10):** `scenario.ts`, `scenarios/escuela/crm.json`, sus pruebas y
   `scenarios` en el paso de CI.
3. **La semilla y la llave (D11–D22, D25):** `seed.ts`, el paso exportado de `keys.ts`,
   `.gitignore`, `.env.example`, el control de la guarda y sus pruebas.
4. **Los documentos:** el README, CLAUDE.md, el plan y el comentario de circuit.
5. **La base de desarrollo (D26),** con el dueño al tanto.

Las pruebas nuevas se ven en rojo antes del código, o las muerde su mutante.

## Notas de implementación (2026-11-25)

- **Dos chequeos corregidos al aceptar (D4 y D7).** En git, `*` de una ruta sin `:(glob)` cruza
  `/`: `'database/*.ts'` tomaba también los 17 archivos de `database/test/`, así que D4 habría
  mostrado el `DROP DATABASE` de `disposable-db.ts` y D7 habría puesto en rojo las pruebas que
  leen el paquete real. Y `'apps/*/src'` no casaba con ningún archivo (`git ls-files` da 0): D7
  habría pasado sin leer las apps. Los dos van ahora con `:(glob)`, que lee solo lo que nombra.

## Preguntas abiertas

Cada una tiene escrita su recomendación como **ASUNCIÓN** en la cláusula que afecta.
Respondidas el 2026-11-25: el dueño aceptó cada recomendación como está escrita, así que
cada ASUNCIÓN queda como decisión.

1. **¿La llave del agente queda en `.secrets/crm-agent-key`, un archivo que git ignora y que
   nombra `CRM_AGENT_KEY_FILE`, y §1 pasa a decir «Secretos solo en variables de entorno o en
   archivos que git ignora y que una variable nombra; nunca en el repositorio ni en el estado
   de Terraform versionado»?** Recomendación: sí. Es la única opción que no reescribe `.env` y
   que sirve en F6 sin un paso a mano. Si la respuesta es no, entra la opción 2 (la semilla
   escribe `CRM_AGENT_KEY` en `.env`), y cambian D20 y D21 (D20, D21).
2. **¿Se restaura solo en una base nueva, y pasar a usarla es apuntar `POSTGRES_DB` a ella?**
   Recomendación: sí. Un comando que pisa la base de desarrollo convierte un error en la
   pérdida de la única copia (D4).
3. **¿El primer paquete trae una segunda cuenta, `cuenta-vecina`?** Recomendación: sí. Así la
   base real muestra que la llave del agente no ve una cuenta que existe y tiene datos, y no
   solo una que no existe (D10, D22).
4. **¿Volver a sembrar es una vez por cuenta, sin upsert ni orden de reinicio?**
   Recomendación: sí. Es lo único que no pisa lo que aprobó el mentor; un paquete cambiado se
   siembra en una base nueva (D13).
5. **¿Cada `created_at` sale del paquete?** Recomendación: sí. Así los ids y las fechas son
   los mismos en cada clon, y los casos dorados de F2 no dependen del reloj. La bitácora
   guarda la hora real (D15).
6. **¿El paquete es `scenarios/escuela/crm.json`, con el formato en `apps/crm/src/scenario.ts`,
   elegido por `CIRCUIT_SCENARIO`, y CI suma `scenarios` a las frases prohibidas?**
   Recomendación: sí. Es la carpeta de ADR-0003, y zod ya es del CRM (D7, D10).
7. **¿Las reglas de datos sintéticos (dominios reservados, la marca «(ficticio)», ni llaves ni
   autores) valen para todo paquete?** Recomendación: sí. Es un innegociable de §1, y así un
   paquete nuevo no puede saltárselo (D9).
8. **¿`approval_ref` queda nulo en lo que siembra la semilla?** Recomendación: sí. No hay una
   aprobación a la que apuntar, y `approved_by = 'seed'` ya lo dice (D12).
9. **¿La carpeta del respaldo es `<AAAAMMDD-HHMMSS>Z-<etiqueta>`, en formato custom y con su
   `.sha256` al lado? ¿Y la semilla no respalda por su cuenta?** Recomendación: sí a las dos.
   Un respaldo automático en cada corrida llenaría `database/backups/` de copias de una base
   vacía; el ritual de D26 es explícito (D1).
10. **¿Se restaura una vez el respaldo de antes de `0004`, para cerrar lo que la auditoría de
    ADR-0006 dejó sin verificar?** Recomendación: sí, dentro de D26, en una base que después se
    borra (D26).
