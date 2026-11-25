# Línea base de ADR-0009 · Respaldo, restauración y semilla (R6 y F1.5)

- **Fecha:** 2026-11-25
- **Rama:** `feat/f1-crm`
- **Commit medido (la base):** `52e015d4ac43257fe39dcb0f694ecb42607cd6de`, el último empujado
  (CI en verde: corrida 45694757738, `success` sobre ese SHA, consultada con `gh run view`).
- **Árbol de trabajo al medir:** `M CLAUDE.md` y `M DEVELOPMENT_PLAN.md`, las notas de estado
  de F1.4 que quedaron sin commit a propósito (dicen que A1 y A2 se empujaron y que siguen R6 y
  F1.5). No tocan código ni pruebas. Después se escribieron la ADR-0009 y este archivo, sin
  versionar.
- **Base de datos:** `circuit-db-1`, `postgres:18.7-trixie` fijada por digest, `running
  healthy`. Docker 29.9.3, Node 24.20.0 y npm 11.19.0.

## Cómo se midió

En el árbol de trabajo, sobre la base. Los comandos de `npm`, `npx`, `node` y `docker` corrieron
en PowerShell; las guardas, `git` y `gh`, en Git Bash (CLAUDE.md §8). Cada código de salida se
leyó del proceso. La base de desarrollo solo se leyó, con `psql` y `pg_dump` dentro del
contenedor.

## Resultados en la base

| Comando | Salida | Conteo |
|---|---|---|
| `npm run check` | 0 | tipos sin errores; 38 archivos y 480 pruebas, 480 pasadas; cobertura 95,58 / 87,58 / 97,26 / 97,42; 52 s |
| `npx vitest run --reporter=json` | 0 | 480 pruebas: 480 pasadas, 0 fallidas, 0 pendientes (la tabla por archivo, abajo) |
| `npm audit --audit-level=low` | 0 | `found 0 vulnerabilities` |
| `npx drizzle-kit generate` | 0 | «No schema changes, nothing to migrate» |
| `npm ls zod --all` | 0 | una sola copia, zod 4.6.7, bajo `@circuit/crm` |
| `bash guards/check-secrets.sh` | 0 | — |
| `bash guards/check-line-endings.sh '*.sh' '*.json' '*.sql' 'guards/hooks/*' 'database/examples/**' '**/golden/**'` | 0 | 28 archivos fijados en LF |
| `bash guards/check-forbidden-phrases.sh forbidden-phrases.txt README.md apps database` | 0 | 95 archivos |
| `git ls-files -z \| xargs -0 bash guards/check-forbidden-phrases.sh forbidden-phrases.local.txt` | 0 | 133 archivos |
| `git grep -nE "from '\.\.?/[^']*\.js'" -- '*.ts' \| wc -l` | — | 0 (ADR-0006 D1) |
| `git ls-files '*.ts' \| xargs wc -l \| awk '$1 > 400 && $2 != "total"'` | — | ninguna línea. El más largo, `database/test/crm-structure-db.test.ts`, con 360 |
| `git check-ignore -q .secrets/crm-agent-key` | 1 | hoy git **no** ignora ese lugar (D21 lo pide en 0) |
| `git check-ignore -q database/backups/x/circuit.dump` | 0 | los respaldos ya están fuera de git |
| `git grep -n -i "andamio" \| wc -l` | — | 0: el nombre del escenario todavía no está en el repositorio |
| `git grep -n -i -E "escuela\|andamio\|diagn[oó]stico" -- 'database/*.ts' 'apps/*/src'` | 1 | 0 líneas (D7 lo pide igual al final) |
| `ls scenarios .secrets` | — | ninguna de las dos carpetas existe |

**Pruebas que ya fallaban:** ninguna.

Pruebas por archivo (reporte JSON de Vitest), para que la auditoría vea si alguna desaparece o
pierde pruebas:

| Archivo | Pruebas | No pasadas |
|---|---|---|
| `apps/circuit/test/architecture/architecture.test.ts` | 23 | 0 |
| `apps/circuit/test/architecture/source-imports.test.ts` | 8 | 0 |
| `apps/circuit/test/control.test.ts` | 1 | 0 |
| `apps/crm/test/agent-key-db.test.ts` | 5 | 0 |
| `apps/crm/test/audit-read-db.test.ts` | 4 | 0 |
| `apps/crm/test/auth-db.test.ts` | 13 | 0 |
| `apps/crm/test/config.test.ts` | 14 | 0 |
| `apps/crm/test/control.test.ts` | 1 | 0 |
| `apps/crm/test/errors.test.ts` | 6 | 0 |
| `apps/crm/test/export-db.test.ts` | 9 | 0 |
| `apps/crm/test/input-db.test.ts` | 38 | 0 |
| `apps/crm/test/key-format-db.test.ts` | 10 | 0 |
| `apps/crm/test/keys-command.test.ts` | 20 | 0 |
| `apps/crm/test/keys-db.test.ts` | 11 | 0 |
| `apps/crm/test/keys-process.test.ts` | 2 | 0 |
| `apps/crm/test/keys.test.ts` | 6 | 0 |
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
arrancó en `http://127.0.0.1:4010`:

| Petición | Estado |
|---|---|
| `GET /health` | 200 `{"status":"ok"}` |
| `GET /accounts/escuela-andamio/contacts/1`, sin llave | 401 |

Se detuvo después, y no quedó ningún proceso. Hoy no hay ninguna llave con la que probar más:
la base de desarrollo no tiene cuentas.

## Estado de la base de desarrollo

- Migrada hasta `0004`: 5 filas en `drizzle.__drizzle_migrations`.
- 0 filas en las ocho tablas de `crm` (`accounts`, `api_keys`, `pipeline_stages`,
  `companies`, `contacts`, `notes`, `tasks` y `audit_log`). `db:keys issue` no tiene dónde
  emitir.
- Bases del servidor: `circuit`, `postgres`, `template0` y `template1`. Ninguna
  `circuit_test_…`, ni después de las dos corridas de pruebas.
- Roles: `circuit_admin`, `circuit_service`, `crm_app`, `crm_owner` y `crm_service`.
- Respaldos que ya existen, todos hechos a mano y fuera de git:
  `circuit-antes-f1.1-20261124-141842.sql` (2 792 bytes),
  `circuit-antes-0003-20261124-153547.sql` (30 143 bytes) y
  `2026-11-24-1921-antes-0004/circuit.dump` (41 817 bytes). Ninguno trae su hash, y la
  restauración del último sigue sin verificar (auditoría de ADR-0006, «Sin verificar»).

## Lo que se probó para decidir

- **Las herramientas del contenedor:** `pg_dump` y `pg_restore` 18.7 (Debian 18.7-1.pgdg13+5) y
  `/usr/bin/sha256sum`. El `/tmp` del contenedor tiene 947 GB libres.
- **La tubería de PowerShell corrompe el volcado, y `docker compose cp` no.** Se volcó la base
  de desarrollo, solo lectura, con `pg_dump --format=custom --file /tmp/baseline-probe.dump`
  dentro del contenedor (salida 0). Adentro: 41 435 bytes, SHA-256
  `fb2bf1e5…245e8022`, y `pg_restore --list` leyó un índice de 130 líneas.
  - `docker compose cp db:/tmp/baseline-probe.dump …` (salida 0): 41 435 bytes y el mismo
    SHA-256.
  - `docker compose exec -T db cat /tmp/baseline-probe.dump > …` en PowerShell 5.1 (salida
    0): 42 466 bytes y otro SHA-256, `7d263675…b4317fa2`. Cambia el archivo y no avisa.
  - El temporal se borró después (`ls` dentro del contenedor ya no lo encuentra).
- **Node captura la salida de docker sin cambiarla:** `execFileSync('docker', ['compose',
  'exec', '-T', 'db', 'cat', '/usr/lib/postgresql/18/bin/pg_dump'])` dio 504 656 bytes con el
  SHA-256 que `sha256sum` dio adentro (`4edcf164…de19369d`). Es la opción 2 de la ADR,
  descartada por otra razón: el host no tiene `pg_restore` para leer el índice.
- **`.secrets/` no está ignorada** (`git check-ignore` da 1), así que D21 empieza en rojo.
- **La API ya devuelve `createdAt`** de contactos, empresas, notas y tareas
  (`apps/crm/src/db/reads.ts:26, 35, 38, 45`). Por eso D15 toma las fechas del paquete: sin
  eso, lo que lee el agente cambiaría de un clon a otro.
- **El comentario de `apps/circuit/src/modules/scenario/index.ts:2`** dice que el cargador
  «arrives with the seed, in F1.5». La ADR deja ese cargador en F2, así que el comentario
  cambia (D23).

## Lo que no se midió, y por qué

- **CI no se volvió a correr:** se leyó la corrida 45694757738 de `52e015d` con `gh`.
- **Linter:** el proyecto no tiene uno; el análisis estático es `tsc` en modo estricto.
- **La restauración de los respaldos viejos:** no se intentó. Sin `db:restore` habría sido
  otro procedimiento a mano; D26 lo hace con el comando nuevo (pregunta 10).
- **Los mutantes de ADR-0005 a ADR-0008:** no se volvieron a plantar; sus auditorías los
  dejaron en rojo.

## Para la auditoría

- Deben aparecer las pruebas de las cláusulas: `backup-db`, `restore-db`, `scenario`,
  `scenario-content`, `seed-db`, `seed-agent-key-db`, `backup-process` y `seed-process`, o los
  archivos en que se repartan.
- Ningún archivo de la tabla puede desaparecer ni perder pruebas. `keys-command`, `keys-db` y
  `keys-process` siguen con 20, 11 y 2 (D18).
- `git diff 52e015d` no puede tocar `database/migrations/`, `migration-hashes.ts`,
  `database/schema.sql`, `apps/crm/src/db/schema.ts`, el lockfile ni `compose.yaml` (D23), ni
  la API del CRM (D24).
- Después de la auditoría, `SELECT datname FROM pg_database` no debe mostrar ninguna
  `circuit_test_…`, y el `/tmp` del contenedor ningún temporal del respaldo. Si D26 ya corrió,
  la base de desarrollo tiene las dos cuentas del paquete, una sola llave `agente` viva y el
  archivo en `.secrets/crm-agent-key`; si no, sigue con 0 filas en `crm`.
