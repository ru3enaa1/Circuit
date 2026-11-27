# ADR-0013 · Lo que se mira vive en la dirección de la página, y entrar a una estación nunca cambia la corrida

- **Fecha:** 2026-11-26 · **Estado:** aceptada el 2026-11-26. Claude eligió las recomendaciones
  (CLAUDE.md §1b): no tocan la arquitectura ni el contrato de datos.
- **Tarea:** F2.3b de `DEVELOPMENT_PLAN.md` y de `docs/diseno.md` §17: entrar a una estación, el
  portal para volver y el segundo nivel de CRM (`docs/diseno.md` §10 y §14).
- **Depende de:** ADR-0011 (B1: `useState` y `useReducer` solo en `use-run-events.ts`; B2: los
  temporizadores, también; B3: el `data-status` de cada nodo es el de `projectRun`).
- **Enmienda:** ADR-0011, en el «Fuera de alcance» de su cerco («entrar y el portal»), que pasa a
  esta ADR.

## Contexto

Entrar a una estación es estado de la página: qué sala se mira. B1 no deja guardarlo con
`useState` fuera de `use-run-events.ts`, y meterlo en el alimentador de eventos mezclaría lo que
pasó (los eventos) con lo que se mira. El brief pide además que Esc vuelva de a un nivel, que
Enter entre, y que entrar y volver nunca cambien el estado de la corrida.

## Decisión

**Lo que se mira es la dirección de la página, en su fragmento** (`#/estacion/crm`,
`#/estacion/crm/accion/3`, y `#/desde/crm` al volver al circuito desde CRM). Lo lee
`use-route.ts` con `useSyncExternalStore` sobre `hashchange`, como `use-viewport.ts` lee el
tamaño. Así no hay estado de React nuevo, el botón «atrás» del navegador vuelve, y una sala se
puede abrir con un enlace (las capturas de B10 la usan).

Las otras opciones: el estado en `use-run-events.ts` (mezcla lo que se mira con lo que pasó, y
habría que ampliar B1 a otro propósito) o un `useState` en `Board.tsx` con una excepción en B1
(rompe la regla que hoy se prueba con un grep). Se descartan las dos.

- Cada estación del circuito y cada píldora del muelle es un enlace (`<a href="#/estacion/…">`):
  Tab lo alcanza, Enter lo sigue y el lector de pantalla dice su nombre y su estado. El brief
  decía `button`; un enlace es lo que hace (cambia lo que se mira) y funciona sin código.
- La sala sale de la misma proyección: la estación de la sala lleva `data-station` y
  `data-status` de `projectRun`, y sus nodos salen de `secondaryNodes`, con el texto entero.
- El movimiento son animaciones de CSS que corren al montar la vista (300 ms de acercamiento,
  200 ms de llegada; al volver, la inversa, desde la estación que nombra `#/desde/<id>`). Ningún
  temporizador. Con «reducir movimiento», cortes.
- La sala de Persona muestra la propuesta y sus tres salidas, sin botones: decidir es de F2.4
  (ADR-0012). El rótulo «entrar para decidir» llega con ella.

## Cláusulas

| Id | Regla que el código cumple | Chequeo que lo prueba |
|---|---|---|
| E1 | El fragmento se lee con una función pura (`apps/board/src/route.ts`): una estación que la tabla no tiene, una acción que el evento de CRM no trae o cualquier otro texto dan la vista válida más cercana (la sala de la estación, o el circuito). Nunca se muestra el fragmento crudo | `route.test.ts`: ida y vuelta de cada ruta; basura, `..`, mayúsculas, ceros a la izquierda y números enormes caen al circuito o a la sala |
| E2 | La ruta solo cambia lo que se mira: para cada prefijo de cada caso dorado y cada sala, el `data-status` de la estación de la sala es el de `projectRun`, y al volver (`#/desde/<id>`) los siete del circuito también | `room-render.test.ts`. M1 (la sala pinta `completed` siempre) la pone en rojo |
| E3 | La sala muestra el texto entero de sus nodos (la cita sin recortar) y sus salidas de la tabla, con la tomada marcada `data-taken="true"` solo si `projectRun` la tomó | `room-render.test.ts` |
| E4 | Esc, el portal y la miga de pan llevan un nivel arriba: de una acción a CRM, de una sala al circuito (`#/desde/<id>`), y en el circuito Esc no hace nada | `route.test.ts` (`parentOf`); los `href` del portal y de la miga, en `room-render.test.ts`. M2 (Esc de una acción va al circuito) la pone en rojo |
| E5 | B1 y B2 siguen como están: `useState`, `useReducer` y los temporizadores, solo en `use-run-events.ts` | `source-rules.test.ts`, sin cambiar sus listas. M3 (un `useState` para la sala en `Board.tsx`) la pone en rojo |
| E6 | Con `prefers-reduced-motion`, ninguna animación ni transición | `source-rules.test.ts`: la regla de «reducir movimiento» de `styles.css` apaga `animation` y `transition` |
| E7 | Sin dependencias nuevas ni cambios fuera de `apps/board`, el guion de capturas y los documentos | `git diff --stat 7d611b1` |

## Consecuencias

- Una sala se abre con su dirección, así que `npm run board:shots` también la retrata.
- El fragmento es entrada del usuario: se lee con expresiones cerradas y contra la tabla, y React
  escapa lo demás.
- Volver con «atrás» del navegador funciona igual que Esc, porque es el mismo cambio de dirección.

## Notas de implementación (F2.3b, 2026-11-26)

Implementada sobre `7d611b1`. Lo que se hizo distinto o se agregó, y por qué; Claude eligió cada
punto (CLAUDE.md §1b):

- **Archivos:** `route.ts` (leer, escribir, subir un nivel y resolver contra la vista), `room.ts`
  (las salidas y los datos de una acción, puros), `use-route.ts` (el fragmento con
  `useSyncExternalStore` y Esc con un oyente de teclado, sin estado), `components/Room.tsx`,
  `components/Portal.tsx` y `components/StationBall.tsx` (la bola, sacada de `StationNode.tsx`
  para dibujarla igual en la órbita y en la sala), y `room.css`.
- **El foco:** al entrar, el portal toma el foco, así que Enter vuelve igual que Esc; al volver,
  la estación que se dejó lo recupera. Lo hace una función de ref del módulo (`focusOnMount`),
  que React llama solo al montar: no es estado ni temporizador.
- **Cada sala se monta de nuevo** (la `key` es su dirección), así que pasar de una sala a otra
  por una salida repite la entrada.
- **La acción:** la sala muestra solo el título, la fecha, la etapa y el texto de la nota; nunca
  el nombre ni el correo de `create_contact` (brief §15). Su estado sale del resultado de Cierre
  para esa acción, si es del mismo tipo, y si no, de la decisión de Persona; sin decisión,
  «espera aprobación».
- **Persona** muestra la propuesta (las acciones de CRM) y sus tres salidas bajo «Decisión», sin
  botones: decidir es de F2.4.
- **Sin hacer:** la bolita del muelle no se estira al saltar (pediría medir las píldoras en el
  navegador); el contorno que crece hasta el borde se resolvió como un acercamiento de la sala
  entera desde el lugar de la estación.
- **Pruebas:** `route.test.ts` (E1, E4) y `room-render.test.ts` (E2–E4), con
  `renderToStaticMarkup` para cada prefijo de cada caso dorado y cada sala; E6 en
  `source-rules.test.ts`. M1–M3 en rojo, restaurados por hash. `npm run check` en 0: 1161
  pruebas (una saltada, la de Linux), cobertura 93,58 / 87,19 / 93,71 / 96,02. Baja un poco
  porque `use-route.ts` solo corre en el navegador, como `use-viewport.ts`.
- **B10:** `npm run board:shots` toma además cuatro salas (Clasificación, Conocimiento, la tarea
  de CRM y Persona en espera) a las cuatro medidas. Revisión del dueño pendiente.
