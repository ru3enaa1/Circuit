# ADR-0008 · Las llaves del CRM nacen al azar con un formato fijo, se emiten y se revocan con un comando local, y la llave del agente no exporta

- **Fecha:** 2026-11-25
- **Estado:** aceptada el 2026-11-25. El dueño aceptó las nueve recomendaciones de
  «Preguntas abiertas» tal como están escritas.
- **Tarea:** F1.4 de `DEVELOPMENT_PLAN.md`, «llaves con alcance» del CRM simulado. Suma lo que
  dejaron para esta fase ADR-0005 (H12: llaves de al menos 128 bits al azar), ADR-0006 y
  ADR-0007 (el formato, la generación, la revocación y la ruta de exportar), H2 de la
  auditoría de ADR-0007, que el dueño decidió el 2026-11-25, y H4 de esa misma auditoría.
- **Retroactiva:** no. Todavía no hay generador, ni comando, ni ruta de exportar (línea base:
  `docs/reviews/ADR-0008-baseline.md`).
- **Cita sin reescribir:** ADR-0005 D5, D10 y D11 (`crm_service` no toca `api_keys`; la llave
  se guarda solo como su SHA-256; los cuatro permisos); ADR-0006 D8–D10 y D12–D15 (la llave
  Bearer, los 401 iguales, la cuenta, la transacción por petición, los campos, la entrada y
  el registro); ADR-0007 D2–D4 y D13 (el permiso por ruta, el orden y lo que ve una llave sin
  `read`, A2). **Enmienda** ADR-0007 D1: la lista de rutas pasa a ser la de D10 de esta ADR.

## Contexto

F1 termina cuando «la llave del agente no borra, no exporta y no ve otra cuenta», y cada
prueba falla por la razón correcta: un 403 con su motivo, no un 404 casual. Dos de las tres
ya están: «no ve otra cuenta» es el 403 `cuenta_ajena` de ADR-0006 D9, y «no borra» es el
403 «borrado» de ADR-0007 D2. Falta «no exporta», y hoy no hay ruta de exportar: la
petición da 401 sin llave y, con llave, cae en `GET …/contacts/:contactId` (línea base).

Lo demás de las llaves sigue sin hacer:

- **No hay generador.** Las únicas llaves son las del fixture de pruebas (`test-key-a`,
  `test-key-revoked`…), escritas a mano. H12 pide al menos 128 bits al azar.
- **El servidor acepta cualquier token** de RFC 6750 de hasta 512 caracteres, lo busca por
  su hash y responde 401 si no está (`limits.ts:23-27` lo deja para F1.4).
- **No hay cómo emitir ni revocar una llave** sin escribir SQL como administrador.
  `crm_service` no tiene ningún permiso sobre `api_keys` (ADR-0005 D5), y así debe seguir:
  si la API pudiera crear llaves, una llave podría fabricar otra con más permisos.
- **H2, decidida.** Una llave sin `read` ve lo que escribe (ADR-0007 A2). El dueño eligió la
  opción (a) el 2026-11-25, la que recomendaba el informe, «mientras ninguna llave real deje
  de tener `read`». La única forma de que nazca una llave real es el emisor de esta ADR, así
  que esa condición puede volverse una regla.
- **Una llave filtrada no se ve.** La guarda de secretos conoce las llaves de Anthropic, AWS
  y GitHub por su forma. Una llave del CRM no tiene forma propia, así que una pegada en un
  archivo versionado pasaría.

La base de desarrollo tiene 0 cuentas y 0 llaves (línea base). La semilla de F1.5 trae las
cuentas del escenario y, con ellas, la llave real del agente.

## Opciones consideradas

**Formato de la llave**

1. **Un prefijo fijo y 32 bytes al azar:** `crmk_` y la codificación base64url, sin relleno,
   de 32 bytes de `crypto.randomBytes` (256 bits, 43 caracteres). El servidor rechaza lo
   que no tenga esa forma antes de tocar la base. El prefijo deja que la guarda reconozca
   una llave filtrada. A cambio, las llaves del fixture y las llaves desconocidas de las
   pruebas cambian.
2. **32 bytes al azar sin prefijo**, y el servidor sigue aceptando cualquier token. Ninguna
   prueba cambia. A cambio, la guarda no puede reconocer la llave, y una llave débil
   insertada a mano sigue sirviendo.
3. **El id de la llave dentro de ella** (`crmk_<id>_<secreto>`), para buscarla por id y
   comparar en tiempo constante. Es común cuando el hash no tiene índice; aquí la búsqueda
   ya va por el índice único de `key_hash`, y el id viajaría en cada petición.

**Quién emite y revoca**

1. **Un comando local, como el administrador de `.env`:** `npm run db:keys`, como
   `db:users`. La API sigue sin tocar `api_keys`.
2. **Una ruta de administración en la API.** Pide que `crm_service` escriba en `api_keys`,
   contra ADR-0005 D5 y D10, y una llave capaz de crear llaves.
3. **Solo la semilla de F1.5.** No deja revocar ni reemplazar una llave.

**Qué es exportar**

1. **`GET /accounts/:slug/export`** con el permiso `export`: los contactos activos de la
   cuenta, con los campos de siempre y paginados como las listas. Es la única ruta que
   enumera contactos, que es lo que la vuelve sensible.
2. **Sin ruta**, y una prueba de que la llave del agente no tiene `export` en la base. Es el
   404 casual que el criterio de F1 descarta.
3. **Un archivo CSV o NDJSON** con toda la cuenta. Más formato y más código, y nadie lo pide.

## Decisión

La primera opción de cada grupo.

- **El formato** (D1–D3): `crmk_` y 43 caracteres base64url de 32 bytes al azar. El servidor
  rechaza toda otra forma con el mismo 401 de una llave desconocida, sin tomar una conexión.
  El servidor y el emisor calculan el hash con la misma función.
- **El emisor** (D4–D9): `npm run db:keys -- issue | list | revoke`, como el administrador de
  `.env`, en una transacción. Muestra la llave una sola vez. Toda llave que emite lleva
  `read`: así H2 queda en la opción (a) sin depender de que alguien lo recuerde. La base
  sigue aceptando `{write}`, para que el fixture siga probando el chequeo de `read` por ruta.
  Revocar es definitivo y vale desde la petición siguiente.
- **Exportar** (D10–D12): una ruta nueva que pide `export`. La llave del agente recibe 403
  «exportación». Una prueba reúne los tres «no» de F1 con una llave emitida por el emisor
  real (D13).
- **H4** (D18): `read-scope.ts` pasa a `scope.ts`, y `Credentials` y `KEY_AUTHOR_PREFIX` van a
  `keys.ts`, en un commit aparte sin cambio de conducta.

## Cláusulas

«Como `crm_app`» y las pruebas HTTP siguen la convención de ADR-0006: `fastify.inject`
contra una base desechable sembrada con `database/test/crm-fixture.ts`. El fixture gana una
llave viva de la cuenta A con `{read,export}`, y todas sus llaves pasan a tener el formato
de D1. Los nombres de los archivos de prueba son una propuesta; lo que cuenta es que cada
chequeo exista y muerda. `<base>` es `6e8f445`.

| Id | Regla | Chequeo | Crítica |
|---|---|---|---|
| D1 | Una llave es `crmk_` seguido de 43 caracteres de base64url sin relleno (RFC 4648 §5): la codificación de 32 bytes de `crypto.randomBytes`. La forma vive en una constante, `API_KEY_SHAPE`, que comparten el servidor y el emisor; la guarda la repite en su regla (D15) (**ASUNCIÓN**, pregunta 1) | `keys.test.ts`: 1000 llaves generadas cumplen `API_KEY_SHAPE`, son distintas entre sí y su cola decodifica a 32 bytes | sí |
| D2 | El servidor rechaza una llave con otra forma antes de buscarla: 401 `llave_invalida`, con el mismo cuerpo byte a byte que una llave bien formada que no existe, y sin tomar una conexión del pool. `MAX_KEY_LENGTH` desaparece | `key-format-db.test.ts`, con un `Connector` que cuenta las conexiones: el prefijo en mayúsculas, sin prefijo, 42 y 44 caracteres, con `=` al final, con `+` o `/`, y una con la forma de las llaves de hoy (`llave-de-prueba`), cada una 401 y 0 conexiones; una llave bien formada que no existe, 401 con el mismo cuerpo y 1 conexión | sí |
| D3 | El servidor y el emisor calculan el hash con la misma función, `hashApiKey`: el SHA-256 de la llave en UTF-8. La base guarda solo esos 32 bytes; ninguna columna guarda la llave | `keys-db.test.ts`: la fila de una llave emitida tiene `key_hash = sha256(llave)`; `to_jsonb(fila)::text` no contiene ni la llave ni su cola; y esa llave lee `GET …/stages` con 200 | sí |
| D4 | `npm run db:keys -- issue --account <slug> --label <etiqueta> --permissions <lista>` corre como el administrador de `.env`, en una transacción, y crea exactamente una fila. Imprime en la salida estándar el id y la llave, una sola vez, y sale con 0. Una cuenta que no existe sale con 1 y no escribe nada (**ASUNCIÓN**, pregunta 2) | `keys-db.test.ts`, con `runKeysCommand` sobre una base desechable: el conteo de `api_keys` sube en 1; la llave aparece exactamente una vez en la salida estándar y nunca en la de errores; con `cuenta-z`, salida 1 y el conteo igual | sí |
| D5 | El emisor valida antes de conectarse. Los permisos son un subconjunto no vacío y sin repetidos de `read`, `write`, `delete` y `export`, y **siempre incluyen `read`**: así ninguna llave real deja de tener `read`, que es la condición de H2 (a) (**ASUNCIÓN**, pregunta 3). La etiqueta tiene la forma de `SLUG_PATTERN`, para que no lleve el nombre de una persona (**ASUNCIÓN**, pregunta 4). Un subcomando o una opción desconocidos, o uno que falta, salen con 1 y el uso. La base sigue aceptando `{write}` (ADR-0005 D11 no cambia) | `keys.test.ts`, con una fábrica de conexiones que falla si se llama: `--permissions write`, `admin`, `read,read`, vacío, la etiqueta con un espacio o con `@`, sin `--account`, y un subcomando `borrar`, cada uno con salida 1 y 0 conexiones. Las pruebas de la llave `{write}` del fixture (`auth-db`, `write-auth-db`) siguen en verde sin cambios | sí |
| D6 | La llave sale solo en la línea de `issue`. Ningún error del emisor muestra la llave, su hash, la conexión ni el objeto de error: lo describe con su SQLSTATE o con un mensaje propio, como `db:users`. La llave se imprime solo después del `COMMIT` | `keys-db.test.ts`: una inserción que falla (una fábrica de llaves que devuelve dos veces la misma, para chocar con el índice único) sale con 1, el mensaje trae `23505`, y ni la salida estándar ni la de errores contienen la llave | sí |
| D7 | `npm run db:keys -- revoke --id <id>` pone `revoked_at = now()` en una llave viva, y no borra la fila ni cambia otra columna. Desde la petición siguiente, esa llave recibe 401 `llave_invalida` con el mismo cuerpo que una desconocida: no hay caché. Revocar otra vez, o un id que no existe, sale con 1 y no cambia nada. Revocar es definitivo: no hay cómo reactivar (**ASUNCIÓN**, pregunta 7) | `keys-db.test.ts`: emitir, leer con 200, revocar, leer con 401 y el mismo cuerpo que una desconocida; la fila sigue con su hash, su etiqueta y sus permisos; la segunda revocación sale con 1 y `revoked_at` no cambia | sí |
| D8 | `npm run db:keys -- list --account <slug>` imprime de cada llave de la cuenta su id, etiqueta, permisos, `created_at` y `revoked_at`, y nunca su hash | `keys-db.test.ts`: las columnas de la salida, comparadas con una lista fija; la salida no contiene el hash en hexadecimal ni en base64 | no |
| D9 | La API del CRM no emite, no lista ni revoca llaves. `crm_service` sigue sin ningún permiso sobre `api_keys` | `routes.test.ts` (D10) no tiene ninguna ruta de llaves; la matriz de permisos de `crm-structure-db.test.ts` (ADR-0005 D5) sigue igual y en verde | sí |
| D10 | Las rutas son exactamente catorce: las trece de ADR-0007 D1 y `GET /accounts/:slug/export` (**ASUNCIÓN**, pregunta 5) | `routes.test.ts`: la lista fija de método y ruta, ahora con catorce | sí |
| D11 | Exportar pide `export`. Sin él, 403 `sin_permiso` con «La llave no tiene permiso de exportación.». El orden es el de siempre: la llave (401), la cuenta (403 `cuenta_ajena`), el permiso (403 `sin_permiso`) y después la consulta (400). Las llaves `{read,write}` y `{read,write,delete}` reciben 403; la llave `{read,export}`, 200 | `export-db.test.ts`: los tres 403 de permiso, el control con 200, y con una consulta inválida: sin llave 401, en `cuenta-b` 403 `cuenta_ajena`, con la llave del agente 403 `sin_permiso`, nunca 400 | sí |
| D12 | La exportación responde `{ contacts }`: los contactos activos de la cuenta de la llave, con exactamente los campos de ADR-0006 D12, del más nuevo al más viejo por id, con `limit` (50 por defecto, 100 como máximo) y `before` como las notas. Otro parámetro, o `limit` 101, da 400. Corre en una transacción `READ ONLY`, sin autores, como toda lectura. No deja fila en la bitácora (**ASUNCIÓN**, pregunta 6) | `export-db.test.ts`: las claves de cada contacto; con la llave de A nunca sale un contacto de B, y con la de B sí; un contacto archivado no sale; la paginación con `before` no repite ni salta; `limit=101` y `?formato=csv` dan 400; el conteo de `audit_log` no cambia | sí |
| D13 | El criterio de F1, en una prueba: una llave `{read,write}` de la cuenta A, emitida por el emisor real (la del agente), recibe 403 «borrado» al archivar, 403 «exportación» al exportar y 403 `cuenta_ajena` en una ruta de `cuenta-b`. En los tres casos los conteos de `contacts`, `notes` y `audit_log` no cambian. Los controles: la misma llave lee su contacto (200) y anota (201) | `agent-key-db.test.ts` | sí |
| D14 | Ninguna prueba de una llave desconocida o revocada pasa por la puerta de la forma: las del fixture y las desconocidas tienen la forma de D1, y se derivan de bytes fijos con la misma codificación, así que ninguna llave literal queda en el repositorio | `git grep -n "test-key-" -- apps/crm/test database/test` no da ninguna línea; la guarda de D15 da 0 sobre el árbol; la llave desconocida bien formada de D2 toma 1 conexión, es decir, llega a la base | sí |
| D15 | La guarda de secretos conoce la llave: una regla `crm-api-key` con la forma de D1, entre bordes de palabra. `check-secrets.test.sh` gana un caso plantado (una llave en un `.ts`, salida 1) y un control (el texto de la regla y una plantilla `` `crmk_${…}` ``, salida 0) | `bash guards/check-secrets.test.sh` da 0; `bash guards/check-secrets.sh` da 0 sobre el árbol | sí |
| D16 | F1.4 no agrega migraciones, no cambia el esquema ni los permisos de la base, y no agrega dependencias: `crypto` y `parseArgs` son de Node | `git diff --exit-code <base> -- database/migrations database/test/migration-hashes.ts database/schema.sql apps/crm/src/db/schema.ts package-lock.json` sale con 0; `npm ls --workspace @circuit/crm --depth=0` lista las cuatro de ADR-0006 D2; `npm audit --audit-level=low` da 0 | sí |
| D17 | Nada de ADR-0005, ADR-0006 ni ADR-0007 se debilita, y los conteos por archivo de la línea base no bajan. Los únicos cambios en pruebas existentes son las llaves (D14), la lista de `routes.test.ts` (D10), la llave nueva del fixture y las rutas de importación de D18. Ningún archivo pasa de 400 líneas | Los conteos de la línea base, archivo por archivo; `git ls-files '*.ts' \| xargs wc -l \| awk '$1 > 400 && $2 != "total"'` no da ninguna línea | sí |
| D18 | H4: `apps/crm/src/db/read-scope.ts` se llama `scope.ts`, y `Credentials` y `KEY_AUTHOR_PREFIX` viven en `apps/crm/src/keys.ts`, con la forma y el hash. Va en un commit propio, antes del resto, en el que solo cambian nombres e importaciones (**ASUNCIÓN**, pregunta 8) | `git grep -n "read-scope" -- '*.ts'` no da ninguna línea; en ese commit, `npm run check` da 0 con 417 pruebas y los mismos conteos por archivo | no |
| D19 | El comando real funciona: `node database/keys.ts` sin argumentos sale con 1 y el uso, sin conectarse; y `issue` contra una base desechable sale con 0 y una sola llave en la salida | `keys-process.test.ts`, con el proceso real y `PROCESS_TEST_TIMEOUT_MS` | no |

### Chequeos, tal como se corren

En PowerShell (CLAUDE.md §8), con la base levantada y `CRM_DB_PASSWORD` en `.env`:

```powershell
docker compose up -d --wait db
npm run check; echo $LASTEXITCODE                 # D1–D8, D10–D14, D17 y D19 dentro de las pruebas, con el piso de cobertura: debe dar 0
npx vitest run --project '@circuit/crm' keys export agent-key key-format routes   # solo lo de F1.4
npm ls --workspace @circuit/crm --depth=0         # D16
npm audit --audit-level=low                       # D16
npm run crm:start                                 # en la app real: GET /accounts/cuenta-a/export con una llave mal formada da 401
```

En Git Bash:

```sh
bash guards/check-secrets.test.sh; echo $?        # D15: 0
bash guards/check-secrets.sh; echo $?             # D14, D15: 0
git diff --exit-code 6e8f445 -- database/migrations database/test/migration-hashes.ts database/schema.sql apps/crm/src/db/schema.ts package-lock.json; echo $?   # D16: 0
git grep -n "test-key-" -- apps/crm/test database/test | wc -l      # D14: 0
git grep -n "read-scope" -- '*.ts' | wc -l                            # D18: 0
git ls-files '*.ts' | xargs wc -l | awk '$1 > 400 && $2 != "total"'   # D17: ninguna línea
```

La base de desarrollo no tiene cuentas, así que `db:keys issue` contra ella sale con 1
(«no existe la cuenta») hasta la semilla de F1.5. El emisor entero lo cubren D4–D8 y D19
sobre bases desechables.

### Mutantes

Cada uno se planta en el código real, se restaura después (comprobado por hash) y debe
poner en rojo su prueba:

| Id | Cláusula | Mutante |
|---|---|---|
| M1 | D1 | El generador usa bytes fijos (`Buffer.alloc(32)`): las llaves dejarían de ser distintas |
| M2 | D1 | El generador toma 16 bytes: la llave no cumpliría la forma |
| M3 | D2 | `presentedKey` sin la forma (cualquier token de RFC 6750): una llave mal formada tomaría una conexión |
| M4 | D2 | Una llave mal formada responde `sin_llave`: el cuerpo dejaría de ser el de una desconocida |
| M5 | D3 | El emisor guarda el hash de la llave sin el prefijo: la llave emitida recibiría 401 |
| M6 | D5 | El emisor sin la regla de `read`: `--permissions write` saldría con 0 |
| M7 | D5 | El emisor se conecta antes de validar: la fábrica de conexiones se llamaría |
| M8 | D6 | El emisor imprime la llave antes del `COMMIT`: la inserción que falla la dejaría en la salida |
| M9 | D7 | Revocar borra la fila: la fila no seguiría |
| M10 | D7 | Revocar sin `revoked_at IS NULL`: la segunda revocación saldría con 0 y cambiaría la fecha |
| M11 | D8 | `list` selecciona `key_hash` |
| M12 | D11 | Exportar pide `read`: la llave del agente exportaría |
| M13 | D12 | Exportar sin `archived_at IS NULL` |
| M14 | D12 | Exportar devuelve `accountId` |
| M15 | D15 | La guarda sin la regla `crm-api-key`: el caso plantado saldría con 0 |

## Cerco

- **Puede cambiar:**
  - `apps/crm/src/keys.ts`, nuevo: la forma, el generador, el hash, `Credentials` y
    `KEY_AUTHOR_PREFIX` (D1, D3, D18).
  - `apps/crm/src/db/`: `read-scope.ts` pasa a `scope.ts` (D18); el ayudante de lectura
    recibe el permiso de la ruta (`read` o `export`); `reads.ts`, la consulta de la
    exportación.
  - `apps/crm/src/routes/`: un archivo nuevo con la ruta de exportar, registrado dentro del
    plugin de `/accounts/:slug` de `reads.ts`, para que su hook corra antes; las
    importaciones de `reads.ts`, `writes.ts` e `input.ts`.
  - `apps/crm/src/server/`: `auth.ts` (la forma de D1 en `presentedKey`), `limits.ts`
    (sale `MAX_KEY_LENGTH`) y `errors.ts` (`Permission` suma `export`, con su mensaje).
  - `database/keys.ts`, nuevo, y el script `db:keys` de `package.json`.
  - `guards/check-secrets.sh` y `guards/check-secrets.test.sh` (D15).
  - `apps/crm/test/` y `database/test/`: pruebas nuevas; las llaves de las existentes (D14);
    la lista de `routes.test.ts`; `crm-fixture.ts` (las llaves con la forma de D1 y la
    llave `{read,export}`); las importaciones de D18.
  - Los documentos de estado: `CLAUDE.md` (§2, §4, §8 y §9), `DEVELOPMENT_PLAN.md` y
    `README.md` (cómo emitir y revocar), sin anunciar nada que no exista. Una línea en
    ADR-0007 que diga que D1 la enmienda esta ADR, y A2 con la decisión de H2. Esta ADR y su
    auditoría en `docs/reviews/`.
- **No debe cambiar:**
  - `database/migrations/`, `database/test/migration-hashes.ts`, `database/schema.sql` y
    `apps/crm/src/db/schema.ts` (D16).
  - `database/users.ts`, los roles, sus permisos y sus políticas.
  - Las dependencias y el lockfile (D16).
  - `compose.yaml`, `.github/workflows/ci.yml` y `apps/circuit`.
  - `apps/crm/src/log.ts`: la línea de registro no cambia.
  - La conducta de las trece rutas: sus pruebas siguen en verde, cambiando solo las llaves
    (D14) y las importaciones (D18).
- **Fuera de alcance:**
  - Las llaves reales del escenario y dónde las guarda circuit: la semilla de F1.5 emite la
    del agente con `{read,write}`, y F2 decide cómo la lee el cliente del CRM.
  - Que las llaves venzan, rotarlas solas, limitar peticiones por llave.
  - Registrar quién exportó: una fila en la bitácora pide una migración, y el id de la llave
    en el registro cambia ADR-0006 D15 (pregunta 6).
  - Exportar empresas, notas o tareas, y un formato distinto de JSON.
  - La opción (b) de H2.
  - El material del programa que citará la estación 4: es un insumo de F2 que se le pide al
    dueño en F1.4 (`DEVELOPMENT_PLAN.md`), no código.

## Restricciones

- 256 bits es el doble de lo que pide H12. Con una llave de 256 bits al azar, un SHA-256 sin
  sal basta: no hay diccionario contra el que probar.
- base64url cabe en el `b64token` de RFC 6750 §2.1, así que la cabecera no cambia.
- La llave sale una vez en la terminal del dueño. El historial de PowerShell guarda la orden,
  no su salida, y la orden no lleva la llave.
- Solo datos sintéticos, en bases desechables. En F1.4 no se emite ninguna llave en la base
  de desarrollo, que no tiene cuentas.
- Los límites de ADR-0006 no cambian: la exportación pagina con los mismos 50 y 100.

## Daño a vigilar

- **Las llaves de antes dejan de servir.** Toda llave sin la forma de D1 recibe 401. Hoy no
  hay ninguna fuera de las pruebas (la base de desarrollo tiene 0), y las de las pruebas
  cambian en el mismo commit.
- **Una prueba que pasa por la razón equivocada.** Con la puerta de la forma, una prueba de
  «llave desconocida» con `test-key-unknown` seguiría en verde sin llegar nunca a la base.
  D14 lo cierra.
- **Una llave copiada de la terminal termina versionada.** La guarda la reconoce (D15) en
  cada `git push` y en CI.
- **La exportación entrega datos personales en bloque** a toda llave con `export`. Ninguna
  llave del escenario lo tendrá, y una exportación no deja rastro en la bitácora (pregunta 6).
- **El emisor escribe en la base que nombre `.env`.** Corre como administrador, igual que
  `db:users`.
- **Revocar no corta una petición en curso**: esa termina con la llave que ya resolvió.

## Reversión

Revertir los commits quita el emisor, la ruta de exportar y la puerta de la forma, y vuelven
las llaves viejas de las pruebas. No hay migración, así que la base no tiene nada que
deshacer. Las llaves que se hayan emitido en una base que se conserva quedan como filas; se
revocan como administrador con un `UPDATE`. Una llave que ya se mostró no se puede
«desmostrar»: se revoca.

## Consecuencias

- F1 queda con sus tres «no» en una sola prueba (D13), y la falta solo la semilla (F1.5).
- La semilla de F1.5 emite la llave del agente con la función del emisor, no con un literal,
  y decide dónde queda para circuit.
- El cliente de F2 manda `crmk_…`, y la guarda vigila que no se versione.
- Toda llave real tiene `read`, así que H2 (a) se sostiene sola. Pasar a (b) sería otra ADR.
- `scope.ts` y `keys.ts` dejan claro qué abre una transacción y qué es una llave.

## Notas de implementación (2026-11-25)

- **H4 va primero y solo (D18).** `git mv` de `read-scope.ts` a `scope.ts`; `keys.ts` nace
  con `Credentials` y `KEY_AUTHOR_PREFIX`, movidos tal cual con sus comentarios, y doce
  archivos cambian solo su importación (cuatro de ellos, pruebas). La forma y el hash entran
  en `keys.ts` después, con D1–D3. Verificado antes del commit: `npm run check` en 0, 417
  pruebas, cobertura 95,75 / 87,77 / 97,97 / 97,04, y los 31 archivos con los mismos conteos
  que la línea base.
- **D1–D3 y D14, en un commit propio.** `keys.ts` suma `API_KEY_SHAPE`, `generateApiKey`
  (`randomBytes(32)`) y `hashApiKey`; `presentedKey` pide la forma y `MAX_KEY_LENGTH` sale;
  `scope.ts` resuelve con `hashApiKey`. `API_KEY_SHAPE` es más estricta que «43 caracteres de
  base64url»: 43 caracteres llevan 258 bits, así que la última letra de 32 bytes es una de 16
  (`[AEIMQUYcgkosw048]`), y la forma la exige para que una llave tenga una sola escritura.
  D2 suma ese caso. Las llaves de prueba salen de `testApiKey(nombre)` de `crm-fixture.ts`:
  `crmk_` y el base64url del SHA-256 del nombre, codificado ahí y no con la función del
  servidor. Las de `test-key-cualquiera` de `logging-db.test.ts` también cambian: sin la
  forma, sus 500 serían 401. Pruebas nuevas: `keys.test.ts` (6) y `key-format-db.test.ts`
  (10), las dos primero en rojo (el generador no existía; los nueve casos mal formados
  tomaban una conexión). `npm run check` en 0, 433 pruebas, cobertura 95,77 / 87,66 / 98 /
  97,06. M1–M4 en rojo y restaurados por hash, más dos propios: M2b (la forma sin la última
  letra canónica) y M3b (el hash en Latin-1).

## Preguntas abiertas

Cada una tiene escrita su recomendación como **ASUNCIÓN** en la cláusula que afecta.
Respondidas el 2026-11-25: el dueño aceptó cada recomendación como está escrita, así que
cada ASUNCIÓN queda como decisión y la ADR no cambia.

1. **¿El formato es `crmk_` y 32 bytes al azar en base64url, y el servidor rechaza lo demás
   sin tocar la base?** Recomendación: sí. 256 bits, un prefijo que la guarda reconoce y
   que no choca con los nombres `crm_…` de los roles (D1, D2).
2. **¿Se emite y se revoca con un comando local como el administrador (`npm run db:keys`), y
   nunca por la API?** Recomendación: sí. Darle a la API permisos sobre `api_keys` rompe
   ADR-0005 D5 (D4, D9).
3. **¿Toda llave que emite el emisor lleva `read`?** Recomendación: sí. Es la condición con
   la que el dueño eligió H2 (a), hecha regla. La base sigue aceptando `{write}` para que el
   fixture pruebe el chequeo por ruta (D5).
4. **¿La etiqueta de una llave tiene la forma de un slug?** Recomendación: sí: `agente`,
   `mentor`, `exportacion`. Así no lleva el nombre de una persona (D5).
5. **¿Exportar es `GET /accounts/:slug/export`, solo los contactos activos, en JSON y
   paginado como las listas?** Recomendación: sí. `…/contacts/export` chocaría con
   `…/contacts/:contactId` (D10, D12).
6. **¿Una exportación no deja fila en la bitácora ni el id de la llave en el registro?**
   Recomendación: no en F1.4. La bitácora pide una migración, y el registro cambia ADR-0006
   D15. Ninguna llave del escenario tendrá `export`. Si alguna llega a tenerlo, se decide con
   otra ADR (D12).
7. **¿Revocar es por id y definitivo?** Recomendación: sí. Una llave nueva reemplaza a la
   revocada, y la fila queda como rastro (D7).
8. **¿H4 entra en F1.4, como un commit propio sin cambio de conducta?** Recomendación: sí.
   F1.4 cambia cómo se resuelve la llave, y es la última fase que toca ese archivo antes de
   F2 (D18).
9. **¿Las llaves no vencen?** Recomendación: no vencen en F1.4; se revocan. Es una
   demostración local con un agente.
