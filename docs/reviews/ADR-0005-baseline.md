# Línea base de ADR-0005 · Esquema `crm` (F1.1)

- **Fecha:** 2026-11-24
- **Rama:** `feat/f1-crm`
- **Commit medido (la base):** `2eb4c7449a0e6f8bc20e3ff03734470af436e278`. Es `main`
  (`4b79aa3`, F0 integrada) más el commit de cierre de F0, que solo toca `CLAUDE.md` y
  `DEVELOPMENT_PLAN.md`.
- **Árbol de trabajo:** limpio, salvo la ADR-0005 y este archivo, sin versionar.
- **Base de datos:** `circuit-db-1`, `postgres:18.7-trixie` fijada por digest, sana.

## Cómo se midió

En el árbol de trabajo, sobre la base. Los comandos de `npm` corrieron en PowerShell y las
guardas en Git Bash (CLAUDE.md §8). Cada código de salida se leyó del proceso. La base de
desarrollo solo se leyó (`psql` y `pg_dump` dentro del contenedor); no se escribió nada.

## Resultados en la base

| Comando | Salida | Conteo |
|---|---|---|
| `npm run typecheck` | 0 | sin errores |
| `npx vitest run --coverage` | 0 | 9 archivos, 76 pruebas: 76 pasadas, 0 fallidas, 0 omitidas; cobertura 92 / 92,3 / 100 / 91,3 |
| `npm audit --audit-level=low` | 0 | `found 0 vulnerabilities` |
| `bash guards/check-secrets.sh` | 0 | — |
| `bash guards/check-secrets.test.sh` | 0 | sus 25 casos |
| `bash guards/pre-push.test.sh` | 0 | sus 10 casos |
| `bash guards/check-line-endings.sh '*.sh' '*.json' '*.sql' 'guards/hooks/*' 'database/examples/**' '**/golden/**'` | 0 | 20 archivos fijados en LF |
| `bash guards/check-forbidden-phrases.sh forbidden-phrases.txt README.md apps database` | 0 | 31 archivos |
| Lista privada sobre lo versionado (`git ls-files -z \| xargs -0 …`) | 0 | 59 archivos |
| CI en GitHub sobre `4b79aa3` | verde | corridas 45459976606 (`feat/f0-base`) y 45460157418 (`main`) |

**Pruebas que ya fallaban:** ninguna.

Pruebas por archivo (reporte JSON de Vitest), para que la auditoría vea si alguna desaparece:

| Archivo | Pruebas | No pasadas |
|---|---|---|
| `apps/circuit/test/architecture/architecture.test.ts` | 23 | 0 |
| `apps/circuit/test/architecture/source-imports.test.ts` | 8 | 0 |
| `apps/circuit/test/control.test.ts` | 1 | 0 |
| `apps/crm/test/control.test.ts` | 1 | 0 |
| `database/test/compose.test.ts` | 3 | 0 |
| `database/test/connection.test.ts` | 11 | 0 |
| `database/test/migration-files.test.ts` | 3 | 0 |
| `database/test/migration-rules.test.ts` | 25 | 0 |
| `database/test/migrations-db.test.ts` | 1 | 0 |

## Estado de la base de desarrollo

- Esquemas `circuit`, `crm` y `drizzle`; **0 tablas** en `circuit` y `crm`; una migración
  aplicada (`0000_init`). No hay filas que respaldar antes de migrarla.
- Roles fuera de los del sistema: solo `circuit_admin` (superusuario, con login).
  `crm_service` y `circuit_service` todavía no existen.
- Bases: `circuit`, `postgres`, `template0` y `template1`; no quedó ninguna base de prueba.
- PostgreSQL y `pg_dump` 18.7 (Debian 18.7-1.pgdg13+5). En el contenedor, el socket local y
  `127.0.0.1` entran con `trust`; desde fuera, `scram-sha-256`.
- Un `pg_dump --schema-only` de esta base tiene 108 líneas. La 5 es `\restrict <clave>` y
  la 107 es `\unrestrict <clave>`, con una clave al azar en cada volcado. El volcado dice
  `OWNER TO circuit_admin`, que sale de `.env`. `pg_dump --help` ofrece `--restrict-key`.
- `drizzle-kit generate --help` ofrece `--custom` («Prepare empty migration file for custom
  SQL») y `--name`.

## Lo que no se midió, y por qué

- **`npm run db:migrate`:** no se corrió. F1.1 todavía no trae migraciones.
- **Arrancar la aplicación:** todavía no hay servidor (llega en F1.2).
- **Linter:** el proyecto no tiene uno; el análisis estático es `tsc` en modo estricto.

## Para la auditoría

- Deben aparecer `crm-structure-db.test.ts`, `crm-rules-db.test.ts` y
  `schema-dump-db.test.ts`, y `migrations-db.test.ts` debe ganar pruebas sin perder la que
  tiene. Ningún archivo de la tabla debe desaparecer ni perder pruebas sin una explicación.
- Las pruebas nuevas crean roles en el servidor de PostgreSQL compartido. Después de la
  auditoría, `SELECT datname FROM pg_database` no debe mostrar ninguna `circuit_test_…`.
