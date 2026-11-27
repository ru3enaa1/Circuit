# ADR-0014 · El logo, el equipo y los paneles salen de funciones puras, y ninguno muestra un estado que la proyección no tenga

- **Fecha:** 2026-11-27 · **Estado:** aceptada el 2026-11-27. Claude eligió las recomendaciones
  (CLAUDE.md §1b): no tocan la arquitectura ni el contrato de datos.
- **Tarea:** F2.3c de `DEVELOPMENT_PLAN.md` y de `docs/diseno.md` §17: el logo 4a (§12), el
  equipo de personajes (§11) y los paneles de la ultraancha (§9).
- **Depende de:** ADR-0011 (B1, B2, B7 y B10) y ADR-0013 (la miniatura del portal).

## Contexto

Las tres piezas son dibujo: ninguna agrega datos. El riesgo es que se vuelvan estado (un
personaje que «avisa», un panel con su propia cuenta) o que el ícono de pestaña rompa B7: la CSP
`default-src 'self'` rechaza un `data:`, así que el ícono tiene que ser un archivo de `dist`.

## Decisión

- **Una sola geometría para la órbita en pequeño** (`apps/board/src/mark.ts`, pura): dónde va
  cada bola y cada cuello en la caja de -50 a 50. La usan la miniatura del portal y el logo; el
  logo solo cambia sus medidas (§12) y pone Filtro a 250°.
- **El logo es un componente puro** (`components/Logo.tsx`): sus colores van como atributos del
  SVG, no en CSS, así que el mismo marcado sirve en la página y como archivo. Va a 32 px junto a
  «Circuit» (Plex Sans 600) en la línea de la marca.
- **El ícono de pestaña** es `apps/board/public/favicon.svg`, que Vite copia a `dist` y circuit
  sirve desde su lista (B7). Es el marcado del componente con su fondo; una prueba lo compara y
  `npm run board:favicon` lo reescribe. La otra opción, un `data:` en `index.html`, pedía abrir
  la CSP: se descarta.
- **El equipo** (cuando llegue): `crew.ts`, puro, de la vista, la medida y el id de la corrida.
  La semilla es un hash del id (FNV-1a de 32 bits) que alimenta un generador fijo; nada de
  `Math.random`. Entre 2 y 4 figuras sobre cuellos, descartadas si tocan una estación, un nodo,
  un texto o el muelle. Con alto, falla o espera, solo poses serias.
- **Los paneles** (cuando lleguen): con la ventana a más de 2,05 : 1, `layoutFor` dice `wide`, y
  dos `<aside>` dibujan la cita, las acciones, el reloj, la confianza y los totales desde la
  misma proyección; esos datos dejan los nodos y las esquinas en esa medida.

## Cláusulas

| Id | Regla que el código cumple | Chequeo que lo prueba |
|---|---|---|
| G1 | El logo sigue §12: Persona al centro (radio 11,5, hueca hasta 6), seis bolas de 7,6 a 39 del centro, a los ángulos de §6 salvo Filtro a 250°; cuellos de 2,4, Clasificación→Persona en amarillo y CRM→Persona en rosado; nada sale de la caja | `logo.test.ts` |
| G2 | El logo y la miniatura del portal ponen sus bolas con la misma función de `mark.ts` | `logo.test.ts`; `room-render.test.ts` sigue en verde |
| G3 | `favicon.svg` es el marcado de `<Logo>` con fondo, byte a byte; `index.html` lo enlaza por una ruta propia | `favicon.test.ts`; B7 de `source-rules.test.ts` sin cambio |
| G4 | La misma corrida pone al equipo siempre igual; ninguna figura toca una estación, un nodo ni el muelle; con alto, falla o espera, solo poses serias; un accesorio rosado nunca junto a una estación rosada | `crew.test.ts`, sobre cada prefijo de cada caso dorado y las cuatro medidas de B10 |
| G5 | Los paneles solo existen a más de 2,05 : 1 y cada cifra que muestran es la de la proyección | `panels-render.test.ts` |
| G6 | B1, B2 y E5 siguen como están: ni estado ni temporizadores nuevos | `source-rules.test.ts`, sin cambiar sus listas |
| G7 | Sin dependencias nuevas ni cambios fuera de `apps/board`, el guion de capturas, `package.json` (el guion) y los documentos | `git diff --stat a30dd2e` |

## Consecuencias

- Cambiar la órbita del logo cambia también la miniatura del portal, a propósito: son la misma
  figura.
- El ícono de pestaña no se edita a mano; si se edita, `favicon.test.ts` se pone en rojo.

## Notas de implementación

**El logo (2026-11-27, sobre `a30dd2e`).** `mark.ts` (`markDots`, `markNeck`, `at`, `round`),
`logo.ts` (`logoShapes`, con los colores de §4 como valores) y `components/Logo.tsx`. La
miniatura del portal dejó sus propios cálculos y usa `markDots` y `markNeck`; sus cuellos ahora
van de borde a borde, igual a la vista porque las bolas los tapaban. La línea de la marca es
`BrandLine` (`Panels.tsx`), en el circuito y en las salas; `brandLine`, que devolvía texto, se
quitó. El ícono lleva el `xmlns` que React no escribe: lo agrega la prueba, así que `src/` sigue
sin nombrar ningún origen (B7). `npm run board:favicon` es `vitest run favicon --update=all`,
como `db:dump-schema`. M1 (Filtro a 242°), M2 (la rama en rosado), M3 (el portal con su propia
posición), M4 (el ícono editado a mano) y M5 (el cuello sin recortar), en rojo y restaurados por
hash. `npm run check` en 0: 1175 pruebas (una saltada, la de Linux), cobertura 93,7 / 87,38 /
93,81 / 96,07. Siguen el equipo (G4) y los paneles (G5).
