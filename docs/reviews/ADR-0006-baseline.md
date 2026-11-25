# Línea base de ADR-0006 · API de lectura del CRM (F1.2)

- **Fecha:** 2026-11-24
- **Rama:** `feat/f1-crm`
- **Commit medido (la base):** `f7542cc88a3ac4c37456464cec9b5c5c64d0eac6`, con los
  arreglos de la auditoría de ADR-0005 (A6–A9). Empujado ese día.
- **Árbol de trabajo:** limpio, salvo la ADR-0006 y este archivo, sin versionar.
- **Base de datos:** `circuit-db-1`, `postgres:18.7-trixie` fijada por digest, sana. Docker
  29.9.3.

## Cómo se midió

En el árbol de trabajo, sobre la base. Los comandos de `npm` corrieron en PowerShell y las
guardas en Git Bash (CLAUDE.md §8). Cada código de salida se leyó del proceso. La base de
desarrollo solo se leyó, con `psql` dentro del contenedor: `npm run db:migrate` no aplicó
nada, porque ya estaba en `0003`.

## Resultados en la base

| Comando | Salida | Conteo |
|---|---|---|
| `docker compose up -d --wait db` | 0 | — |
| `npm run db:migrate` | 0 | nada pendiente |
| `npm run check` | 0 | tipos sin errores; 12 archivos y 164 pruebas: 164 pasadas, 0 fallidas, 0 omitidas; cobertura 98,46 / 92,3 / 100 / 98,24 |
| `npm audit --audit-level=low` | 0 | `found 0 vulnerabilities` |
| `npx drizzle-kit generate` | 0 | «No schema changes, nothing to migrate» |
| `bash guards/check-secrets.sh` | 0 | — |
| `bash guards/check-line-endings.sh '*.sh' '*.json' '*.sql' 'guards/hooks/*' 'database/examples/**' '**/golden/**'` | 0 | 26 archivos fijados en LF |
| `bash guards/check-forbidden-phrases.sh forbidden-phrases.txt README.md apps database` | 0 | 46 archivos |
| CI en GitHub sobre `f7542cc` | verde | corrida 45503832664. El paso «Carrera de roles en un servidor nuevo» corrió por primera vez y pasó |

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
| `database/test/crm-rules-db.test.ts` | 46 | 0 |
| `database/test/crm-structure-db.test.ts` | 11 | 0 |
| `database/test/migration-files.test.ts` | 11 | 0 |
| `database/test/migration-rules.test.ts` | 40 | 0 |
| `database/test/migrations-db.test.ts` | 8 | 0 |
| `database/test/schema-dump-db.test.ts` | 1 | 0 |

`crm-rules-db.test.ts` tiene 391 líneas. Al partirlo (D17), sus 46 pruebas deben seguir
existiendo, repartidas entre los archivos que salgan.

## Estado de la base de desarrollo

- Migrada hasta `0003`, con 0 filas en `crm` (0 cuentas y 0 contactos).
- Roles fuera de los del sistema: `circuit_admin` (login, superusuario, `BYPASSRLS`),
  `crm_service` y `circuit_service` (sin login, sin superusuario, sin `BYPASSRLS`). Ningún
  rol es miembro de otro fuera de los del sistema. `crm_owner` y `crm_app` todavía no
  existen.
- **Dueños (H3):** el esquema `crm`, sus 16 relaciones (8 tablas y 8 secuencias) y sus 3
  funciones (`context_account_id`, `resolve_api_key` y `write_audit_log`) son de
  `circuit_admin`.
- Bases: `circuit`, `postgres`, `template0` y `template1`. No quedó ninguna base de prueba.

## Lo que se probó para decidir

En una carpeta temporal fuera del repositorio, el 2026-11-24:

- Node 24.20.0 corre un `.ts` sin opciones: `process.features.typescript` es `'strip'`, sale
  con 0 y no muestra ninguna advertencia.
- Con una importación relativa terminada en `.js`, falla con `ERR_MODULE_NOT_FOUND`. Con un
  `enum`, también falla, con el código de salida 1.
- `--env-file-if-exists` sigue sin el archivo, con el aviso «not found. Continuing without
  it.». Con un archivo guardado con BOM, la primera variable no se lee, porque el BOM se
  pega a su nombre.
- TypeScript 7.0.2 acepta `allowImportingTsExtensions` y `erasableSyntaxOnly`. Sin la
  primera, una importación `.ts` da TS5097. Con la segunda, un `enum` da TS1294.
- En el registro de npm: `fastify` 5.12.8 es `latest`, publicado el 2026-11-02; `zod` 4.6.7
  es `latest`, publicado el 2026-10-12.
- Hay 42 importaciones relativas terminadas en `.js` en `apps/` y `database/`.

## Lo que no se midió, y por qué

- **Arrancar la aplicación:** todavía no hay servidor. Llega con esta ADR.
- **Linter:** el proyecto no tiene uno; el análisis estático es `tsc` en modo estricto.
- **La lista privada de frases:** no se corrió para esta línea base. Corre en el hook de
  `pre-push`, que salió limpio en el push de `f7542cc`.

## Para la auditoría

- Deben aparecer las pruebas de las cláusulas (`crm-login-db`, `config`, `main-process`,
  `auth-db`, `read-context-db`, `routes`, `reads-db`, `input-db` y `logging-db`), y
  `crm-structure-db.test.ts` debe ganar las de D3.
- Ningún archivo de la tabla debe desaparecer ni perder pruebas sin una explicación, salvo
  la partición de `crm-rules-db.test.ts`.
- Después de la auditoría, `SELECT datname FROM pg_database` no debe mostrar ninguna
  `circuit_test_…`, y los miembros de `crm_service` deben ser solo `crm_app`.
