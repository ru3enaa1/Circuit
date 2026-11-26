# Línea base de ADR-0011 · El tablero desde los eventos (F2.3)

- **Fecha:** 2026-11-26 · **Base:** `8edc7d88d220e34ce4365cbc2119c54608166bef`, rama
  `feat/f2-circuito`.
- **La suite, las guardas y su falla intermitente:** las de `docs/reviews/ADR-0010-baseline.md`,
  medidas sobre el mismo commit. Al implementar esta ADR, la base real será el commit que
  cierre ADR-0010; antes de empezar, se vuelve a correr `npm run check` sobre él y se anota aquí.

## Lo propio de esta ADR, medido en la base

| Comando | Resultado |
|---|---|
| `ls apps` | `circuit` y `crm`: no existe `apps/board` |
| `git ls-files '*.tsx' \| wc -l` | 0 |
| `vitest.config.ts`, `coverage.include` | `['apps/*/src/**/*.ts', 'database/*.ts']`: un `.tsx` quedaría fuera (ADR-0004 H6) |
| `docs/diseno.md` | no existe; B10 lo cita |
| Servidor de circuit | no existe: ningún `main.ts` ni `src/server/` |
| `npm ls vite --all` | no medido (la versión que trae Vitest 5.1.1 es 8.3.8, según CLAUDE.md §5) |

## No medido

- El aspecto del boceto elegido se midió en la sesión anterior con Chrome sin ventana (relevo
  del 2026-11-26): bien a 1536×864 y a 720×900, con un vacío al centro a 2560×1080. Aquí no se
  repitió.
