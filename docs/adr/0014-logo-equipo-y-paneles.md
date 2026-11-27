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
| G8 | (Enmienda del 2026-11-27, a pedido del dueño.) La órbita se dibuja como el boceto B1: cada estación es una forma (bola y nodos en brazos, unidos por cuellos tipo metaball) con ícono, nombre y número adentro; los nodos van en el hueco más ancho entre sus tubos; tubos rectos de dos rieles con la ruta amarilla adentro. Ningún texto de la órbita pisa una estación, un nodo, otro texto ni el muelle, en las medidas de §3 | `scene.test.ts`; B3 de `board-render.test.ts` |
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

**La fidelidad al boceto, el equipo y los paneles (2026-11-27, sobre `dc6b7e8`).** El dueño miró
las capturas y pidió que el circuito se viera igual a su boceto B1 («le cambia mucho los
circuitos, el color y los dots»). Eso es G8.

- **G8** (`cab6432`): `shape.ts` (la geometría pura de B1: círculos, el cuello metaball, los
  brazos en el hueco más ancho), `scene.ts` (dónde va cada cosa y los choques entre textos: la
  telemetría se mueve primero, luego el nombre que todavía toque algo) e `icons.ts` (los íconos
  de B1). La órbita, la sala y el muelle usan la misma forma y los mismos íconos. Lo que difiere
  del brief queda en `docs/diseno.md` §15: junto a cada nodo va su nombre corto (B1), y su valor
  queda en el tooltip y entero en la sala; la telemetría dice la duración y, con un modelo que
  cuenta, tokens y costo (con el simulador no repite «simulador»: lo dice la cabecera); la
  estación que sigue va llena con el anillo amarillo (B1), no pintada de amarillo; la línea de
  la marca lleva el logo a 20 px y el texto en mono, como la de B1; cuando Filtro detiene la
  corrida, la tarjeta de B1 reemplaza el rótulo del alto (sin el texto, que en una inyección no
  se guarda). Mutantes N1 (sin empuje), N2 (los brazos fuera del hueco) y N3 (los nombres sin
  empuje, que a 2560×1440 pisan el nodo vecino), en rojo. **N4 sobrevive**: que un nombre
  empujado no caiga sobre otro nombre no pasa en ninguna medida de §3; queda como guarda.
- **G4** (`df2b6ac`): `crew-poses.ts` (las doce poses de B7 como datos; la pose sentada pierde
  su tubo propio, porque se sienta en el real), `crew.ts` y `components/Crew.tsx`. La semilla es
  FNV-1a de `circuit-crew-<id>` y el generador, Mulberry32. Las figuras se paran en tubos de hasta
  40° de pendiente, entre 0,3 y 0,7 de su largo; las poses con estación propia («escudo frente a
  Filtro») prueban primero sus tubos. «Junto a una estación rosada» es estar en uno de sus tubos
  o a menos de 3 radios de ella. Mutantes C1–C4 en rojo; **C5 sobrevive** (sin el marco del
  muelle): ningún tubo llega a esa franja; queda como guarda explícita de §11.
- **G5** (`134863a`, `8d91c2f`): `side-panels.ts`, `side-panels.css` y
  `components/SidePanels.tsx`. El lugar se busca a cada lado de Persona, de cerca hacia afuera y
  a su altura primero, sin tocar obstáculos ni tubos. **Desviación de la decisión:** el reloj se
  queda en su esquina (si se iba al panel, la esquina quedaba vacía); el panel derecho muestra
  el mismo tiempo guardado, nunca otro. Un panel sin datos no se dibuja. Mutantes P1–P5 en rojo.

`npm run check` en 0: 1260 pruebas (una saltada, la de Linux), cobertura 94,53 / 86,97 / 94,9 /
96,53. F2.3 queda hecha; falta B10 (el dueño mira `npm run board:shots`).
