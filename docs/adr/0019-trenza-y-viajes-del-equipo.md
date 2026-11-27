# ADR-0019 · La solicitud viaja como una trenza, y el equipo llega y se va caminando

- **Fecha:** 2026-11-27 · **Estado:** aceptada el 2026-11-27, a pedido del dueño. Claude eligió los
  detalles (CLAUDE.md §1b).
- **Tarea:** F6 de `DEVELOPMENT_PLAN.md`, antes de `docker compose up`.
- **Enmienda:** ADR-0018 (el pulso de un guion y el punto 3, «sigue sin caminar») y ADR-0016 (el
  punto 7 y «toda animación dentro del paso» valen para el circuito, ya no para el equipo).
- **Depende de:** ADR-0014 G4 (el equipo y su semilla), ADR-0016, ADR-0017 (el GIF), ADR-0018.

## Contexto

El dueño, el 2026-11-27: el viaje debe ser «una trenza tipo pulso que conecta», fluorescente entre
el amarillo y el rosado mientras viaja, con la mezcla de los dos en algunos momentos, y que al
conectar con la estación deje de verse de dos colores y quede de uno solo, según el estado. Y el
equipo: que camine a las estaciones desde las dos líneas de la izquierda (la de entrada y la de
salida), que a veces llegue por el inicio y otras por una puerta que se abre con el fondo negro,
con el mismo dibujo de las figuras, y que uno se vaya como en un tobogán por la última línea.

Preguntó si hacía falta Higgsfield. No: las figuras son trazos y puntos de B7 dibujados por el
código, y una imagen generada no seguiría su forma, su color ni la semilla de la corrida.

## Decisión

1. **La trenza** (`Orbit.tsx`, `braidPath` de `shape.ts`): dos hebras, amarilla y rosada, ondas
   alrededor del centro del tubo, de lados opuestos, que se cruzan cada media onda. Cada una mide uno
   y crece desde la estación que deja (180–480 ms), titilando en fase opuesta; donde se cruzan, la
   mezcla `screen` muestra los dos colores juntos (un durazno claro), y un `drop-shadow` las hace
   brillar. Al conectar (460–680 ms), las dos toman el color del estado (`--settle`) y se apagan, y
   la ruta punteada entra en ese único color: amarillo hacia una estación que trabaja, **rosado hacia
   Persona cuando espera a la persona** (`edge__route is-now is-person`). Como el pulso, existe solo
   mientras un evento guardado deja esa ruta punteada.
2. **El equipo llega** (`crew-moves.ts`, puro): toda figura que se monta llega por uno de tres
   caminos, por turnos dentro de cada equipo (la posición de su pose en B7 más un punto de partida de
   la semilla de la corrida): por la línea de entrada, por la línea de salida (sube por ella) o por
   una puerta en su sitio. Por una línea, camina desde fuera de la ventana, por los tubos (por debajo
   de las estaciones) hasta su sitio, a velocidad pareja, con un paso cada dos puntos. La puerta es de
   trazos y puntos como las figuras: un marco claro, un vano negro y una hoja que se abre y se cierra.
3. **Uno se va en tobogán:** cuando la corrida cierra por su ruta (todas completas o saltadas), la
   semilla elige una figura; se monta de nuevo (`@sale`), camina a Cierre, pasa bajo su burbuja y se
   desliza por la última línea fuera de la ventana, inclinada hacia atrás y cada vez más rápido.
4. **Solo CSS, una vez:** el camino son 17 puntos en propiedades propias (`--w0x` … `--w16y`, con el
   CSSOM, que la CSP permite); `motion.css` los recorre una vez desde el montaje. Sin estado ni
   temporizadores nuevos (B1, B2). Los viajes del equipo pueden durar más que el paso (hasta
   `WALK_MAX_MS`, 4,8 s), porque son decoración: el circuito sigue dibujado solo con eventos guardados
   y sus animaciones siguen dentro de los 700 ms. Con movimiento reducido, cortes limpios, y la trenza
   y la puerta no se dibujan.
5. **El GIF guarda solo lo que cambia:** con el equipo caminando pasó a 5,38 MB, sobre el tope de
   5 MB. Cada cuadro después del primero marca como transparente lo que no cambió y deja el anterior
   debajo: 0,92 MB con 357 cuadros pintados. La imagen no cambia.

## Cómo se comprueba

- `choreography.test.ts`: en cada cuadro de los cuatro casos dorados, una trenza de dos hebras
  distintas, medidas en uno, en cada ruta punteada y en ninguna otra; la rosada justo donde la ruta es
  rosada; la forma de la onda; los tiempos (las dos hebras juntas, la llegada y la ruta con la trenza).
- `crew-moves.test.ts`: en tres tamaños, cada corrida y cada prefijo, una caminata empieza fuera de
  la ventana, termina en su sitio y dura entre los topes; la puerta no camina; los tres caminos
  ocurren y un equipo los mezcla; solo una corrida cerrada manda a uno al tobogán, que acaba fuera de
  la ventana; la misma corrida, el mismo viaje.
- `motion.test.ts`: los viajes del equipo son solo esas seis reglas, una vez cada una y dentro de su
  tope; todo lo demás sigue de 160 a 320 ms y dentro del paso. `source-rules.test.ts`: el corte de
  movimiento reducido esconde la trenza y la puerta. `readme-gif.test.ts`: `onlyChanges`.
- Mutantes V1–V12 (sin trenza, sin rosado, hebras del mismo lado, ruta antes de tiempo, caminata que
  no acaba en su sitio, tobogán sin cierre, todos por la puerta, el que sale sin montarse de nuevo,
  caminata infinita, trenza visible sin movimiento, cuadros enteros, caminata que empieza dentro de
  la ventana): todos en rojo, restaurados por hash. V3 sobrevivió al principio y pidió su prueba.
- Visto en tiempo real en los cuadros de `npm run board:gif`: la trenza a medio tubo, la ruta ya de
  un color, figuras subiendo por la línea de salida y entrando por la de entrada, puertas, y el
  tobogán al final.

## Límites conocidos

- Una figura que cambia de sitio a mitad de corrida llega de nuevo (por su camino), en vez de caminar
  del sitio viejo al nuevo: eso pediría recordar dónde estaba, estado fuera de `use-run-events.ts`.
- De paso, una figura puede cruzar un instante el rótulo de la rama o una telemetría; en reposo no
  tapa nada (§11, `crew.test.ts`).
- Las figuras no se voltean al caminar hacia la izquierda: voltearlas invertiría sus objetos.
- La paleta del GIF sale del último cuadro; el durazno de la trenza queda con el color más cercano.
