# Línea base de ADR-0004 · CI, guardas y cobertura (F0.5)

- **Fecha:** 2026-11-24
- **Rama:** `feat/f0-base`
- **Commit medido (la base):** `040b09ce77f3f31d39b73ee93728857e043316d9` (F0.4). La ADR es
  retroactiva, así que lo que sirve para comparar es el estado de antes de F0.5 y no la
  cabeza.
- **Cabeza al escribir esta línea base:** `fad87289672777215d71eee717cec0acca687f49` (F0.5),
  todavía sin auditar.
- **Árbol de trabajo:** limpio, salvo `docs/adr/0004-ci-guardas-y-cobertura.md` y este archivo,
  sin versionar.
- **Base de datos:** `circuit-db-1`, `postgres:18.7-trixie` fijada por digest, sana.

## Cómo se midió

En un worktree desechable de la base (`git worktree add --detach <scratchpad> 040b09c`),
nunca en el árbol de trabajo. Se copió `.env` para que las pruebas de base desechable
llegaran a PostgreSQL, y se borró con el worktree; se comprobó que no quedó nada. Los
comandos de `npm` corrieron en PowerShell y las guardas en Git Bash (CLAUDE.md §8). Cada
código de salida se leyó del proceso (`$LASTEXITCODE`, `${PIPESTATUS[0]}`), no de lo que
imprimió.

## Resultados en la base

| Comando | Salida | Conteo |
|---|---|---|
| `npm ci` | 0 | npm avisa que no corrió los `postinstall` de `esbuild@0.25.12` y `esbuild@0.28.2` (la puerta de `install-scripts` de npm 11); las pruebas pasaron igual |
| `npm run typecheck` | 0 | sin errores |
| `npm test` | 0 | 9 archivos, 76 pruebas: 76 pasadas, 0 fallidas, 0 omitidas |
| `npm audit --audit-level=low` | 0 | `found 0 vulnerabilities` |
| `bash guards/check-line-endings.sh '*.sh' '*.json' '*.sql' 'database/examples/**' '**/golden/**'` | 0 | 16 archivos fijados en LF |
| `bash guards/check-forbidden-phrases.sh forbidden-phrases.txt apps database` | 0 | 30 archivos |
| `bash <cabeza>/guards/check-secrets.sh` corrida sobre el árbol de la base | 0 | 51 archivos; ningún secreto ni archivo de secretos ya existía antes de F0.5 |

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

## Lo que no se midió, y por qué

- **Cobertura:** la base no tiene `@vitest/coverage-v8`, así que no hay una medida de antes.
  La auditoría compara la cabeza contra el piso de 80 (C11), no contra esta línea base.
- **`guards/check-secrets.test.sh`:** no existe en la base; llega con F0.5.
- **`npm run db:migrate`:** no se corrió. La base de desarrollo es del dueño, F0.5 no trae
  migraciones y la prueba de migraciones sobre una base desechable
  (`migrations-db.test.ts`) pasó.
- **CI en GitHub:** el workflow no existe en la base y nunca ha corrido (C15).
- **Linter:** el proyecto no tiene uno; el análisis estático es `tsc` en modo estricto
  (`npm run typecheck`).
- **Arrancar la aplicación:** todavía no hay servidor (llega en F1).

## Para la auditoría

- Lo que debe aparecer de nuevo en la cabeza: `check-secrets.test.sh`, `check-secrets.sh` y
  `npm run test:coverage`. Ningún archivo de prueba de la tabla debe desaparecer ni perder
  pruebas sin una explicación.
- En Windows, `git worktree remove --force` puede salir con 255 («Directory not empty»).
  Pasa cuando el worktree tiene `node_modules`: Git borra el registro, pero la carpeta
  queda. Se comprueba con `Test-Path` y se borra con `Remove-Item -Recurse -Force`.
