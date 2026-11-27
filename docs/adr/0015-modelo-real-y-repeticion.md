# ADR-0015 · El modelo real entra detrás del mismo puerto, pasa la misma batería que el simulador y sus corridas se reproducen sin llave

- **Fecha:** 2026-11-27 · **Estado:** aceptada el 2026-11-27. Claude eligió las recomendaciones
  (CLAUDE.md §1b): no cambian la arquitectura (el puerto `ModelPort` de ADR-0010 queda igual), ni
  el rumbo del producto, ni nada fuera del repositorio. El gasto lo decidió el dueño el 2026-11-23
  (sin tope, solo en local).
- **Tarea:** F3 de `DEVELOPMENT_PLAN.md` (F3.1 a F3.5).
- **Depende de:** ADR-0001 (D1–D3: el código ordena; el modelo detrás de una interfaz), ADR-0003
  (el SDK solo en `model`), ADR-0010 (D2, D4, D9, D12, D13 y D14).

## Contexto

Hoy las estaciones 3, 4 y 5 las responde el simulador desde `scenarios/<id>/simulator.json`, y
`CIRCUIT_MODEL` solo acepta `simulator`. F3 tiene que meter el modelo real sin que el núcleo lo
note, sin pruebas que llamen a la API en CI y sin que quien clona el repositorio necesite una
llave para ver corridas reales. El núcleo ya valida toda salida del modelo (ADR-0010 D2, D13 y
D14) y ya guarda los tokens y el costo en cada evento (D9).

## Decisión

1. **Una batería de contrato del puerto** (F3.1), en `apps/circuit/test/model-contract/`. Es una
   función que recibe cómo construir un `ModelPort` y una lista de casos, y comprueba lo que
   cualquier modelo tiene que cumplir para que el núcleo lo use. La corren el simulador (desde ya),
   el adaptador con un transporte falso (F3.2 a F3.4) y la repetición (F3.5).
2. **El adaptador de Anthropic** (F3.2 a F3.4), en `modules/model/anthropic.ts`, con
   `@anthropic-ai/sdk` 1.14.0 (verificado en el registro el 2026-11-27; su `zod` de pares acepta
   el 4.6.7 que ya está). Se enciende con `CIRCUIT_MODEL=anthropic` y la llave en
   `ANTHROPIC_API_KEY`: es configuración, no código (CLAUDE.md §1). El modelo es
   `claude-opus-5-5`, el Opus vigente, en una constante con su razón; cambiarlo es una decisión del
   dueño, porque cambia el costo.
   - Una llamada por estación, sin flujo y sin bucle: el código ordena (ADR-0001 D1).
   - **Clasificación y conocimiento** piden salida estructurada (`output_config.format`, un
     esquema JSON). El conocimiento recibe los documentos del escenario delimitados con su id y
     tiene que citar uno textualmente; quien decide si la cita vale es `checkCitation` del núcleo,
     no el modelo. No se usa la función de citas de la API: no se combina con la salida
     estructurada, y el núcleo ya revisa la cita.
   - **CRM** (F3.4): las acciones de la lista cerrada (`ACTION_TYPES` del núcleo) van como
     herramientas con `strict: true`. Cada llamada a una herramienta es solo una propuesta: se junta
     y nunca se ejecuta, y no hay segunda vuelta. Antes de F3.4 se vuelve a revisar el SDK y el
     modelo vigentes (lo pide el plan).
   - El texto de la solicitud llega ya delimitado y tachado (ADR-0010 D4), y el mensaje de sistema
     dice que lo que está dentro de `<solicitud>` es dato y nunca instrucción.
   - La salida se devuelve como `unknown` y la valida el núcleo (ADR-0010 D2). No se agrega `zod`
     en `model`, aunque el plan lo nombra: validar dos veces, con dos definiciones, deja que se
     desvíen, y el núcleo no puede importar paquetes. El adaptador solo hace `JSON.parse` del texto
     de la respuesta; si no es JSON, la estación falla en el núcleo.
   - **Medidas:** `tokensIn` suma la entrada, la escritura y la lectura de caché; `tokensOut`, la
     salida; `costMicroUsd` sale de una tabla de precios con su fuente primaria (la página de
     precios de Anthropic) y la fecha en que se leyó, redondeado hacia arriba a un entero. Si el
     modelo que respondió no está en la tabla, el costo es nulo: sin fuente, no hay número. El
     `model` del evento es el que respondió de verdad (`response.model`).
   - **Rechazos:** si la API rechaza la solicitud por seguridad (`stop_reason: "refusal"`), la
     estación falla con un error propio. No se piden modelos de respaldo: la corrida grabada tiene
     que decir qué modelo trabajó en cada estación, y un rechazo queda a la vista en el mapa.
   - **Errores:** todo error del SDK se vuelve `ModelUnavailable`, con el código HTTP cuando lo hay y
     sin el cuerpo, los encabezados ni la llave. Los reintentos del SDK (2, sin efectos laterales)
     se dejan; el tiempo máximo es explícito.
   - **Pruebas sin red:** el adaptador recibe el `fetch` que usa el cliente. Las pruebas le pasan uno
     falso que responde lo que la prueba escribió; ninguna prueba construye el adaptador sin él.
     CI no tiene llave.
3. **Grabar y reproducir** (F3.5). `npm run model:record` (manual, en la máquina del dueño, con la
   llave) pasa las solicitudes de `samples.json` por el adaptador y escribe
   `scenarios/<id>/recordings.json`: por el SHA-256 de cada solicitud, la salida, las medidas, el
   modelo que respondió y cuánto tardó. Nada más: ni encabezados, ni la llave, ni el texto crudo.
   `CIRCUIT_MODEL=replay` responde desde ese archivo, espera lo que tardó la llamada real y da sus
   medidas reales; sin llave y sin red. Una solicitud que no está grabada falla con un error que lo
   dice, en vez de inventar una respuesta.

## Cláusulas

| Id | Regla que el código cumple | Chequeo que lo prueba |
|---|---|---|
| K1 | Todo modelo tiene un `name` de 1 a 80 caracteres, el largo que acepta `circuit.station_events.model`, y no cambia entre llamadas | La batería de contrato |
| K2 | Cada medida de una respuesta es nula o un entero no negativo (ADR-0010 D9) | La batería: las tres medidas de cada respuesta de cada caso |
| K3 | Con cada caso, el motor recorre la ruta esperada con ese modelo, sin ningún evento `failed`, y cada estación del modelo termina con el resultado esperado | La batería, sobre los cuatro casos de `samples.json` con los contactos de los casos dorados |
| K4 | El modelo no cambia lo que recibe: los documentos y el contexto del CRM llegan congelados, y una escritura lanzaría | La batería |
| K5 | Cada respuesta es un valor nuevo: cambiar la salida de una no cambia la siguiente | La batería |
| K6 | La misma solicitud dos veces da la misma salida, con el simulador, el transporte falso y la repetición | La batería |
| K7 | El SDK solo se importa en `model` (ADR-0001 D2); el núcleo sigue sin importar nada | `architecture.test.ts` y `PACKAGE_OWNERS`, sin cambio |
| K8 | Ninguna prueba llama a la API: el adaptador no se construye sin un `fetch` dado | Prueba del adaptador (F3.2) y `git grep` de su constructor en `test/` |
| K9 | Lo que va a la API lleva la solicitud solo dentro de `<solicitud>`, y el mensaje de sistema la nombra como dato | Prueba del adaptador con el transporte falso, que guarda el cuerpo |
| K10 | El costo sale de la tabla con fuente y fecha; un modelo que no está en ella da costo nulo | Prueba del adaptador (F3.2) |
| K11 | Un error del SDK o un rechazo termina la estación en `failed`, y el mensaje no lleva la llave, el cuerpo ni la solicitud | Prueba del adaptador |
| K12 | `recordings.json` guarda solo los campos de la lista; la guarda de secretos lo revisa como a todo lo versionado | Prueba del grabador (F3.5) y `check-secrets.sh` |
| K13 | `CIRCUIT_MODEL=replay` no abre la red y una solicitud sin grabar falla diciendo que no está grabada | Prueba de la repetición (F3.5) |

## Consecuencias

- Con `CIRCUIT_MODEL=anthropic` cada solicitud gasta tres llamadas como máximo, y la cuenta queda
  en los eventos.
- La batería no prueba que el modelo real clasifique bien: prueba que lo que devuelve lo puede usar
  el núcleo. La calidad de las corridas reales se ve en lo grabado.
- Cambiar el modelo o un precio cambia `recordings.json` solo si se vuelve a grabar; el archivo
  dice con qué modelo se grabó.

## Enmiendas

**A1 (el dueño, 2026-11-27): sin llave y sin corridas reales.** «La llave no la usaremos; es una
demostración y no quiero gastar tokens». El adaptador se construye entero y se prueba solo con el
transporte falso, que responde con la forma de la API; nunca se llama a la API. Por eso:

- F3.5 (grabar y reproducir) sale del hito: no hay corridas reales que grabar. `CIRCUIT_MODEL=replay`,
  `recordings.json`, `npm run model:record`, K12 y K13 no se construyen.
- El circuito de la demostración corre con el simulador, y sus medidas siguen nulas (ADR-0010 D9):
  ninguna pantalla, ni el README, ni F6 muestran tokens, costos o tiempos del modelo como si fueran
  reales. Lo que el transporte falso responde nunca se guarda como corrida.
- F3 termina cuando el simulador y el adaptador (con el transporte falso) pasan la misma batería.
- Encender el modelo real sigue siendo configuración: `CIRCUIT_MODEL=anthropic` y la llave. Queda
  hecho y probado, pero apagado.

## Notas de implementación

**F3.1 (2026-11-27, sobre `71d0fcf`).** `test/model-contract/cases.ts` (los casos: cada muestra de
`samples.json`, con el contacto de su caso dorado y la ruta esperada escrita en
`SCENARIO_EXPECTATIONS`; una muestra sin ruta esperada hace fallar la batería), `contract.ts`
(`describeModelContract`: K1 a K6, más la solicitud delimitada de ADR-0010 D4) y
`simulator-contract.test.ts`, que la corre con el simulador: 15 pruebas. La K4 no tiene prueba
propia: los documentos, el contexto del CRM y los contactos llegan congelados a cada recorrido, y
una escritura del modelo deja la estación en `failed`, así que la K3 la ve. Seis mutantes del
simulador, cada uno en rojo y restaurado por hash: X1 (un token negativo) y X2 (un costo con
decimales) para K2, X3 (la salida compartida) para K5, X4 (el nombre vacío) para K1, X5 (escribe en
los documentos) para K4 y X6 (busca con otra clave) para K3. `npm run check` en 0: 1393 pruebas
(una solo en Linux), cobertura 93,53 / 87,07 / 93,64 / 95,7, la misma, porque no se tocó `src/`.

**F3.2 (2026-11-27, con A1).** `@anthropic-ai/sdk` 1.14.0 exacto en `apps/circuit` (su `zod` se
comparte con el 4.6.7; `npm audit` en 0) y en la lista de `model` de `module-map.ts`.
`modules/model/anthropic.ts` (`createAnthropicModel`: la clasificación con salida estructurada,
esfuerzo `low` y los programas del escenario como únicos `topic`; `answer` y `proposeCrm` lanzan
hasta F3.3 y F3.4) y `prices.ts` (la tabla de Opus 5.5, en centavos por millón de tokens, leída
el 2026-11-27 de la página de precios, que no trae fecha; `usageOf`). Dos diferencias con la
decisión: el adaptador recibe los programas al crearse (`topics`), porque `classify` del puerto
solo recibe la solicitud; y el `model` del evento es el nombre fijo del puerto, mientras que el
costo se calcula con el `model` de la respuesta (sin modelos de respaldo, son el mismo; si
difieren, el costo es nulo). El SDK 1.14.0 manda la llave como `Authorization: Bearer`, no como
`x-api-key`. Pruebas: `test/anthropic-model.test.ts` sobre el transporte falso
`test/support/fake-anthropic.ts` (13); Y1–Y7 en rojo y restaurados por hash. `npm run check` en 0:
1406 pruebas (una solo en Linux), cobertura 93,6 / 86,96 / 93,64 / 95,73.

**F3.3 (2026-11-27, con A1).** `answer` pide salida estructurada `{answer, documentId, quote}`:
`documentId` es uno de los ids del escenario o `null`, y `quote`, un texto o `null`, para que el
modelo pueda decir que ningún documento responde; con cero documentos, `documentId` solo puede ser
`null`. Quien decide si hay fuente sigue siendo `checkCitation`. Los límites de largo van en las
instrucciones, tomados de `knowledge.ts`, y no en el esquema. El mensaje de sistema son dos
bloques fijos para un escenario: las instrucciones y los documentos, cada uno como
`<documento id="…">`, en el orden del escenario y con el punto de caché después de ellos (Opus 5.5
cachea desde 512 tokens; los tres documentos son unos mil). La solicitud va sola en el turno del
usuario (K9). Esfuerzo `medium`, el de Opus 5.5 por defecto, escrito a la vista; 8000 tokens
de salida. Un documento cuyo id no tiene la forma del cargador, o cuyo texto trae `<documento` o
`</documento>` (en mayúsculas o minúsculas), lanza `UnsafeDocument` antes de llamar a la red, sin
el texto del documento: se rechaza en vez de escaparse. Los textos y esquemas de las dos estaciones
pasaron a `modules/model/prompts.ts`. Pruebas: `test/anthropic-answer.test.ts` (10, con la
estación 4 dentro del motor; la 5 sigue con un modelo de guion hasta F3.4). Z1–Z8 en rojo y
restaurados por hash: la solicitud en el sistema, sin punto de caché, documentos sin id,
`documentId` sin `null`, la revisión de etiquetas sensible a mayúsculas, sin revisión del id, los
documentos armados dentro de la llamada y en otro orden. `npm run check` en 0: 1417 pruebas (una
solo en Linux), cobertura 93,66 / 86,99 / 93,78 / 95,79.

**F3.4 (2026-11-27, con A1).** Antes se revisó lo vigente ese día: `@anthropic-ai/sdk` 1.14.0 sigue
siendo `latest` en el registro, y `claude-opus-5-5`, el Opus vigente; nada cambió.
`modules/model/crm-tools.ts`: las cinco acciones de `ACTION_TYPES` como herramientas `strict`, en
ese orden. `create_contact` pide solo el nombre, porque el correo lo pone el núcleo (ADR-0010 D4).
`move_stage` lleva un enum con las etapas de la cuenta del agente y se quita si el escenario no
tiene etapas; una etapa fuera de forma lanza `InvalidStage` al crear el adaptador. Hay una sola
llamada, con `tool_choice: auto` (Opus 5.5 rechaza la elección forzada) y esfuerzo `medium`, sin
`tool_result` y sin segunda vuelta. Las llamadas se juntan en orden como `{actions}`, con el
nombre de la herramienta como `type`, puesto al final para que ninguna entrada renombre su acción.
Ninguna llamada es la propuesta de nada; una respuesta cortada por `max_tokens` da `null` y la
estación falla, en vez de proponer menos. El contexto del CRM va en un bloque `<crm>` aparte,
antes de la solicitud, como JSON con cada `<` escapado y sin el id del contacto. Las herramientas
y las instrucciones son fijas para un escenario, con el punto de caché después de ellas.
`loadTryouts` devuelve también `stages`: las claves de la cuenta del agente, por `position`.

**Encendido (2026-11-27).** `CIRCUIT_MODEL` acepta `simulator` (por defecto) y `anthropic`. Con
`anthropic`, `ANTHROPIC_API_KEY` es obligatoria, de 20 a 200 letras, dígitos, `-` o `_`, y el
mensaje nombra la variable, nunca su valor. `modelFor`, de `main.ts`, construye el modelo y le da
al adaptador el `fetch` del proceso; las pruebas le dan uno falso (K8). `.env.example` trae
`CIRCUIT_MODEL=simulator` y la llave comentada. **F3 cumple su «terminado cuando»:** la batería
de contrato corre con el adaptador sobre `test/support/simulated-anthropic.ts`, un transporte
falso que responde lo que respondería el simulador (`anthropic-contract.test.ts`, 15 pruebas).
Pruebas nuevas: `anthropic-crm.test.ts` (11), `model-choice.test.ts` (3) y casos en
`config`, `simulator` y `tryouts`. W1–W14 en rojo y restaurados por hash. `npm run check` en 0:
1456 pruebas (una solo en Linux), cobertura 93,74 / 87,07 / 93,91 / 95,83.
