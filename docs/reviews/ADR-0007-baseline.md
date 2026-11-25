# Línea base de ADR-0007 · API de escritura del CRM (F1.3)

- **Fecha:** 2026-11-25
- **Rama:** `feat/f1-crm`
- **Commit medido (la base):** `5bdbf6859d22e614380f9371cf4c4d4119ad3bf0`. Es local:
  `origin/feat/f1-crm` está en `b41f8d6`, y `5bdbf68` solo agrega documentos de estado.
- **Árbol de trabajo:** limpio, salvo la ADR-0007 y este archivo, sin versionar.
- **Base de datos:** `circuit-db-1`, `postgres:18.7-trixie` fijada por digest, sana. Docker
  29.9.3, Node 24.20.0 y npm 11.19.0.

## Cómo se midió

En el árbol de trabajo, sobre la base. Los comandos de `npm` y de `node` corrieron en
PowerShell, y las guardas y `git` en Git Bash (CLAUDE.md §8). Cada código de salida se leyó
del proceso. La base de desarrollo solo se leyó, con `psql` dentro del contenedor. Las dos
pruebas de «Lo que se probó para decidir» que tocan la base corrieron con `SELECT` sobre la
base de desarrollo, o sobre una base desechable que se borró al terminar.

## Resultados en la base

| Comando | Salida | Conteo |
|---|---|---|
| `docker compose up -d --wait db` | 0 | — |
| `npm run db:migrate` | 0 | nada pendiente: 5 migraciones aplicadas (`0000`–`0004`) |
| `npm run check` | 0 | tipos sin errores; 22 archivos y 301 pruebas: 301 pasadas, 0 fallidas, 0 omitidas; cobertura 94,67 / 85,16 / 97,11 / 96,18 |
| `npx vitest run --reporter=json` | 0 | 301 pruebas, 301 pasadas (la tabla por archivo, abajo) |
| `npm audit --audit-level=low` | 0 | `found 0 vulnerabilities` |
| `npx drizzle-kit generate` | 0 | «No schema changes, nothing to migrate» |
| `npm ls --workspace @circuit/crm --depth=0` | 0 | drizzle-orm 0.45.4, fastify 5.12.8, pg 8.23.1 y zod 4.6.7 |
| `bash guards/check-secrets.sh` | 0 | — |
| `bash guards/check-line-endings.sh '*.sh' '*.json' '*.sql' 'guards/hooks/*' 'database/examples/**' '**/golden/**'` | 0 | 28 archivos fijados en LF |
| `bash guards/check-forbidden-phrases.sh forbidden-phrases.txt README.md apps database` | 0 | 74 archivos |
| `git ls-files -z \| xargs -0 bash guards/check-forbidden-phrases.sh forbidden-phrases.local.txt` | 0 | 106 archivos |
| `git grep -nE "from '\.\.?/[^']*\.js'" -- '*.ts' \| wc -l` | — | 0 (ADR-0006 D1) |
| `git ls-files '*.ts' \| xargs wc -l \| awk '$1 > 400 && $2 != "total"'` | — | ninguna línea. El más largo, `database/test/crm-structure-db.test.ts`, con 360 |
| CI en GitHub sobre `b41f8d6` | verde | corrida 45635335825, consultada con `gh run list` ese día. `5bdbf68` no se ha empujado |

**Pruebas que ya fallaban:** ninguna.

Pruebas por archivo (reporte JSON de Vitest), para que la auditoría vea si alguna desaparece:

| Archivo | Pruebas | No pasadas |
|---|---|---|
| `apps/circuit/test/architecture/architecture.test.ts` | 23 | 0 |
| `apps/circuit/test/architecture/source-imports.test.ts` | 8 | 0 |
| `apps/circuit/test/control.test.ts` | 1 | 0 |
| `apps/crm/test/auth-db.test.ts` | 13 | 0 |
| `apps/crm/test/config.test.ts` | 14 | 0 |
| `apps/crm/test/control.test.ts` | 1 | 0 |
| `apps/crm/test/input-db.test.ts` | 35 | 0 |
| `apps/crm/test/logging-db.test.ts` | 8 | 0 |
| `apps/crm/test/main-process.test.ts` | 8 | 0 |
| `apps/crm/test/read-context-db.test.ts` | 4 | 0 |
| `apps/crm/test/reads-db.test.ts` | 10 | 0 |
| `apps/crm/test/routes.test.ts` | 3 | 0 |
| `database/test/compose.test.ts` | 3 | 0 |
| `database/test/connection.test.ts` | 11 | 0 |
| `database/test/crm-audit-keys-db.test.ts` | 23 | 0 |
| `database/test/crm-login-db.test.ts` | 32 | 0 |
| `database/test/crm-rules-db.test.ts` | 23 | 0 |
| `database/test/crm-structure-db.test.ts` | 13 | 0 |
| `database/test/migration-files.test.ts` | 13 | 0 |
| `database/test/migration-rules.test.ts` | 40 | 0 |
| `database/test/migrations-db.test.ts` | 14 | 0 |
| `database/test/schema-dump-db.test.ts` | 1 | 0 |

## La aplicación

`node --env-file-if-exists=.env apps/crm/src/main.ts` (lo que corre `npm run crm:start`)
arrancó y anunció `http://127.0.0.1:4010`. Respuestas:

| Petición | Estado | Línea de registro |
|---|---|---|
| `GET /health` | 200 `{"status":"ok"}` | `route: "/health"` |
| `GET /accounts/cuenta-a/stages`, sin llave | 401 | `route: "/accounts/:slug/stages"` |
| `POST /accounts/cuenta-a/contacts`, sin llave | **404**: la ruta no existe todavía | `route: null` |

Después se detuvo, y el proceso quedó terminado. Con F1.3, la tercera debe dar 401.

## Estado de la base de desarrollo

- Migrada hasta `0004`, con 0 filas en `crm.accounts`, `crm.api_keys`, `crm.contacts` y
  `crm.audit_log`. No hay llaves, así que la app real no puede escribir hasta la semilla
  de F1.5.
- Roles: `crm_service`, `circuit_service` y `crm_owner` sin login, sin superusuario y sin
  `BYPASSRLS`; `crm_app` con login y sin superusuario. El único miembro de `crm_service` es
  `crm_app`, sin `ADMIN OPTION`.
- **Permisos de `crm_service` en `crm`** (lo que F1.3 usa, sin migración): `SELECT` en
  `accounts`, `pipeline_stages` y `audit_log`; `INSERT`, `SELECT` y `UPDATE` en
  `companies`, `contacts`, `notes` y `tasks`. Nada en `api_keys`.
- No quedó ninguna base `circuit_test_…`, tampoco después de la prueba desechable de abajo.

## Lo que se probó para decidir

- **Lo que drizzle manda en un `INSERT`** (`drizzle.mock()` y `toSQL()`, sin base): `insert
  into "crm"."contacts" ("id", "account_id", "company_id", "stage_id", "full_name",
  "email", "created_at", "archived_at") values (default, $1, default, $2, $3, $4, default,
  default)`. Nombra `id` y `created_at`, pero con `default`. Por eso D8 mira los valores y
  no los nombres de columna. El `UPDATE` solo nombra lo que se le pasa en `set`.
- **Un NUL en un texto:** PostgreSQL 18.7 rechaza `SELECT length($1::text)` con `a\0b` con
  SQLSTATE 22021.
- **Un sustituto UTF-16 suelto** (`a\ud800b`) llega como U+FFFD: `length` 3 y bytes
  `61efbfbd62`. `'a\ud800b'.isWellFormed()` da `false` en Node 24.20.0.
- **La forma del correo de `input.ts`** (`/^[^@\s]+@[^@\s]+$/`) deja pasar los dos: `\s` no
  incluye U+0000.

## Fallas previas que las pruebas no ven

Halladas al medir. Las dos son de ADR-0006, y la auditoría de esa ADR no las vio. En la base
son conducta medida, no regresiones. Se corrigieron después, como ADR-0006 A6–A7 (ver
«Después de medir»).

- **F-1 · La búsqueda con un NUL da 500, no 400** (ADR-0006 D14). Reproducido en una base
  desechable sembrada con el fixture de las pruebas: `POST /accounts/cuenta-a/contacts/search`
  con la llave de A y `{"email": "conta\u0000cto@cuenta-a.test"}` da 500 `error_interno`.
  El NUL pasa zod y la base lo rechaza. Con un sustituto suelto en el correo da 200 y
  `{"contacts":[]}`, sin daño.
- **F-2 · El SQLSTATE no llega al registro cuando la consulta es de drizzle** (ADR-0006
  D15). En la misma prueba, la línea del 500 fue `{"event":"internal_error","sqlstate":null,
  "code":null}`, donde se esperaba `22021`. La causa: drizzle-orm 0.45.4 envuelve el error de
  pg en un `DrizzleQueryError` (`node_modules/drizzle-orm/pg-core/session.js:41`), y el
  `pg.DatabaseError` queda en su `cause` (`node_modules/drizzle-orm/errors.js:10`).
  `errorCodes` (`apps/crm/src/log.ts:24`) no mira la causa. `logging-db.test.ts` planta un
  `pg.DatabaseError` suelto, y por eso no lo ve. **No filtra nada:** el mensaje del
  envoltorio lleva el SQL y sus parámetros (el correo), pero hoy no se registra ni se
  responde. Para F1.3 importa más: sin leer la causa, un correo repetido daría 500 y no 409.

## Lo que no se midió, y por qué

- **CI no se volvió a correr:** `5bdbf68` no se ha empujado. La corrida de `b41f8d6` se leyó
  con `gh`.
- **Linter:** el proyecto no tiene uno; el análisis estático es `tsc` en modo estricto.
- **Una escritura en la app real:** la base de desarrollo no tiene llaves. La cubre D17
  sobre una base desechable.
- **Los mutantes de ADR-0006** no se volvieron a plantar; su auditoría los dejó en rojo.

## Para la auditoría

- Deben aparecer las pruebas de las cláusulas: `write-auth-db`, `write-context-db`,
  `writes-db`, `write-input-db`, `audit-read-db` y `errors`, o los archivos en que se
  repartan, más los casos nuevos de `routes`, `input-db`, `logging-db` y `main-process`.
- Ningún archivo de la tabla puede desaparecer ni perder pruebas sin una explicación.
- `git diff 5bdbf68` no puede tocar `database/migrations/`, `migration-hashes.ts`,
  `database/schema.sql`, `apps/crm/src/db/schema.ts` ni el lockfile (D14 y D15).
- F-1 y F-2 tienen que estar corregidas, cada una con una prueba que estaba en rojo antes
  del arreglo. Hecho antes de F1.3: ver «Después de medir».
- Después de la auditoría, `SELECT datname FROM pg_database` no debe mostrar ninguna
  `circuit_test_…`, y la base de desarrollo debe seguir con 0 filas en `crm`.

## Después de medir (2026-11-25): F-1 y F-2, corregidas como ADR-0006 A6–A7

La medición de arriba sigue siendo la de `5bdbf68`. Después, y antes de escribir nada de
F1.3, el dueño pidió arreglar lo que hubiera que arreglar. Las dos fallas se corrigieron en
ADR-0006, donde nacieron (enmiendas A6 y A7). Cada prueba nueva estaba en rojo antes del
arreglo, y su mutante (M19 y M20 de ADR-0006) la vuelve a poner en rojo.

| Falla | Antes del arreglo | Después | Prueba |
|---|---|---|---|
| F-1 | la búsqueda con un NUL en el correo, dentro o al final: 500 | 400 «email» | `input-db.test.ts`, «a NUL … is 400 «email», not 500» (2 casos) |
| F-2 | el `DrizzleQueryError` real de una sentencia con un NUL: `sqlstate: null` | `22021`, sin el correo de sus parámetros | `logging-db.test.ts`, «a database error wrapped by drizzle…» y «a connection drizzle wraps…» |

Lo que cambia para la auditoría de ADR-0007:

- `npm run check` dio 0, con 305 pruebas (4 nuevas) y cobertura 94,72 / 85,86 / 97,14 /
  96,21. Por archivo, solo cambian `input-db.test.ts` (35 → 37) y `logging-db.test.ts`
  (8 → 10). Esos son los conteos que D16 no deja bajar.
- `apps/crm/src/routes/input.ts` y `apps/crm/src/log.ts` ya traen los arreglos. El diff de
  F1.3 se lee desde el commit que los integre, no desde `5bdbf68`. Los chequeos de D14 y D15
  contra `5bdbf68` siguen valiendo, porque A6 y A7 no tocan migraciones, esquema ni lockfile.
- La app real arrancó, respondió `GET /health` con 200 y la búsqueda sin llave con 401, y
  se detuvo. No quedó ninguna base `circuit_test_…`, y la base de desarrollo sigue con 0
  filas en `crm`.
