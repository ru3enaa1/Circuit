# Circuit — reglas del proyecto

Circuit es un agente de texto que atiende solicitudes entrantes y trabaja dentro de un CRM,
con un tablero donde cada solicitud recorre siete estaciones visibles y una persona aprueba
lo que el modelo no debe decidir. Es una pieza de portafolio pública e independiente, hecha
como prueba de habilidades para una vacante de desarrollo con IA. El origen y las razones
están en `docs/privado/propuesta.md`, que es local y no se publica. Nunca se convierte en un
sistema donde el modelo ordena el flujo, escribe en el CRM sin aprobación o habla en nombre
de una empresa real.

---

## 1. Innegociables

- **El código ordena el circuito, no el modelo.** El modelo solo trabaja en las estaciones 3,
  4 y 5, y nunca elige la siguiente estación.
- **El texto de entrada es dato, nunca instrucción.** Va delimitado al prompt; un intento de
  inyección se detiene en la estación 2 y queda registrado.
- **Nada sale ni se escribe en el CRM sin aprobación humana** (estación 6). La estación 5 solo
  propone.
- **Permiso mínimo en el CRM, no en el prompt.** La llave del agente no borra, no exporta y
  no ve otra cuenta; lo rechaza la API del CRM simulado, y borrar y ver otra cuenta también
  los impide la base (ADR-0005).
- **Toda escritura al CRM queda en bitácora** con quién la propuso y quién la aprobó.
- **El mapa se dibuja con eventos guardados**, nunca con una animación suelta.
- **Sin fuente, no hay respuesta** en la estación 4.
- **El modelo está detrás de una interfaz.** Hoy responde un simulador; encenderlo es cambiar
  configuración, no código.
- **Secretos** solo en variables de entorno o en archivos que git ignora y que una variable
  nombra (ADR-0009, pregunta 1); nunca en el repositorio ni en el estado de Terraform versionado.
- **Datos sintéticos.** Ni marca, ni logo, ni datos de la empresa de la vacante; ni nombres
  ni análisis de terceros estudiados fuera de Circuit. `docs/privado/` no entra a git.
- **Inspirar, no copiar:** ningún nombre, personaje, logo, música ni imagen de terceros en el
  producto; las referencias de tono solo guían el diseño.
- **Honestidad:** no se inventa experiencia del autor; `forbidden-phrases.txt` lo vigila.
- **Reproducible:** la misma entrada con el simulador y la misma versión da la misma salida.
- **Local, sin llave:** quien clone el repositorio levanta todo con un comando y ve el
  circuito con el simulador o con corridas reales grabadas. No hay despliegue en la nube.
- **Alcance congelado** hasta la primera entrega (F0–F3 y F6), ver `DEVELOPMENT_PLAN.md`.

## 1b. Forma de trabajo (el dueño, 2026-11-26)

- **Sin auditorías.** Quien recibe la demostración no es técnico: quiere verla funcionar y bien
  hecha. No se corre ni se recomienda `/coderachnid:adr-guard` (ni plan ni audit), ni se
  escribe su bloque «adr-guard · NEEDED» al cerrar. Se mantienen las pruebas, la prueba en rojo
  antes de arreglar un error, `npm run check` en 0 antes de cada commit, las guardas y CI.
- **Claude corre las fases en orden** (las de `DEVELOPMENT_PLAN.md`), con commits por paso,
  sin pedir permiso para cada uno. Las ADR se siguen escribiendo, más cortas, como registro
  de la decisión; Claude elige las recomendaciones que no son críticas y las anota.
- **Solo se detiene** cuando el chat está muy largo (escribe el relevo con
  `/coderachnid:handoff`) o cuando hace falta una decisión crítica del dueño: arquitectura,
  rumbo del producto, algo que sale del repositorio (push, integración a `main`) o algo que
  no se deshace. Los innegociables de §1 siguen valiendo igual.

## 2. Dónde estamos de verdad

2026-11-24: **F0 cerrada e integrada a `main`** con el sí del dueño (fast-forward a
`4b79aa3`, sin commit de merge; CI en verde en la rama, corrida 45459976606, y en `main`,
45460157418). Remoto: https://github.com/ru3enaa1/Circuit. Lo que hay: npm workspaces con
`apps/circuit` y `apps/crm`, TypeScript estricto y Vitest con un proyecto por app; los cinco
módulos de circuit, vacíos, con la prueba de arquitectura; PostgreSQL 18.7 en Compose, solo
en `127.0.0.1`, con Drizzle y la migración inicial (esquemas `circuit` y `crm`, vacíos);
cobertura con piso de 80, la guarda de secretos, `.github/workflows/ci.yml` y el hook de
`pre-push` (§9). Sin código de producto todavía. ADR-0003 (opción 4) aceptada; ADR-0004
auditada (APROBAR CON CONDICIONES): H6 se aplica en F2 y H8 en F3.
**F1 · CRM simulado abierta en `feat/f1-crm`**, que sale de `main`. **F1.1 hecha y
empujada el 2026-11-24** (CI en verde en `d40b3c3`, corrida 45473516868). ADR-0005
aceptada (el dueño delegó sus siete preguntas) y **auditada**: APROBAR CON CONDICIONES
(`docs/reviews/ADR-0005-audit-2026-11-24.md`). El dueño pidió arreglar lo que se pudiera, y
las enmiendas A6–A9 de la ADR cierran las condiciones: la guarda de roles con prueba, la
carrera de roles en un paso de CI sobre un servidor nuevo, RLS sin cuenta y sin `WHERE`,
autores opacos en la bitácora (`0003`) y el hash de cada migración fijado. Ocho tablas en
`crm` con RLS por cuenta; roles `crm_service` y `circuit_service` sin login; bitácora por
trigger, sin valores; llaves solo como SHA-256 y solo por `crm.resolve_api_key`.
Migraciones `0001` y `0003` (generadas) y `0002` (a mano); `database/schema.sql` sale de
un `pg_dump` (R8). 164 pruebas, cobertura 98,46 / 92,3 / 100 / 98,24; los mutantes de la
ADR y los de la auditoría, en rojo. Los arreglos, empujados el 2026-11-24 (CI en verde en
`f7542cc`, corrida 45503832664, con la carrera de roles en un servidor nuevo).
**F1.2 (API de lectura) hecha y empujada el 2026-11-24 (CI en verde en `bf7a52f`,
corrida 45521454430), y auditada:** APROBAR CON CONDICIONES
(`docs/reviews/ADR-0006-audit-2026-11-24.md`). El 2026-11-25 el dueño pidió arreglar lo que
pedía arreglo, y las enmiendas A1–A5 de la ADR cierran las condiciones (empujadas el
2026-11-25, CI en verde en `b41f8d6`, corrida 45635335825):
sin llave, una URL que el enrutador no puede leer da 401 y deja su línea de registro; un
puerto ocupado se nombra por `CRM_PORT`; y `db:users` rechaza `WITH ADMIN OPTION`. Quedan
301 pruebas, con cobertura 94,67 / 85,16 / 97,11 / 96,18, y los mutantes M15–M18, en rojo.
ADR-0006
aceptada ese día (el dueño aceptó sus siete recomendaciones), con su línea base
(`docs/reviews/ADR-0006-baseline.md`). Fastify y zod en `apps/crm`, corridos por Node sin
compilar (`npm run crm:start`, solo en `127.0.0.1`); siete rutas de lectura con llave
Bearer, 403 de cuenta y de permiso, una transacción `READ ONLY` por petición y un registro
sin datos personales. `0004` deja todo `crm` en manos de `crm_owner`, sin login (H3);
`npm run db:users` crea `crm_app` con un verificador SCRAM (H10), y las reglas de ADR-0005
se repiten como `crm_app` (H11). Al empujarla: 291 pruebas, cobertura 94,48 / 85,14 /
96,03 / 96,02; los mutantes M1–M13, más M11b y M14, en rojo. La base de desarrollo, respaldada y migrada
hasta `0004`, con `crm_app` creado. Los push los pide el dueño; el hook no se salta con
`--no-verify`.
**F1.3 (API de escritura):** ADR-0007 aceptada el 2026-11-25 (el dueño aceptó sus nueve
recomendaciones), con su línea base (`docs/reviews/ADR-0007-baseline.md`); enmienda D11
de ADR-0006. La línea base halló dos fallas de
ADR-0006, corregidas ese día como sus enmiendas A6–A7: la búsqueda con un NUL en el correo
da 400 y no 500, y el SQLSTATE de un error que drizzle envuelve llega al registro.
**F1.3 hecha y empujada el 2026-11-25 con A6–A7 (CI en verde en `7a60246`, corrida
45650884008), y auditada:** APROBAR CON CONDICIONES
(`docs/reviews/ADR-0007-audit-2026-11-25.md`). Trece rutas (seis nuevas: crear, actualizar y
archivar un contacto, anotar, crear tarea y leer la bitácora); cada escritura, una
transacción `READ WRITE` que lee la entrada después de la llave, la cuenta y el permiso, y
fija `proposed_by = key-<id>` y la aprobación del cuerpo. La llave del agente recibe 403
«borrado» al archivar. Sin migraciones ni dependencias nuevas. 413 pruebas, cobertura 95,75
/ 87,77 / 97,97 / 97,04; los mutantes M1–M14 de ADR-0007, en rojo. Fuera del cerco, sin
cambio de conducta: `credentialsOf` pasó de `routes/reads.ts` a `server/auth.ts`.
El 2026-11-25 el dueño pidió arreglar lo que pidiera la auditoría. Las enmiendas A1–A4 de la
ADR cierran las condiciones, empujadas el 2026-11-25 (CI en verde en `6e8f445`, corrida
45659052830). Cada hook con base lleva
`DATABASE_HOOK_TIMEOUT_MS` (H1), y lo comprueba `hook-budget.test.ts`, porque `--hookTimeout`
no llega a los proyectos (§8). El cerco y la precedencia del `PATCH` quedan escritos, con dos
pruebas nuevas. Quedan 417 pruebas, con la misma cobertura; 10 vueltas
seguidas de `npm run check` en 0; M15, M16 y M16b, en rojo. **H2** (una llave sin `read` ve
lo que escribe): el dueño eligió la opción (a) el 2026-11-25, mientras ninguna llave real
deje de tener `read` (ADR-0007 A2).
**F1.4 (llaves con alcance), hecha y empujada el 2026-11-25 (CI en verde en `ece213b`,
corrida 45682667249), y auditada:** APROBAR CON CONDICIONES
(`docs/reviews/ADR-0008-audit-2026-11-25.md`). ADR-0008 **aceptada** ese día (el dueño aceptó
sus nueve recomendaciones), con su línea base (`docs/reviews/ADR-0008-baseline.md`, sobre
`6e8f445`: 417 pruebas, todo en 0). Un commit por paso: H4 (D18, `7b60367`), `read-scope.ts`
→ `scope.ts` y `apps/crm/src/keys.ts`, sin cambio de conducta; D1–D3 y D14 (`d24ed3a`), la
forma `crmk_` (`API_KEY_SHAPE`, con la última letra canónica), el generador y `hashApiKey`
en `keys.ts`, `presentedKey` que rechaza otra forma sin tomar conexión y toda llave de prueba
desde `testApiKey` (`crm-fixture.ts`); el emisor (D4–D9, D19, `eeb8ce6`), `database/keys.ts` y
`npm run db:keys -- issue | list | revoke`; exportar y los tres «no» (D10–D13, `501445b`),
`GET /accounts/:slug/export` con `export` (`routes/export.ts`) y `agent-key-db.test.ts`; la
regla `crm-api-key` de la guarda (D15, `acd5e2b`), con 28 casos en `check-secrets.test.sh`; y
los documentos (`ece213b`): el README (emitir, listar y revocar), §4 y §9 de este archivo y
«Enmendada por» en ADR-0007. 477 pruebas, cobertura 95,58 / 86,92 / 97,26 / 97,42; M1–M15
en rojo. Toda llave emitida lleva `read` (H2 hecha regla). La auditoría: las 19 cláusulas
en CUMPLE, 1 mayor de la suite (H1: ninguna prueba vigila que un error de `db:keys` no
muestre el hash ni el mensaje), 3 menores y 3 notas. El 2026-11-25 el dueño pidió A1 (H1) y
eligió (a) para H2: la guarda lee también los mensajes de los commits que se publican. H3,
H4 y H5 no los pidió y quedan abiertos. **A1 y A2, hechas y empujadas ese día (CI en verde
en `52e015d`, corrida 45694757738):** tres
pruebas nuevas de D6 en `keys-db.test.ts` (`497bbfb`), en rojo con X1, X4 y X4b; y
`check-secrets.sh --range` lee también el mensaje de cada commit (`15f3023`, que enmienda
ADR-0004 C12), con 31 casos en su batería y 11 en la del hook. 480 pruebas, cobertura 95,58
/ 87,58 / 97,26 / 97,42. La trampa del worktree, en §8.
**R6 y F1.5 (respaldo y semilla), hechas el 2026-11-25, sin empujar.** ADR-0009
aceptada ese día (el dueño aceptó sus diez recomendaciones), con su línea base
(`docs/reviews/ADR-0009-baseline.md`, sobre `52e015d`); al aceptarla se corrigieron los
chequeos de D4 y D7, que sin `:(glob)` no leían lo que decían (§8). Un commit por paso: R6
(`a1d57e0`), `npm run db:backup` y `db:restore`, con el volcado dentro del contenedor y su
SHA-256 comparado; el paquete (`88b2a78`), `scenarios/escuela/crm.json` y su formato en
`apps/crm/src/scenario.ts`; la semilla y la llave (`7f04b0a`), `npm run db:seed`, una vez por
cuenta, firmada `seed`, con las fechas del paquete y la llave del agente en
`CRM_AGENT_KEY_FILE` (`.secrets/crm-agent-key`, que git ignora); y los documentos. 627
pruebas (una, el modo `0600`, solo en Linux), cobertura 95,47 / 86,43 / 96,29 / 97,68;
M1–M22 en rojo, M8 plantado en `pg_restore` (§8). D26 hecho: la base de desarrollo,
respaldada (`database/backups/20261125-213637Z-antes-semilla/`), restaurada en una copia que
se volcó igual y se borró, sembrada dos veces (la segunda no tocó nada) y probada con
`crm:start`; el respaldo de antes de `0004` también restauró, y se borró. **La `.env` del
dueño no trae `CIRCUIT_SCENARIO` ni `CRM_AGENT_KEY_FILE`:** D26 las pasó por el entorno; hay
que copiar las dos líneas de `.env.example`. **Auditada el 2026-11-26: BLOQUEAR**
(`docs/reviews/ADR-0009-audit-2026-11-26.md`): `npm run check` salía con 1 en 2 de 5 vueltas
(H1), más tres mayores (H2–H4). El dueño pidió aplicar los arreglos con lo que más asegura, y
las enmiendas A1–A7 de la ADR los cierran: presupuesto con nombre en cada prueba que siembra o
llama a docker, vigilado por `hook-budget.test.ts`, y `adminClient`, que escucha el `'error'`
de una sesión cortada; el correo del paquete con `storable`; las pruebas de D7 y de las ramas
de D19; una clave desconocida que no se repite; `ORDER BY` calificados; las carpetas de llaves
de las pruebas, borradas; mensajes propios para las fallas raras de la semilla; y
`database/command.ts` y `docker.ts` (H11). Commits `03177b5`, `39c11cc` y `321c0d3`. 648
pruebas, cobertura 95,62 / 86,6 / 96,72 / 97,71; los mutantes de cada enmienda, en rojo; 10
vueltas seguidas de `npm run check` en 0 (de 50 a 131 s). H10 (`db:keys list` ordena el id
como texto) queda abierto, para la fase que toque `db:keys`. **Empujada el 2026-11-26 a
pedido del dueño (CI en verde en `4e833d5`, corrida 45842358302):** en Linux corrieron las 648
pruebas, ninguna saltada, D20 (el modo `0600`) entre ellas; cobertura 95,71 / 87,2 / 96,72 /
97,82. **F1 cerrada e integrada a `main` el 2026-11-26** con el sí del dueño (fast-forward
de `4b79aa3` a `f72aa15`, sin commit de merge; CI en verde en la rama, corrida 45845613390, y
en `main`, 45845951453, con 648 pruebas). **F2 · Circuito y mapa abierta el 2026-11-26 en `feat/f2-circuito`**, que sale de `main`
(`f72aa15`). Primero F2.0: los bocetos del dueño y el brief `docs/diseno.md`. Los bocetos
(B0–B8, más sus referencias y los prompts) están listos desde el 2026-11-26 en
`docs/privado/bocetos/Mockups_completados.zip`, que git ignora; el dueño eligió el logo
**4a** de B8. `docs/diseno.md` **aprobado por el dueño el 2026-11-26** (`adc60e2`): la órbita con Persona al
centro, siete apariencias por estación, revelado de eventos de a uno y los paneles de la
ultraancha. Con él, **ADR-0011 aceptada** (enmiendas: `@fontsource` en B12 y más campos en
`GET /api/circuit`). Por §16 (a), ADR-0010 A1: el evento de Filtro guarda el texto ya tachado en
`detail.text`; casos dorados regenerados; 897 pruebas (una solo en Linux). **F2.0 cerrada; sigue
F2.3a** (servidor de lectura, `projectRun`, la órbita), en el orden de §17 del brief.
Pedido al dueño, como insumo de F2: el material del programa que citará la estación 4.
ADR-0010 (motor, eventos y simulador: F2.1 y F2.2) y ADR-0012 (aprobación y cierre: F2.4)
**aceptadas el 2026-11-26** (el dueño aceptó sus nueve y cinco recomendaciones), con su línea
base (`docs/reviews/ADR-0010-baseline.md`, sobre `8edc7d8`). ADR-0011 (el tablero, F2.3),
propuesta con sus respuestas elegidas: se acepta cuando el dueño apruebe `docs/diseno.md`. Se
implementan en orden, 0010 → 0011 → 0012 (sin auditoría por ADR desde el 2026-11-26, §1b).
**F2.1 hecha el 2026-11-26, sin empujar:** el núcleo (`46d4558`: la tabla, el filtro, las
estaciones 1 a 5 y `decideRun`, que guarda la decisión como el único evento de la 6 y corre la
7 desde el almacén; M1–M5, M8, M10 y M11 en rojo) y la base (`6cbf768`: `0005`, `circuit_owner`,
`circuit_app` en `db:users` con `CIRCUIT_DB_PASSWORD`, `PgEventStore`, D20; M6, M7, MU1, MU2 y
M20 en rojo). La base de desarrollo, respaldada (`database/backups/20261126-204043Z-antes-0005/`),
migrada a `0005` y con `circuit_app`; la `.env` del dueño ya trae `CIRCUIT_DB_PASSWORD`.
**F2.2 a medias:** el simulador y el cargador, en `a51bb1b` (D12). Los tres documentos del
programa (`scenarios/escuela/documents/`, sintéticos, escritos por Claude por la pregunta 8),
`simulator.json` y los cuatro casos dorados están escritos y en verde; con §1b entran a commit
sin esperar la aprobación de los documentos (2026-11-26). Con ellos: 852 pruebas, cobertura 95,6 / 88,22 / 96,82
/ 97,99; M1, M2, M3, M9 y M11 ponen en rojo un caso dorado. Las desviaciones de la ADR, en sus
«Notas de implementación». 10 vueltas seguidas de `npm run check` en 0 (de 56 a 73 s), con
los archivos sin commit en el árbol. **Auditada el 2026-11-26: APROBAR CON CONDICIONES**
(`docs/reviews/ADR-0010-audit-2026-11-26.md`; 1 mayor, 4 menores). Ese día, a pedido del dueño,
H1–H5 arreglados sin commit, cada uno con su prueba en rojo primero (las «Notas de
implementación» de la ADR): el filtro tacha más formas de documento, las cifras de ancho
completo, los teléfonos 3-3-4 con puntos (lo eligió el dueño) y el teléfono que cierra una
oración; quita toda `\p{Cf}`; la 5 revisa el correo como la 6; y `crm-limits.test.ts`. 880
pruebas (una solo en Linux), cobertura 95,63 / 88,25 / 96,85 / 98; un mutante por arreglo,
en rojo. **Segunda auditoría el 2026-11-26: APROBAR CON CONDICIONES**
(`docs/reviews/ADR-0010-audit-2026-11-26-2.md`). R1–R4 arreglados ese día, con 15 pruebas en rojo
primero (NFC, el tramo de hasta 30 caracteres y un salto de línea entre etiqueta y número, las
cifras de otros sistemas y el correo con tildes); EA1 y EA2 aplicadas en la ADR. Es la última
auditoría: el dueño las apagó (§1b). Con eso, 896 pruebas (una solo en Linux), cobertura
95,66 / 88,18 / 96,85 / 98,01; **F2.2 hecha**, en commits locales, sin empujar.
**F2.3a hecha el 2026-11-26, sin empujar (ADR-0011):** circuit sirve en `127.0.0.1:4020`
(`npm run circuit:start`) el tablero y cuatro rutas `GET`, con la revisión de `Host`, CSP y la
lista fija de `apps/board/dist`; `apps/board` (React, Vite 8.3.8 sin plugin) dibuja la órbita solo
desde `projectRun`, con siete apariencias, nodos, telemetría, muelle y el revelado de a uno.
1094 pruebas (una solo en Linux), cobertura 94,21 / 87,09 / 94,67 / 96,44; M1–M6 en rojo; las
desviaciones, en las «Notas de implementación» de la ADR. **F2.3b hecha el 2026-11-26, sin empujar (ADR-0013):** cada estación y cada píldora del muelle es
un enlace a su sala (`#/estacion/<id>`, `#/estacion/crm/accion/<n>`); la sala muestra la estación
en grande, sus nodos enteros y sus salidas con la tomada; el portal, la miga de pan y Esc vuelven
de a un nivel. Lo que se mira vive en el fragmento, leído con `useSyncExternalStore`: B1 y B2
sin cambio. 1161 pruebas (una solo en Linux), cobertura 93,58 / 87,19 / 93,71 / 96,02; M1–M3 en
rojo. **B10 (revisión del dueño de `npm run board:shots`, ahora con cuatro salas) pendiente.**
**F2.3b empujada e integrada a `main` el 2026-11-27** con el sí del dueño (fast-forward de
`f72aa15` a `a30dd2e`, sin commit de merge; CI en verde en la rama, corrida 46002333304, y en
`main`, 46002654942). F2 sigue abierta en la misma rama.
**F2.3c abierta el 2026-11-27 (ADR-0014, aceptada por Claude):** el logo 4a hecho, sin empujar.
`mark.ts` es la geometría de la órbita en pequeño que comparten la miniatura del portal y
`Logo.tsx` (puro, colores como valores); el ícono de pestaña es `apps/board/public/favicon.svg`,
el marcado del componente, vigilado por `favicon.test.ts` y reescrito con `npm run
board:favicon`. 1175 pruebas (una solo en Linux), cobertura 93,7 / 87,38 / 93,81 / 96,07; M1–M5
en rojo. **El 2026-11-27 el dueño pidió el circuito igual a su boceto B1** («le cambia mucho los
circuitos, el color y los dots»): G8 de ADR-0014 (`cab6432`), estaciones con brazos, tubos de
dos rieles, anillos, íconos, rótulos cortos y el muelle con íconos. Ese día también el equipo
(G4, `df2b6ac`) y los paneles de la ultraancha (G5, `134863a`, `8d91c2f`). **F2.3 hecha, sin
empujar:** 1260 pruebas (una solo en Linux), cobertura 94,53 / 86,97 / 94,9 / 96,53; N1–N3,
C1–C4 y P1–P5 en rojo; N4 y C5 sobreviven como guardas (las notas de la ADR). B10 (el dueño
mira `npm run board:shots`) sigue pendiente. Sigue F2.4.
**B10 aprobado por el dueño el 2026-11-27. F2.4 hecha ese día, sin empujar (ADR-0012, con su
enmienda A12):** `48bcb18` (el tipo `Approval` y `approvalFrom`, la 7 que reclama la corrida en
`circuit.apply_claims` (`0006`) y aplica en orden, el cliente HTTP del CRM, el escritorio del
mentor y las rutas `POST /api/runs/:id/decision` y `POST /api/runs`) y `6f66116` (la sala de
Persona como aprobación y «Probar una solicitud»). 1378 pruebas (una solo en Linux), cobertura
93,53 / 87,07 / 93,64 / 95,7; M1–M7 y D1–D4 en rojo. La base de desarrollo, respaldada
(`database/backups/20261127-143511Z-antes-0006/`) y migrada a `0006`, con una corrida real
aprobada (la 1) y sus tres escrituras en el CRM. **`circuit:start` ahora pide
`CRM_AGENT_KEY_FILE`, y la `.env` del dueño sigue sin ella ni `CIRCUIT_SCENARIO`:** hay que
copiar esas dos líneas de `.env.example` (el dueño las copió el 2026-11-27).
**F2 cerrada e integrada a `main` el 2026-11-27** con el sí del dueño (fast-forward de `a30dd2e`
a `71d0fcf`, sin commit de merge; CI en verde en la rama, corrida 46045777906, y en `main`,
46046648965). El dueño la probó en la app real: funciona, con transiciones bruscas (R11 del plan,
antes del GIF de F6). **F3 · Modelo abierta el 2026-11-27 en `feat/f3-modelo`**, que sale de
`main` (`71d0fcf`). La `.env` del dueño aún no trae `ANTHROPIC_API_KEY`; F3.1 no la necesita.
ADR-0015 aceptada ese día (Claude, §1b): el adaptador de Anthropic detrás de `ModelPort`
(`claude-opus-5-5`, SDK 1.14.0, sin red en las pruebas), una batería de contrato común y la
repetición de corridas grabadas. **F3.1 hecha, sin empujar:** la batería
(`apps/circuit/test/model-contract/`), en verde con el simulador; 1393 pruebas; X1–X6 en rojo.
**El dueño decidió no usar la llave (2026-11-27, ADR-0015 A1):** sin corridas reales; el adaptador
se prueba solo con un transporte falso (`test/support/fake-anthropic.ts`); F3.5 sale del hito, y
nada muestra medidas del modelo como reales. **F3.2 hecha, sin empujar:** `modules/model/anthropic.ts`
(la clasificación) y `prices.ts` (Opus 5.5, con fuente y fecha); 1406 pruebas; Y1–Y7 en rojo.
**F3.3 hecha, sin empujar:** `answer` con cita, los documentos delimitados con su id y en caché,
los textos en `modules/model/prompts.ts`; 1417 pruebas; Z1–Z8 en rojo. **F3.4 hecha, sin empujar:**
`proposeCrm` con herramientas `strict` que no se ejecutan (`modules/model/crm-tools.ts`), y
`CIRCUIT_MODEL=anthropic` con `ANTHROPIC_API_KEY`, apagado (`modelFor` de `main.ts`); la batería
corre con el adaptador sobre un transporte falso (`test/support/simulated-anthropic.ts`). **F3
cumple su «terminado cuando»**: 1456 pruebas (una solo en Linux), cobertura 93,74 / 87,07 / 93,91 /
95,83; W1–W14 en rojo. **F3 cerrada e integrada a `main` el 2026-11-27** con el sí del dueño
(fast-forward de `71d0fcf` a `cf1384a`, sin commit de merge; CI en verde en la rama, corrida
46056206780, y en `main`, 46056514020). **F6 · Demostración abierta ese día en
`feat/f6-demostracion`**, que sale de `main` (`cf1384a`); su primer paso es R11 (transiciones del
tablero), antes del GIF. El README aún dice «fase F1» en su portada: F6 lo rehace.

## 3. Reglas de producto que gobiernan el código

1. Siete estaciones, en este orden: entrada, filtro, clasificación, conocimiento, CRM,
   persona, cierre. Ramas: queja o fuera de alcance salta de 3 a 6; inyección se detiene en 2.
2. Cada estación guarda un evento: estado, duración, tokens y costo.
3. Clasificación con confianza baja va a la persona.
4. El núcleo es genérico; el escenario (datos y documentos) es un paquete cambiable.

## 4. Arquitectura

Decidida en F0: ADR-0001 (el código ordena el circuito) y ADR-0003 (monolito modular con
el CRM aparte).

- `apps/circuit`: un proceso con módulos (`circuit`, `model`, `crm-client`, `approval`,
  `scenario`, `event-store`). Cada módulo se usa solo por su `index.ts`. El núcleo (`circuit`)
  declara sus puertos y no importa ningún módulo ni paquete; los demás solo importan el núcleo.
  El SDK de Anthropic solo entra en `model`. El núcleo (ADR-0010): `definition.ts` (la tabla
  `CIRCUIT`), `filter.ts` (la estación 2), `stations.ts` (1 a 5), `engine.ts` (`startRun`),
  `decision.ts` (`decideRun`: la 6 y la 7, leídas del almacén), `actions.ts`, `knowledge.ts`
  y `validate.ts`. `event-store` guarda los eventos en `circuit.runs` y
  `circuit.station_events` como `circuit_app` (`0005`, dueño `circuit_owner`); su esquema de
  drizzle está en `apps/circuit/src/modules/event-store/schema.ts`. `model` trae el simulador,
  que responde desde `scenarios/<id>/simulator.json`, y el adaptador de Anthropic (`anthropic.ts`, con
  sus textos y esquemas en `prompts.ts`, las herramientas del CRM en `crm-tools.ts` y los precios en
  `prices.ts`; lo elige `modelFor` de `main.ts` con `CIRCUIT_MODEL`); `scenario` carga los documentos. Las
  pruebas con base de circuit viven en `database/test/`, porque `apps/circuit/test` no sale de
  la app. Los casos dorados: `apps/circuit/test/golden/`, y solo `npm run golden:update` los
  reescribe.
- `apps/crm`: el CRM simulado, un proceso aparte. Circuit no importa su código; solo le
  habla por HTTP con la llave del agente, y su usuario de base no ve el esquema del CRM.
  El CRM es dueño de sus tablas (`apps/crm/src/db/schema.ts`); lo que drizzle-kit no
  expresa (roles, permisos, RLS, trigger, búsqueda de llaves) está en
  `database/migrations/0002_crm_security.sql` (ADR-0005), y el dueño sin login de todo
  `crm`, `crm_owner`, en `0004_crm_owner.sql` (ADR-0006). Su servidor (ADR-0006):
  `src/config.ts` (solo del entorno), `src/server/` (Fastify, errores, llave, límites),
  `src/routes/` (las lecturas en `reads.ts`, la exportación en `export.ts`, las escrituras y
  la bitácora en `writes.ts`, y su zod en `input.ts`), `src/db/` (la transacción de cada
  petición en `scope.ts`, las consultas en `reads.ts` y las escrituras en `writes.ts`),
  `src/keys.ts` (la forma, el generador y el hash de la llave, que comparten el servidor y el
  emisor) y `src/main.ts`. Se conecta como `crm_app`, miembro solo de `crm_service`, nunca
  como el administrador. Toda escritura nueva pasa por `withWriteScope` (ADR-0007 D4): sin
  él, la base la rechaza por falta de cuenta o de autor. Las llaves no las toca la API: las
  emite, lista y revoca `database/keys.ts` (`npm run db:keys`) como el administrador de
  `.env` (ADR-0008 D9).
- `scenarios/<id>/`: el paquete cambiable del escenario (regla 4, ADR-0009). Su parte del CRM,
  `crm.json`, es solo datos; su formato, estricto, está en `apps/crm/src/scenario.ts`, y el
  código no nombra ningún escenario: lo elige `CIRCUIT_SCENARIO`. Lo carga `database/seed.ts`
  (`npm run db:seed`) como el administrador, una vez por cuenta, y la llave del agente la
  emite con el paso de `database/keys.ts`. Respaldo y restauración: `database/backup.ts` y
  `database/restore.ts`, con las herramientas del contenedor.
- El servidor de circuit (ADR-0011): `apps/circuit/src/main.ts` (la raíz de composición) y
  `src/server/` (`server.ts`, `api.ts` con sus listas fijas de campos, `guard.ts` con el `Host` y
  las cabeceras, `board-files.ts`, y `commands.ts` con las dos rutas `POST` de ADR-0012). Lee las corridas con `PgRunReader`
  (`modules/event-store/reader.ts`), que no es un puerto del núcleo. `CRM_TOOLS` vive en
  `crm-client`. Sus pruebas con base: `database/test/circuit-server-db.test.ts`.
- `apps/board`: el tablero, servido por circuit desde `dist`. Su estado sale solo de
  `projectRun` (`src/projection.ts`); `useState`, `useReducer` y los temporizadores, solo en
  `src/use-run-events.ts` (lo vigila `test/source-rules.test.ts`); los textos, en `src/texts.ts`.
  No importa código de circuit: solo sus pruebas lo hacen (`test/support.ts`). Lo que se mira
  (ADR-0013) es el fragmento de la dirección: `src/route.ts` lo lee y lo resuelve contra la vista,
  `src/use-route.ts` lo escucha, y `components/Room.tsx` y `Portal.tsx` dibujan la sala. La
  aprobación (ADR-0012): `components/Decision.tsx` (la tarjeta de Persona), `src/correction.ts`
  (la corrección, pura) y `components/Tryout.tsx` («Probar una solicitud»); las dos órdenes las
  manda el feed de `use-run-events.ts`. La órbita en pequeño (ADR-0014) es
  `src/mark.ts`, que usan el portal y el logo (`src/logo.ts`, `components/Logo.tsx`). El dibujo
  de B1 (ADR-0014 G8): `src/shape.ts` (geometría pura), `src/scene.ts` (dónde va cada nodo,
  rótulo y telemetría, y sus `obstacles`) e `src/icons.ts`. El equipo: `src/crew-poses.ts` (las
  poses de B7), `src/crew.ts` (semilla del id) y `components/Crew.tsx`; los paneles de la
  ultraancha: `src/side-panels.ts` y `components/SidePanels.tsx`. Todo puro: lee la escena, no
  guarda nada.

Lo impone `apps/circuit/test/architecture/`: el mapa de dependencias (`module-map.ts`) y una
prueba que revisa `src/` y `test/` contra él. Para agregar una dependencia hay que cambiar
el mapa, y el cambio se ve en el diff.

## 5. Stack

TypeScript de punta a punta: Fastify, Drizzle, PostgreSQL, React, zod, Vitest, SDK de
Anthropic (apagado por defecto), Docker Compose, GitHub Actions. Terraform, por decidir:
solo validado, nunca aplicado.
Verificado en esta máquina el 2026-11-23: Node 24.20.0, npm 11.19.0, Docker 29.9.3.
**Terraform y psql no están instalados**; PostgreSQL corre en Docker.
Las dependencias entran una a una, en la fase que las necesita, con la versión verificada ese día.
En uso, verificadas en el registro de npm el 2026-11-24: TypeScript 7.0.2, Vitest 5.1.1 (trae
Vite 8.3.8) con @vitest/coverage-v8 5.1.1 (su par exacto) y @types/node 24.19.2 (la línea de Node 24, no la última); drizzle-orm 0.45.4 y
drizzle-kit 0.31.11 (la 1.0 sigue en RC), pg 8.23.1 y @types/pg 8.23.1. PostgreSQL 18.7
(`postgres:18.7-trixie`, fijada por digest; la 19.0 acababa de salir). Versiones exactas
(`save-exact` en `.npmrc`) y lockfile versionado. El `overrides` de `package.json` sube el
esbuild que drizzle-kit arrastra por `@esbuild-kit/core-utils` (0.18.20, GHSA-67mh-4wv8-2f99)
al 0.25.12 que ya usa; se quita cuando drizzle-kit suelte esa dependencia.
`apps/crm` declara las suyas (R10), verificadas el 2026-11-24: fastify 5.12.8 y zod 4.6.7,
más drizzle-orm 0.45.4 y pg 8.23.1. **Sin compilar** (ADR-0006 D1): Node 24 quita los
tipos, así que toda importación relativa termina en `.ts`, y `erasableSyntaxOnly` prohíbe
`enum`, `namespace` y las propiedades de parámetro (TS1294).
`apps/circuit` declara drizzle-orm 0.45.4 y pg 8.23.1 (ADR-0010 D18), comprobadas en el
registro el 2026-11-26, las mismas que `apps/crm`; desde F2.3a también fastify 5.12.8 y zod 4.6.7,
y desde F3.2 `@anthropic-ai/sdk` 1.14.0 (verificada el 2026-11-27; solo en `model`).
`apps/board` (ADR-0011 B12), verificadas el 2026-11-26: react y react-dom 19.3.1, @types/react
19.3.3, @types/react-dom 19.3.0, @fontsource/ibm-plex-sans y @fontsource/jetbrains-mono 5.3.0, y
vite 8.3.8 (la que trae Vitest; no la 8.4.0), sin `@vitejs/plugin-react`.
CI (`.github/workflows/ci.yml`): `ubuntu-24.04`, Node 24.20.0, actions/checkout v7.0.1 y
actions/setup-node v7.1.0 fijadas por SHA, comprobados contra sus etiquetas el 2026-11-24.

## 6. Convenciones de código

- Leer antes de cambiar; en cambios grandes, decir antes qué cambia.
- Los comentarios explican el porqué. Las constantes con nombre llevan su razón.
- Funciones < 50 líneas, archivos < 400, anidación ≤ 4.
- Nada se da por hecho si no compiló y no se probó.
- Nombres en el código en inglés (el dueño, 2026-11-24).
- Textos de interfaz, documentos y commits en español; commits convencionales (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).
- Una rama por fase (`feat/f0-base`, …); se integra a `main` solo con aprobación del dueño.

## 7. Base de datos

- Respaldo → migrar → probar → verificar. Las pruebas usan bases desechables, nunca la original.
  El respaldo es `npm run db:backup -- --label <motivo>` (R6, ADR-0009); se restaura solo con
  `npm run db:restore`, en una base nueva, nunca encima de la de desarrollo.
- La semilla escribe filas cuya bitácora no se borra nunca: antes de la primera en una base,
  un respaldo. Un paquete cambiado se siembra en una base nueva (ADR-0009 D13).
- Migraciones solo hacia adelante, en `database/migrations/`. Las filas de prueba se borran por id.
- Una migración que ya está en `database/test/migration-hashes.ts` no se edita nunca; se
  corrige con una nueva. Cada migración nueva agrega su SHA-256 a esa lista en el mismo commit.
- `database/dev/` y `database/backups/` no entran a git.
- **Toda tabla nueva de `crm` termina con `ALTER TABLE … OWNER TO crm_owner`** (y su RLS y
  sus permisos): drizzle-kit la crea con el administrador como dueño, y
  `crm-structure-db.test.ts` se pone en rojo (ADR-0006 D3).
- `crm_app` es del servidor, no de la base: lo crea `npm run db:users` (después de
  `db:migrate`), nunca una migración. Las pruebas lo crean igual, con `CRM_DB_PASSWORD` de
  `.env`, y sin ella fallan con el nombre de la variable.

## 8. Trampas

Se registran con el formato de pitfall-log: regla, síntoma, causa, chequeo y fecha.

**Entorno:**
- Windows con Git Bash: los guiones de `guards/` corren con `bash`; los archivos comparados
  byte a byte van en LF (`.gitattributes`).
- **npm y Vitest se corren en PowerShell, no en Git Bash** (2026-11-24, ampliada con la
  auditoría de ADR-0005, H14). Síntoma: `npm test` o `npx` fallan con `""node"" no se
  reconoce como un comando interno o externo`, y Node lanzado desde bash da `spawnSync
  docker ENOENT` en `compose.test.ts` y `schema-dump-db.test.ts`. Causa: bash encuentra
  `node` y `docker`, pero el PATH que reciben los procesos de Windows que lanza (cmd, node)
  no trae sus carpetas. Se vio en el Bash de Claude Code; no se ha confirmado en otra
  terminal de Git Bash. Chequeo: desde bash, `cmd //c "echo %PATH%" | tr ';' '\n' | grep -i
  'nodejs\|docker'` debe listar las dos carpetas; donde no lista ninguna, solo PowerShell.
- **`grep -c $'\r'` miente en el Bash de Claude Code** (2026-11-24). Síntoma: cuenta todas
  las líneas de cada archivo, así que todo el árbol parece CRLF. Causa: no se investigó; los
  bytes reales no tenían ningún CR. Regla: contar los CR con `tr -cd '\r' < archivo | wc -c`,
  que da 0 en LF. Chequeo: `bash guards/check-line-endings.sh …` (§9).
- **PowerShell 5.1 reescribe un binario que pasa por `>`** (2026-11-25, línea base de
  ADR-0009). Síntoma: `docker compose exec -T db cat <volcado> > archivo` sale con 0, pero de
  41 435 bytes llegan 42 466, con otro SHA-256. Causa: PowerShell 5.1 lee la salida de un
  programa como texto y la vuelve a codificar al escribirla. Regla: un binario sale del
  contenedor con `docker compose cp`, y `db:backup` compara el SHA-256 de adentro y de afuera.
  Chequeo: M3 de ADR-0009 (la copia por la salida estándar) pone en rojo `backup-db.test.ts`.
- **PowerShell 5.1 lee como ANSI un archivo UTF-8 sin BOM** (2026-11-26, enmiendas de
  ADR-0009). Síntoma: plantar un mutante a mano con `Get-Content -Raw` y restaurarlo con
  `[IO.File]::WriteAllText` dejó `Â«`, `â€¦` y `fallÃ³` en `command.ts`, y el hash no volvió.
  Causa: sin BOM, `Get-Content` de PowerShell 5.1 decodifica con la página de códigos del
  sistema; `WriteAllText` escribe UTF-8. Regla: los archivos del repositorio se leen y se
  escriben con Node (`mutants.mjs` del scratchpad), o con `-Encoding UTF8` en PowerShell, y
  todo mutante se restaura comprobando el hash. Chequeo: `git diff` del archivo da vacío.
- **Docker Desktop está instalado por usuario** (2026-11-24). Síntoma: `failed to connect
  to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine`. Causa: Docker Desktop
  apagado; el ejecutable está en `%LOCALAPPDATA%\Programs\DockerDesktop\Docker Desktop.exe`,
  no en `Program Files`. Chequeo: `docker version --format '{{.Server.Version}}'` da versión.

**Base de datos:**
- **PostgreSQL 18 cambió dónde guarda los datos** (2026-11-24). Regla: el volumen va en
  `/var/lib/postgresql`. Causa: desde la 18 la imagen usa `/var/lib/postgresql/18/docker`;
  montar el antiguo `/var/lib/postgresql/data` deja los datos en un volumen anónimo que se
  pierde al recrear. Chequeo: `docker image inspect <imagen> --format '{{json .Config.Volumes}}'`.
- **Drizzle se salta migraciones sin avisar** (2026-11-24). Síntoma: un `.sql` que no está
  en `meta/_journal.json`, o con un `when` no posterior al último aplicado, no se aplica y
  la migración «sale bien». Chequeo: `database/test/migration-files.test.ts`.
- **`npm test` necesita la base levantada** (2026-11-24). Sin ella, la prueba de base
  desechable falla con el comando para levantarla; no se salta.
- **Los roles son del servidor, no de la base** (2026-11-24). Síntoma: dos migraciones a la
  vez fallan al crear el mismo rol con `unique_violation` (no `duplicate_object`), o con
  «tuple concurrently updated» si lo alteran. Regla: crear con una guarda que atrape los dos
  códigos y comprobar los atributos sin `ALTER ROLE`. Chequeo: la carrera solo ocurre donde
  los roles aún no existen, así que la ejerce el paso «Carrera de roles en un servidor nuevo»
  de CI, antes de `db:migrate`, con `CIRCUIT_FRESH_ROLES=1` (ADR-0005, A6).
- **`drizzle-kit migrate` esconde el error de SQL** (2026-11-24, auditoría de ADR-0005, H5).
  Síntoma: `npm run db:migrate` sale con 1 y solo muestra «applying migrations...». Pasa con
  cualquier error (se reprodujo con un esquema que ya existía) y con la guarda de roles de
  `0002`. Causa: drizzle-kit 0.31.11 no imprime el error de PostgreSQL. La base queda como
  estaba, porque todo corre en una transacción. Chequeo: el error sí queda en el registro
  del servidor, `docker compose logs db --since 5m | Select-String ERROR` (CI lo muestra en
  su paso de registro).
- **`pool.end()` de pg no espera a que se cierren los sockets** (2026-11-24). Síntoma: una
  corrida con todas las pruebas en verde sale con 1 por un error no manejado `57P01
  terminating connection due to administrator command`; pasó 2 veces en 10. Causa: pg-pool
  3.14 resuelve `end()` en cuanto pide cerrar cada cliente, y el `DROP DATABASE … WITH
  (FORCE)` que sigue mata un backend que todavía se cierra. Regla: antes de borrar la base,
  esperar el evento `remove` de cada cliente (`closedClients` en `disposable-db.ts`).
  Chequeo: 20 corridas seguidas de `npx vitest run --project database`, ninguna con «Unhandled
  Errors». Ojo: ese error de pg imprime la conexión entera, contraseña incluida; en CI la
  tapa `add-mask`.
- **`search_path = ''` no basta en una función `SECURITY DEFINER`** (2026-11-24). Causa: con
  la ruta vacía, `pg_temp` se busca primero para tablas y tipos. Regla:
  `SET search_path = pg_catalog, pg_temp`. Chequeo: `crm-structure-db.test.ts` (D12).
- **Las reglas de migraciones leen también los comentarios** (2026-11-24, a propósito desde
  F0.4). Síntoma: `migration-files.test.ts` en rojo por un comentario. Regla: en un `.sql` de
  `database/migrations/` no se escriben, ni en comentarios, las órdenes de borrado ni las
  palabras sueltas `LOGIN` y `PASSWORD`. Chequeo: `migration-files.test.ts`.
- **Nunca `drizzle-kit push`** (2026-11-24). Causa: drizzle-kit no conoce los permisos, las
  políticas ni el trigger de `0002` y los borraría. No hay script `db:push`; los cambios van
  por `db:generate` y una migración.
- **`pg_dump` 18 cambia en cada corrida** (2026-11-24). Causa: pone una clave `\restrict` al
  azar y el dueño de `.env`. Regla: `--restrict-key=circuit` y `--no-owner`. Chequeo:
  `schema-dump-db.test.ts`.
- **drizzle envuelve cada error de la base** (2026-11-25, línea base de ADR-0007, F-2).
  Síntoma: el registro de un 500 dice `sqlstate: null` aunque PostgreSQL dio un código, y
  `instanceof pg.DatabaseError` da `false`. Causa: drizzle-orm 0.45.4 lanza un
  `DrizzleQueryError` cuyo mensaje lleva el SQL y sus parámetros (los valores), y deja el
  error de pg en `cause`. Una prueba que planta un `pg.DatabaseError` suelto no lo ve. Regla:
  los códigos salen de `cause` (`errorCodes`, `log.ts`); el mensaje y `String(error)` del
  envoltorio no se registran ni se responden nunca. Chequeo: «a database error wrapped by
  drizzle…» de `logging-db.test.ts`, con un error que drizzle lanza en una sentencia real.
- **PostgreSQL rechaza U+0000 en un texto** (2026-11-25, F-1 de la misma línea base).
  Síntoma: un 500 con SQLSTATE 22021 por una entrada que zod dejó pasar. Causa: `\s` no
  incluye U+0000 y `trim()` no lo quita. Un sustituto UTF-16 suelto, en cambio, no falla: se
  guarda como U+FFFD sin avisar. Regla: todo texto que llega a la base rechaza el NUL en zod.
  Chequeo: los casos «a NUL …» de `input-db.test.ts`.
- **`z.iso.date()` acepta el año 0000 y PostgreSQL no** (2026-11-25, al codificar F1.3).
  Síntoma: un `dueOn` de `0000-01-01` pasa zod y la base lo rechaza con SQLSTATE 22008, un
  500. Causa: la expresión de zod 4.6.7 es `\d{4}` para el año, y el tipo `date` no tiene
  año cero. Los días de cada mes y los bisiestos sí los valida. Regla: `dueOn` rechaza el
  año 0000 en `input.ts`. Chequeo: «dueOn as year zero…» de `write-input-db.test.ts`.
- **`pg_dump` en formato custom ignora `--no-owner`** (2026-11-25, mutantes de ADR-0009). Síntoma: M8 tal como estaba escrito (`pg_dump
  --format=custom --no-owner`) sobrevive, y la copia sale con sus dueños. Causa: con un archivo
  que no es texto, `pg_dump` deja la decisión de los dueños a `pg_restore` (la documentación
  de `-O`); `--no-acl`, en cambio, sí quita los permisos del archivo (M9 muerde). Regla: los
  dueños de una restauración se deciden en `pg_restore`. Chequeo: M8 en `pg_restore` pone en
  rojo `restore-db.test.ts`.
- **Un mutante que rompe la limpieza deja temporales en el contenedor** (2026-11-25, mutantes
  de ADR-0009). Síntoma: después de los mutantes, `/tmp` del contenedor tenía dos
  `circuit-backup-….dump` de 42 KB; las corridas normales no dejan ninguno. Causa: M2 quita el
  borrado del temporal en una corrida que falla, a propósito. Regla: después de plantar
  mutantes, `docker compose exec -T db ls -A /tmp` y borrar lo que dejaron. Chequeo: esa
  orden da una salida vacía.
- **`pg` emite `'error'` en el cliente cuando el servidor corta la sesión** (2026-11-26,
  auditoría de ADR-0009, H1). Síntoma: «Connection terminated unexpectedly» como error no
  manejado, y la vuelta de `npm run check` en 1, cuando una prueba vencida dejó su base borrarse
  con `WITH (FORCE)` bajo una semilla conectada; en la terminal, el proceso muere con una traza.
  Causa: pg 8.23 rechaza las consultas pendientes y además emite el evento
  (`_handleErrorEvent`), salvo si el cliente ya estaba terminando. Por eso un corte mientras
  espera fuera de la transacción a veces no lo muestra, y uno con el `ROLLBACK` pendiente,
  siempre. Regla: todo cliente de un comando se crea con `adminClient` (`database/command.ts`).
  Chequeo: «A1 · a seed whose session the server ends» de `seed-failure-db.test.ts`, en rojo sin
  el oyente.
- **`jsonb` no guarda el orden de las claves** (2026-11-26, D16 de ADR-0010). Síntoma: el
  caso dorado leído de `circuit.station_events` no era igual byte a byte a su `events.json`,
  con los mismos valores. Causa: `jsonb` ordena las claves a su manera (las cortas primero).
  Regla: lo que se compara byte a byte se escribe con las claves ordenadas (`serialize` del
  arnés dorado). Chequeo: `golden-db.test.ts`.
- **La intercalación del servidor pone `r` antes que `S`** (2026-11-26, en una prueba de
  ADR-0010). Síntoma: un `ORDER BY` de `relkind` dio `r` antes que `S`, y `ORDER BY 1 COLLATE
  "C"` falla con «collations are not supported by type integer». Regla: ordenar en la prueba,
  por punto de código, o con el nombre de la columna. Chequeo: «circuit_owner owns…» de
  `circuit-events-db.test.ts`.
- **`SELECT id::text … ORDER BY id` ordena como texto** (2026-11-25, en una prueba de F1.3).
  Síntoma: `'9'` antes que `'15'`. Causa: `ORDER BY` busca primero entre las columnas de
  salida, y la salida `id` ya es texto. Regla: calificar la columna (`ORDER BY tabla.id`).
  Chequeo: `idsInDatabase` de `audit-read-db.test.ts`.

**Herramientas:**
- **La herramienta Write de Claude Code convierte `\uXXXX` en el carácter** (2026-11-26, al
  escribir el filtro de ADR-0010). Síntoma: `filter.ts` no compiló («Unterminated regular
  expression») porque U+2028 quedó literal dentro de una expresión regular; en otros archivos,
  U+200B y U+00AD quedaron invisibles en el código. No pasa siempre: `'\u0000'` quedó escrito
  como escape. Un `node -e` desde el Bash de Claude Code también se come barras. Regla: después
  de escribir un archivo con escapes, buscar `[\p{Cf}\p{Zl}\p{Zp}]` con Node y volverlos escape
  con un script que no lleve `\u` en su texto; U+2028 y U+2029 se nombran `\p{Zl}` y `\p{Zp}`.
  Chequeo: ese barrido da 0 en `apps/` y `database/`.
- **`vitest --update` se come el filtro** (2026-11-24). Síntoma: `vitest run --update x`
  corre todos los archivos. Causa: `-u, --update [type]` acepta un valor y toma `x` como tal.
  Regla: el filtro va antes y el valor explícito (`--update=all`). Chequeo:
  `npm run db:dump-schema` dice «Test Files 1».
- **En Windows, un proceso terminado con `kill()` queda con `exitCode` en `null`**
  (2026-11-24). Síntoma: el `afterAll` de `main-process.test.ts` se colgaba 10 s y dejaba
  una base `circuit_test_…` sin borrar. Causa: Node pone `signalCode` en su lugar, y esperar
  `exit` de un proceso que ya salió no termina nunca. Regla: está vivo solo si `exitCode` y
  `signalCode` son `null`. Chequeo: después de `npm run check`, `SELECT datname FROM
  pg_database` no muestra ninguna `circuit_test_…`.
- **Una prueba que lanza un proceso necesita más de los 5 s por defecto** (2026-11-24).
  Síntoma: `main-process.test.ts` pasa sola y vence con `npm run check`. Causa: con todos los
  archivos a la vez y la cobertura, un Node nuevo tarda más en escuchar. Regla: esas pruebas
  llevan `PROCESS_TEST_TIMEOUT_MS`, por encima de la espera de arranque. Chequeo: `npm run
  check` en 0.
- **Un hook con base necesita más de los 10 s por defecto** (2026-11-25, auditoría de
  ADR-0007, H1). Síntoma: `npm run check` sale con 1 por `HookTimeoutError: Hook timed out
  in 10000ms` en varios archivos a la vez; sus pruebas no fallan, se saltan, y la vuelta
  siguiente sale en 0. Causa: crear la base desechable, migrarla, sembrarla y crear
  `crm_app`, con todos los archivos a la vez y la cobertura, pasó los 10 s de Vitest en la
  primera vuelta de una sesión. No se reprodujo; en caliente cabe en los 10 s. Regla: todo
  `beforeAll` y `afterAll` de una prueba con base lleva `DATABASE_HOOK_TIMEOUT_MS`
  (`database/test/disposable-db.ts`) como segundo argumento. Chequeo:
  `database/test/hook-budget.test.ts`, que un hook sin el presupuesto pone en rojo.
- **Una prueba que siembra o llama a docker necesita más de los 5 s por defecto** (2026-11-26,
  auditoría de ADR-0009, H1). Síntoma: `npm run check` salía con 1 en 2 de 5 vueltas; vencían
  D15 de `seed-db` (5 124 ms) y `schema-dump-db` (5 353 ms), que pasan solas. Causa: con todos
  los archivos a la vez, la cobertura y docker ocupado por las pruebas del respaldo. Regla: esas
  pruebas llevan `SEED_TEST_TIMEOUT_MS` o `DOCKER_TEST_TIMEOUT_MS` como último argumento.
  Chequeo: «the tests that seed or call docker» de `hook-budget.test.ts`, y 10 vueltas seguidas
  de `npm run check` en 0.
- **`--hookTimeout` en la línea de comandos no llega a los proyectos** (2026-11-25, al
  arreglar H1 de la auditoría de ADR-0007). Síntoma: `npx vitest run --hookTimeout=1` sale
  en 0 aunque un hook con base no lleve presupuesto. Causa: Vitest 5.1.1 pasa a cada
  proyecto solo las opciones de `PROJECT_CLI_OVERRIDES` (`vitest/dist/chunks/index.*.js`),
  y ahí está `testTimeout` pero no `hookTimeout`. Así que las vueltas de la auditoría con
  `--hookTimeout=5000` y `=60000` corrieron con los 10 s de siempre. Regla: no medir ni
  probar nada con `--hookTimeout`; el tiempo de un hook se fija en el código. Chequeo: M16
  de ADR-0007 (un hook sin presupuesto) sale en 0 con `--hookTimeout=1` y en 1 con
  `hook-budget.test.ts`.
- **`frameworkErrors` de Fastify no corre ningún hook** (2026-11-25, auditoría de ADR-0006,
  H1 y H2). Síntoma: sin llave, una URL con un `%` mal codificado o con un parámetro de más
  de 100 caracteres daba 400 y no 401, y no dejaba línea de registro. Causa: Fastify 5.12
  responde esas peticiones desde `frameworkErrors`, antes del enrutador, sin `onRequest` ni
  `onResponse` y con `reply.elapsedTime` en 0. Regla: lo que vale para toda petición (la
  llave primero, la línea de registro) se repite en `answerUnroutable` de `server.ts`.
  Chequeo: «the key comes before a URL the router cannot read» de `input-db.test.ts` y la
  prueba de la URL ilegible de `logging-db.test.ts`.
- **En git, el `*` de una ruta cruza `/`** (2026-11-25, al aceptar ADR-0009). Síntoma:
  `git grep … -- 'database/*.ts'` lee también los 17 archivos de `database/test/`, y
  `'apps/*/src'` no casa con ningún archivo, así que un chequeo con esas rutas pasa sin leer
  lo que dice. Causa: sin `:(glob)`, git compara la ruta entera con `fnmatch` sin
  `FNM_PATHNAME`. Regla: toda ruta con comodines de un chequeo va con `:(glob)`
  (`':(glob)database/*.ts'`, `':(glob)apps/*/src/**'`). Chequeo: `git ls-files 'apps/*/src' |
  wc -l` da 0 y `git ls-files ':(glob)apps/*/src/**' | wc -l` da los archivos.
- **En Windows, `git worktree remove --force` sigue una junction** (2026-11-25, auditoría de
  ADR-0008). Síntoma: al quitar un worktree desechable cuyo `node_modules` era una junction
  al del clon, se borraron el `node_modules` del clon y 57 archivos versionados de `apps/`.
  Causa: git entra en la junction y borra lo que hay detrás, y los workspaces de npm enlazan
  `node_modules/@circuit/crm` con `apps/crm` y `@circuit/circuit` con `apps/circuit`. Se
  reparó con `git restore --source=HEAD -- apps/` y `npm ci`. Regla: un worktree corre su
  propio `npm ci` y nunca recibe un enlace al clon. Chequeo: `git status --short` del clon da
  lo mismo antes y después de quitar el worktree.
- **Chrome sin ventana se cuelga si ya hay un Chrome abierto, o si el mismo proceso sirve la
  página** (2026-11-26, `board:shots`). Síntoma: `--screenshot` no termina y no deja archivo.
  Causa: sin `--user-data-dir`, Chrome le entrega la orden a la instancia abierta; y
  `execFileSync` bloquea el proceso de Node que es el servidor que Chrome lee. Regla: perfil
  propio y `execFile` asíncrono con `timeout`. Chequeo: `npm run board:shots` deja 28 archivos.
- **Fastify 5.12 deprecó `disableRequestLogging`** (2026-11-24). Con `logger: false` no hace
  falta: no hay registrador que escriba esas líneas. Chequeo: las pruebas no muestran
  `FSTDEP023`.

## 9. Comandos

Verificados el 2026-11-23 contra violaciones plantadas:

```sh
bash guards/check-forbidden-phrases.sh forbidden-phrases.txt README.md   # 0 limpio, 1 hallazgo, 2 nada revisado
bash guards/run-checked.sh -- <comando>                                   # código de salida real
```

Verificados el 2026-11-24 en PowerShell, contra un error de tipos plantado en cada app y la
prueba de control invertida:

```powershell
npm ci              # instala exactamente lo del lockfile
npm run typecheck   # tipos de la raíz y de cada app: 0 limpio, 1 error
npm test            # Vitest, un proyecto por app
npm run check       # tipos y pruebas con cobertura (CI corre además las guardas, la instalación, la auditoría, la base y las migraciones)
$env:CIRCUIT_INVERT_CONTROL='1'; npm test; echo $LASTEXITCODE; Remove-Item Env:CIRCUIT_INVERT_CONTROL   # control positivo: debe dar 1
Set-Content apps\circuit\src\modules\circuit\planted.ts "import '@anthropic-ai/sdk';"; npm test; echo $LASTEXITCODE; Remove-Item apps\circuit\src\modules\circuit\planted.ts   # arquitectura: debe dar 1
```

Verificados el 2026-11-24 en PowerShell, con seis violaciones plantadas (puerto en todas las
interfaces, imagen sin digest, `.sql` fuera del journal, `DROP`, SQL roto y un esquema que
falta), cada una en rojo en su prueba:

```powershell
Copy-Item .env.example .env                       # y poner POSTGRES_PASSWORD y CRM_DB_PASSWORD (sin BOM)
docker compose up -d --wait db                    # PostgreSQL 18.7 en 127.0.0.1, espera a que esté sano
npm run db:migrate                                # aplica las migraciones pendientes a la base de desarrollo
npm run db:generate -- --name <nombre>            # escribe una migración desde database/schema.ts
npx vitest run --project database                 # solo las pruebas de la base y de Compose
docker compose stop db                            # detiene la base y conserva el volumen
```

Verificados el 2026-11-24 (F0.5, con las enmiendas de la auditoría). La guarda de secretos,
contra 25 casos plantados y 16 mutantes de sí misma, todos en rojo; la cobertura, contra un
archivo sin pruebas plantado en `apps/circuit/src`, que la bajó a 65,62 % y la hizo salir
con 1. Son los pasos de CI, más el `--range` que va antes de cada push (R9):

```sh
bash guards/check-secrets.test.sh                 # controles positivos de la guarda: 0 si los 33 casos pasan (unos 40 s en Windows)
bash guards/check-secrets.sh                      # lo versionado, lo nuevo sin ignorar y el índice: 0 limpio, 1 hallazgo, 2 nada revisado
bash guards/check-secrets.sh --range origin/feat/f0-base..HEAD   # los archivos y el mensaje de cada commit que se va a publicar (antes del push; CI no lo corre)
bash guards/check-line-endings.sh '*.sh' '*.json' '*.sql' 'guards/hooks/*' 'database/examples/**' '**/golden/**'
bash guards/check-forbidden-phrases.sh forbidden-phrases.txt README.md apps database
```

Verificados el 2026-11-24, el hook de `pre-push` (R9) contra 10 empujes reales a un remoto
desechable y 7 mutantes de sí mismo, todos en rojo. Corre solo en cada `git push`; nunca
pregunta nada y para el push solo con un hallazgo (1) o si no pudo revisar (2):

```sh
git config core.hooksPath guards/hooks   # lo activa en este clon (desactivar: git config --unset core.hooksPath)
bash guards/pre-push.test.sh             # sus controles positivos: 0 si los 11 casos pasan (unos 25 s en Windows)
```

Sin el hook, o para revisar a mano, verificados el 2026-11-24 antes y después del primer
push (R9 a mano y C15). La lista
privada se probó con una de sus frases plantada en una copia del rango: salió con 1.

```sh
git ls-files -z | xargs -0 bash guards/check-forbidden-phrases.sh forbidden-phrases.local.txt   # lista privada sobre lo versionado
git log -p --format='%an %ae%n%B' origin/feat/f0-base..HEAD > /tmp/rango.patch && bash guards/check-forbidden-phrases.sh forbidden-phrases.local.txt /tmp/rango.patch   # sobre cada diff, mensaje y autor que se publica
gh run list --branch feat/f0-base --limit 3 --json databaseId,status,conclusion,headSha   # sin --workflow: falla mientras ci.yml no esté en main
gh run watch <id> --exit-status   # 0 en verde, 1 en rojo
```

```powershell
npm audit --audit-level=low   # 0 sin vulnerabilidades conocidas (no se probó con una plantada)
npm run test:coverage         # pruebas con cobertura: bajo el piso de 80 sale con 1
```

Verificados el 2026-11-24 en PowerShell (F1.1), con doce mutantes plantados en las
migraciones y una columna plantada en `database/schema.sql`, cada uno en rojo:

```powershell
npx vitest run --project database crm             # el esquema crm: estructura (D1–D13) y reglas como conducta
npm run db:dump-schema                            # regenera database/schema.sql desde una base desechable recién migrada (R8)
```

Verificados el 2026-11-24 en PowerShell (arreglos de la auditoría de ADR-0005), con 13
mutantes en las migraciones y M21 en tres servidores nuevos, cada uno en rojo en su prueba.
El paso de la carrera corre así en CI, en un servidor sin los roles. Con
`$env:CIRCUIT_FRESH_ROLES='1'` sobre tu base de desarrollo sale con 1 a propósito, porque
allí los roles ya existen; para ejercerla en local, ver ADR-0005, A6:

```powershell
npx vitest run --project database migrations-db -t "two disposable databases"   # la carrera de roles de D14 (el paso de CI, antes de db:migrate)
npx vitest run --project database migration-files                                # el hash de cada migración, contra database/test/migration-hashes.ts
```

Verificados el 2026-11-24 en PowerShell (F1.2, ADR-0006), con 16 mutantes (M1–M13, M11b,
M14 y una variante de M5 sin la guarda) y un `enum` plantado, cada uno en rojo. Las pruebas
de `crm_app` y del CRM necesitan `CRM_DB_PASSWORD` en `.env`:

```powershell
npm run db:users                                  # crea o actualiza crm_app (después de db:migrate): 0 listo, 1 con el motivo
npx vitest run --project database crm-login-db    # crm_app: su contraseña, sus atributos y las reglas de ADR-0005 como crm_app
npx vitest run --project '@circuit/crm'           # la API: configuración, rutas, llave, cuenta, lectura, entrada, registro y proceso
npm run crm:start                                 # el CRM en http://127.0.0.1:4010; Ctrl+C lo detiene
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4010/health   # 200 {"status":"ok"}; una ruta sin llave da 401
```

```sh
git grep -nE "from '\.\.?/[^']*\.js'" -- '*.ts' | wc -l              # D1: 0 importaciones .js
git ls-files '*.ts' | xargs wc -l | awk '$1 > 400 && $2 != "total"'   # D17: ninguna línea
```

Verificados el 2026-11-25 en PowerShell (F1.3, ADR-0007), con los 14 mutantes de la ADR
(M1–M14), cada uno en rojo en su prueba y restaurado por hash:

```powershell
npx vitest run --project '@circuit/crm' write audit-read errors   # F1.3: 8 archivos, 103 pruebas (permiso, contexto, entrada, referencias, SQL, bitácora)
```

Verificados el 2026-11-25 en PowerShell (enmiendas A1–A4 de ADR-0007), con M15, M16 y M16b,
cada uno en rojo en su prueba y restaurado por hash:

```powershell
npx vitest run --project database hook-budget    # A4: cada hook con base lleva DATABASE_HOOK_TIMEOUT_MS
npx vitest run --project '@circuit/crm' write-refs   # A3: la precedencia del PATCH y la sonda P4
```

```sh
git diff --exit-code 5bdbf68 -- database/migrations database/test/migration-hashes.ts database/schema.sql apps/crm/src/db/schema.ts   # D14: 0
git diff --exit-code 5bdbf68 -- package-lock.json   # D15: 0
```

Verificados el 2026-11-25 en PowerShell (F1.4, ADR-0008), con M1–M15 de la ADR, cada uno en
rojo en su prueba y restaurado por hash. Contra la base de desarrollo, que aún no tiene
cuentas, solo se corrieron el uso y `list`:

```powershell
npx vitest run --project '@circuit/crm' keys export agent-key key-format routes   # F1.4: 8 archivos, 63 pruebas (forma, emisor, exportar, los tres «no» y las rutas)
npm run db:keys                                       # sin orden: 1 y el uso, sin conectarse
npm run db:keys -- list --account <cuenta>            # id, etiqueta, permisos y fechas, nunca el hash; hoy 1 y «No existe la cuenta»
npm run db:keys -- issue --account <cuenta> --label <etiqueta> --permissions read,write   # la llave, una sola vez; toda llave lleva read
npm run db:keys -- revoke --id <id>                   # definitivo: desde la petición siguiente, 401
```

```sh
bash guards/check-secrets.test.sh                     # D15: 0 si los 31 casos pasan, la llave crmk_ entre ellos
git diff --exit-code 6e8f445 -- database/migrations database/test/migration-hashes.ts database/schema.sql apps/crm/src/db/schema.ts package-lock.json   # D16: 0
git grep -n "test-key-" -- apps/crm/test database/test | wc -l   # D14: 0
git grep -n "read-scope" -- '*.ts' | wc -l                       # D18: 0
```

Verificados el 2026-11-25 (enmiendas A1–A2 de ADR-0008). Cada mutante quedó en rojo en su
prueba y se restauró por hash: X1, X4 y X4b en `database/keys.ts`, y tres de la guarda (sin
la llamada, sin el `cut` y sin el filtro de rutas).

```powershell
npx vitest run --project '@circuit/crm' keys-db keys-command   # A1: 2 archivos, 31 pruebas; ningún error de db:keys muestra el hash ni su mensaje
```

```sh
bash guards/check-secrets.test.sh            # A2: 0 si los 31 casos pasan, una llave en un mensaje entre ellos
bash guards/pre-push.test.sh                 # A2: 0 si los 11 casos pasan
bash guards/check-secrets.sh --range HEAD    # A2: los archivos y el mensaje de cada commit de la historia: 0 (50 commits, unos 2 min)
```

Verificados el 2026-11-25 en PowerShell (R6 y F1.5, ADR-0009), con M1–M22 de la ADR, cada uno
en rojo en su prueba y restaurado por hash (M8 en `pg_restore`), y D26 sobre la base de
desarrollo. `db:seed` necesita `CIRCUIT_SCENARIO` y `CRM_AGENT_KEY_FILE` en `.env` (las trae
`.env.example`) o en el entorno:

```powershell
npx vitest run --project database backup restore         # D1–D6: 4 archivos, 37 pruebas
npx vitest run --project database scenario seed          # D7–D21 y D25: 6 archivos, 105 pruebas (una solo en Linux)
npx vitest run --project '@circuit/crm' seed-agent-key   # D22 y D13 después de una escritura por la API: 5 pruebas
npm run db:backup -- --label <motivo>                    # 0: database/backups/<AAAAMMDD-HHMMSS>Z-<motivo>/ con circuit.dump y su .sha256
npm run db:restore -- --file database\backups\<carpeta>\circuit.dump --into <base nueva>   # 0; 1 si la base existe, sin tocarla
npm run db:seed                                          # 0: «sembrada» o «ya estaba» por cuenta, y la ruta de la llave, nunca la llave
"DROP DATABASE <base de verificación>;" | docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d postgres'   # borra a mano una restauración de prueba
docker compose exec -T db ls -A /tmp                     # vacío: ningún temporal de db:backup ni de db:restore
```

```sh
git check-ignore -q .secrets/crm-agent-key; echo $?      # D21: 0
git grep -n -E "DROP DATABASE|RENAME TO" -- ':(glob)database/*.ts'   # D4: solo la línea de restore.ts
git diff --exit-code 52e015d -- database/migrations database/test/migration-hashes.ts database/schema.sql apps/crm/src/db/schema.ts package-lock.json compose.yaml   # D23: 0
bash guards/check-secrets.test.sh                        # D21: 0 si los 33 casos pasan
```

Verificados el 2026-11-26 en PowerShell (enmiendas A1–A7 de ADR-0009), con el mutante de cada
una en rojo en su prueba y restaurado por hash:

```powershell
npx vitest run --project database hook-budget seed-failure   # A1: el presupuesto de cada prueba pesada y la sesión cortada (2 archivos, 8 pruebas)
npx vitest run --project database scenario seed              # A2–A7: 7 archivos, 124 pruebas (una solo en Linux)
Get-ChildItem $env:TEMP -Directory -Filter 'circuit-*'      # A6: ninguna, después de npm run check
```

Verificados el 2026-11-26 en PowerShell (F2.1 y F2.2, ADR-0010), con M1–M11, MU1, MU2 y M20,
cada uno en rojo en su prueba y restaurado por hash. Las pruebas de D10, D11 y D16 necesitan
`CIRCUIT_DB_PASSWORD` en `.env`:

```powershell
npx vitest run --project '@circuit/circuit'                    # el núcleo, el simulador y los casos dorados (11 archivos)
npx vitest run --project database circuit-events circuit-login event-store golden-db   # D10, D11 y D16, como circuit_app
npm run golden:update                                          # reescribe los cuatro events.json; leer el diff antes del commit
npm run db:users                                               # crm_app y circuit_app en una transacción; sin CIRCUIT_DB_PASSWORD, 1 y su nombre
```

```sh
git grep -nE "Math\.random|Date\.now|new Date|randomUUID|randomBytes" -- ':(glob)apps/circuit/src/modules/model/**' | wc -l   # D12: 0
git grep -n "writeFile" -- apps/circuit/test/golden.test.ts | wc -l                                                          # D15 (M12): 0
git diff --exit-code 8edc7d8 -- apps/crm database/migrations/0000_init.sql database/migrations/0001_crm_tables.sql database/migrations/0002_crm_security.sql database/migrations/0003_audit_author_format.sql database/migrations/0004_crm_owner.sql   # D19: 0
```

Verificados el 2026-11-26 en PowerShell (F2.3a, ADR-0011), con M1–M6, cada uno en rojo en su
prueba y restaurado por hash:

```powershell
npx vitest run --project '@circuit/board'                        # B1–B3, B8, B9: proyección, marcado, textos, revelado y las reglas del código
npx vitest run --project '@circuit/circuit' server config        # B5–B8, B13 en memoria
npx vitest run --project database circuit-server                 # B4, B5, B13 sobre PostgreSQL, y el arranque
npm run board:build                                              # apps/board/dist
npm run circuit:start                                            # http://127.0.0.1:4020; Ctrl+C lo detiene
npm run board:shots                                              # B10: 28 capturas en .shots/ (git las ignora)
```

Verificados el 2026-11-26 en PowerShell (F2.3b, ADR-0013), con M1–M3, cada uno en rojo en su
prueba y restaurado por hash:

```powershell
npx vitest run --project '@circuit/board' route room-render source-rules   # E1–E6: la ruta, las salas y el corte de movimiento
node apps/circuit/test/shots/board-shots.ts sala-clasificacion sala-accion # solo algunas capturas (después de board:build)
```

Verificados el 2026-11-27 en PowerShell (el logo de F2.3c, ADR-0014), con M1–M5, cada uno en
rojo en su prueba y restaurado por hash:

```powershell
npx vitest run --project '@circuit/board' logo favicon   # G1–G3: la geometría de §12, una sola función con el portal y el ícono
npm run board:favicon                                    # reescribe apps/board/public/favicon.svg desde <Logo>; leer el diff
```

Verificados el 2026-11-27 en PowerShell (F2.4, ADR-0012), con M1–M7 y D1–D4, cada uno en rojo
en su prueba y restaurado por hash, y el flujo real sobre la base de desarrollo:

```powershell
npx vitest run --project '@circuit/circuit' approval apply-without-approval crm-client server-decision tryouts   # A1, A2, A4, A5, A6, A8, A9, A12
npx vitest run --project database apply-once apply-crm-e2e circuit-events   # A4 sobre PostgreSQL, A3 y A10 con el CRM real como proceso
npx vitest run --project '@circuit/board' decision-render feed room-render  # la tarjeta de Persona, la corrección y «Probar una solicitud»
npm run crm:start; npm run circuit:start   # en dos terminales; circuit necesita CIRCUIT_SCENARIO y CRM_AGENT_KEY_FILE en .env
```

```sh
grep -rn "as Approval" apps/circuit/src   # A1: una sola línea, la de approvalFrom
git diff --exit-code 4988600 -- apps/crm database/migrations/0000_init.sql database/migrations/0005_circuit_events.sql   # A11: 0
```

Verificados el 2026-11-27 en PowerShell (G8, G4 y G5 de ADR-0014), con N1–N3, C1–C4 y P1–P5,
cada uno en rojo en su prueba y restaurado por hash:

```powershell
npx vitest run --project '@circuit/board' scene crew panels-render   # el dibujo de B1, el equipo y los paneles: 3 archivos
node apps/circuit/test/shots/board-shots.ts normal espera inyeccion  # solo esas capturas (después de board:build)
```

Verificados el 2026-11-27 en PowerShell (F3.1, ADR-0015), con X1–X6 en el simulador, cada uno en
rojo en la batería y restaurado por hash:

```powershell
npx vitest run --project '@circuit/circuit' simulator-contract   # K1–K6: la batería de contrato del modelo, con el simulador (15 pruebas)
npx vitest run --project '@circuit/circuit' anthropic-model      # F3.2: el adaptador sobre el transporte falso, sin red (13 pruebas; Y1–Y7 en rojo)
npx vitest run --project '@circuit/circuit' anthropic-answer     # F3.3: el conocimiento con cita y la estación 4 en el motor (10 pruebas; Z1–Z8 en rojo)
npx vitest run --project '@circuit/circuit' anthropic-crm anthropic-contract model-choice   # F3.4: herramientas, la batería con el adaptador y CIRCUIT_MODEL (W1–W14 en rojo)
```

## 10. Dónde está todo lo demás

| Archivo | Qué guarda |
|---|---|
| `docs/privado/propuesta.md` | El porqué, el escenario y la cobertura de la vacante (local) |
| `DEVELOPMENT_PLAN.md` | Las fases, en orden, y su estado |
| `docs/adr/` | Decisiones de arquitectura |
| `database/` | Migraciones, esquema legible, conexión y sus pruebas |
| `.env.example` | Las variables locales, sin la contraseña |
| `guards/` | Guardas: frases prohibidas, finales de línea, código de salida |
| `forbidden-phrases.txt` | Lo que Circuit nunca dice (pública, en CI) |
| `forbidden-phrases.local.txt` | Nombres privados; fuera de git, se corre antes de cada push |
| `.coderachnid/HANDOFF.md` | Relevo entre sesiones (local) |

---

### Cómo termina cada respuesta

Toda respuesta de desarrollo cierra con el bloque de cinco puntos: siguiente fase · claves ·
cuidados · pruebas recomendadas · implementación recomendada. Desde el 2026-11-26 la
implementación recomendada nunca nombra `/coderachnid:adr-guard` (§1b).
