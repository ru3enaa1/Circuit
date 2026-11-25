# ADR-0007 · La API de escritura del CRM escribe solo con una aprobación, firma al proponente con la llave y deja leer la bitácora

- **Fecha:** 2026-11-25
- **Estado:** aceptada el 2026-11-25. El dueño aceptó las nueve recomendaciones de
  «Preguntas abiertas» tal como están escritas.
- **Tarea:** F1.3 de `DEVELOPMENT_PLAN.md`, «API de escritura con bitácora» del CRM simulado.
  Suma lo que dejaron para esta fase ADR-0005 (H7: nunca mandar `id` ni `created_at`; que
  `proposed_by` salga de la llave y no del cliente), ADR-0006 (la lectura de la bitácora) y
  la auditoría de ADR-0006 (H9: una prueba de `__proto__` por cada cuerpo nuevo).
- **Retroactiva:** no. Todavía no hay ninguna ruta que escriba (línea base:
  `docs/reviews/ADR-0007-baseline.md`).
- **Cita sin reescribir:** ADR-0001 D4 (nada se escribe sin aprobación); ADR-0005 D4–D9
  (RLS, sin borrar, la bitácora por trigger y el autor obligatorio); ADR-0006 D8–D10 y
  D12–D16 (la llave, la cuenta, la transacción por petición, los campos, la entrada y el
  registro), con sus enmiendas A6–A7, que ya corrigieron F-1 y F-2 de la línea base.
  **Enmienda** ADR-0006 D11: la lista de rutas pasa a ser la de D1 de esta ADR.

## Contexto

La estación 5 de circuit solo propone; la persona aprueba en la estación 6, y la estación 7
aplica lo aprobado en el CRM. El conector del CRM ofrece cinco herramientas: buscar el
contacto, crearlo o actualizarlo, anotar, crear una tarea y moverlo de etapa. F1.2 dejó la
búsqueda. Faltan las escrituras, y con ellas el innegociable que más pesa en el CRM: toda
escritura queda en bitácora con quién la propuso y quién la aprobó.

La base ya hace casi todo (ADR-0005). El trigger escribe la bitácora en la misma
transacción y rechaza una escritura sin `crm.proposed_by` o sin `crm.approved_by`. RLS ata
cada fila a la cuenta. `crm_service` ya tiene `INSERT` y `UPDATE` sobre las cuatro tablas
de negocio y `SELECT` sobre `audit_log` (línea base), así que F1.3 no necesita migración.
Lo que falta es la API que llena ese contexto. Hay cinco fuerzas:

- **El proponente lo fija el CRM, no quien llama** (ADR-0005, cerco). La llave es lo único
  que el CRM sabe del que propone.
- **La aprobación no la puede comprobar el CRM** (ADR-0005, «Daño a vigilar»). Circuit la
  afirma; el CRM la guarda y rechaza lo que a todas luces no es una aprobación.
- **«La llave del agente no borra» tiene que fallar por la razón correcta**: un 403 con
  motivo, no un 404 porque la ruta no existe (criterio de F1). Para eso tiene que haber una
  ruta que archive, y archivar es borrar (ADR-0005 D6).
- **Los errores de la base llegan envueltos.** drizzle-orm 0.45.4 envuelve cada error de
  pg en un `DrizzleQueryError` cuyo mensaje lleva el SQL y sus parámetros, es decir, los
  valores. Por eso el registro perdía el SQLSTATE (línea base, F-2), y `errorCodes` ya lee
  la causa (ADR-0006 A7). Para responder 409 ante un correo repetido, la API tiene que leer
  esa misma causa y no el mensaje.
- **Un texto que zod deja pasar puede romper la base.** Un NUL daba 500 en la búsqueda
  (línea base, F-1; el correo ya lo rechaza, ADR-0006 A6), y un sustituto UTF-16 suelto se
  guardaría como U+FFFD sin avisar.

## Opciones consideradas

**Forma de las escrituras**

1. **Una ruta por acción**, cada una en su transacción: crear contacto, actualizarlo,
   anotar, crear tarea y archivar. Mapea uno a uno con las herramientas del conector, y
   cada fila de la bitácora queda junto a su escritura. A cambio, una propuesta con tres
   acciones son tres transacciones: si falla la segunda, la primera queda hecha.
2. **Una ruta que aplica una propuesta entera** en una transacción, con una lista de
   operaciones. Es todo o nada. A cambio, valida una unión de tipos, y crear un contacto y
   anotarlo en la misma lista pide referencias a ids que todavía no existen.

**De dónde sale `proposed_by`**

1. **`key-<id>` de la llave que firma:** un identificador opaco que cumple
   `AUDIT_AUTHOR_PATTERN`, sin migración. Repite `api_key_id`, pero deja la fila legible
   sola.
2. **Una columna nueva en `api_keys`** con el nombre del que propone (por ejemplo,
   `agente`). Más legible. A cambio, una migración y una función nueva: `resolve_api_key`
   no puede cambiar lo que devuelve sin borrarla, y las reglas de migraciones prohíben las
   órdenes de borrado.
3. **Lo manda circuit:** contradice el cerco de ADR-0005.

**Dónde viaja la aprobación**

1. **En el cuerpo**, como `approval: { approvedBy, approvalRef }`, validada por zod en modo
   estricto como el resto.
2. **En cabeceras propias.** Funciona también para un `DELETE` sin cuerpo. A cambio, es una
   segunda vía de entrada con sus propias reglas.

## Decisión

La primera opción de cada grupo.

- **Seis rutas nuevas** (D1): crear contacto, actualizarlo (también lo mueve de etapa),
  anotar, crear tarea, archivar el contacto y leer la bitácora. Cada escritura es una
  transacción `READ WRITE` en su propia conexión, con el mismo orden que las lecturas: la
  llave, la cuenta, el permiso, la entrada y después la escritura.
- **Permiso por ruta, adelantado de F1.4** (D2): leer pide `read`, escribir pide `write` y
  archivar pide `delete`. La llave del agente (`{read,write}`) recibe 403 al archivar. Ese
  es el «no borra» de F1, con su motivo.
- **El contexto lo fija solo el ayudante de escritura** (D4, D5): la cuenta y la llave salen
  de la llave; `crm.proposed_by` es `key-<id>`; `crm.approved_by` y `crm.approval_ref`
  salen de la aprobación ya validada. Todo con `set_config(…, true)`.
- **Errores:** la lista cerrada suma `ya_existe` (409), y el mensaje de `sin_permiso` nombra
  el permiso que falta. Los errores de la base se leen de la causa cuando drizzle los
  envuelve, y el mensaje del envoltorio no se registra nunca.

## Cláusulas

«Como `crm_app`» y las pruebas HTTP siguen la convención de ADR-0006: `fastify.inject`
contra una base desechable sembrada con `database/test/crm-fixture.ts`, con `crm_app`
creado como lo crea `npm run db:users`. El fixture gana dos llaves vivas de la cuenta A: una
`{read}` y una `{read,write,delete}`. Los nombres de los archivos de prueba son una
propuesta; lo que cuenta es que cada chequeo exista y muerda.

| Id | Regla | Chequeo | Crítica |
|---|---|---|---|
| D1 | Las rutas son exactamente trece: las siete de ADR-0006 D11 y seis nuevas. `POST /accounts/:slug/contacts` (crear); `PATCH /accounts/:slug/contacts/:contactId` (actualizar y mover de etapa); `POST /accounts/:slug/contacts/:contactId/notes` (anotar); `POST /accounts/:slug/contacts/:contactId/tasks` (crear tarea); `POST /accounts/:slug/contacts/:contactId/archive` (archivar); y `GET /accounts/:slug/audit-log` (leer la bitácora). No hay ningún `DELETE` (**ASUNCIÓN**, preguntas 3 y 6) | `routes.test.ts`: la lista fija de método y ruta, ahora con trece; `DELETE /accounts/cuenta-a/contacts/1` sigue dando 404 | sí |
| D2 | Cada ruta exige un permiso: las lecturas y la bitácora, `read`; crear, actualizar, anotar y crear tarea, `write`; archivar, `delete`. Sin él, 403 `sin_permiso`, con un mensaje que nombra el permiso («lectura», «escritura» o «borrado»), y no se escribe nada. El mensaje de lectura no cambia (**ASUNCIÓN**, pregunta 4) | `write-auth-db.test.ts`: la llave `{read}` en `POST …/contacts` da 403 «escritura» y los conteos de `contacts` y `audit_log` no cambian; la llave del agente (`{read,write}`) en `…/archive` da 403 «borrado» y el contacto sigue activo; los controles son la llave `{read,write,delete}` archivando (204) y la llave `{write}` creando (201); la llave `{write}` en `GET …/audit-log` da 403 «lectura» | sí |
| D3 | El orden de ADR-0006 vale para las escrituras: la llave (401), la cuenta (403 `cuenta_ajena`), el permiso (403 `sin_permiso`) y después la entrada (400). Nada del cuerpo se lee antes del permiso | `write-auth-db.test.ts`: con un cuerpo inválido, sin llave da 401; con la llave de A en `cuenta-b` da 403 `cuenta_ajena`; con la llave `{read}`, 403 `sin_permiso`; nunca 400. Sin llave, un cuerpo de más de 16 KiB da 401 y no 413 | sí |
| D4 | Cada escritura corre en una transacción `READ WRITE` en su propia conexión. El ayudante fija, con `set_config(…, true)`, `crm.account_id` y `crm.api_key_id` desde la llave, `crm.proposed_by`, `crm.approved_by` y `crm.approval_ref`. Nada más de la petición toca el contexto. Las lecturas siguen en `READ ONLY` y sin autores (ADR-0006 D10). El contexto no pasa a la petición siguiente | `write-context-db.test.ts`, con un pool de una conexión: después de una escritura, en esa conexión, `crm.context_account_id()` es `NULL` y `current_setting('crm.proposed_by', true)` está vacío; una inserción plantada ahí falla con el mensaje de RLS. Dentro del ayudante de lectura, `crm.proposed_by` no está fijado, y la prueba de 25006 de ADR-0006 sigue en verde | sí |
| D5 | `proposed_by` es `key-<id>`, donde `id` es el de la llave que firma la petición, y no sale de nada que mande el cliente (**ASUNCIÓN**, pregunta 1). Un cuerpo con `proposedBy`, arriba o dentro de `approval`, da 400 | `writes-db.test.ts`: la fila de bitácora de cada escritura tiene `proposed_by = 'key-' \|\| api_key_id`, y `api_key_id` es el de la llave usada; los dos cuerpos con `proposedBy` dan 400 y no escriben | sí |
| D6 | Cada escritura que responde 2xx deja exactamente una fila nueva en `audit_log`, en la misma transacción: la tabla, el `row_id` del registro escrito, la operación, `changed_columns`, `api_key_id`, `proposed_by`, `approved_by` y `approval_ref`, estos dos iguales a los de la aprobación. Una escritura rechazada (400, 403, 404 o 409) no deja ni la fila ni la bitácora. Un `PATCH` que no cambia ningún valor escribe igual y deja `changed_columns = {}` (**ASUNCIÓN**, pregunta 5) | `writes-db.test.ts`: por cada una de las cinco rutas que escriben, la fila de bitácora comparada con un objeto exacto, y el conteo de `audit_log` sube en 1; por cada rechazo, los conteos de la tabla y de `audit_log` no cambian | sí |
| D7 | Todo cuerpo de escritura lleva `approval: { approvedBy, approvalRef }`, los dos obligatorios y con la forma de `AUDIT_AUTHOR_PATTERN`. `approvedBy` no puede tener la forma `key-<n>`: una llave nunca aprueba (**ASUNCIÓN**, preguntas 2 y 9). Sin aprobación, o con una mal formada, da 400 «approval» y no escribe | `write-input-db.test.ts`: sin `approval`; sin uno de sus dos campos; con un nombre con espacio, un correo, más de 40 caracteres y `key-7` en `approvedBy`; con un campo de más dentro de `approval`. Todos dan 400 «approval», y ningún cuerpo de error contiene el valor | sí |
| D8 | Ninguna escritura manda un valor para `id` ni para `created_at` (ADR-0005, H7), y ninguna toma `account_id` del cuerpo. En un `INSERT` esas dos columnas van como `default` y nunca con `OVERRIDING`. Un `UPDATE` nunca asigna `id`, `account_id` ni `created_at`, y solo el archivado asigna `archived_at`, con el `now()` de la base | `writes-db.test.ts`, con un conector que guarda el texto y los parámetros de cada sentencia: ningún texto contiene `OVERRIDING`; en cada `INSERT`, `id` y `created_at` van como `default`; la lista `SET` de cada `UPDATE` está dentro de las columnas permitidas. Los cuerpos con `id`, `accountId`, `createdAt` o `archivedAt` dan 400 | sí |
| D9 | Todo cuerpo pasa por zod en modo estricto, también `approval`. `fullName` y `title`, de 1 a 200 caracteres después de recortar; `body` de la nota, de 1 a 4000 después de recortar; el correo, como en la búsqueda (recortado, en minúsculas, hasta 254, con la forma de `contacts_email_shape`); `stageId` y `companyId`, enteros JSON positivos que caben en 2^53, y `companyId` también `null`; `dueOn`, una fecha real `AAAA-MM-DD`; un `PATCH`, al menos un campo. Ningún texto acepta U+0000 ni un sustituto UTF-16 suelto, y el sustituto tampoco en el correo de la búsqueda (**ASUNCIÓN**, pregunta 8), que ya rechaza el NUL (ADR-0006 A6). Lo inválido da 400 `entrada_invalida`, que nombra el campo y nunca el valor | `write-input-db.test.ts`: un caso por campo y por borde (200 y 201, 4000 y 4001, `2026-02-30`, un NUL y un sustituto suelto en cada texto), cada uno 400 y nunca 500; un `__proto__` en cada uno de los cinco cuerpos y dentro de `approval` da 400, y `Object.prototype` queda intacto (H9); `input-db.test.ts`: la búsqueda con un sustituto suelto en el correo da 400 «email» (hoy, 200 sin contactos) | sí |
| D10 | Las referencias son de la cuenta de la llave. Un `stageId` o un `companyId` que no se ve, o una empresa archivada, dan 400 `entrada_invalida` con el nombre del campo, igual para otra cuenta que para un id que no existe. El contacto de la ruta (`PATCH`, notas, tareas y archivar), si es de otra cuenta, no existe o está archivado, da 404 `no_encontrado`, con el mismo cuerpo en los tres casos. La llave foránea compuesta sigue detrás | `writes-db.test.ts`: la etapa de B en un contacto de A da 400 «stageId», con el mismo cuerpo que un id que no existe; la empresa archivada da 400 «companyId»; el contacto de B en `PATCH`, notas, tareas y archivar da 404, con el mismo cuerpo que un id que no existe; archivar dos veces da 404 la segunda; el control es la llave de B con la etapa de B (201) | sí |
| D11 | La lista cerrada de errores suma `ya_existe` (409), con el mensaje «Ya hay un contacto activo con ese correo.». Crear o actualizar un contacto con el correo de otro contacto activo de la cuenta da 409 y no escribe. La barrera es el índice único de la base, no una consulta previa: la API reconoce el 23505 de `contacts_account_email_active_key` también cuando drizzle lo envuelve (`DrizzleQueryError.cause`). Cualquier otro error de la base da 500 `error_interno` | `writes-db.test.ts`: el correo del fixture, en `POST` y en `PATCH`, da 409, los conteos no cambian y el cuerpo no trae el correo; el control es que el correo de un contacto archivado se puede usar (201). `errors.test.ts`: la lista de códigos y estados, comparada con una lista fija | sí |
| D12 | La línea de registro de ADR-0006 D15 vale para las escrituras, y nunca lleva el cuerpo. Un error de la base deja su SQLSTATE también cuando drizzle lo envuelve: se lee de la causa, un `pg.DatabaseError`. El mensaje, el SQL y los parámetros del envoltorio no se registran ni se responden nunca. `errorCodes` ya lo hace (ADR-0006 A7, que corrigió F-2); esta cláusula lo exige también en el camino de las escrituras | `logging-db.test.ts`: crear un contacto con un nombre y un correo no deja ninguno de los dos en el registro; un `DrizzleQueryError` plantado, con un correo en su SQL, en sus parámetros y en el mensaje de su causa, deja solo el SQLSTATE de la causa, y el cuerpo del 500 no trae el correo | sí |
| D13 | Las respuestas traen solo los campos de una lista fija. Crear y actualizar devuelven `{ contact }`, `{ note }` o `{ task }`, con los campos de ADR-0006 D12: 201 al crear y 200 al actualizar. Archivar responde 204 sin cuerpo. La bitácora responde `{ entries }`, de la más nueva a la más vieja, con `limit` y `before` como las notas, y cada entrada trae `id`, `occurredAt`, `tableName`, `rowId`, `operation`, `changedColumns`, `apiKeyId`, `proposedBy`, `approvedBy` y `approvalRef`, nunca `accountId`. `changedColumns` trae los nombres de columna de la base (**ASUNCIÓN**, pregunta 7) | `writes-db.test.ts`: las claves de cada respuesta son exactamente las de la lista; `audit-read-db.test.ts`: las claves de cada entrada son las de la lista, la llave de A no ve las entradas de B y la paginación con `before` no repite ni salta entradas | sí |
| D14 | F1.3 no agrega migraciones ni cambia el esquema ni los permisos de la base: usa los que `crm_service` ya tiene | `git diff --exit-code 5bdbf68 -- database/migrations database/test/migration-hashes.ts database/schema.sql apps/crm/src/db/schema.ts` sale con 0; `migration-files.test.ts` sigue en verde | sí |
| D15 | No entra ninguna dependencia, ni directa ni en el lockfile | `git diff --exit-code 5bdbf68 -- package-lock.json` sale con 0; `npm ls --workspace @circuit/crm --depth=0` lista las cuatro de ADR-0006 D2 y nada más; `npm audit --audit-level=low` da 0 | sí |
| D16 | Nada de ADR-0005 ni de ADR-0006 se debilita. Ninguna prueba existente se quita ni se debilita: los conteos por archivo de la línea base no bajan. Los únicos cambios en pruebas existentes son la lista de `routes.test.ts` (D1) y las llaves nuevas del fixture. Ningún archivo pasa de 400 líneas | Los conteos de la línea base, comparados archivo por archivo; `git ls-files '*.ts' \| xargs wc -l \| awk '$1 > 400 && $2 != "total"'` no da ninguna línea | sí |
| D17 | El proceso real escribe: arrancado con `node`, sin compilar, crea una nota y deja su fila en la bitácora | `main-process.test.ts`: el proceso real, sobre una base desechable sembrada, responde 201 a `POST …/notes` con la llave de A, y la base tiene la fila de bitácora con `proposed_by = key-<id>` | no |

### Chequeos, tal como se corren

En PowerShell (CLAUDE.md §8), con la base levantada y `CRM_DB_PASSWORD` en `.env`:

```powershell
docker compose up -d --wait db
npm run check; echo $LASTEXITCODE                 # D1–D13, D16 y D17 dentro de las pruebas, con el piso de cobertura: debe dar 0
npx vitest run --project '@circuit/crm'           # solo la API
npm ls --workspace @circuit/crm --depth=0         # D15
npm audit --audit-level=low                       # D15
npm run crm:start                                 # verlo en la app real: POST /accounts/cuenta-a/contacts sin llave da 401 (hoy, 404)
```

En Git Bash:

```sh
git diff --exit-code 5bdbf68 -- database/migrations database/test/migration-hashes.ts database/schema.sql apps/crm/src/db/schema.ts; echo $?   # D14: 0
git diff --exit-code 5bdbf68 -- package-lock.json; echo $?                                  # D15: 0
git ls-files '*.ts' | xargs wc -l | awk '$1 > 400 && $2 != "total"'                         # D16: ninguna línea
```

La base de desarrollo no tiene llaves ni filas (línea base), así que en la app real solo se
ve la llave. La escritura completa por el proceso real la cubre D17, sobre una base
desechable.

### Mutantes

Cada uno se planta en el código real, se restaura después (comprobado por hash) y debe
poner en rojo su prueba:

| Id | Cláusula | Mutante |
|---|---|---|
| M1 | D2 | Las rutas de escritura sin el chequeo de `write`: la llave `{read}` crearía |
| M2 | D2 | Archivar pide `write` en vez de `delete`: la llave del agente archivaría |
| M3 | D3 | El cuerpo se valida antes del permiso: la llave `{read}` con un cuerpo inválido daría 400 |
| M4 | D4 | `set_config(…, false)` en el ayudante de escritura: los autores quedarían en la sesión |
| M5 | D5 | `proposed_by` tomado de `approvedBy` |
| M6 | D6 | El ayudante no fija `crm.approval_ref`: la bitácora lo guardaría nulo |
| M7 | D7 | `approvedBy` sin el rechazo de la forma `key-<n>` |
| M8 | D8 | El esquema de crear contacto sin `strict`: un `id` en el cuerpo se ignoraría en vez de dar 400 |
| M9 | D9 | Los textos sin la regla de U+0000: el NUL llegaría a la base y daría 500 |
| M10 | D10 | Sin la comprobación de la etapa: la de B daría 500 por la llave foránea, no 400 |
| M11 | D11 | El 409 mirando solo el error y no su causa: el correo repetido daría 500 |
| M12 | D12 | La ruta de escritura vuelve a lanzar el error sin su causa (`new Error(error.message)`): el SQLSTATE saldría nulo. El de `errorCodes` es M20 de ADR-0006 |
| M13 | D13 | La bitácora devuelve `accountId` |
| M14 | D10 | Archivar sin el filtro `archived_at IS NULL`: archivar dos veces daría 204 y otra fila de bitácora |

## Cerco

- **Puede cambiar:**
  - `apps/crm/src/db/`: el ayudante de transacción, para que sirva a lecturas y escrituras
    sin cambiar la conducta de las lecturas; un archivo nuevo con las escrituras; las
    consultas de la bitácora.
  - `apps/crm/src/routes/`: un archivo nuevo con las rutas que escriben y la de la bitácora;
    `input.ts` (los esquemas nuevos y la regla de texto, que alcanza también al correo de
    la búsqueda).
  - `apps/crm/src/server/errors.ts` (`ya_existe` y el mensaje de `sin_permiso` por permiso),
    `server.ts` (el registro de las rutas nuevas) y, si hace falta, el comentario de
    `limits.ts`.
  - `apps/crm/test/`: pruebas nuevas, `crm-under-test.ts`, la lista de `routes.test.ts` y
    el caso del sustituto suelto en `input-db.test.ts`.
  - `database/test/crm-fixture.ts`: las dos llaves nuevas de la cuenta A.
  - Los documentos de estado: `CLAUDE.md` (§2, §4, §8 y §9), `DEVELOPMENT_PLAN.md` y
    `README.md`, sin anunciar nada que no exista. Una línea en ADR-0006 que diga que D11 la
    enmienda esta ADR. Esta ADR y su auditoría en `docs/reviews/`.
- **No debe cambiar:**
  - `database/migrations/`, `database/test/migration-hashes.ts`, `database/schema.sql` y
    `apps/crm/src/db/schema.ts` (D14).
  - `database/users.ts`, los roles, sus permisos y sus políticas.
  - `package.json`, `apps/*/package.json` y el lockfile (D15).
  - `compose.yaml`, `.github/workflows/ci.yml`, `guards/` y `apps/circuit`.
  - `apps/crm/src/log.ts`: ya lee la causa de un `DrizzleQueryError` (ADR-0006 A7).
  - La conducta de las siete rutas de lectura: sus pruebas siguen en verde sin cambios,
    salvo la búsqueda con un sustituto suelto en el correo, que pasa de 200 a 400 (D9).
- **Fuera de alcance:**
  - La ruta de exportar, el formato y la generación de las llaves (H12) y su revocación
    (F1.4). F1.4 hereda de aquí la prueba de «no borra».
  - Escribir empresas, completar o archivar notas y tareas: ninguna herramienta del
    conector las pide.
  - Aplicar una propuesta entera en una transacción, y que un reintento no duplique una
    escritura (pregunta 6).
  - Comprobar la aprobación contra los eventos de circuit (F2, en circuit).
  - El cliente del CRM en circuit (F2) y la semilla (F1.5).

## Restricciones

- Solo datos sintéticos, en bases desechables. Las pruebas no leen ni escriben la base de
  desarrollo, que tiene 0 filas.
- Los límites de ADR-0006 no cambian: cuerpo de hasta 16 KiB, pool de 5, 5 s por sentencia
  y por transacción ociosa, listas de 50 por defecto y 100 como máximo. Una nota de 4000
  unidades UTF-16 ocupa a lo sumo 12 000 bytes en UTF-8, así que cabe en 16 KiB con la
  aprobación. Escrita con muchos escapes `\u`, puede no caber, y da 413.
- zod cuenta unidades UTF-16 y la base cuenta caracteres. Un emoji vale 2 para zod y 1
  para la base, así que zod es más estricto y nunca deja pasar lo que la base rechazaría.
- Los ids salen como números JSON y las fechas en ISO 8601, en UTC (ADR-0006). `dueOn` sale
  como `AAAA-MM-DD`, porque `schema.ts` lo declara `mode: 'string'`.

## Daño a vigilar

- **Una aprobación falsa se guarda igual.** El CRM solo rechaza lo que no tiene forma de
  aprobación (D7). Que el mentor de verdad aprobó lo prueban los eventos de circuit (F2).
- **Una propuesta a medias.** Con una ruta por acción, si la segunda escritura de una
  propuesta falla, la primera queda hecha. La estación 7 (F2) aplica en orden, guarda el
  resultado de cada acción como evento y se detiene en el primer fallo, que queda a la vista.
- **Un reintento duplica.** Sin llave de idempotencia, volver a mandar una nota crea otra.
  El cliente de circuit (F2) no reintenta escrituras por su cuenta.
- **El mensaje de un `DrizzleQueryError` lleva los valores** (el SQL y sus parámetros: un
  correo, un nombre). Nunca se registra, nunca se responde y nunca se convierte a texto.
- **Una carrera entre archivar y anotar** puede dejar una nota en un contacto recién
  archivado. Queda escondida como el contacto, y en la demostración escribe un solo agente.
- **La bitácora solo crece.** Nada la borra, por diseño (ADR-0005 D9).
- **El contrato de la API cambia.** Pasa de siete a trece rutas, y la búsqueda con un
  sustituto suelto pasa de 200 a 400. Hoy nadie la consume; circuit la usa desde F2.

## Reversión

Revertir los commits quita las rutas. No hay migración ni cambio de esquema, así que la
base no tiene nada que deshacer. Lo que se escriba por la API en una base que se conserva
queda, con su bitácora, porque nada se borra. En las pruebas no importa, porque las bases se
desechan. No se puede deshacer lo publicado: después del push, el diseño de la API es
público (no lleva secretos).

## Consecuencias

- F1.4 encuentra lista la prueba de «no borra» (D2) y le queda la de «no exporta», con su
  ruta, además del formato y la generación de las llaves.
- El conector de F2 se mapea uno a uno: buscar con `POST …/contacts/search`; crear con
  `POST …/contacts`; actualizar y mover de etapa con `PATCH …/contacts/:contactId`; anotar
  con `POST …/notes`; crear tarea con `POST …/tasks`.
- La bitácora se lee por la API, así que el tablero (F2) puede mostrar quién propuso y
  quién aprobó sin tocar la base.
- Toda escritura nueva hereda el ayudante. Si alguien lo salta, la base falla cerrada: sin
  autor no se escribe nada (ADR-0005 D8) y sin cuenta, tampoco (D4).

## Preguntas abiertas

Cada una tiene escrita su recomendación como **ASUNCIÓN** en la cláusula que afecta.
Respondidas el 2026-11-25: el dueño aceptó cada recomendación como está escrita, así que
cada ASUNCIÓN queda como decisión y la ADR no cambia.

1. **¿`proposed_by` es `key-<id>` o una columna nueva en `api_keys`?** Recomendación:
   `key-<id>`. Sale de la llave, es opaco y no pide migración. La columna sería más legible,
   pero exige una función nueva (D5).
2. **¿La aprobación va en el cuerpo o en cabeceras?** Recomendación: en el cuerpo, como
   `approval`, validada por zod como el resto (D7).
3. **¿Se archiva en F1.3, con el permiso `delete`, solo el contacto y con `POST …/archive`?**
   Recomendación: sí. Sin esa ruta, «no borra» daría un 404 casual. Archivar el contacto ya
   esconde sus notas y tareas. `POST …/archive` deja claro que no borra, y `DELETE` sigue sin
   ruta (D1, D2).
4. **¿Se adelantan de F1.4 los chequeos de `write` y de `delete`?** Recomendación: sí, por
   la misma razón que `read` en ADR-0006: sin ellos, una llave de solo lectura podría
   escribir entre F1.3 y F1.4 (D2).
5. **¿Un `PATCH` que no cambia nada escribe y deja `changed_columns = {}`?** Recomendación:
   sí. Es lo que pasó: una escritura aprobada que no cambió valores. Compararla antes
   agregaría una lectura y otra carrera (D6).
6. **¿Una ruta por acción, sin aplicar la propuesta entera ni idempotencia?**
   Recomendación: sí para F1.3. Si la estación 7 necesita todo o nada, se decide en F2 con
   otra ADR (D1).
7. **¿La bitácora se lee por cuenta y paginada, sin filtros, y con los nombres de columna
   de la base?** Recomendación: sí. Lo que necesita el tablero se agrega cuando se diseñe
   (D13).
8. **¿Los textos se recortan, y ninguno acepta un NUL ni un sustituto suelto, tampoco la
   búsqueda?** Recomendación: sí. El NUL de la búsqueda ya lo corrigió ADR-0006 A6; el
   sustituto evita que la base guarde U+FFFD sin avisar (D9).
9. **¿`approvedBy` rechaza la forma `key-<n>`?** Recomendación: sí. Una llave nunca aprueba,
   y es la única aprobación falsa que el CRM puede ver por sí mismo (D7).
