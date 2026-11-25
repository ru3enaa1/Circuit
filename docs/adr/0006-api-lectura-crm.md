# ADR-0006 · La API de lectura del CRM autentica la llave, ata la cuenta de la ruta y lee como un usuario sin privilegios

- **Fecha:** 2026-11-24
- **Estado:** aceptada el 2026-11-24. El dueño aceptó las siete recomendaciones de
  «Preguntas abiertas» tal como están escritas.
- **Tarea:** F1.2 de `DEVELOPMENT_PLAN.md`, «API de lectura» del CRM simulado. Suma lo que
  la auditoría de ADR-0005 dejó para esta fase (`docs/reviews/ADR-0005-audit-2026-11-24.md`):
  H3 (un dueño sin superusuario), H8 (los documentos de estado en el cerco), H10 (los
  miembros de `crm_service`) y H11 (D4 y D5 conectando como el usuario con login). También
  R10 del plan: `apps/crm` declara sus dependencias.
- **Retroactiva:** no. Todavía no hay servidor (línea base: `docs/reviews/ADR-0006-baseline.md`).

## Contexto

F1.1 dejó la base lista para que la use un servicio: RLS por cuenta, un rol `crm_service`
sin login, `crm.resolve_api_key` para resolver una llave por su hash y el contexto por
transacción (ADR-0005). Falta lo que la usa: un proceso HTTP que reciba la llave del
agente y lea solo lo de su cuenta. La estación 5 de circuit buscará el contacto por correo
y leerá sus etapas, notas y tareas antes de proponer nada (F2). Las escrituras llegan en
F1.3.

Cuatro fuerzas deciden la forma:

- **Local, sin llave y sin compilar** (CLAUDE.md §1). Quien clone el repositorio debe
  levantarlo con un comando. Node 24.20 corre TypeScript tal cual, con el modo
  `process.features.typescript = 'strip'`, comprobado en la línea base. Ese modo exige que
  las importaciones relativas terminen en `.ts`, y no acepta `enum`.
- **Un usuario con contraseña tiene que existir**, y ninguna migración puede tener `LOGIN`
  ni `PASSWORD` (ADR-0005 D14). Hoy las funciones `SECURITY DEFINER` son del superusuario
  de `.env`: con ese dueño, cualquier error futuro en ellas correría con todos los permisos
  del servidor (H3).
- **«No ve otra cuenta» debe fallar por la razón correcta**: un 403 con motivo, no un 404
  casual (criterio de F1). ADR-0005 puso la cuenta en la ruta y dejó el 403 «para F1.4».
  Una API de lectura no puede abrir sin él, así que esta ADR lo adelanta (pregunta 5).
- **Nada personal en los registros** (seguridad de F1). El correo es dato personal y la
  búsqueda por correo es la lectura principal.

## Opciones consideradas

**Cómo corre el servidor**

1. **Node con type stripping:** sin paso de compilación ni dependencia nueva. A cambio, se
   cambian las 42 importaciones relativas de `.js` a `.ts` y TypeScript prohíbe la sintaxis
   que no se puede borrar (`erasableSyntaxOnly`).
2. **`tsx` como cargador:** acepta `.js` y `enum`. A cambio, una dependencia más en tiempo de
   ejecución, y el comando de arranque ya no es solo `node`.
3. **Compilar con `tsc` a `dist/`:** es lo más común. A cambio, un paso de construcción, una
   carpeta generada y la duda de si `dist/` está al día.

**Cómo se conecta a la base**

1. **Un usuario `crm_app` con login, miembro de `crm_service`, creado por un script de
   administrador** que lee la contraseña del entorno. Las tablas y funciones pasan a un rol
   `crm_owner` sin login ni superusuario (H3).
2. **Conectar como el administrador y hacer `SET ROLE crm_service`** en cada transacción,
   como hacen hoy las pruebas. Es más simple, pero el proceso tendría la contraseña del
   superusuario: un error del CRM sería un error con todos los permisos.

**Dónde se comprueba la cuenta**

1. **En la API, antes de leer nada:** se compara la cuenta de la ruta con la de la llave, y
   si no coinciden la respuesta es 403 con motivo. RLS queda detrás, como segunda barrera.
2. **Solo con RLS:** la cuenta sale de la llave y la de la ruta se ignora. Otra cuenta daría
   200 con las filas propias o un 404, nunca el 403 que pide F1.

## Decisión

La primera opción de cada grupo.

- **Servidor:** Fastify 5.12.8, publicado el 2026-11-02, y zod 4.6.7, del 2026-10-12. Los
  dos se verificaron en el registro de npm el 2026-11-24. Corre con `node
  --env-file-if-exists=.env apps/crm/src/main.ts`, detrás de `npm run crm:start`. Escucha
  solo en `127.0.0.1`.
- **Base:** la migración `0004` crea `crm_owner` (`NOLOGIN`, con la guarda de ADR-0005 D14)
  y le pasa el esquema `crm`, sus tablas, sus secuencias y sus funciones. El script `npm run
  db:users` crea `crm_app` con la contraseña de `CRM_DB_PASSWORD`. Al servidor le manda un
  verificador SCRAM-SHA-256 calculado en local, nunca la contraseña. Así no puede quedar
  escrita en el registro de PostgreSQL, que copia la sentencia entera cuando falla (H5).
- **Cada petición, una transacción `READ ONLY` en su propia conexión.** Primero resuelve la
  llave por su SHA-256 con `crm.resolve_api_key`. Después compara la cuenta de la ruta con la
  de la llave y exige el permiso `read`. Luego fija `crm.account_id` y `crm.api_key_id` con
  `set_config(…, true)`, lee y termina.
- **Errores** con un cuerpo fijo, `{ "error": { "code", "message" } }`, y códigos de una
  lista cerrada: `sin_llave`, `llave_invalida`, `cuenta_ajena`, `sin_permiso`,
  `entrada_invalida`, `no_encontrado`, `demasiado_grande` y `error_interno`. El mensaje va
  en español y nunca repite un valor de la entrada.
- **La búsqueda por correo es un `POST` con el correo en el cuerpo**, no un `GET` con el
  correo en la URL. Así no acaba en el registro de nadie (pregunta 3).

## Cláusulas

«Como `crm_app`» quiere decir conectando con su usuario y su contraseña a una base
desechable, sin `SET ROLE`. Las pruebas HTTP usan `fastify.inject` contra una base
desechable sembrada con `database/test/crm-fixture.ts`. Solo D7 abre un puerto.

| Id | Regla | Chequeo | Crítica |
|---|---|---|---|
| D1 | El código corre con el type stripping de Node, sin compilar ni cargador. Toda importación relativa termina en `.ts`, y `tsconfig.base.json` tiene `allowImportingTsExtensions` y `erasableSyntaxOnly` | `git grep -nE "from '\.\.?/[^']*\.js'" -- '*.ts'` da 0 líneas; `npm run typecheck` da 0; un `enum` plantado en `apps/crm/src` lo pone en 1 (TS1294); D7 arranca el proceso real | no |
| D2 | Entran `fastify` 5.12.8 y `zod` 4.6.7, en las `dependencies` de `apps/crm` junto con `drizzle-orm` 0.45.4 y `pg` 8.23.1 (R10). Todas van con versión exacta y en el lockfile. No entra ninguna otra dependencia directa | `npm ls --workspace @circuit/crm --depth=0` lista esas cuatro; `git diff f7542cc -- package.json apps/circuit/package.json` no agrega dependencias; `npm audit --audit-level=low` da 0 | sí |
| D3 | `0004` crea `crm_owner` `NOLOGIN` con la guarda de ADR-0005 D14: es idempotente, resiste dos bases migrando a la vez, y falla si el rol ya existe con atributos o membresías. `crm_owner` es dueño del esquema `crm` y de cada tabla, secuencia, índice y función que hay en él (H3) | `crm-structure-db.test.ts`: `nspowner`, `pg_class.relowner` de todo lo de `crm` y `pg_proc.proowner` son de `crm_owner`; `crm_owner` no tiene atributos ni miembros. Además, el par de la carrera de `migrations-db.test.ts` incluye `0004`, y las pruebas existentes de D7 y D10 de ADR-0005 siguen en verde con el dueño nuevo | sí |
| D4 | `npm run db:users` crea o actualiza `crm_app` con `LOGIN` e `INHERIT`, sin ningún otro atributo y miembro solo de `crm_service`, con la contraseña de `CRM_DB_PASSWORD`. Si `crm_app` ya existe con atributos o membresías de más, falla en vez de usarlo. Ninguna sentencia que manda lleva la contraseña: lleva un verificador `SCRAM-SHA-256$4096:…` calculado en local. Los únicos miembros de `crm_service` son `crm_app`, y `crm_owner` y `circuit_service` no tienen miembros (H10) | `crm-login-db.test.ts`: `crm_app` entra con su contraseña y no entra con otra (28P01); los atributos y las membresías se comparan con una lista fija; el texto de cada sentencia capturada no contiene la contraseña; `rolpassword` empieza con `SCRAM-SHA-256$`; con `BYPASSRLS` plantado en una transacción que se deshace, el script falla con su mensaje | sí |
| D5 | Como `crm_app` valen D4 y D5 de ADR-0005. Con la cuenta A fijada solo se ven filas de A. Sin cuenta se ven 0 filas, y toda inserción falla con el mensaje de RLS. `DELETE` y `TRUNCATE` fallan con 42501. Su matriz de permisos es la de `crm_service` (H11) | `crm-login-db.test.ts`, sin `SET ROLE`: los conteos, los 42501 con su mensaje y `has_table_privilege('crm_app', …)` comparada con la matriz fija de D5 | sí |
| D6 | La configuración sale solo de `process.env` y la valida zod: `CRM_DB_PASSWORD`, `POSTGRES_DB`, `DB_PORT` y `CRM_PORT`. El usuario (`crm_app`) y el host (`127.0.0.1`) son constantes. Si falta una variable, o no es válida, el arranque se detiene con un mensaje que nombra la variable y nunca su valor. Si una variable empieza con BOM, lo dice | `config.test.ts`: una variable que falta, un puerto fuera de rango, una variable con BOM, y en ninguno de esos mensajes aparece el valor | no |
| D7 | El servidor escucha solo en `127.0.0.1`. El proceso real arranca con `node`, sin compilar, y responde | `main-process.test.ts`: lanza `node apps/crm/src/main.ts` con `CRM_PORT=0`, apuntando a una base desechable; lee la dirección que anuncia, que es `127.0.0.1`; `GET /health` da 200; y termina el proceso | sí |
| D8 | Toda ruta bajo `/accounts/:slug/` exige `Authorization: Bearer <llave>`. Sin cabecera o con otro esquema: 401 `sin_llave`. Con una llave desconocida o revocada: 401 `llave_invalida`, con el mismo cuerpo byte a byte en los dos casos. Todo 401 lleva `WWW-Authenticate: Bearer`. La llave solo se busca por su SHA-256 con `crm.resolve_api_key`; el servidor no la guarda ni la compara | `auth-db.test.ts`: los cuatro 401, y el cuerpo de la revocada igual al de la desconocida | sí |
| D9 | La cuenta de la ruta tiene que ser la de la llave, y se compara antes de leer cualquier dato. Si no lo es, la respuesta es 403 `cuenta_ajena`, igual para otra cuenta que existe y para un `slug` que no existe. Una llave sin `read` recibe 403 `sin_permiso`. Esto se adelanta de F1.4 (pregunta 5) | `auth-db.test.ts`: la llave de A en `/accounts/cuenta-b/stages` da 403; la misma llave en un `slug` que no existe da el mismo cuerpo; el control es que la llave de B en `cuenta-b` da 200; una llave `{write}` da 403 `sin_permiso` | sí |
| D10 | Cada petición corre en una transacción `READ ONLY`, y el contexto lo fija `set_config(…, true)`. Una escritura dentro de una lectura falla con 25006. El contexto no pasa a la petición siguiente en la misma conexión | `read-context-db.test.ts`: un `INSERT` plantado dentro del ayudante da 25006; con un pool de una conexión, después de una petición de A, `crm.context_account_id()` es `NULL` y se ven 0 contactos | sí |
| D11 | Las rutas son exactamente siete, y ninguna escribe: `GET /health`; `GET /accounts/:slug/stages`; `POST /accounts/:slug/contacts/search`; `GET /accounts/:slug/contacts/:contactId`; `GET /accounts/:slug/contacts/:contactId/notes`; `GET /accounts/:slug/contacts/:contactId/tasks`; y `GET /accounts/:slug/companies/:companyId`. `/health` no pide llave y no devuelve datos | `routes.test.ts`: las rutas que registra un hook `onRoute`, comparadas con esa lista fija de método y ruta | sí |
| D12 | Cada respuesta trae solo los campos de su lista fija (pregunta 1). Etapa: `id`, `key`, `label`, `position`. Contacto: `id`, `fullName`, `email`, `companyId`, `stageId`, `createdAt`. Empresa: `id`, `name`, `industry`, `sizeRange`, `revenueRange`, `createdAt`. Nota: `id`, `body`, `createdAt`. Tarea: `id`, `title`, `dueOn`, `completedAt`, `createdAt`. Nunca `accountId` ni `archivedAt`. Lo archivado no se devuelve, y un contacto archivado pedido por id da 404 (pregunta 2) | `reads-db.test.ts`: las claves de cada objeto son exactamente las de la lista; una nota y un contacto archivados no aparecen, y el contacto archivado da 404 | sí |
| D13 | Un registro de otra cuenta responde igual que uno que no existe: 404 `no_encontrado`, nunca 403. RLS lo esconde, y la ruta propia no revela si existe | `reads-db.test.ts`: el contacto de B, pedido por `/accounts/cuenta-a/…` con la llave de A, da el mismo cuerpo que un id que no existe; el control es que la llave de B lo lee con 200 | sí |
| D14 | Toda entrada pasa por zod, después de la llave y la cuenta. El `slug` sigue `SLUG_PATTERN` y los ids siguen `^[1-9][0-9]{0,15}$`. El correo se recorta, va a minúsculas, mide hasta 254 y tiene la forma de `contacts_email_shape`. `limit` va de 1 a 100, con 50 por defecto, y `before` es un id. Un cuerpo con campos desconocidos se rechaza. Lo inválido da 400 `entrada_invalida`, que nombra el campo y nunca el valor. Un cuerpo de más de 16 KiB da 413 `demasiado_grande` | `input-db.test.ts`: un caso por campo, y ningún cuerpo de error contiene el valor enviado; sin llave, una entrada inválida da 401 y no 400 | sí |
| D15 | Cada petición escribe una línea de registro con el método, el patrón de la ruta (no la URL), el estado y la duración. Nunca escribe cabeceras, cuerpo, la llave, un correo ni un nombre. Un error de la base se registra solo con su SQLSTATE, y la respuesta es 500 `error_interno`, sin el mensaje | `logging-db.test.ts`: con el registro capturado, una búsqueda con la llave y el correo del fixture no deja en él ni la llave, ni el correo, ni el nombre. Un error plantado que lleva un correo en su `message` y en su `detail` deja solo el código, y el cuerpo del 500 no lo trae | sí |
| D16 | No hay CORS, cookies ni otra forma de autenticarse | `auth-db.test.ts`: ninguna respuesta trae `access-control-allow-origin` ni `set-cookie` | no |
| D17 | Nada de ADR-0005 se debilita. Las migraciones `0000`–`0003` no cambian (sus hashes, A9). Ninguna prueba existente se quita ni se debilita. Ningún archivo pasa de 400 líneas, así que `crm-rules-db.test.ts`, que tiene 391, se parte antes de crecer | `migration-files.test.ts`; los conteos por archivo de la línea base no bajan, salvo las pruebas que se mueven al partir el archivo, que se nombran; `wc -l` sobre `apps database` no da ningún `.ts` de más de 400 | sí |

### Chequeos, tal como se corren

En PowerShell (CLAUDE.md §8), con la base levantada y `CRM_DB_PASSWORD` en `.env`:

```powershell
docker compose up -d --wait db
npm run db:migrate                         # aplica 0004
npm run db:users                           # crea o actualiza crm_app (D4)
npm run check; echo $LASTEXITCODE          # D1–D17 dentro de las pruebas, con el piso de cobertura: debe dar 0
npm ls --workspace @circuit/crm --depth=0  # D2
npm audit --audit-level=low                # D2
npm run crm:start                          # verlo en la app real: /health da 200 y una ruta sin llave, 401
```

En Git Bash:

```sh
git grep -nE "from '\.\.?/[^']*\.js'" -- '*.ts' | wc -l                 # D1: 0
git diff f7542cc -- package.json apps/circuit/package.json               # D2: sin dependencias nuevas fuera de apps/crm
git ls-files '*.ts' | xargs wc -l | awk '$1 > 400 && $2 != "total"'      # D17: ninguna línea
```

### Mutantes

Cada uno se planta en el código real, se restaura después (comprobado por hash) y debe
poner en rojo su prueba:

| Id | Cláusula | Mutante |
|---|---|---|
| M1 | D3 | La guarda de `crm_owner` cambiada por `NULL` |
| M2 | D3 | Una tabla que se queda con el administrador como dueño |
| M3 | D4 | El script manda la contraseña en claro |
| M4 | D4 | `crm_app` como miembro de un segundo rol |
| M5 | D5 | `crm_app` con `BYPASSRLS` |
| M6 | D9 | Sin la comparación de la cuenta: la llave de A en `cuenta-b` daría 200 con las etapas de A |
| M7 | D9 | Sin el chequeo de `read` |
| M8 | D10 | La transacción sin `READ ONLY` |
| M9 | D10 | `set_config(…, false)`, que deja el contexto en la sesión |
| M10 | D12 | Una consulta que devuelve `accountId` |
| M11 | D12 | Una consulta que no filtra lo archivado |
| M12 | D15 | El manejador de errores que registra el error entero |
| M13 | D14 | El esquema de la búsqueda sin `strict` |

## Cerco

- **Puede cambiar:**
  - `apps/crm/`: `src/` nuevo (`config`, `db`, `server`, `routes`, `main`), `test/`,
    `package.json` y `tsconfig.json`.
  - `database/users.ts` y su script, los dos nuevos.
  - `database/migrations/`: solo `0004_*`, su snapshot y el journal.
  - `database/test/`: pruebas nuevas, la partición de `crm-rules-db.test.ts`, el fixture
    ampliado y la línea de `0004` en `migration-hashes.ts`.
  - `database/schema.sql`, si `npm run db:dump-schema` cambia algo.
  - Las importaciones relativas de `apps/` y `database/`, de `.js` a `.ts`. Es un cambio
    mecánico (D1).
  - `tsconfig.base.json` (dos opciones), `package.json` (los scripts `crm:start` y
    `db:users`, y el lockfile) y `.env.example` (`CRM_DB_PASSWORD` y `CRM_PORT`).
  - `.github/workflows/ci.yml`: solo el paso «Entorno local con una contraseña de un solo
    uso», que también genera y tapa `CRM_DB_PASSWORD`.
  - Los documentos de estado (H8): `CLAUDE.md` (§2, §4, §5, §7, §8 y §9),
    `DEVELOPMENT_PLAN.md` y `README.md`, sin anunciar nada que no exista. Más esta ADR y su
    auditoría en `docs/reviews/`.
- **No debe cambiar:**
  - Las migraciones `0000`–`0003`.
  - Los roles `crm_service` y `circuit_service`, sus permisos y sus políticas.
  - `compose.yaml` y `guards/`.
  - `apps/circuit`, salvo sus importaciones (D1).
  - Los demás pasos de CI.
  - Ninguna prueba existente se debilita (D17).
- **Fuera de alcance:**
  - Las escrituras, que `proposed_by` salga de la llave y la lectura de la bitácora (F1.3).
  - El formato y la generación de las llaves (H12), su revocación y los permisos `write`,
    `delete` y `export` por ruta (F1.4).
  - La semilla del escenario y R6 (F1.5).
  - El cliente del CRM en circuit y el usuario `circuit_app` (F2).
  - El CRM como servicio de Compose (F6).
  - Límite de peticiones y TLS: todo es local, en `127.0.0.1`.

## Restricciones

- Solo datos sintéticos, en bases desechables. Las pruebas nunca leen ni escriben la base
  de desarrollo. Lo único que tocan del servidor compartido es `crm_app`, con la misma
  contraseña de `.env` que pondría `npm run db:users`.
- La contraseña de `crm_app` vive solo en `.env` y en el entorno. En CI se genera en cada
  corrida y se tapa con `add-mask`, igual que `POSTGRES_PASSWORD`.
- **ASUNCIÓN** (pregunta 4): puerto 4010 en `.env.example`; un cuerpo de hasta 16 KiB; un
  pool de 5 conexiones; `statement_timeout` de 5 s y la misma espera para una transacción
  ociosa; listas de 50 por defecto y 100 como máximo, ordenadas por id de mayor a menor, con
  `before` como cursor.
- Los ids salen como números JSON, porque `schema.ts` los declara `mode: 'number'`
  (ADR-0005). Las fechas salen en ISO 8601, en UTC.

## Daño a vigilar

- **La base de desarrollo del dueño:** `0004` cambia los dueños. Hoy tiene 0 filas (línea
  base); igual se respalda antes de migrar.
- **El servidor de PostgreSQL compartido:** `crm_app` es de todo el servidor, como los
  roles de servicio. Las pruebas lo crean con la contraseña de `.env`, y sin
  `CRM_DB_PASSWORD` fallan con el comando que falta, nunca se saltan.
- **Cada migración futura de `crm`:** drizzle-kit crea las tablas nuevas con el
  administrador como dueño. La migración tiene que terminar con `OWNER TO crm_owner`; si no,
  D3 se pone en rojo. Va a CLAUDE.md §7.
- **El cambio de `.js` a `.ts`** puede romper la carga de `drizzle.config.ts`. El chequeo es
  `npx drizzle-kit generate`, que debe decir «No schema changes».
- **`pg_dump --no-owner` no muestra los dueños**, así que `schema.sql` no ve H3. Lo ve D3.
- **Un error de pg impreso entero puede llevar la contraseña** (CLAUDE.md §8). Por eso el
  servidor nunca registra el objeto del error (D15).

## Reversión

Revertir los commits quita el servidor, el script y las dependencias. `0004` solo avanza,
así que se deshace con una migración nueva, que devuelve los dueños con `OWNER TO
CURRENT_USER`. `crm_app` se borra a mano (`DROP ROLE crm_app`), nunca desde una migración. No
se puede deshacer lo publicado: después del push, el diseño de la API es público (no lleva
secretos).

## Consecuencias

- F1.3 reusa el mismo ayudante de transacción sin `READ ONLY`, y le suma los autores, que
  salen de la llave.
- F1.4 hereda la autenticación, el 403 de cuenta y el de `read`. Le queda el formato de las
  llaves, su generación (H12) y los permisos de escritura.
- Circuit (F2) le habla a esta API por HTTP con la llave del agente y nunca toca la base.
- Toda tabla nueva de `crm` necesita su `OWNER TO crm_owner`, además de RLS y permisos.
- No hay `enum` de TypeScript en el repositorio. Las listas cerradas siguen siendo `as const`.

## Preguntas abiertas

Respondidas el 2026-11-24: el dueño aceptó cada recomendación como está escrita, así que
la ADR no cambia.

1. **¿Estas siete rutas y estos campos?** Recomendación: los de D11 y D12, que son lo que
   necesita la estación 5. La bitácora se lee en F1.3.
2. **¿Lo archivado se esconde?** Recomendación: sí, y un contacto archivado da 404. Archivar
   es la forma de borrar (ADR-0005 D6).
3. **¿La búsqueda por correo es `POST` o `GET`?** Recomendación: `POST`, para que el correo
   no quede en una URL ni en un registro.
4. **¿Estos límites?** Recomendación: los de la ASUNCIÓN de «Restricciones».
5. **¿Se adelantan de F1.4 el 403 de cuenta y el chequeo de `read`?** Recomendación: sí. Sin
   ellos, una llave de solo escritura podría leer entre F1.2 y F1.4.
6. **¿Verificador SCRAM o la contraseña en claro en `CREATE ROLE`?** Recomendación: el
   verificador. Son unas 20 líneas con `node:crypto`, y la contraseña nunca llega al registro.
7. **¿`crm_owner` también es dueño del esquema, o solo recibe `USAGE`?** Recomendación: dueño.
   Sin login y sin miembros, el riesgo es el mismo, y queda una sola regla para D3.
