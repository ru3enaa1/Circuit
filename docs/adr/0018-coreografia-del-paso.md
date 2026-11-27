# ADR-0018 · Cada paso del tablero es un movimiento de la solicitud: salir, viajar, llegar

- **Fecha:** 2026-11-27 · **Estado:** aceptada el 2026-11-27. Claude eligió (CLAUDE.md §1b): no
  cambia la arquitectura, ni el rumbo del producto, ni nada fuera del repositorio.
- **Tarea:** F6 de `DEVELOPMENT_PLAN.md`, a pedido del dueño, antes del README.
- **Enmienda:** ADR-0016 (los tiempos de `motion.css` y el punto 7, «el equipo nunca camina»).
- **Enmendada por:** ADR-0019, aceptada el 2026-11-27: el pulso pasa a ser una trenza de dos hebras
  que al conectar queda del color del estado, y el equipo llega caminando o por una puerta y uno se va
  en tobogán (el punto 3 ya no vale).
- **Depende de:** ADR-0011 (B1, B2), ADR-0014 G4 (el equipo), ADR-0016, ADR-0017 (el GIF).

## Contexto

Con ADR-0016, todo lo que un evento monta entraba con el mismo fundido de 240 ms, a la vez. El dueño
lo vio en la app real el 2026-11-27: «se ve como una diapositiva sin animación de transición». Nada
viajaba de una estación a la otra, y la grabación en tiempo real lo confirmaba: 28 cuadros distintos
en 9 s. Además, cuando la escena se reacomodaba, una figura del equipo con la misma pose saltaba de
un tubo a otro (la lupa, de 436,375 a 909,376 cuando Persona espera), porque su clave era solo la pose.

## Decisión

1. **Un paso, tres tiempos, dentro de los 700 ms del revelado** (`motion.css`):
   - **salir** (0–300 ms): la estación que se completa monta su relleno de nuevo (con clave por
     estado en `StationBall.tsx`) y florece desde su centro; sus nodos salen por los brazos; la ruta
     de atrás se dibuja sólida desde la estación anterior;
   - **viajar** (180–480 ms): un **pulso** amarillo cruza el tubo hacia la estación que espera
     (`edge__pulse` en `Orbit.tsx`, solo en la ruta que el evento dejó punteada), y entra lo que la
     estación completada midió;
   - **llegar** (460–680 ms): la estación que espera pasa de contorno a relleno con una pequeña
     crecida, su texto se oscurece solo ya encendida, y el anillo amarillo se posa. Persona, que
     espera a la persona, se vuelve rosada y recibe su anillo en ese mismo tiempo.
2. **El pulso es un guion corto** (una vigésima del tubo, con puntas redondas) sobre un trazo medido
   en uno, que `stroke-dashoffset` lleva de un extremo al otro una sola vez, con velocidad casi pareja:
   con una curva fuerte cruzaba la parte visible del tubo en dos cuadros. Al final se desvanece bajo
   la estación. No es un elemento suelto: existe solo mientras un evento guardado deja esa ruta
   punteada.
3. **El equipo entra por turnos con un saltito** (`crew__body`, 120, 200, 280 y 360 ms), donde está
   parado. La figura se identifica por pose y lugar (`figureKey`): una que cambia de tubo entra de
   nuevo donde aterriza, y ninguna se teletransporta. Sigue sin caminar: un desplazamiento entre dos
   tubos cruzaría estaciones (§11, nunca tapan).
4. **Sigue todo como ADR-0016:** solo CSS, sin estado ni temporizadores nuevos; ninguna animación se
   repite; cada duración de 160 a 320 ms y, con su retraso, dentro del paso; con
   `prefers-reduced-motion`, cortes limpios.

## Cómo se comprueba

`apps/board/test/choreography.test.ts`: en cada cuadro de los cuatro casos dorados, un pulso
medido en uno por cada ruta punteada y ninguno en otra; los tres tiempos leídos de `motion.css`
(el pulso sale mientras florece la estación, la llegada empieza cuando el pulso entra, el anillo y
el anillo de espera con ella, el texto y el rosado de Persona no antes); los turnos del equipo,
crecientes y dentro del paso; el relleno con clave por estado y la clave de cada figura por su
lugar, leídos del árbol de React sin pintar. `motion.test.ts` sigue vigilando que nada entre de golpe.

Los mutantes U1–U8 (sin pulso, pulso en toda ruta, llegada antes del pulso, texto oscuro de una vez,
relleno sin clave, figura por pose, dos turnos iguales, sin cuerpo) quedan en rojo.

Visto en tiempo real con `npm run board:gif`: de 28 cuadros distintos se pasa a 183 pintados en la
misma corrida, con el pulso a mitad del tubo y la estación que espera encendiéndose al llegar. El GIF
pasa de 1,6 a 4,2 MB, dentro del tope de 5 MB de ADR-0017.

## Límites conocidos

- Los brazos de Persona aparecen de golpe en su contorno cuando espera (su forma cambia de comandos,
  como dice ADR-0016); el resto de la estación llega con el pulso.
- Una figura que sale de la escena se va de golpe: animar una salida pide recordar lo que se fue, y
  eso es estado fuera de `use-run-events.ts` (B2).
- La línea de entrada no lleva pulso: su trazo nace lejos de la pantalla y el pulso pasaría casi todo
  su viaje fuera de ella.
