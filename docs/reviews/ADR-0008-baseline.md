# Línea base de ADR-0008 · Llaves del CRM (F1.4)

- **Fecha:** 2026-11-25
- **Rama:** `feat/f1-crm`
- **Commit medido (la base):** `6e8f4458756993c33f7c43f61fb5a69355e05058`, igual a
  `origin/feat/f1-crm`.
- **Árbol de trabajo:** limpio al medir (`git status --short` vacío). Después se escribieron
  la ADR-0008 y este archivo, sin versionar.
- **Base de datos:** `circuit-db-1`, `postgres:18.7-trixie` fijada por digest, sana. Docker
  29.9.3, Node 24.20.0 y npm 11.19.0.

## Cómo se midió

En el árbol de trabajo, sobre la base. Los comandos de `npm` y de `node` corrieron en
PowerShell, y las guardas, `git` y `gh` en Git Bash (CLAUDE.md §8). Cada código de salida se
leyó del proceso. La base de desarrollo solo se leyó, con `psql` dentro del contenedor.

## Resultados en la base

| Comando | Salida | Conteo |
|---|---|---|
| `docker compose up -d --wait db` | 0 | — |
| `npm run db:migrate` | 0 | nada pendiente: 5 migraciones aplicadas (`0000`–`0004`) |
| `npm run check` | 0 | tipos sin errores; 31 archivos y 417 pruebas: 417 pasadas, 0 fallidas, 0 omitidas; cobertura 95,75 / 87,77 / 97,97 / 97,04 |
| `npx vitest run --reporter=json` | 0 | 417 pruebas, 417 pasadas (la tabla por archivo, abajo) |
| `npm audit --audit-level=low` | 0 | `found 0 vulnerabilities` |
| `npx drizzle-kit generate` | 0 | «No schema changes, nothing to migrate» |
| `npm ls --workspace @circuit/crm --depth=0` | 0 | drizzle-orm 0.45.4, fastify 5.12.8, pg 8.23.1 y zod 4.6.7 |
| `bash guards/check-secrets.sh` | 0 | — |
| `bash guards/check-line-endings.sh '*.sh' '*.json' '*.sql' 'guards/hooks/*' 'database/examples/**' '**/golden/**'` | 0 | 28 archivos fijados en LF |
| `bash guards/check-forbidden-phrases.sh forbidden-phrases.txt README.md apps database` | 0 | 85 archivos |
| `git ls-files -z \| xargs -0 bash guards/check-forbidden-phrases.sh forbidden-phrases.local.txt` | 0 | 120 archivos |
| `git grep -nE "from '\.\.?/[^']*\.js'" -- '*.ts' \| wc -l` | — | 0 (ADR-0006 D1) |
| `git ls-files '*.ts' \| xargs wc -l \| awk '$1 > 400 && $2 != "total"'` | — | ninguna línea. El más largo, `database/test/crm-structure-db.test.ts`, con 360 |
| CI en GitHub sobre `6e8f445` | verde | corrida 45659052830, consultada con `gh run view` ese día |

**Pruebas que ya fallaban:** ninguna.

Pruebas por archivo (reporte JSON de Vitest), para que la auditoría vea si alguna desaparece:

| Archivo | Pruebas | No pasadas |
|---|---|---|
| `apps/circuit/test/architecture/architecture.test.ts` | 23 | 0 |
| `apps/circuit/test/architecture/source-imports.test.ts` | 8 | 0 |
| `apps/circuit/test/control.test.ts` | 1 | 0 |
| `apps/crm/test/audit-read-db.test.ts` | 4 | 0 |
| `apps/crm/test/auth-db.test.ts` | 13 | 0 |
| `apps/crm/test/config.test.ts` | 14 | 0 |
| `apps/crm/test/control.test.ts` | 1 | 0 |
| `apps/crm/test/errors.test.ts` | 6 | 0 |
| `apps/crm/test/input-db.test.ts` | 38 | 0 |
| `apps/crm/test/logging-db.test.ts` | 13 | 0 |
| `apps/crm/test/main-process.test.ts` | 9 | 0 |
| `apps/crm/test/read-context-db.test.ts` | 4 | 0 |
| `apps/crm/test/reads-db.test.ts` | 10 | 0 |
| `apps/crm/test/routes.test.ts` | 3 | 0 |
| `apps/crm/test/write-auth-db.test.ts` | 11 | 0 |
| `apps/crm/test/write-context-db.test.ts` | 4 | 0 |
| `apps/crm/test/write-input-db.test.ts` | 50 | 0 |
| `apps/crm/test/write-refs-db.test.ts` | 15 | 0 |
| `apps/crm/test/write-sql-db.test.ts` | 6 | 0 |
| `apps/crm/test/writes-db.test.ts` | 9 | 0 |
| `database/test/compose.test.ts` | 3 | 0 |
| `database/test/connection.test.ts` | 11 | 0 |
| `database/test/crm-audit-keys-db.test.ts` | 23 | 0 |
| `database/test/crm-login-db.test.ts` | 32 | 0 |
| `database/test/crm-rules-db.test.ts` | 23 | 0 |
| `database/test/crm-structure-db.test.ts` | 13 | 0 |
| `database/test/hook-budget.test.ts` | 2 | 0 |
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
| `GET /accounts/cuenta-a/contacts/export`, sin llave | 401 | `route: "/accounts/:slug/contacts/:contactId"` |
| La misma, con `Bearer crmk_` y 43 `A` (la forma de D1, una llave que no existe) | 401 | la misma ruta |
| `GET /accounts/cuenta-a/stages`, con `Bearer test-key-unknown` | 401 | `route: "/accounts/:slug/stages"` |

Se detuvo después, y el proceso quedó terminado. Con F1.4, `GET /accounts/cuenta-a/export`
debe existir (401 sin llave, con su propio patrón de ruta).

## Estado de la base de desarrollo

- Migrada hasta `0004` (5 filas en `drizzle.__drizzle_migrations`), con 0 filas en
  `crm.accounts`, `crm.api_keys`, `crm.contacts` y `crm.audit_log`. Sin cuentas, `db:keys
  issue` no tendrá dónde emitir hasta la semilla de F1.5.
- No quedó ninguna base `circuit_test_…`.

## Lo que se probó para decidir

- **La forma de D1:** `randomBytes(32).toString('base64url')` da 43 caracteres que cumplen
  `^[A-Za-z0-9_-]{43}$` (Node 24.20.0).
- **El prefijo no choca con nada:** `git grep -nE 'crm_[A-Za-z0-9_-]{43}'` y `git grep -n
  'crmk_'` dan 0 líneas cada uno. Se prefirió `crmk_` a `crm_` porque `crm_service`,
  `crm_app` y `crm_owner` ya usan ese prefijo.
- **`…/contacts/export` cae en `…/contacts/:contactId`** (la tabla de arriba). Por eso D10
  pone la exportación en `/accounts/:slug/export`.
- **Una llave mal formada no toca la base hoy**, por lectura del código y no por medición:
  `credentialsOf` (`apps/crm/src/server/auth.ts:31-38`) lanza el 401 al armar los
  argumentos de `withReadScope` y de `withWriteScope`, antes de `pool.connect()`
  (`apps/crm/src/db/read-scope.ts:114`). Ninguna prueba lo comprueba; D2 lo hará.
- **Las pruebas de una llave desconocida usan literales sin la forma de D1:**
  `test-key-unknown` en `auth-db.test.ts:33`, `input-db.test.ts:150`,
  `logging-db.test.ts:93-99` y `read-context-db.test.ts:51`; `test-key-cualquiera` en
  `logging-db.test.ts:124, 144, 164`; y las llaves del fixture (`crm-fixture.ts:108-190`).
  Con la puerta de D2, todas darían 401 sin llegar a la base: lo que cierra D14.

## Lo que no se midió, y por qué

- **CI no se volvió a correr:** se leyó la corrida 45659052830 de `6e8f445` con `gh`.
- **Linter:** el proyecto no tiene uno; el análisis estático es `tsc` en modo estricto.
- **Los mutantes de ADR-0005 a ADR-0007** no se volvieron a plantar; sus auditorías los
  dejaron en rojo.

## Para la auditoría

- Deben aparecer las pruebas de las cláusulas: `keys`, `keys-db`, `keys-process`,
  `key-format-db`, `export-db` y `agent-key-db`, o los archivos en que se repartan, más la
  lista nueva de `routes`.
- Ningún archivo de la tabla puede desaparecer ni perder pruebas sin una explicación. Si D18
  se acepta, `read-scope.ts` se llama `scope.ts`, y los archivos de prueba que lo importan
  cambian solo esa línea.
- `git diff 6e8f445` no puede tocar `database/migrations/`, `migration-hashes.ts`,
  `database/schema.sql`, `apps/crm/src/db/schema.ts` ni el lockfile (D16).
- Después de la auditoría, `SELECT datname FROM pg_database` no debe mostrar ninguna
  `circuit_test_…`, y la base de desarrollo debe seguir con 0 filas en `crm`.
