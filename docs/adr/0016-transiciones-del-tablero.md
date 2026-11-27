# ADR-0016 · El tablero pasa de un evento al siguiente con animaciones de CSS, sin estado ni temporizadores nuevos

- **Fecha:** 2026-11-27 · **Estado:** aceptada el 2026-11-27. Claude eligió (CLAUDE.md §1b): no
  cambia la arquitectura, ni el rumbo del producto, ni nada fuera del repositorio.
- **Tarea:** R11 de `DEVELOPMENT_PLAN.md`, primer paso de F6.
- **Depende de:** ADR-0011 (B1, B2: el estado y los temporizadores, solo en `use-run-events.ts`),
  ADR-0013 (E6: el corte de «reducir movimiento»), `docs/diseno.md` §8 y §14.
- **Enmendada por:** ADR-0018, aceptada el 2026-11-27. Los tiempos de `motion.css` pasan a tres
  tiempos por paso (salir, viajar, llegar), con un pulso por la ruta punteada; el equipo entra por
  turnos con un saltito, y una figura que cambia de lugar entra de nuevo donde aterriza (punto 7).
  Y por ADR-0019, el mismo día: el pulso es una trenza, y el equipo llega y se va caminando, con
  viajes que pueden durar más que el paso; el circuito sigue dentro de los 700 ms.

## Contexto

El dueño probó F2 en la app real el 2026-11-27: el recorrido «salta sin transicionar». El feed ya
revela un evento guardado cada 700 ms, pero cada evento cambia el dibujo de golpe: React cambia el
contorno de una estación por su relleno y monta la ruta amarilla, el anillo de la estación en curso,
la telemetría y las figuras del equipo, todo de una vez. Solo el tubo tenía una transición. El GIF y
el video de F6 dependen de que el recorrido se vea fluido.

## Decisión

1. **Solo CSS, en `apps/board/src/motion.css`** (importada por `main.tsx`). Ni estado ni
   temporizadores nuevos, y la proyección no cambia: el movimiento sale de los eventos guardados,
   porque solo se anima lo que un evento revelado monta o cambia (CLAUDE.md §1).
2. **Lo que un evento monta entra con una animación** que corre al montarse: el relleno y los
   puntos de una estación, el contorno y la marca de un alto, de una espera o de un salto, el anillo
   de la estación en curso (se posa desde un poco más afuera), la ruta, el arco de tiempo, la
   telemetría, los rótulos de los nodos, la confianza, cada figura del equipo y los textos del
   encabezado y del reloj. Ninguna se repite ni sigue sola.
3. **La ruta se dibuja desde la estación que deja** hacia la que alcanza: la ruta sólida lleva
   `pathLength="1"` y anima `stroke-dashoffset` de 1 a 0. La que va hacia una estación que espera
   conserva sus guiones y solo aparece con un fundido. Cuando esa estación se completa, la ruta
   cambia de clase y se dibuja.
4. **Lo que cambia de clase en el mismo elemento cambia con una transición** (trazo, relleno y
   color).
5. **Tiempos:** cada animación y transición dura de 160 a 320 ms (§14), y su duración más su
   retraso caben en `REVEAL_STEP_MS` (700 ms): todo termina antes del evento siguiente. La entrada,
   240 ms; lo que mide el evento entra 80 ms después del relleno; la ruta, 320 ms.
6. **Con `prefers-reduced-motion`**, el corte de `styles.css` (E6) quita todas: la vista es la
   misma, de una vez.
7. **El equipo nunca camina:** una figura solo aparece con un fundido donde está cuando la corrida
   cambia sus poses. La animación es solo de opacidad, porque una `transform` de CSS reemplazaría
   la de su atributo.

## Cómo se comprueba

`apps/board/test/motion.test.ts`, en rojo antes de `motion.css`:

- Para cada caso dorado y cada par de cuadros seguidos del revelado, todo elemento que aparece en el
  segundo cuadro entra con una regla de `motion.css`, puesta en él o en un ancestro que también es
  nuevo. La regla tiene que casar con todas las clases del elemento, modificadores incluidos. Tiene
  dos controles: sin animaciones, el caso normal monta elementos de golpe, y una regla de otro
  modificador o de un ancestro que ya estaba no cuenta.
- La ruta sólida lleva `pathLength="1"` y la que va hacia una estación que espera, no.
- Las duraciones de todas las hojas del tablero (de 160 a 320 ms, y con su retraso, dentro del paso)
  y que `main.tsx` importe cada hoja.
- E6 (`source-rules.test.ts`) admite `@keyframes` en `motion.css` y en `room.css`.

Los mutantes T1–T7 (sin la animación de la ruta, sin la del equipo, sin `pathLength`, una entrada
de 400 ms, un retraso que pasa el paso, sin importar la hoja y la animación puesta en el circuito
entero) quedan en rojo.

## Límites conocidos

- Los brazos de una estación aparecen de golpe cuando se completa: la forma cambia de comandos y CSS
  no interpola un `d` así. Sus puntos y sus rótulos sí entran con un fundido.
- El arco de tiempo de cada estación cambia de largo con cada evento (es su parte del total), sin
  transición, por la misma razón.
- `board:shots` corre con tiempo virtual, que no lleva las animaciones al paso de los temporizadores:
  sus capturas muestran el final, no el movimiento. El movimiento se revisó con cuadros en tiempo
  real tomados con el protocolo de DevTools sobre el mismo servidor en memoria (un script fuera del
  repositorio), y el GIF de F6 los necesitará igual.
