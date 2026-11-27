# Circuit

Pieza de portafolio en construcción. La meta: un agente de texto que atiende solicitudes
entrantes y trabaja dentro de un CRM, con un tablero donde cada solicitud recorre siete
estaciones y una persona aprueba lo que el modelo no debe decidir.

**Estado: fase F1, el CRM simulado.** Existen su esquema de base de datos, su API de
lectura y de escritura, que corre en local, el comando que emite y revoca sus llaves, la
semilla con los datos sintéticos del escenario y el respaldo de la base; todavía no hay
agente ni tablero. Lo que sigue está en el [plan de desarrollo](DEVELOPMENT_PLAN.md).

## Qué hay hoy

- Un monorepo TypeScript con npm workspaces: `apps/circuit`, el motor del circuito y su
  servidor; `apps/crm`, con el esquema y el servidor del CRM; y `apps/board`, el tablero.
- El esquema del CRM, donde la base impone las reglas aunque la API se equivoque: cada
  cuenta ve solo sus filas (seguridad por filas), el rol del servicio no puede borrar, cada
  escritura deja una fila de bitácora con quién la propuso y quién la aprobó, y las llaves
  se guardan solo como SHA-256 ([ADR-0005](docs/adr/0005-esquema-crm.md)). El esquema
  completo se lee en [database/schema.sql](database/schema.sql), generado desde una base
  migrada.
- La API de lectura del CRM ([ADR-0006](docs/adr/0006-api-lectura-crm.md)): siete rutas
  que solo leen, en `127.0.0.1`. Cada petición pide una llave (`Authorization: Bearer`), la
  cuenta de la ruta tiene que ser la de la llave (si no, 403 con el motivo), y cada lectura
  corre en una transacción de solo lectura con un usuario de base de permiso mínimo y sin
  atributos de administrador (`crm_app`). El registro guarda método, ruta, estado y duración, y nada personal.
- La API de escritura del CRM ([ADR-0007](docs/adr/0007-api-escritura-crm.md)): crear y
  actualizar un contacto (también moverlo de etapa), anotar, crear una tarea, archivar y
  leer la bitácora. Cada escritura lleva la aprobación de una persona; el CRM firma como
  proponente la llave que la manda, y la base deja la fila de bitácora en la misma
  transacción. Archivar pide el permiso de borrado, que la llave del agente no tiene: 403
  con el motivo. No hay ninguna ruta que borre.
- Las llaves del CRM ([ADR-0008](docs/adr/0008-llaves-crm.md)): cada una es `crmk_` y 256
  bits al azar, se muestra una sola vez y la base guarda solo su SHA-256. Las emite, lista y
  revoca un comando local que corre como administrador (`npm run db:keys`); la API no tiene
  ninguna ruta de llaves. Una llave con otra forma recibe 401 sin llegar a la base. Exportar
  los contactos de una cuenta pide el permiso `export`: la llave del agente (leer y escribir)
  recibe 403 al exportar, al archivar y en otra cuenta, y una prueba lo comprueba con una
  llave emitida por el comando real.
- El escenario, un paquete de datos que se cambia sin tocar el código
  ([ADR-0009](docs/adr/0009-respaldo-y-semilla.md)): `scenarios/escuela/crm.json`, una
  escuela de negocios inventada, Escuela Andamio, con sus seis etapas, cinco empresas
  inventadas con una facturación marcada como ficticia, sus contactos, notas y tareas, y una
  segunda cuenta para que el aislamiento se vea. Todo es sintético: los correos están bajo
  `.test`, un dominio reservado que no entrega correo. `npm run db:seed` lo carga una vez por
  cuenta y deja la llave del agente en un archivo que git ignora.
- El respaldo de la base (`npm run db:backup`) y su restauración en una base nueva
  (`npm run db:restore`), con el SHA-256 comprobado y una prueba que restaura y compara.
- Una prueba de arquitectura: el núcleo no importa ningún otro módulo ni el SDK de
  Anthropic, y cada módulo se usa solo por su `index.ts`
  ([ADR-0001](docs/adr/0001-codigo-ordena-el-circuito.md),
  [ADR-0003](docs/adr/0003-monolito-modular.md)).
- PostgreSQL 18.7 en Docker Compose, publicado solo en `127.0.0.1`, con las migraciones
  probadas contra bases desechables.
- Guardas de secretos (reconocen también la forma de una llave del CRM), de frases
  prohibidas y de finales de línea, y GitHub Actions con los
  mismos comandos que en local, cobertura mínima de 80 incluida
  ([ADR-0004](docs/adr/0004-ci-guardas-y-cobertura.md)).

## Requisitos

- Node 24 y npm 11 (verificado con Node 24.20.0 y npm 11.19.0).
- Docker con Compose, encendido (verificado con Docker 29.9.3).
- Git. En Windows, las guardas corren en Git Bash y npm en PowerShell
  ([CLAUDE.md](CLAUDE.md), sección 8).

## Correr las pruebas

```sh
git clone https://github.com/ru3enaa1/Circuit.git
cd Circuit
npm ci
cp .env.example .env
```

Abrir `.env` y poner una contraseña distinta en cada una de `POSTGRES_PASSWORD`,
`CRM_DB_PASSWORD` y `CIRCUIT_DB_PASSWORD` (de 16 a 128 letras, dígitos, `-`, `_`, `.` o `~`;
`.env.example` trae un comando para generarlas). Se guarda en UTF-8 sin BOM. Si otro
PostgreSQL ya usa el puerto 5432, cambiar `DB_PORT`.

```sh
docker compose up -d --wait db
npm run db:migrate
npm run db:users
npm run check
```

`npm run check` corre los tipos y las pruebas con cobertura: sale con 0 si todo pasa.
`npm run db:users` crea el usuario `crm_app` con la contraseña de `CRM_DB_PASSWORD`, y
`circuit_app` con la de `CIRCUIT_DB_PASSWORD`; sin alguna de las dos, sale con 1 y nombra la
variable.

`npm run crm:start` levanta el CRM en `http://127.0.0.1:4010`: `/health` responde 200, y una
ruta sin llave, 401. Las cuentas y la llave del agente llegan con la semilla (la sección
siguiente). `docker compose stop db` detiene la base y conserva sus datos.

## El tablero

```sh
npm run board:build    # compila apps/board en apps/board/dist
npm run crm:start      # el CRM en http://127.0.0.1:4010 (en otra terminal)
npm run circuit:start  # el tablero, su API y sus dos órdenes en http://127.0.0.1:4020; Ctrl+C lo detiene
npm run board:shots    # capturas a 1536×864, 768×864, 720×900 y 2560×1080 en .shots/, con Chrome (el circuito y cuatro salas)
```

El tablero dibuja el circuito solo con los eventos guardados
([ADR-0011](docs/adr/0011-tablero-desde-eventos.md)): cada estación toma el estado de su evento,
y los eventos se revelan de a uno cada 700 ms. Circuit responde solo a `127.0.0.1` y
`localhost` con su puerto, nunca responde CORS y sirve solo los archivos de su compilación.
`board:shots` no necesita la base: usa los casos dorados en memoria.

Un clic en una estación, o en su píldora del muelle, entra a su sala: la estación en grande, lo
que guardó con el texto entero y sus salidas, con la tomada en amarillo. Desde CRM se entra a
cada acción propuesta. El portal de la izquierda, la miga de pan o Esc vuelven de a un nivel.
Lo que se mira vive en la dirección de la página (`#/estacion/crm`, `#/estacion/crm/accion/3`),
así que «atrás» del navegador también vuelve, y entrar nunca cambia la corrida
([ADR-0013](docs/adr/0013-entrar-a-una-estacion.md)).

El dibujo sigue el boceto del autor: cada estación lleva sus nodos en brazos, los tubos tienen
dos rieles y la ruta tomada va en amarillo por dentro. Sobre los tubos se paran de dos a cuatro
figuras del equipo, siempre las mismas para la misma corrida; son decoración y nunca muestran un
estado. En una ventana ultraancha, dos paneles a los lados de Persona muestran la cita, las
acciones propuestas, la confianza y el tiempo de la corrida
([ADR-0014](docs/adr/0014-logo-equipo-y-paneles.md)).

**Aprobar.** «Probar una solicitud», abajo a la derecha, arranca una corrida con una de las
solicitudes de ejemplo del escenario (`scenarios/<id>/samples.json`). El circuito la recorre
hasta Persona y espera. Al entrar a Persona se ve la propuesta de CRM y sus tres salidas, que
son los botones: **Aprobar**, **Corregir** (quitar o editar acciones) y **Rechazar**. Solo
entonces Cierre escribe en el CRM, una petición por acción, en orden, una sola vez, y cada fila
de la bitácora del CRM dice que la propuso la llave del agente y la aprobó el mentor, con
`approvalRef = run-<id>` ([ADR-0012](docs/adr/0012-aprobacion-y-cierre.md)). El mentor es
`CIRCUIT_MENTOR` (por defecto `mentor`): **no hay inicio de sesión**, porque la demostración es
local y de una sola persona; cualquier programa de este equipo podría decidir, y eso no sirve
para un despliegue. Circuit necesita en `.env` las líneas `CIRCUIT_SCENARIO` y
`CRM_AGENT_KEY_FILE` de `.env.example`, y la llave que deja `npm run db:seed`.

**El modelo.** Las estaciones 3, 4 y 5 las responde un simulador, que lee
`scenarios/<id>/simulator.json` y da siempre la misma respuesta a la misma solicitud. Por eso
sus tokens, costos y tiempos de modelo salen vacíos: no hay una fuente para esos números. Detrás
de la misma interfaz está el adaptador de Anthropic (`claude-opus-5-5`,
[ADR-0015](docs/adr/0015-modelo-real-y-repeticion.md)): clasifica con salida estructurada,
responde citando un documento del escenario (el código revisa que la cita esté ahí, palabra por
palabra) y propone las acciones del CRM como herramientas que nunca ejecuta. Pasa la misma
batería de pruebas que el simulador, pero **solo contra un transporte falso**: esta
demostración no llama a la API ni muestra corridas reales. Encenderlo es configuración:
`CIRCUIT_MODEL=anthropic` y `ANTHROPIC_API_KEY` en `.env`, con el gasto de tokens que eso trae.

## Datos de ejemplo: la semilla

```sh
npm run db:seed
```

Carga el escenario que nombra `CIRCUIT_SCENARIO` (`escuela`, la carpeta
`scenarios/escuela/`) en la base de `POSTGRES_DB`, en una sola transacción: o entra todo o
nada. Una `.env` copiada antes de que existiera la semilla no trae `CIRCUIT_SCENARIO` ni
`CRM_AGENT_KEY_FILE`; sin ellas el comando sale con 1 y las nombra, y basta con copiar esas
dos líneas de `.env.example`.

- **Una vez por cuenta.** Una cuenta que no existe nace con todas sus filas; una que ya
  existe se salta entera, así que correrlo otra vez no duplica nada ni deshace lo que se
  escribió después. Cambiar los datos de una cuenta ya sembrada pide una base nueva.
- **Reproducible.** Las fechas salen del paquete y los ids del orden de carga: en una base
  nueva, el mismo paquete da las mismas filas.
- **La llave del agente** (`read,write`, etiqueta `agente`) queda en el archivo de
  `CRM_AGENT_KEY_FILE`, `.secrets/crm-agent-key`, que git ignora; nunca se imprime. Si el
  archivo ya tiene la llave viva, no se toca; si falta o no sirve, se revoca la anterior y se
  emite otra.

```powershell
npm run crm:start   # en otra terminal; Ctrl+C lo detiene
$k = (Get-Content .secrets\crm-agent-key -Raw).Trim()
Invoke-WebRequest -UseBasicParsing -Headers @{ Authorization = "Bearer $k" } http://127.0.0.1:4010/accounts/escuela-andamio/stages   # 200
```

## Respaldar y restaurar

```sh
npm run db:backup -- --label antes-de-migrar
npm run db:restore -- --file database/backups/<carpeta>/circuit.dump --into <base nueva>
```

- `db:backup` vuelca la base de `POSTGRES_DB` dentro del contenedor y la copia a
  `database/backups/<AAAAMMDD-HHMMSS>Z-<etiqueta>/`, que git ignora, con su SHA-256 al
  lado. No pasa por una tubería de la terminal: en Windows PowerShell 5.1, `>` reescribe un
  archivo binario sin avisar.
- `db:restore` restaura solo en una base nueva que crea, y nunca encima de una que existe.
  Si algo falla, la borra. Para usar la copia, apuntar `POSTGRES_DB` a ella.

## Llaves del CRM

Las maneja `npm run db:keys`, como el administrador de `.env` y en una transacción por
orden. En Windows, en PowerShell, como el resto de npm.

```sh
npm run db:keys -- issue --account <cuenta> --label <etiqueta> --permissions read,write
npm run db:keys -- list --account <cuenta>
npm run db:keys -- revoke --id <id>
```

- `issue` imprime el id y la llave una sola vez, después de guardarla. La base guarda solo
  su SHA-256, así que una llave perdida no se recupera: se revoca y se emite otra.
- Los permisos son `read`, `write`, `delete` y `export`, sin repetidos, y toda llave lleva
  `read`; `read,write` es la del agente. La cuenta y la etiqueta van en minúsculas, cifras y
  guiones, hasta 40 caracteres, para que una etiqueta no lleve el nombre de una persona.
- `list` muestra de cada llave su id, etiqueta, permisos y fechas de creación y de
  revocación, nunca su hash.
- `revoke` es definitivo: desde la petición siguiente, esa llave recibe 401, igual que una
  que no existe.
- Sale con 0 si hizo lo pedido y con 1 y el motivo si no; sin orden, con el uso. Un error de
  la base se nombra por su SQLSTATE, sin la llave ni la conexión.

Las cuentas existen después de la semilla; antes, el comando sale con 1 y «No existe la
cuenta …». La llave del agente la emite la semilla, no hace falta emitirla a mano.

Las guardas, en Git Bash:

```sh
bash guards/check-secrets.sh
bash guards/check-forbidden-phrases.sh forbidden-phrases.txt README.md apps database scenarios
```

## Dónde está cada decisión

| Archivo | Qué guarda |
|---|---|
| [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) | Las fases, su estado y las recomendaciones abiertas |
| [docs/adr/](docs/adr/) | Las decisiones de arquitectura, con sus razones |
| [docs/reviews/](docs/reviews/) | Las líneas base y las auditorías de esas decisiones |
| [CLAUDE.md](CLAUDE.md) | Las reglas del proyecto y los comandos verificados |
