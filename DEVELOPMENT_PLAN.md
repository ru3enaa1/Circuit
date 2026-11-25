# Circuit — plan de desarrollo

> La guía de trabajo. Se sigue **en orden**. Cada fase dice qué la desbloquea, qué entrega,
> cómo saber que terminó y qué trampas la esperan. Si no está en este plan, no está decidido.

## 0. Cómo usar este documento

- **Antes de una fase:** leer su sección y el código existente, decir qué falta y qué cambia,
  y acordarlo con el dueño **antes** de escribir código.
- **Dentro de una fase:** se trabaja por subpasos. Cada uno termina con una prueba que el
  dueño corre en minutos, y se avanza solo cuando el dueño la confirma.
- **Insumos con un paso de adelanto:** lo que un subpaso necesita (datos, textos, bocetos)
  se pide en el subpaso anterior.
- **Ramas:** una por fase (`feat/f0-base`, `feat/f1-crm`, …), con commits convencionales en
  español (`feat:`, `fix:`, `test:`, `docs:`, `chore:`). Se integra a `main` solo con la
  aprobación del dueño.
- **Al cerrar una fase:** correr la definición de terminado, escribir su línea de estado
  (fecha, rama, número de pruebas, veredicto), actualizar «Dónde estamos» en `CLAUDE.md` y
  revisar que nada anuncie como pendiente algo que ya existe.
- **Cambios de alcance:** son decisiones. Van en una ADR con fecha y razón, y luego aquí.

## 1. Meta y alcance congelado

**Hito (primera entrega):** demostración **local** que se levanta con un comando, más un
paquete corto para captar atención (visuales y tres líneas) que lleva al repositorio, donde
está la profundidad. Una solicitud recorre las siete estaciones en el mapa, contra el CRM
simulado, con un mentor que aprueba y **corridas reales del modelo grabadas**. Sin
despliegue en la nube ni uso como producción (ADR-0002). Sin fecha fija: se entrega cuando
muestre valor real.

**En alcance:** F0, F1, F2, F3 y F6, en ese orden.

**Fuera de alcance hasta el hito:** F4 (defensas avanzadas y evaluaciones con juez), F5
(medida y optimización de costo), F7 (servidor MCP), voz, CRM reales, despliegue en la nube
y cualquier enlace público a la aplicación.

## 2. Descubrimiento: aplazado, con lo que sigue sin probar

Circuit es ante todo una pieza de portafolio, así que se construye sin la cadena de
descubrimiento (mercado, oferta, PRD). Lo que eso deja sin probar se dice:

| Afirmación | Estado | Cómo se probaría |
|---|---|---|
| A quien evalúa la vacante le basta un GIF y tres líneas para abrir el repositorio | Sin probar | La respuesta a la aplicación |
| El valor para el participante, el mentor y la escuela | Hipótesis deducida del texto de la vacante | Conversación con quien publicó la vacante |
| Empresas con CRM pagarían por un agente con mapa y aprobación | Hipótesis sin cliente; no define el alcance | Investigación de mercado después del hito |

## 3. Fases

### F0 · Base

- **Lo desbloquea:** nada (primera fase).
- **Entrega:** monorepo TypeScript con pruebas, prueba de arquitectura, umbral de
  cobertura, PostgreSQL en Docker con migraciones, guardas, integración continua y los
  comandos reales en `CLAUDE.md`.
- **Subpasos:**

  | # | Qué | Prueba del dueño |
  |---|---|---|
  | F0.1 | Primer commit en `main`, remoto conectado, rama `feat/f0-base` | `git log --oneline; git branch -vv` |
  | F0.2 | Monorepo con npm workspaces, TypeScript estricto y Vitest, con una prueba de control positivo. Los módulos y sus dependencias permitidas van en una ADR | `npm test; echo $?` da 0, y da 1 con la prueba de control invertida |
  | F0.3 | Prueba de arquitectura: el núcleo no importa adaptadores ni el SDK de Anthropic (ADR-0001 D2) | Una importación plantada en el núcleo hace fallar `npm test` |
  | F0.4 | PostgreSQL en Docker Compose, publicado solo en `127.0.0.1`; Drizzle y una migración inicial probada contra una base desechable | `docker compose up -d --wait db; npm run db:migrate; npm test; echo $LASTEXITCODE` |
  | F0.5 | GitHub Actions: tipos, pruebas con cobertura, frases prohibidas sobre el README y las apps, finales de línea y patrones de secretos | La rama en verde; una frase plantada la pone en rojo |
  | F0.6 | README mínimo (solo lo que existe), comandos verificados en `CLAUDE.md`. Se piden los insumos de F1: nombre de la escuela inventada, programas y etapas del CRM | Seguir el README en una terminal limpia |

- **Terminado cuando:** la construcción completa sale con 0 en local y en CI; las pruebas
  de arquitectura y de migración existen y fallan contra una violación plantada.
- **Seguridad:** secretos solo en `.env` (ignorado) con un `.env.example` sin valores; la
  base escucha solo en `127.0.0.1`; dependencias fijadas con lockfile y `npm audit` en CI.
- **Trampas:** CRLF en Windows en archivos comparados byte a byte; códigos de salida
  tapados por tuberías (`guards/run-checked.sh`); Docker Desktop apagado; mezcla de ESM y
  CommonJS en TypeScript; versión del proveedor de cobertura distinta de la de Vitest;
  npm lanzado desde Git Bash (ver `CLAUDE.md`, sección 8); un lockfile hecho en Windows sin
  los binarios nativos de Linux (TypeScript 7, rolldown, lightningcss, esbuild), que rompe
  `npm ci` en CI y en Docker. El 2026-11-24 el lockfile sí los traía. La imagen de
  PostgreSQL 18 guarda los datos en otra ruta, y Drizzle se salta sin avisar un `.sql` que
  no está en el journal (ver `CLAUDE.md`, sección 8).
- **Estado:** **cerrada e integrada a `main` el 2026-11-24**, con el sí del dueño: rama
  `feat/f0-base`, 76 pruebas, cobertura 92 / 92,3 / 100 / 91,3, `npm run check` en 0 en
  local; veredicto: terminada. `main` avanzó por fast-forward a `4b79aa3` (el mismo SHA que
  CI verificó, sin commit de merge): CI en verde en la rama (corrida 45459976606, donde
  GitHub aceptó el `ci.yml` de F0.6 y «Registro de PostgreSQL» salió `skipped`) y en `main`
  (45460157418). La historia de los subpasos sigue.
  F0.1 cerrado el 2026-11-23. F0.2 cerrado el
  2026-11-24, con la ADR-0003 aceptada (opción 4). F0.3 cerrado el 2026-11-24 con la
  confirmación del dueño: 33 pruebas, cuatro violaciones plantadas en el árbol real y dos
  mutantes del verificador, todos en rojo. F0.4 cerrado el 2026-11-24 con la confirmación
  del dueño: 76 pruebas; seis violaciones plantadas, cada una en rojo en su prueba, y
  ninguna base desechable sobrante. Sin auditoría de `adr-guard` (el dueño hizo el commit
  sin ella). F0.5 cerrado el 2026-11-24, con el push aprobado por el dueño: cobertura con
  piso de 80 en las cuatro medidas (confirmado por el dueño), `guards/check-secrets.sh` y
  `.github/workflows/ci.yml` con los mismos comandos que en local. ADR-0004, retroactiva,
  aceptada y auditada el mismo día (`docs/reviews/ADR-0004-audit-2026-11-24.md`): APROBAR
  CON CONDICIONES. H1–H5 resueltos y la ADR enmendada (la guarda revisa el índice, la forma
  YAML y cada commit con `--range`; 25 casos y 16 mutantes en rojo). H6 queda para F2
  (cobertura de `.tsx`) y H8 para F3 (binarios). C15 verificado en GitHub: la corrida
  45448819374 en verde (14 pasos, 76 pruebas, cobertura 92 / 92,3 / 100 / 91,3, la
  contraseña como `***`, Compose sano sobre un volumen vacío) y la rama desechable
  `test/c15-frase-plantada` en rojo en «Frases prohibidas» (corrida 45449147850), ya
  borrada. Nota de esa corrida: el paso «Registro de PostgreSQL si algo falló» también sale
  en rojo cuando Compose no llegó a correr; se arregla en F0.6.
  F0.6 hecho el 2026-11-24: README con solo lo que existe, seguido por Claude en un clon
  limpio (todo en 0, 76 pruebas); el dueño pidió seguir sin correr él esa prueba. Los
  insumos de F1 quedaron entregados (el dueño, 2026-11-24): escenario y nombres en la
  propuesta privada. R9 hecho: el hook de `pre-push`.

### F1 · CRM simulado

- **Lo desbloquea:** F0 integrada y los insumos de F0.6 entregados.
- **Entrega:** servicio aparte con empresas, contactos, notas, tareas y etapas; API
  validada con zod; llaves con alcance por cuenta y por permiso; bitácora de escrituras
  (quién propuso, quién aprobó); datos sintéticos del escenario cargados desde una semilla.
- **Subpasos:** F1.1 esquema y migración (antes: `/coderachnid:adr-guard plan`) · F1.2 API
  de lectura · F1.3 API de escritura con bitácora · F1.4 llaves con alcance · F1.5 semilla
  del escenario. En F1.4 se piden los insumos de F2: el material del programa que citará la
  estación 4.
- **Terminado cuando:** pruebas negativas demuestran que la llave del agente no borra, no
  exporta y no ve otra cuenta, y que fallan por la razón correcta (código 403 con el
  motivo, no un 404 casual). La cuenta es la escuela; la empresa es la del prospecto
  (ADR-0005).
- **Seguridad:** autenticación por llave guardada como hash; aislamiento entre cuentas en
  cada consulta, impuesto también por la base (RLS); validación de toda entrada; nada
  personal en los registros.
- **Trampas:** pruebas de permisos que pasan porque el recurso no existe; semillas que se
  ejecutan dos veces; migraciones que no se probaron desde una base vacía.
- **Estado:** abierta el 2026-11-24 en `feat/f1-crm`, que sale de `main` (`4b79aa3`).
  F1.1 hecha el 2026-11-24; el dueño pidió los commits y seguir con F1.2 (su prueba:
  `docker compose up -d --wait db; npm run db:migrate; npm run check; echo $LASTEXITCODE`,
  que debe dar 0). ADR-0005 aceptada ese día: el dueño delegó en Claude sus siete
  preguntas y pidió seguir sin la auditoría de `adr-guard`; las respuestas y cinco enmiendas
  están en la ADR. Entrega: ocho tablas en `crm` (`apps/crm/src/db/schema.ts`), migración
  `0001` generada y `0002_crm_security.sql` a mano, `database/schema.sql` generado (R8) y
  la regla de credenciales en las migraciones. 144 pruebas (68 nuevas), cobertura 98,43 /
  92,3 / 100 / 98,21, `npm run check` en 0. Doce mutantes plantados en las migraciones y una
  columna plantada en `schema.sql`, todos en rojo; la carrera de roles de D14, ejercida una
  vez en un PostgreSQL desechable. La base de desarrollo, migrada después de un respaldo.
  Línea base: `docs/reviews/ADR-0005-baseline.md`. Empujada el 2026-11-24 (CI en verde en
  `d40b3c3`). Ese mismo día el dueño pidió la auditoría: APROBAR CON CONDICIONES
  (`docs/reviews/ADR-0005-audit-2026-11-24.md`). Las enmiendas A6–A9 de la ADR cierran sus
  condiciones: la guarda y la carrera de roles muerden (esta última en un paso de CI), D4
  cubre la inserción sin cuenta y el `UPDATE` sin `WHERE`, la migración `0003` deja solo
  autores opacos en la bitácora, y una lista fija el hash de cada migración. También se
  arregló una carrera de `disposable-db.ts` que ponía en rojo 2 corridas de cada 10. Quedan
  164 pruebas, cobertura 98,46 / 92,3 / 100 / 98,24, y la base de desarrollo migrada hasta
  `0003`. **Para F1.2 (ADR-0006):** H3 (un dueño sin superusuario para tablas y funciones),
  H8, H10 (los miembros de `crm_service`) y H11 (D4 y D5 conectando como el usuario con
  login). **Para F1.3:** no mandar nunca `id` ni `created_at` (H7). **Para F1.4:** llaves
  de 128 bits o más al azar (H12). Arreglos empujados el 2026-11-24 (CI en verde en
  `f7542cc`). **F1.2:** ADR-0006 propuesta y aceptada ese día, con su línea base; el dueño
  aceptó sus siete recomendaciones. **F1.2 hecha y empujada el 2026-11-24 (CI en
  verde en `bf7a52f`, corrida 45521454430), sin auditar:** la API de lectura (Fastify y zod, sin compilar, en `127.0.0.1`), siete rutas
  con llave Bearer, 403 de cuenta ajena y de permiso con su motivo (adelantados de F1.4),
  una transacción `READ ONLY` por petición y un registro sin datos personales. `0004` da
  todo `crm` a `crm_owner` (H3); `npm run db:users` crea `crm_app` con un verificador SCRAM
  (H10), y las reglas de ADR-0005 se repiten como `crm_app` (H11); R10 cerrada. 291
  pruebas, cobertura 94,48 / 85,14 / 96,03 / 96,02; los mutantes M1–M13, más M11b y M14, en
  rojo. La base de desarrollo, respaldada (restauración probada) y migrada hasta `0004`.
  **Auditada:** APROBAR CON CONDICIONES (`docs/reviews/ADR-0006-audit-2026-11-24.md`). El
  2026-11-25 el dueño pidió arreglar lo que pedía arreglo, y las enmiendas A1–A5 de la ADR
  cierran las condiciones. Sin llave, una URL que el enrutador no puede leer da 401, y deja
  su línea de registro. Un puerto ocupado se nombra por `CRM_PORT`, y `db:users` rechaza una
  membresía `WITH ADMIN OPTION`. El cerco y la nota del 413 quedaron escritos. Quedan 301
  pruebas, cobertura 94,67 / 85,16 / 97,11 / 96,18. Empujadas el 2026-11-25 (CI en verde
  en `b41f8d6`, corrida 45635335825). **Para F1.3,
  además:** una prueba de `__proto__` por cada cuerpo nuevo (H9 de esa auditoría).
  **F1.3:** ADR-0007 aceptada el 2026-11-25, con su línea base; el dueño aceptó sus nueve
  recomendaciones. Al medir aparecieron dos fallas de ADR-0006 (F-1 y F-2), corregidas ese día como
  enmiendas A6–A7, cada una con una prueba que estaba en rojo: la búsqueda con un NUL en el
  correo da 400 y no 500, y el registro guarda el SQLSTATE de un error envuelto por drizzle.
  305 pruebas, cobertura 94,72 / 85,86 / 97,14 / 96,21; M19 y M20, en rojo.
  **F1.3 hecha y empujada el 2026-11-25, sin auditar:** seis rutas nuevas
  (trece en total): crear, actualizar y archivar un contacto, anotar, crear tarea y leer la
  bitácora. Cada escritura es una transacción `READ WRITE` que lee la entrada solo después
  de la llave, la cuenta y el permiso, y fija la cuenta, la llave, `proposed_by = key-<id>` y
  la aprobación con `set_config(…, true)`. Permiso por ruta, adelantado de F1.4: la llave del
  agente recibe 403 «borrado» al archivar. `ya_existe` (409) sale del índice único, leído de
  la causa que drizzle envuelve. Sin migraciones ni dependencias nuevas (D14, D15). 413
  pruebas, cobertura 95,75 / 87,77 / 97,97 / 97,04; los mutantes M1–M14 de la ADR, en rojo y
  restaurados por hash. Al codificar apareció que `z.iso.date()` acepta el año 0000, que
  PostgreSQL rechaza: `dueOn` lo rechaza en zod (CLAUDE.md §8). CI en verde en `7a60246`
  (corrida 45650884008). **Auditada:** APROBAR CON CONDICIONES
  (`docs/reviews/ADR-0007-audit-2026-11-25.md`): 1 mayor, de la suite (siete `beforeAll`
  pasaron los 10 s de Vitest en una vuelta). El 2026-11-25 el dueño pidió arreglar lo que
  pidiera, y las enmiendas A1–A4 de la ADR cierran las condiciones, empujadas el 2026-11-25
  (CI en verde en `6e8f445`, corrida 45659052830). Cada
  hook con base lleva `DATABASE_HOOK_TIMEOUT_MS`, con una prueba que lo exige. El cerco y la
  precedencia del `PATCH` quedan escritos, con dos pruebas nuevas. 417 pruebas; 10 vueltas
  seguidas de `npm run check` en 0. **H2:** el dueño eligió la opción (a) el 2026-11-25
  (una llave sin `read` ve lo que escribe, mientras ninguna llave real deje de tener `read`).
  **F1.4, hecha y empujada el 2026-11-25 (CI en verde en `ece213b`, corrida 45682667249),
  y auditada:** APROBAR CON CONDICIONES (`docs/reviews/ADR-0008-audit-2026-11-25.md`).
  ADR-0008 aceptada ese día (el dueño aceptó sus nueve
  recomendaciones), con su línea base sobre `6e8f445` (417 pruebas, todo en 0). H4 (D18)
  hecha primero, sin cambio de conducta: `read-scope.ts` pasa a `scope.ts`. Después, en su propio
  commit, D1–D3 y D14: la forma de la llave, el generador, el hash y las llaves de prueba con
  esa forma (433 pruebas, `npm run check` en 0). Luego, en su commit, el emisor `npm run
  db:keys` (D4–D9, D19; 463 pruebas). Después, en su commit, exportar y la prueba de los tres
  «no» (D10–D13; 477 pruebas). Luego, en su commit, la regla `crm-api-key` de la guarda
  (D15), y al final el README (emitir, listar y revocar). La auditoría dio 1 mayor, de la
  suite: ninguna prueba vigila que un error de `db:keys` no muestre el hash de la llave ni
  el mensaje del error (H1). El 2026-11-25 el dueño pidió A1 (H1) y eligió (a) para H2: la
  guarda lee también los mensajes de los commits que se publican. H3, H4 y H5 no los pidió.
  Las dos enmiendas, hechas ese día y sin empujar: A1, tres pruebas de D6 que muerden los
  mutantes de la auditoría (`497bbfb`); y A2, `--range` lee el mensaje de cada commit, y con
  él el hook de `pre-push` (`15f3023`). 480 pruebas, `npm run check` en 0. Se pidió al dueño
  el insumo de F2: el material del programa que citará la estación 4.

### F2 · Circuito y mapa

- **Lo desbloquea:** F1 integrada y `docs/diseno.md` aprobado por el dueño.
- **Entrega:** las siete estaciones y sus ramas con el modelo simulado, eventos guardados y
  una sola página central donde el circuito es la pieza principal: se entra a cada estación
  sin salir del circuito, y lo que pasa dentro se refleja en todo el circuito según su fase.
  La aprobación del mentor vive dentro del circuito.
- **Subpasos:**
  - F2.0 brief de diseño y UX (`docs/diseno.md`), hecho con las skills de diseño: el
    circuito pensado para usarse y para grabarse en 10 segundos. El boceto se revisa como
    tabla (qué dice, qué se construye, por qué difieren) antes de construir.
  - F2.1 motor del circuito: las estaciones y las ramas como datos, y un evento por estación.
  - F2.2 simulador y casos dorados de las tres rutas: normal, salto de 3 a 6 y alto en 2.
  - F2.3 tablero que dibuja el recorrido solo desde los eventos.
  - F2.4 aprobación del mentor.
- **Restricciones de producto, como código:**
  - El tono es comedia sin perder lo serio. El humor vive solo en el catálogo de textos de
    la interfaz, y cada texto lleva el campo `tono` (`juego` o `serio`). Lo que va al
    participante o al CRM solo acepta `serio`, y una prueba lo comprueba.
  - Las referencias de tono no aparecen en el producto (`forbidden-phrases.txt`).
  - La lista de herramientas del CRM es un dato que el tablero lee. F7 (MCP) la publicará
    sin cambiar el tablero; una prueba inyecta una herramienta falsa y el tablero la muestra.
- **Terminado cuando:** los casos dorados recorren las tres rutas, el mapa coincide con los
  eventos guardados y aplicar en el CRM sin aprobación falla (ADR-0001 D4).
- **Seguridad:** el texto de entrada va delimitado y nunca se interpreta como instrucción;
  nada se aplica sin aprobación; el tablero no muestra datos personales tachados en la estación 2.
- **Trampas:** una animación que no sale de los eventos; un mapa que se ve bien en el GIF
  pero no a la mitad del ancho; casos dorados que pasan con cualquier salida.
- **Estado:** pendiente.

### F3 · Modelo

- **Lo desbloquea:** F2 integrada y la llave de la API en el `.env` local del autor.
- **Entrega:** adaptador de Anthropic detrás de la interfaz (clasificación estructurada,
  conocimiento con cita, agente con herramientas que solo propone), apagado por defecto.
  Modo repetición: las corridas reales quedan guardadas como eventos y el mapa las
  reproduce sin llave.
- **Subpasos:** F3.1 batería de contrato que pasa con el simulador · F3.2 clasificación ·
  F3.3 conocimiento con cita · F3.4 agente con herramientas · F3.5 grabar y reproducir
  corridas. Antes de F3.4, se revisa la versión vigente del SDK y del modelo ese día.
- **Terminado cuando:** el simulador y el adaptador pasan la misma batería de contrato; hay
  corridas reales grabadas de las tres rutas, con sus medidas, y se reproducen sin llave.
- **Seguridad:** las corridas grabadas no llevan la llave ni encabezados (lo revisa una
  guarda); solo datos sintéticos; la salida del modelo se valida con zod antes de usarse.
- **Trampas:** pruebas que llaman a la API real en CI; una salida del modelo que «pide» otra
  estación (ADR-0001 D1); cifras de costo calculadas con precios sin fecha ni fuente.
- **Estado:** pendiente. Sin tope de gasto (el dueño, 2026-11-23): la llave se usa solo en
  local, en la máquina del autor, para grabar corridas.

### F6 · Demostración

- **Lo desbloquea:** F3 integrada, con corridas reales grabadas.
- **Entrega:** `docker compose up` levanta todo en local, sin llave; un README cuya primera
  pantalla es un GIF del circuito, una línea y el comando para correrlo; un video de 90
  segundos; una página del caso con las medidas de las corridas grabadas; el mensaje corto
  de la aplicación.
- **Terminado cuando:** en una máquina limpia, clonar y un comando recorren el circuito sin
  llave; una persona ajena entiende qué es viendo solo el GIF y las tres líneas.
- **Seguridad:** los puertos de Compose se publican solo en `127.0.0.1`; ningún secreto en
  la imagen.
- **Trampas:** Docker en Windows y puertos ocupados; un GIF pesado que GitHub no muestra;
  cifras que no salen de corridas grabadas (sin fuente, no hay número).
- **Estado:** pendiente.

### Segunda ronda (después del hito)

F4 · Defensas y evaluaciones · F5 · Medida · F7 · MCP. Se planifican al cerrar el hito y no
se anuncian en el README mientras no existan.

## 4. Definición de terminado (cada fase)

- [ ] Construcción completa en verde, confirmada por el código de salida.
- [ ] Cada regla nueva tiene una prueba que falla si se quita el código que la cumple.
- [ ] Umbral de cobertura cumplido.
- [ ] Cambio de esquema → migración, muestra de la versión anterior y prueba de migración.
- [ ] Lista de seguridad revisada; frases prohibidas limpias, la lista pública y la local.
- [ ] Visto funcionando en la app real, y la app queda detenida.
- [ ] Nada en pantalla ni en el README anuncia algo que no existe.
- [ ] Rama integrada con la aprobación del dueño.

## 5. Recomendaciones vivas

Lo que una respuesta recomienda y no se aplica en ese paso queda aquí hasta aplicarse.

| Id | Qué | Por qué | Lo decide o lo hace | Estado |
|---|---|---|---|---|
| R1 | Terraform: escribirlo y validarlo sin aplicarlo, o dejarlo fuera | La vacante pide infraestructura como código; no hay despliegue | El dueño | Abierta |
| R2 | Elegir la licencia del repositorio | Sin licencia nadie puede reutilizar el código; pesa si se ofrece como producto | El dueño | Abierta |
| R3 | Comparar «Circuit» con productos y paquetes existentes | Un nombre repetido resta en un enlace corto | Claude, en F0.6 | Cerrada el 2026-11-24: es una palabra común. La app de rutas que se llamaba Circuit ahora es Spoke; el nombre más cercano en IA con CRM es Circuitry.ai; el paquete `circuit` de npm está tomado (librería de enlace de datos), sin efecto porque el repositorio es `private` y no se publica en npm. Sirve para el portafolio; si Circuit se ofrece como producto, el nombre se revisa con una búsqueda de marca (el dueño) |
| R4 | Confirmar en el navegador que la vacante sigue abierta | No se pudo comprobar por consola | El dueño | Abierta |
| R5 | Elegir el canal del mensaje (plataforma de la vacante o LinkedIn) | Define el formato del GIF y de las tres líneas | El dueño, antes de F6 | Abierta |
| R6 | Script de respaldo (`pg_dump` dentro del contenedor, no por la tubería de PowerShell) con una restauración probada | Hoy no hay datos que respaldar; el ritual de `safe-database` lo exige desde el primer dato | Claude, antes de la semilla de F1.5 | Abierta |
| R7 | CI levanta la base con el mismo `compose.yaml` y una contraseña generada en la corrida | Una sola definición de la base; las pruebas de Compose y de migración corren igual que en local | Claude, en F0.5 | Cerrada el 2026-11-24: la primera corrida salió en verde (45448819374) |
| R8 | Generar `database/schema.sql` desde una base migrada y compararlo en una prueba | Hoy se escribe a mano porque solo hay dos esquemas vacíos; con tablas se desvía | Claude, en F1.1 | Cerrada el 2026-11-24: `npm run db:dump-schema` lo regenera y `database/test/schema-dump-db.test.ts` falla si difiere (una columna plantada la puso en rojo) |
| R9 | Hook de `pre-push` que corre `forbidden-phrases.local.txt` sobre lo versionado y `check-secrets.sh --range <remoto>..<local>` sobre cada commit que se publica | La lista privada no puede ir a CI, y CI corre después del push: detecta un secreto, no impide publicarlo (auditoría de ADR-0004, H1). Hoy depende de acordarse antes de cada push | El dueño. Hasta que exista, los dos comandos se corren a mano antes de cada push | Cerrada el 2026-11-24: `guards/hooks/pre-push`, activado con `git config core.hooksPath guards/hooks`, con la condición del dueño: nunca pregunta y para el push solo con un hallazgo o si no pudo revisar. Sus controles (`guards/pre-push.test.sh`, 10 casos, 7 mutantes en rojo) corren en CI |
| R10 | `apps/crm` declara sus dependencias (`drizzle-orm`, `pg`) en su `package.json` | Hoy `apps/crm/src/db/schema.ts` importa `drizzle-orm` desde la raíz, donde es solo de desarrollo; el servidor del CRM, que en F6 corre en Compose, no puede depender de eso. F1.1 no podía tocar dependencias (ADR-0005 D17) | Claude, en F1.2, con la versión verificada ese día | Cerrada el 2026-11-24: `apps/crm/package.json` declara drizzle-orm 0.45.4, fastify 5.12.8, pg 8.23.1 y zod 4.6.7 (ADR-0006 D2) |

## 6. Mapa de documentos

| Documento | Qué guarda | Cuándo se usa |
|---|---|---|
| `CLAUDE.md` | Reglas, dónde estamos, comandos | Al empezar cada sesión |
| `DEVELOPMENT_PLAN.md` | Fases, subpasos, estado y recomendaciones | Al empezar y al cerrar cada subpaso |
| `docs/privado/propuesta.md` | El porqué, el escenario y la cobertura de la vacante (local, fuera de git) | Al decidir alcance |
| `docs/adr/` | Decisiones de arquitectura y de alcance | Antes de cambiar lo que una ADR fija |
| `docs/diseno.md` | Brief de diseño y UX, tono y circuito | F2.0 en adelante |
| `docs/reviews/` | Auditorías de `adr-guard` | Al cerrar F1 y F3 |
| `forbidden-phrases.txt` | Lo que Circuit nunca dice (pública) | En CI y antes de cada commit |
| `forbidden-phrases.local.txt` | Nombres privados (fuera de git) | Antes de cada push |
