# ADR-0011 · El tablero dibuja el circuito solo con una proyección de los eventos guardados, que circuit sirve en 127.0.0.1

- **Fecha:** 2026-11-26 · **Estado:** propuesta. El 2026-11-26 el dueño eligió las
  recomendaciones de «Preguntas abiertas» («vamos con lo recomendado»); por la 4, se acepta
  cuando el dueño apruebe `docs/diseno.md`, que B10 cita.
- **Tarea:** F2.3 de `DEVELOPMENT_PLAN.md`: «tablero que dibuja el recorrido solo desde los
  eventos». Terminado (parte de F2): el mapa coincide con los eventos guardados.
- **Retroactiva:** no. No existen `apps/board`, ningún `.tsx`, ni un servidor HTTP en circuit
  (línea base: `docs/reviews/ADR-0011-baseline.md`).
- **Depende de:** ADR-0010 (la tabla `CIRCUIT` y el formato de los eventos) y de
  `docs/diseno.md`, que todavía no existe. Esta ADR fija el contrato de datos, la seguridad del
  servidor y las pruebas; el aspecto (composición, paleta, tipografía, el muelle de abajo, los
  personajes) lo fija `docs/diseno.md`, y no se repite aquí.
- **Cita sin reescribir:** CLAUDE.md §1 («el mapa se dibuja con eventos guardados, nunca con
  una animación suelta»); ADR-0002 D3 (solo `127.0.0.1`); ADR-0003 (el tablero en
  `apps/board`, servido por circuit); ADR-0004 H6 (la cobertura de los `.tsx`, que se aplica en
  F2). Las restricciones de producto de F2: el catálogo de textos con `tono` y la lista de
  herramientas del CRM como dato.

## Contexto

El tablero es lo que se ve en el GIF y lo primero que juzga quien evalúa. Por eso la tentación
es animarlo por su cuenta, y el innegociable dice lo contrario. Las fuerzas:

- **El mapa es una lectura, no una fuente.** Si una estación se enciende en pantalla, tiene que
  haber un evento guardado que lo diga. Con una animación suelta, el GIF puede mostrar una ruta
  que no ocurrió.
- **Un servidor en `127.0.0.1` no está a salvo del navegador.** Cualquier página abierta en el
  mismo equipo puede mandar peticiones a `http://127.0.0.1:<puerto>`, y un nombre de dominio
  propio puede apuntar a `127.0.0.1` (*DNS rebinding*) y leer las respuestas. ADR-0012 agrega
  aquí una ruta que decide qué se escribe en el CRM.
- **Lo tachado no se muestra** (seguridad de F2), y el boceto trae fuentes de
  `fonts.googleapis.com`, que en el producto se sirven en local (relevo del 2026-11-26).
- **El boceto elegido se ve bien a 1536×864 y a 720×900, y deja un vacío al centro a
  2560×1080** (relevo del 2026-11-26). La trampa escrita: «un mapa que se ve bien en el GIF pero
  no a la mitad del ancho».
- **Dependencias nuevas:** React y su servidor estático entran ahora; cada una se verifica el
  día que entra.

## Opciones consideradas

**Cómo se dibuja**

1. **SVG con React, desde una función pura** `projectRun(definición, eventos) → vista`. Se
   prueba sin navegador; los componentes solo pintan la vista.
2. **Canvas o WebGL.** Más libertad visual; no se puede leer el estado de un nodo en una prueba.
3. **Una librería de grafos.** Otra dependencia, y su propio estado interno.

**Cómo llegan los eventos**

1. **Consulta cada segundo** con `?after=<seq>`: el tablero pide solo los nuevos. Simple y
   probable; un segundo de retraso.
2. **Eventos del servidor (SSE).** Sin retraso; una conexión abierta por pestaña y más casos de
   reconexión.
3. **WebSocket.** Bidireccional, que no hace falta.

**Cómo se sirve el tablero**

1. **Circuit sirve los archivos de `apps/board/dist`** desde una lista fija que lee al arrancar;
   cualquier otra ruta da 404. Sin dependencia nueva y sin recorrer carpetas.
2. **`@fastify/static`.** Menos código; otra dependencia y su resolución de rutas.

## Decisión

Opciones 1, 1 y 1.

`apps/board` es una app de React compilada con Vite. Su estado del circuito sale de una sola
función pura, `projectRun`, que recibe la tabla `CIRCUIT` y los eventos de una corrida y
devuelve, por estación, uno de estos estados: `completed`, `stopped`, `failed`, `waiting`,
`skipped` o `pending`. Una estación con evento toma el estado de su evento. La siguiente del
último evento, si la corrida no terminó, queda `waiting`. Las que la rama dejó atrás quedan
`skipped`, y las demás, `pending`. La rama tomada se enciende desde el `outcome` del evento y
la tabla. Los nodos secundarios toman el estado de su estación.

Circuit abre un servidor Fastify solo en `127.0.0.1`, que sirve el tablero y una API de
lectura: la tabla del circuito, las corridas, los eventos de una corrida y la lista de
herramientas del CRM. Rechaza toda petición cuyo `Host` no sea el suyo y nunca responde
cabeceras CORS.

## Cláusulas

| Id | Regla que el código cumple | Chequeo que lo prueba | Crítica |
|---|---|---|---|
| B1 | El estado del circuito en pantalla sale solo de `projectRun` (`apps/board/src/projection.ts`), una función pura de la tabla y los eventos. Ningún componente guarda estado de una estación: `useState` y `useReducer` solo aparecen en `use-run-events.ts`, que guarda la lista de eventos | `projection.test.ts`: para cada caso dorado de ADR-0010 y para cada prefijo de su `events.json`, la vista es igual a la esperada, escrita en la prueba. `git grep -nE "useState\|useReducer" -- ':(glob)apps/board/src/**'` solo da líneas de `use-run-events.ts` | sí |
| B2 | Ninguna animación crea estado: `setTimeout`, `setInterval` y `requestAnimationFrame` solo aparecen en `use-run-events.ts`, para la consulta. El movimiento son transiciones de CSS entre dos vistas proyectadas | `git grep -nE "setTimeout\|setInterval\|requestAnimationFrame" -- ':(glob)apps/board/src/**'` solo da líneas de `use-run-events.ts` | sí |
| B3 | El mapa coincide con los eventos: cada nodo de estación lleva `data-station` y `data-status`, y su `data-status` es el de la proyección | `board-render.test.ts`: con `renderToStaticMarkup` de `react-dom/server`, para cada prefijo de cada caso dorado, el `data-status` de los siete nodos es el de `projectRun`. M1 (un nodo con estado fijo) y M2 (`skipped` pintado como `completed`) lo ponen en rojo | sí |
| B4 | De punta a punta: el caso dorado `normal` corrido por circuit contra una base desechable, leído por `GET /api/runs/:id/events` y proyectado, da la vista final esperada | `board-db.test.ts` | sí |
| B5 | La API de lectura es `GET /api/circuit`, `GET /api/runs`, `GET /api/runs/:id/events?after=<seq>` y `GET /api/tools`. Cada respuesta trae solo los campos de una lista fija; los parámetros pasan por zod en modo estricto, con 400 que nombra el campo y nunca el valor. Ninguna respuesta trae lo que la estación 2 tachó | `server-read-db.test.ts`: las claves de cada respuesta son las de la lista; `after=-1`, `after=abc` y un id de 2^53 dan 400; por cada caso dorado, el cuerpo de los eventos no contiene ninguna cadena de `personal` de su `input.json` | sí |
| B6 | El servidor escucha solo en `127.0.0.1`, en `CIRCUIT_PORT` (por defecto 4020; **ASUNCIÓN**, pregunta 1), y el anfitrión no se configura. Una petición cuyo `Host` no es `127.0.0.1:<puerto>` ni `localhost:<puerto>` da 403 sin cuerpo útil. Nunca responde `Access-Control-Allow-Origin` | `server-security.test.ts`: `Host: ejemplo.test` y `Host: 127.0.0.1:1` dan 403 en cada ruta; un `OPTIONS` con `Origin` ajeno no trae cabeceras CORS; `config.test.ts`: no existe `CIRCUIT_HOST`. M3 (sin la revisión del `Host`) lo pone en rojo | sí |
| B7 | El tablero se sirve desde una lista fija de archivos de `apps/board/dist`, leída al arrancar; cualquier otra ruta da 404. Cada respuesta lleva `Content-Security-Policy: default-src 'self'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff` y `Referrer-Policy: no-referrer`. Las fuentes y los recursos se sirven en local | `server-security.test.ts`: `/../package.json`, `/%2e%2e/package.json` y `/assets/../../.env` dan 404; las tres cabeceras en el HTML y en un recurso. `git grep -nE "https?://" -- ':(glob)apps/board/src/**' ':(glob)apps/board/index.html'` da 0 líneas | sí |
| B8 | La lista de herramientas del CRM es un dato: `GET /api/tools` devuelve la lista del módulo `crm-client` (nombre, etiqueta y si lee o escribe), y el tablero pinta la lista que recibe, sin una propia | `board-render.test.ts`: una lista con una herramienta falsa, `herramienta-falsa`, aparece en el marcado; `server-read-db.test.ts`: el servidor, armado con una lista inyectada, la devuelve tal cual | no |
| B9 | Cada texto del catálogo de la interfaz (`apps/board/src/texts.ts`) tiene `tone` (`juego` o `serio`) y `audience` (`interfaz`, `participante` o `crm`). Un texto con `audience` distinto de `interfaz` es `serio`, y el tipo lo exige | `texts.test.ts`: recorre el catálogo; un `@ts-expect-error` comprueba que un texto `juego` con `audience: 'crm'` no compila. `bash guards/check-forbidden-phrases.sh forbidden-phrases.txt README.md apps database` sigue en 0 | no |
| B10 | La composición llena la ventana sin franjas ni vacíos a 1536×864, 768×864 (la mitad del ancho), 720×900 y 2560×1080, según `docs/diseno.md` | Manual: `npm run board:shots` toma las cuatro capturas con Chrome sin ventana en una carpeta que git ignora, y el dueño las revisa. No es automático; la auditoría lo reporta como revisión humana | no |
| B11 | La cobertura incluye los `.tsx`: `include` pasa a `apps/*/src/**/*.{ts,tsx}` (ADR-0004 H6), con el mismo piso de 80 | `vitest.config.ts`; un `.tsx` sin pruebas plantado en `apps/board/src` baja la cobertura y hace salir `npm run test:coverage` con 1 | no |
| B12 | Dependencias nuevas, solo estas, exactas y verificadas el día que entran: `react` y `react-dom` en `apps/board`, sus `@types`, y `vite` declarado con la versión que ya trae Vitest; `fastify` 5.12.8 en `apps/circuit` (la de `apps/crm`). Sin `@fastify/static`, sin `@vitejs/plugin-react` (**ASUNCIÓN**, pregunta 3) y sin librería de pruebas de DOM | `git diff 8edc7d8 -- package.json apps/*/package.json`; `npm ls vite --all` muestra una sola versión; `npm audit --audit-level=low` sale con 0 | no |
| B13 | El tablero no escribe nada: en F2.3 solo hay rutas `GET`. La ruta que decide llega con ADR-0012 | `server-read-db.test.ts`: `POST`, `PUT`, `PATCH` y `DELETE` en cada ruta dan 404 o 405, y la base no cambia | sí |
| B14 | `apps/crm`, las migraciones y la tabla `CIRCUIT` de ADR-0010 no cambian | `git diff --exit-code <commit de cierre de ADR-0010> -- apps/crm database/migrations` da 0 | sí |

### Mutantes

| Id | Cláusula | Qué se planta |
|---|---|---|
| M1 | B3 | El nodo de la estación 4 pinta `completed` siempre |
| M2 | B1, B3 | `projectRun` devuelve `completed` en vez de `skipped` |
| M3 | B6 | Sin la revisión del `Host` |
| M4 | B7 | El servidor resuelve la ruta pedida contra `dist` en vez de la lista fija |
| M5 | B5 | La respuesta de eventos devuelve la fila entera |
| M6 | B2 | Un `setTimeout` en un componente que cambia el color de un nodo |

## Cerco

- **Puede cambiar:** `apps/board/` (nuevo); `apps/circuit/src/main.ts` y `apps/circuit/src/server/`
  (nuevos, la raíz de composición); `apps/circuit/src/modules/crm-client/` (solo la lista de
  herramientas); `module-map.ts`, solo para los paquetes del servidor; `vitest.config.ts`
  (B11); `package.json` (los scripts `board:build`, `board:shots` y `circuit:start`), los
  `package.json` de las apps y el lockfile (B12); `.env.example` (`CIRCUIT_PORT`);
  `.gitignore` (la carpeta de capturas); `CLAUDE.md`, `DEVELOPMENT_PLAN.md`, `README.md`.
- **No debe cambiar:** `apps/crm/`; `database/migrations/`; la tabla `CIRCUIT` y el formato de
  los eventos (ADR-0010); `compose.yaml` (el servicio de circuit en Compose es de F6);
  `guards/`.
- **Fuera de alcance:** la decisión del mentor y la tarjeta de aprobación (ADR-0012); entrar y
  el portal, los personajes y el logo (`docs/diseno.md` y los bocetos P4 a P6); reproducir
  corridas grabadas (F3.5); circuit dentro de Compose (F6); varios usuarios a la vez.

## Restricciones

- Solo en `127.0.0.1`, sin enlace público (ADR-0002).
- El tablero no pide nada a otro origen (`connect-src 'self'`, por `default-src`).
- La proyección es pura: sin reloj, sin azar, sin `fetch`.
- La consulta cada 1000 ms es una constante con nombre (**ASUNCIÓN**, pregunta 2).

## Daño a vigilar

- **Un GIF que miente:** si una prueba solo mira la proyección y no el marcado, un componente
  puede pintar otra cosa. Por eso B3 lee los atributos del marcado.
- **Otra página del mismo equipo** puede leer los eventos si falla B6, y desde ADR-0012 también
  decidir. B6 es la primera defensa de las dos.
- **El vacío a 2560×1080** del boceto: si `docs/diseno.md` no lo resuelve, B10 falla en la
  revisión del dueño.

## Reversión

Sin datos: el tablero solo lee. Se revierten los commits; nada en la base cambia.

## Consecuencias

- El tablero sirve igual para corridas en vivo y para las grabadas de F3: solo cambia de
  dónde salen los eventos.
- El aspecto se cambia sin tocar la proyección, y la proyección se prueba sin navegador.
- Sin pruebas de DOM ni de navegador, el diseño a distintos anchos depende de la revisión del
  dueño (B10).

## Preguntas abiertas

Respondidas el 2026-11-26: el dueño eligió cada recomendación como está escrita. Las 1 a 3
quedan como decisión al aceptarse la ADR; la 4 fija cuándo.

1. **Puerto de circuit (B6).** Recomendación: 4020, junto al 4010 del CRM.
2. **Consulta o SSE (decisión).** Recomendación: consulta cada 1000 ms con `?after`; SSE si el
  GIF lo pide.
3. **JSX sin `@vitejs/plugin-react` (B12).** Recomendación: probar primero que Vite 8.3.8
  compila el JSX solo; si no, el plugin entra con una enmienda y su versión del día.
4. **Aceptación (orden).** Recomendación: aceptar esta ADR después de aprobar
  `docs/diseno.md`, porque B10 lo cita.
