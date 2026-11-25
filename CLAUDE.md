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
- **Secretos** solo en variables de entorno; nunca en el repositorio ni en el estado de Terraform versionado.
- **Datos sintéticos.** Ni marca, ni logo, ni datos de la empresa de la vacante; ni nombres
  ni análisis de terceros estudiados fuera de Circuit. `docs/privado/` no entra a git.
- **Inspirar, no copiar:** ningún nombre, personaje, logo, música ni imagen de terceros en el
  producto; las referencias de tono solo guían el diseño.
- **Honestidad:** no se inventa experiencia del autor; `forbidden-phrases.txt` lo vigila.
- **Reproducible:** la misma entrada con el simulador y la misma versión da la misma salida.
- **Local, sin llave:** quien clone el repositorio levanta todo con un comando y ve el
  circuito con el simulador o con corridas reales grabadas. No hay despliegue en la nube.
- **Alcance congelado** hasta la primera entrega (F0–F3 y F6), ver `DEVELOPMENT_PLAN.md`.

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
**F1.4 (llaves con alcance), abierta el 2026-11-25:** ADR-0008 **aceptada** ese día (el
dueño aceptó sus nueve recomendaciones), con su línea base
(`docs/reviews/ADR-0008-baseline.md`, sobre `6e8f445`: 417 pruebas, todo en 0). **H4 (D18)
hecha en un commit propio (`7b60367`), sin empujar:** `read-scope.ts` → `scope.ts` y
`apps/crm/src/keys.ts`, con 417 pruebas y los mismos conteos por archivo. **D1–D3 y D14
hechas, sin empujar:** la forma `crmk_` (`API_KEY_SHAPE`, con la última letra canónica), el
generador y `hashApiKey` en `keys.ts`; `presentedKey` rechaza otra forma sin tomar conexión;
toda llave de prueba sale de `testApiKey` (`crm-fixture.ts`). 433 pruebas, `npm run check`
en 0, M1–M4 en rojo (`d24ed3a`). **El emisor (D4–D9, D19), en su commit, sin empujar:**
`database/keys.ts` y `npm run db:keys -- issue | list | revoke`; 463 pruebas, `npm run check`
en 0, M5–M11 en rojo (`eeb8ce6`). **Exportar y los tres «no» (D10–D13), en su commit, sin empujar:**
`GET /accounts/:slug/export` con `export` (`routes/export.ts`) y `agent-key-db.test.ts`;
477 pruebas, `npm run check` en 0, M12–M14 en rojo (`501445b`). **La regla `crm-api-key`
de la guarda (D15), en su commit, sin empujar:** 28 casos en `check-secrets.test.sh`, M15 en rojo. Decide llaves `crmk_` de 256 bits, el emisor `npm run db:keys` (emitir, listar, revocar) como administrador, toda llave
emitida con `read` (H2 hecha regla), `GET /accounts/:slug/export` con `export`, la regla de
la guarda de secretos y H4 (`read-scope.ts` → `scope.ts`). Pedido al dueño, como insumo de
F2: el material del programa que citará la estación 4.

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
  `scenario`). Cada módulo se usa solo por su `index.ts`. El núcleo (`circuit`) declara sus
  puertos y no importa ningún módulo ni paquete; los demás solo importan el núcleo. El SDK
  de Anthropic solo entra en `model`.
- `apps/crm`: el CRM simulado, un proceso aparte. Circuit no importa su código; solo le
  habla por HTTP con la llave del agente, y su usuario de base no ve el esquema del CRM.
  El CRM es dueño de sus tablas (`apps/crm/src/db/schema.ts`); lo que drizzle-kit no
  expresa (roles, permisos, RLS, trigger, búsqueda de llaves) está en
  `database/migrations/0002_crm_security.sql` (ADR-0005), y el dueño sin login de todo
  `crm`, `crm_owner`, en `0004_crm_owner.sql` (ADR-0006). Su servidor (ADR-0006):
  `src/config.ts` (solo del entorno), `src/server/` (Fastify, errores, llave, límites),
  `src/routes/` (las lecturas en `reads.ts`, las escrituras y la bitácora en `writes.ts`, y
  su zod en `input.ts`), `src/db/` (la transacción de cada petición en `scope.ts`, las
  consultas en `reads.ts` y las escrituras en `writes.ts`) y `src/main.ts`. Se conecta como
  `crm_app`, miembro solo de `crm_service`, nunca como el administrador. Toda escritura
  nueva pasa por `withWriteScope` (ADR-0007 D4): sin él, la base la rechaza por falta de
  cuenta o de autor.
- `apps/board`: el tablero, servido por circuit (llega en F2).

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
- **`SELECT id::text … ORDER BY id` ordena como texto** (2026-11-25, en una prueba de F1.3).
  Síntoma: `'9'` antes que `'15'`. Causa: `ORDER BY` busca primero entre las columnas de
  salida, y la salida `id` ya es texto. Regla: calificar la columna (`ORDER BY tabla.id`).
  Chequeo: `idsInDatabase` de `audit-read-db.test.ts`.

**Herramientas:**
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
bash guards/check-secrets.test.sh                 # controles positivos de la guarda: 0 si los 28 casos pasan (unos 40 s en Windows)
bash guards/check-secrets.sh                      # lo versionado, lo nuevo sin ignorar y el índice: 0 limpio, 1 hallazgo, 2 nada revisado
bash guards/check-secrets.sh --range origin/feat/f0-base..HEAD   # cada commit que se va a publicar (antes del push; CI no lo corre)
bash guards/check-line-endings.sh '*.sh' '*.json' '*.sql' 'guards/hooks/*' 'database/examples/**' '**/golden/**'
bash guards/check-forbidden-phrases.sh forbidden-phrases.txt README.md apps database
```

Verificados el 2026-11-24, el hook de `pre-push` (R9) contra 10 empujes reales a un remoto
desechable y 7 mutantes de sí mismo, todos en rojo. Corre solo en cada `git push`; nunca
pregunta nada y para el push solo con un hallazgo (1) o si no pudo revisar (2):

```sh
git config core.hooksPath guards/hooks   # lo activa en este clon (desactivar: git config --unset core.hooksPath)
bash guards/pre-push.test.sh             # sus controles positivos: 0 si los 10 casos pasan (unos 25 s en Windows)
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
cuidados · pruebas recomendadas · implementación recomendada. Si el trabajo tocó
autenticación, dinero, datos personales, un esquema, una API pública, seguridad o código que
va a otra persona, y no hay auditoría registrada, la implementación recomendada nombra el
comando `/coderachnid:adr-guard`.
