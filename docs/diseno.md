# Circuit · brief de diseño y UX (F2.0)

- **Fecha:** 2026-11-26 · **Estado:** propuesta. Al aprobarlo el dueño, ADR-0011 queda aceptada
  (su pregunta 4) y empieza F2.3.
- **Sale de:** los bocetos B0 a B8 del dueño (locales, fuera de git) y del contrato de datos de
  ADR-0010 (los eventos), ADR-0011 (el tablero) y ADR-0012 (la aprobación). Donde el boceto y el
  contrato no coinciden, manda el contrato, y la diferencia queda en §15.
- **Para quién:** quien construye el tablero, y el dueño, que lo aprueba.

## 1. Qué es esta página

Una sola página, sin desplazamiento: el circuito de siete estaciones ocupa la ventana, y en él se
ve por dónde va una solicitud, qué decidió cada estación y qué espera a la persona. La usa el
mentor, que aprueba lo que el modelo propone. La mira, en la demostración, alguien que no es
técnico. Por eso la prueba es de 10 segundos: quien la ve sin explicación sabe **en qué estación
va la solicitud, qué ruta tomó y si alguien tiene que hacer algo**.

## 2. Cinco principios

1. **El circuito es la pieza principal.** Ni los instrumentos ni los personajes compiten con él
   en tamaño ni en color.
2. **Todo lo que se enciende sale de un evento guardado** (CLAUDE.md §1, ADR-0011 B1–B3). Una
   estación cambia de estado porque llegó su evento, nunca porque pasó un tiempo.
3. **Cada instrumento muestra un dato real**: duración, tokens, costo, confianza, la cita, las
   acciones propuestas. Si el dato no existe, el instrumento no se dibuja.
4. **Serio donde importa, juego en el borde.** El humor vive solo en los textos de interfaz y en
   los personajes; nunca en lo que llega al participante o al CRM (§13).
5. **Se recompone, no se escala.** La página llena cualquier ventana sin franjas ni vacíos; las
   bolas no se deforman: se alargan o acortan los cuellos y las líneas (§9).

## 3. Ley de pantalla

Ocupa el 100 % del ancho y del alto de la ventana, de 1280×720 a 2560×1440 y en ultraanchas
21:9. Sin lienzo fijo centrado, sin franjas, sin marco. Ninguna bola ni texto toca el borde; solo
las líneas finas de entrada y salida del circuito siguen más allá, como si continuara. Dividida la
pantalla en 4×3, ninguna parte queda vacía. El texto que se lee tiene ancho máximo (60 caracteres);
lo que llena la pantalla es el circuito. El tamaño de trabajo es 1536×864 (un portátil de
1920×1080 con la escala de Windows al 125 %).

## 4. Paleta y tipografía

| Color | Papel | Contraste sobre `#0A0A0B` |
|---|---|---|
| `#0A0A0B` | Fondo | — |
| `#F3F1EC` | Circuito y texto principal | 17,5 : 1 |
| `#BDBAB2` | Texto secundario | 10,2 : 1 |
| `#9A978F` | Etiquetas y lo apagado | 6,8 : 1 |
| `#7D7B75` | Estaciones saltadas o fuera de la ruta | 4,7 : 1 (solo trazos y etiquetas de 10 px en mayúscula de ancho fijo) |
| `#FFD23F` | El recorrido, la rama tomada, lo activo | 13,7 : 1 |
| `#FF5FA2` | Lo que espera a la persona, el alto y la falla | 7,0 : 1 |
| `#161618` | El muelle (la barra de estaciones) | — |

- Plano: sin sombras ni degradados, salvo el halo amarillo de lo activo
  (`drop-shadow(0 0 6px rgba(255,210,63,.7))`).
- **IBM Plex Sans** (400, 500, 600) para leer: 44 / 22 / 15 / 13 px. **JetBrains Mono** (400,
  500) para telemetría y números: 26 / 13 / 10,5 px. Las dos tienen licencia OFL y se sirven en
  local, desde los paquetes `@fontsource/ibm-plex-sans` y `@fontsource/jetbrains-mono`, que
  entran con su versión del día (enmienda de ADR-0011 B12, §15). Nunca desde otro origen
  (ADR-0011 B7).
- Los números van en formato de Colombia: coma decimal y espacio de miles («1 260 tok»,
  «US$0,004», «0,82»).

## 5. Una estación, siete apariencias

Cada estación es una bola de radio `R` con un anillo de marcas por fuera. El estado sale de
`projectRun` (ADR-0011); la apariencia, de esta tabla. El color nunca va solo: cada estado tiene
además su forma y su texto.

| Estado de `projectRun` | Cuándo | Dibujo | Texto junto a la bola |
|---|---|---|---|
| `pending` | Todavía no le toca | Solo contorno blanco hueso, centro negro | — |
| `waiting`, estación de código o del modelo | Es la siguiente y la corrida sigue | Llena, con halo y anillo amarillo; su cuello de llegada, amarillo discontinuo | «en curso» |
| `waiting`, la estación Persona | La propuesta espera al mentor | Anillo rosado grueso, centro hueco, punto rosado | «espera a la persona» |
| `completed` | Su evento llegó | Llena, con punto negro al centro; su cuello de llegada, amarillo continuo | duración · tokens · costo |
| `skipped` | La rama la dejó atrás | Contorno gris punteado, nombre tachado, una diagonal | «saltada» |
| `stopped` | El filtro detuvo la corrida | Contorno rosado discontinuo, ícono de alto (cuadrado) | «detenida · inyección» |
| `failed` | La estación terminó con error | Contorno rosado continuo, ícono de una X | «falló» y el motivo corto del evento |

Lo que dice el `outcome` del evento se agrega como una etiqueta pequeña debajo del nombre:
«sin fuente» en Conocimiento (`no_source`), «queja», «fuera de alcance» o «confianza baja» en
Clasificación, y «aprobado», «corregido» o «rechazado» en Persona.

## 6. Composición: la órbita

La composición elegida es la órbita del boceto (la variante «libre» de B1, la misma de B3 a B5):

- **Persona va al centro**, más grande (1,3 R): es la estación que decide, y la figura lo cuenta
  sin explicarlo.
- **Las otras seis giran alrededor** en una elipse, en el orden del recorrido y en sentido
  horario: Entrada a 195°, Filtro a 242°, Clasificación a 305°, Conocimiento a 10°, CRM a 65° y
  Cierre a 130° (0° a la derecha, ángulos hacia abajo).
- **Los cuellos** unen las estaciones en orden: 1→2→3→4→5, de 5 a Persona y de Persona a 7. La
  **rama** de Clasificación a Persona es una curva propia, rotulada «queja, fuera de alcance o
  duda». El **alto por inyección** es un tramo corto que sale de Filtro hacia afuera y termina en
  una bola pequeña con el ícono de alto.
- **Líneas de borde:** de Entrada sale una línea fina hasta el borde de la pantalla (por ahí
  llegan las solicitudes), y de Cierre otra (por ahí salen). Son las únicas que tocan el borde.
- **Arriba a la izquierda, la solicitud:** «Circuit · Escuela Andamio · Simulador», y debajo, en
  grande, «Solicitud N.º 12» con su estado («en curso · Conocimiento»). Un clic abre la lista de
  las últimas corridas (§8).
- **Arriba a la derecha, el reloj de la corrida** (§7), los totales de tokens y costo, y cuántas
  corridas están en curso.
- **Abajo al centro, el muelle:** una píldora por estación con su ícono y su nombre, y una bolita
  amarilla sobre la seleccionada, que se estira al saltar. Al lado, «Probar una solicitud» (§8).

## 7. Nodos e instrumentos: solo con dato real

Alrededor de cada estación, unidos por cuellos finos, van sus nodos secundarios. Toman el estado
de su estación (sin eventos nuevos) y su texto sale del `detail` del evento. Si el evento no
trae el dato, el nodo no se dibuja. Los títulos de los documentos los trae `GET /api/circuit`
del paquete del escenario, junto a la tabla y el umbral.

| Estación | Nodos | De dónde sale cada texto |
|---|---|---|
| Entrada | texto recibido | `detail.length`: «347 caracteres» |
| Filtro | delimitar · inyección · datos personales | «delimitado»; «sin inyección» o el id del patrón; «1 correo aparte · 1 teléfono · 1 documento tachados» (de `hasEmail`, `phones`, `documents`), **nunca lo tachado** |
| Clasificación | intención · programa · urgencia · confianza | `intent`, `topic` (el título del documento), `urgency` y el arco de confianza |
| Conocimiento | documento · cita | `documentId` (el título del documento) y la cita entre comillas, recortada a 90 caracteres en el circuito y entera al entrar |
| CRM | una por acción propuesta | `detail.actions`: «nota», «etapa: programa propuesto», «tarea: Agendar la conversación… · 1 dic» |
| Persona | aprobar · corregir · rechazar | El que se eligió se llena; los otros quedan en contorno |
| Cierre | una por resultado | `detail.results`: «aplicada» o el motivo, y «bitácora» |

**Instrumentos:**

- **Telemetría** junto a cada estación hecha, unida por una línea guía: «1,2 s · 840 tok ·
  US$0,004». Con el simulador, tokens y costo son `null`: dice «1,2 s · simulador», sin inventar
  cifras.
- **Arco de confianza** alrededor de Clasificación: el valor sobre 1 y una marca en el umbral.
  El umbral no se escribe en el tablero: lo trae `GET /api/circuit` desde
  `LOW_CONFIDENCE_BELOW` (hoy 0,70).
- **Regla de tiempo en la órbita:** el anillo exterior de cada estación hecha lleva un arco
  amarillo proporcional a su parte de la duración total.
- **El reloj de la corrida** muestra tiempo guardado: desde el `startedAt` del primer evento
  hasta el final del último. No avanza solo. Mientras espera a la persona dice «espera desde
  09:00:00», la hora del último evento.

## 8. Cómo llegan las corridas

- **Qué corrida se ve:** la última, salvo que se elija otra en la lista de arriba a la izquierda
  (las 10 últimas, con su ruta y su estado, de `GET /api/runs`).
- **Paso a paso:** el simulador recorre las estaciones 1 a 5 en milisegundos, y así el circuito
  saltaría al final. Por eso el tablero **revela los eventos guardados de a uno**, cada 700 ms
  (`REVEAL_STEP_MS`). Cada cuadro es la proyección de un prefijo de los eventos guardados, que es
  justo lo que B1 y B3 prueban; la cadencia vive en `use-run-events.ts`, el único lugar donde B2
  deja un temporizador. Una corrida vieja abierta desde la lista se muestra entera, sin
  revelar. Con «reducir movimiento», todo de una vez.
- **Consulta:** cada 1000 ms con `?after=<seq>` (ADR-0011). Lo nuevo entra a la cola de
  revelado.
- **«Probar una solicitud»:** abre la lista de solicitudes de ejemplo del escenario (las de los
  casos del simulador) y al elegir una arranca una corrida. Es una ruta `POST`, así que llega
  con F2.4, junto a la ruta que decide (ADR-0012), y no en F2.3, que solo lee (ADR-0011 B13).
  Mientras no exista, el botón no se dibuja.

## 9. Tamaños

Ningún tamaño escala la página: se recalculan `R`, la elipse y lo que cabe.
`R = clamp(50 × min(ancho/1536, alto/864), 33, 80)`.

| Ventana | Qué cambia |
|---|---|
| 1536×864 (trabajo) | La composición de §6, tal cual |
| 1280×720 | `R` baja a unos 42; la telemetría muestra solo la duración; los nodos guardan su texto corto |
| 768×864 y 720×900 (media pantalla) | El muelle queda solo con íconos; la elipse se vuelve alta; la solicitud y el reloj se apilan arriba en una franja de dos líneas |
| 2560×1080 y otras de más de 2,05 : 1 | La elipse no pasa de 2,2 veces su alto en ancho. **El hueco del centro se llena con dos paneles de datos** a los lados de Persona: a la izquierda, la cita de Conocimiento y las acciones propuestas; a la derecha, el reloj grande, el arco de confianza y los totales. En las ventanas normales esos datos viven en los nodos y en las esquinas |
| 2560×1440 | `R` llega a 80 y el resto crece con él |

Revisión: `npm run board:shots` toma 1536×864, 768×864, 720×900 y 2560×1080 en una carpeta que
git ignora, y el dueño las mira (ADR-0011 B10). Pasa si no hay franjas, ni nada cortado, ni una
parte vacía de las 12.

## 10. Entrar a una estación y volver

- **Entrar:** clic en una estación o en su píldora del muelle. La cámara se acerca a la bola y la
  atraviesa (300 ms de entrada, 200 ms de llegada): su contorno crece hasta el borde y quedamos
  dentro. La estación va al centro en grande, con su nombre, su telemetría y sus nodos alrededor,
  cada uno con su texto completo. Adelante van solo sus salidas, con la tomada en amarillo: desde
  Clasificación, Conocimiento («ruta normal») y Persona («queja, fuera de alcance o duda»).
- **Volver:** a la izquierda, un portal: un anillo de marcas con el circuito en miniatura y la
  estación actual en amarillo. Clic en el portal, la miga de pan («Circuito › Clasificación») o
  Esc. La transición es la inversa.
- **Segundo nivel:** desde CRM se entra a una acción propuesta (la tarea, con su título, su fecha
  y «espera aprobación»); su portal lleva la miniatura de CRM, y se vuelve de a un nivel.
- **Persona es la aprobación** (ADR-0012). Cuando espera, entrar a Persona muestra la propuesta:
  las acciones al centro y tres salidas, que son los botones: **Aprobar** (primario, blanco
  hueso), **Corregir** (contorno) y **Rechazar** (rosado discontinuo, con el ícono de alto).
  Fuera de la sala, Persona en espera lleva su rótulo «espera a la persona · entrar para
  decidir». La aprobación vive dentro del circuito, nunca en un diálogo encima.
- Entrar y volver solo cambian lo que se mira, nunca el estado de la corrida.

## 11. El equipo (los personajes)

- Una figura de palitos hecha con el lenguaje del circuito: cabeza de bola, articulaciones de
  punto, miembros de línea. Blanco hueso, con un accesorio en amarillo o rosado, y una sombra corta
  y plana. Las doce poses de B7: seis de juego (barre una conexión, se asoma detrás de una
  estación, empuja una bola, toma café sentada en un cuello, mide una conexión, saluda con
  sombrero) y seis serias (escudo frente a Filtro, lupa en Conocimiento, mano de «espera» frente a
  Persona, casco y llave en CRM, portapapeles, firme con casco).
- Entre 2 y 4 a la vez, más pequeñas que una estación, paradas sobre cuellos. **Nunca tapan** una
  estación, un texto, un botón ni la propuesta.
- **Son decoración:** nunca muestran un estado. Su elección y su lugar salen de una semilla
  atada al id de la corrida, así que la misma corrida las pone siempre igual («Reproducible»).
- En un alto, en una falla y mientras espera la persona, solo poses serias. Con «reducir
  movimiento», quietas.
- Un accesorio rosado nunca va junto a una estación rosada: para no confundirlo con un estado,
  ahí se usa uno amarillo.

## 12. El logo (4a)

La órbita en pequeño, la misma de §6. En una caja de 100 × 100: Persona al centro, de radio 11,5,
hueca (agujero de radio 6); las otras seis, de radio 7,6, en un círculo de radio 39, a los ángulos de §6
(salvo Filtro, a 250°, para que la marca respire a 16 px). Cuellos finos (2,4) de 1→2→3→4→5 y de Persona a Cierre, en el color de la marca;
el cuello de Clasificación a Persona, en amarillo (la rama), y el de CRM a Persona, en rosado (la
llegada a la persona). Blanco hueso sobre negro, y negro sobre blanco hueso. Se usa a 32 px junto
al nombre «Circuit» (IBM Plex Sans 600) y a 16 px como ícono de pestaña.

## 13. Textos y tono

- Todo texto de la interfaz vive en `apps/board/src/texts.ts`, con `tone` (`juego` o `serio`) y
  `audience` (`interfaz`, `participante` o `crm`); lo que no es `interfaz` es `serio` (ADR-0011
  B9).
- **Serio siempre:** los estados, los rótulos de rama, lo que dice un alto o una falla, la
  propuesta y los botones de decisión. Ejemplo: «Detenido en Filtro · instrucción dentro del
  texto · registrado».
- **Juego, solo en los bordes:** el reposo y las ayudas. Ejemplos: con el circuito vacío, «Nada
  por aquí. El equipo aprovecha para barrer»; en la ayuda, «clic en una estación para entrar».
- Las referencias de tono que inspiraron los bocetos no aparecen en ningún texto
  (`forbidden-phrases.txt`).

## 14. Accesibilidad y movimiento

- Cada estación es un `button` con su nombre y su estado en `aria-label` («Clasificación,
  hecha, confianza 0,82»). Se recorre con Tab en el orden del circuito; Enter entra, Esc vuelve.
  El foco se ve como un anillo amarillo de 1,5 px.
- El estado nunca depende solo del color (§5).
- El movimiento son transiciones de CSS entre dos vistas proyectadas (ADR-0011 B2), de 160 a
  320 ms. Con `prefers-reduced-motion`, cortes limpios, sin acercamiento ni revelado.
- Texto mínimo: 10,5 px en mono para la telemetría; 13 px para lo que se lee.

## 15. Lo que el boceto dice y lo que se construye

| El boceto dice | Se construye | Por qué difieren |
|---|---|---|
| Arriba, «Lucía Restrepo Arango · Confecciones Hilo Verde» y la frase de su solicitud | «Solicitud N.º 12», su estado, y lo que las estaciones guardaron (programa, cita, acciones) | El texto de la solicitud no se guarda; solo su huella SHA-256 (ADR-0010 D6, pregunta 7). Ver §16 |
| Rama «queja o fuera de alcance» | «queja, fuera de alcance o duda» | La rama también lleva la confianza baja (ADR-0010, tabla `CIRCUIT`) |
| Telemetría «840 tok · US$0,004» en cada estación | «1,2 s · simulador» mientras responde el simulador | El simulador no cuenta tokens ni costo; inventarlos rompería el principio 3 |
| Reloj que avanza («en espera 39,4 s») | «espera desde 09:00:00» | Un reloj que avanza es un temporizador fuera de `use-run-events.ts` (ADR-0011 B2) |
| Nodos extra en la ultraancha (precios, empresa, costo) | Dos paneles con la cita, las acciones y los instrumentos | Esos nodos no tienen dato detrás; los paneles sí, y llenan el hueco del centro que dejaba el boceto |
| Nodos «canal» y «remitente» en Entrada | Solo «texto recibido · N caracteres» | Entrada no guarda canal ni remitente |
| Seis estados | Siete apariencias: se agrega `failed` | `projectRun` tiene `failed`, y el boceto no lo dibujaba |
| «Nueva solicitud» siempre visible | «Probar una solicitud», desde F2.4 | Arrancar una corrida es escribir; F2.3 solo lee (ADR-0011 B13) |
| Fuentes desde un servicio externo | Fuentes de `@fontsource`, en local | ADR-0011 B7: nada desde otro origen. Enmienda de B12 para los dos paquetes |
| Logo provisional de dos bolas en la barra | El logo 4a (§12) | El dueño eligió 4a en B8 |
| Las estaciones cambian con un temporizador del boceto | Cambian solo con eventos, revelados de a uno | CLAUDE.md §1 y ADR-0011 B1–B3 |

## 16. Una decisión del dueño

**¿Se guarda y se muestra el texto de la solicitud, ya tachado?** Hoy no se guarda, y por eso el
tablero no puede mostrar «cada pedido grande pasa por mí…». Para quien ve la demostración, leer
lo que escribió la persona es lo que da sentido a todo lo demás.

- **(a) Recomendada:** el evento de Filtro guarda el texto ya tachado (sin correo, con
  `[teléfono]` y `[documento]`), y el tablero lo muestra arriba a la izquierda y dentro de Entrada.
  Cambia ADR-0010 D6 y su pregunta 7 con una enmienda, y los casos dorados se regeneran. Lo
  tachado sigue sin guardarse en ningún lado.
- **(b)** Se deja como está: la solicitud se cuenta solo con lo que guardaron las estaciones.

## 17. Orden de construcción

1. **F2.3a:** el servidor de lectura, `projectRun`, la órbita con sus siete apariencias, los
   nodos, la telemetría, el muelle y el revelado paso a paso. Es lo que prueba ADR-0011.
2. **F2.3b:** entrar a una estación, el portal y el segundo nivel de CRM.
3. **F2.3c:** el logo, el equipo y los paneles de la ultraancha.
4. **F2.4:** la sala de Persona como aprobación, y «Probar una solicitud» (ADR-0012).
