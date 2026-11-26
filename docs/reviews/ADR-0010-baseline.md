# Línea base de ADR-0010 · Motor, eventos y simulador (F2.1 y F2.2)

También es la línea base de ADR-0011 y ADR-0012: las tres se escribieron sobre el mismo commit,
y sus archivos de línea base remiten a este para la suite.

- **Fecha:** 2026-11-26
- **Rama:** `feat/f2-circuito`
- **Commit medido (la base):** `8edc7d88d220e34ce4365cbc2119c54608166bef` (sin empujar,
  según el relevo del 2026-11-26).
- **Árbol de trabajo al medir:** limpio (`git status --short` vacío). Después se escribieron
  las ADR-0010 a 0012 y sus líneas base, sin versionar; no tocan código ni pruebas.
- **Entorno:** `circuit-db-1` `running healthy` (`postgres:18.7-trixie`), Docker 29.9.3,
  Node 24.20.0. npm, npx y docker en PowerShell; las guardas y git en Git Bash (CLAUDE.md §8).

## Resultados en la base

| Comando | Salida | Conteo |
|---|---|---|
| `npm run check` (1.ª vuelta) | **1** | 50 archivos, 648 pruebas: 646 pasadas, **1 fallida**, 1 saltada; 82 s. Falló `database/test/migrations-db.test.ts › two disposable databases migrating at once › both apply every migration` con `TestTimeoutError: Test timed out in 5000ms` |
| `npm run check` (2.ª vuelta) | 0 | 50 archivos, 648 pruebas: 647 pasadas, 1 saltada; cobertura 95,62 / 86,6 / 96,72 / 97,71; 58 s |
| `npm audit --audit-level=low` | 0 | `found 0 vulnerabilities` |
| `npx drizzle-kit generate` | 0 | «No schema changes, nothing to migrate» |
| `bash guards/check-secrets.sh` | 0 | — |
| `bash guards/check-line-endings.sh '*.sh' '*.json' '*.sql' 'guards/hooks/*' 'database/examples/**' '**/golden/**'` | 0 | 29 archivos fijados en LF |
| `bash guards/check-forbidden-phrases.sh forbidden-phrases.txt README.md apps database` | 0 | 117 archivos |
| `git ls-files -z \| xargs -0 bash guards/check-forbidden-phrases.sh forbidden-phrases.local.txt` | 0 | 158 archivos |
| Las dos listas de frases sobre las tres ADR nuevas | 0 | 3 archivos |
| `git grep -nE "from '\.\.?/[^']*\.js'" -- '*.ts' \| wc -l` | — | 0 |
| `git ls-files '*.ts' \| xargs wc -l \| awk '$1 > 400 && $2 != "total"'` | — | ninguna línea |
| `git ls-files ':(glob)apps/circuit/src/**' \| wc -l` | — | 5: los cinco `index.ts`, cada uno con `export {};` |
| `ls scenarios/escuela` | — | solo `crm.json`: no hay `simulator.json` ni `documents/` |
| `grep -n "CIRCUIT\|CRM_" .env.example` | — | `CRM_DB_PASSWORD`, `CRM_PORT`, `CIRCUIT_SCENARIO`, `CRM_AGENT_KEY_FILE`; no hay `CIRCUIT_DB_PASSWORD`, `CIRCUIT_MODEL`, `CIRCUIT_PORT` ni `CIRCUIT_MENTOR` |

**La prueba saltada:** D20 de ADR-0009 (el modo `0600` del archivo de la llave), que solo corre
en Linux; en CI corre.

**Pruebas que ya fallaban:** una, de forma intermitente: la de arriba, en 1 de 2 vueltas.
`migrations-db.test.ts:120` corre las migraciones de dos bases a la vez con los 5 s por defecto
de Vitest. `hook-budget.test.ts` exige presupuesto a los hooks con base y a las pruebas que
siembran o llaman a docker, pero no a esta. Es la misma clase de falla que la auditoría de
ADR-0009 cerró para la semilla (H1); con `0005` la prueba tardará más. ADR-0010 D20 la cubre.
La auditoría no debe contarla como regresión si sigue intermitente; sí, si deja de pasar.

## Lo que existe y lo que no

- `apps/circuit/test/architecture/module-map.ts`: `circuit: { modules: [], packages: [] }`; los
  otros cuatro módulos, `modules: ['circuit'], packages: []`; `@anthropic-ai/sdk` reservado a
  `model`.
- `database/schema.ts` declara solo `pgSchema('circuit')`; `0000` crea los esquemas `circuit` y
  `crm`; `0002` crea `circuit_service` sin login y sin permisos en `crm`
  (`crm-rules-db.test.ts`, «D13 · circuit_service does not see the CRM»).
- `apps/circuit/package.json` no declara dependencias; no hay `main.ts` ni servidor.
- No existen `apps/board`, ningún `.tsx`, ni `apps/circuit/test/golden/`.

## No medido

- La aplicación: circuit no tiene proceso que arrancar. El CRM (`npm run crm:start`) no se
  arrancó en esta medida; su conducta la cubren sus pruebas, en verde en la segunda vuelta.
- CI sobre `8edc7d8`: el commit no está empujado.
