# Línea base de ADR-0012 · Aprobación del mentor y cierre (F2.4)

- **Fecha:** 2026-11-26 · **Base:** `8edc7d88d220e34ce4365cbc2119c54608166bef`, rama
  `feat/f2-circuito`.
- **La suite, las guardas y su falla intermitente:** las de `docs/reviews/ADR-0010-baseline.md`,
  medidas sobre el mismo commit. Al implementar esta ADR, la base real será el commit que
  cierre ADR-0011; antes de empezar, se vuelve a correr `npm run check` sobre él y se anota aquí.

## Lo propio de esta ADR, medido en la base

| Qué | Resultado |
|---|---|
| `apps/circuit/src/modules/approval/index.ts` y `crm-client/index.ts` | solo `export {};` |
| La API de escritura del CRM | trece rutas, con `approval: { approvedBy, approvalRef }` obligatorio (ADR-0007 D7); `AUDIT_AUTHOR_PATTERN` es `^[a-z0-9-]{1,40}$` (`apps/crm/src/db/schema.ts:32-38`) |
| La llave del agente | la emite `npm run db:seed` en `CRM_AGENT_KEY_FILE` (`.env.example:27`, `.secrets/crm-agent-key`); la `.env` del dueño no trae esa variable ni `CIRCUIT_SCENARIO` (CLAUDE.md §2) |
| `circuit.apply_claims` | no existe; las migraciones llegan hasta `0004` |

## No medido

- El CRM con la llave del agente sobre la base de desarrollo: lo midió D26 de ADR-0009 el
  2026-11-25 y no se repitió aquí.
