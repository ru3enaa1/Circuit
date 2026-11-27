# Circuit

![Una solicitud recorre las siete estaciones del circuito: se tachan sus datos personales, se clasifica, se responde con una fuente, se proponen acciones en el CRM, una persona las aprueba y se cierra.](docs/media/circuito.gif)

**Un agente de texto que atiende solicitudes y trabaja dentro de un CRM: el código decide el
camino, el modelo solo opina, y nada se escribe sin que una persona lo apruebe.**

- Cada solicitud recorre siete estaciones (entrada, filtro, clasificación, conocimiento, CRM,
  persona y cierre), y el tablero las dibuja solo con lo que de verdad quedó guardado.
- El modelo trabaja en tres de ellas y nunca elige la siguiente; responde citando un documento,
  y lo que propone para el CRM espera a una persona.
- Es una demostración local, con una escuela y unos datos inventados. Responde un simulador, así
  que el tablero no muestra tokens ni costos: no habría de dónde sacarlos.

Para verlo en tu equipo basta Docker: `docker compose up --wait` y abrir http://127.0.0.1:4020
(detalles en [Verlo en tu equipo](#verlo-en-tu-equipo)).

## Qué se ve en el GIF

Una persona escribe a una escuela de negocios inventada (Escuela Andamio) para preguntar qué
programa le sirve, y de paso deja su correo, su celular y su cédula.

1. **Entrada** recibe el texto.
2. **Filtro** tacha los datos personales antes de que nada los lea: el modelo ve `[correo]`,
   `[teléfono]` y `[documento]`. Si el texto intentara darle órdenes al modelo, el circuito se
   detendría aquí.
3. **Clasificación** dice qué pide, de qué tema y con qué confianza. Una queja, algo fuera de
   alcance o una confianza baja saltan directo a Persona.
4. **Conocimiento** responde con el programa que le sirve y cita la frase del documento de donde
   lo sacó. Sin fuente, no hay respuesta.
5. **CRM** propone tres acciones: una nota, mover el contacto de etapa y una tarea. Solo las
   propone.
6. **Persona** (el mentor) las aprueba, las corrige o las rechaza. Aquí el circuito espera.
7. **Cierre** escribe en el CRM lo aprobado, una vez, y cada escritura queda en la bitácora con
   quién la propuso y quién la aprobó.

La trenza amarilla y rosada que cruza cada tubo es la solicitud en camino; al llegar queda de un
solo color. Los personajes son decoración: llegan caminando o por una puerta, y al cerrar uno se va
en tobogán; no dicen nada del estado.

Cada estación se puede abrir con un clic para ver lo que guardó.

## Verlo en tu equipo

Basta Docker con Compose, encendido (verificado con Docker 29.9.3 y Compose 5.7.0). No hace falta
Node, ni un archivo `.env`, ni ninguna llave de API.

```sh
git clone https://github.com/ru3enaa1/Circuit.git
cd Circuit
docker compose up --wait
```

La orden vuelve cuando todo está listo: la base, los usuarios de permiso mínimo, la escuela
inventada, el CRM y el tablero. La primera vez construye la imagen y tarda unos minutos; las
siguientes, segundos. Después, abrir **http://127.0.0.1:4020**.

En el tablero, **«Probar una solicitud»** (abajo a la derecha) elige una de las solicitudes de
ejemplo y la manda al circuito. Hay una normal, una queja, una con confianza baja y una que intenta
darle órdenes al modelo. Al llegar a Persona, un clic en ella abre la propuesta con sus tres
botones: **Aprobar**, **Corregir** y **Rechazar**.

`docker compose down` lo detiene y guarda lo hecho; `docker compose down -v` borra también la base
y la próxima vez empieza de cero. Si el puerto 4020 o el 5432 ya está ocupado en tu equipo, crea un
archivo `.env` con otro número libre, por ejemplo `CIRCUIT_PORT=4030` o `DB_PORT=5433`.

Todo se publica solo en `127.0.0.1`: nada queda a la vista de la red local. Sin `.env`, el
contenedor de la base genera las contraseñas la primera vez y las guarda en un volumen de Docker;
ninguna entra a la imagen ni al repositorio
([ADR-0020](docs/adr/0020-compose-de-un-comando.md)).

### Para trabajar en el código

Hace falta además Node 24 con npm 11 (verificado con Node 24.20.0 y npm 11.19.0); en Windows, npm se
corre en PowerShell. `cp .env.example .env`, y poner en `.env` una contraseña distinta en
`POSTGRES_PASSWORD`, `CRM_DB_PASSWORD` y `CIRCUIT_DB_PASSWORD` (de 16 a 128 letras, dígitos,
`-`, `_`, `.` o `~`; `.env.example` trae un comando para generarlas), guardado en UTF-8 sin
BOM. Después:

```sh
npm ci
docker compose up -d --wait db   # solo PostgreSQL, en 127.0.0.1
npm run db:migrate               # las tablas
npm run db:users                 # los usuarios de permiso mínimo del CRM y del circuito
npm run db:seed                  # la escuela inventada y la llave del agente
npm run board:build              # el tablero
npm run crm:start                # el CRM en http://127.0.0.1:4010 (déjalo abierto)
npm run circuit:start            # en otra terminal: el tablero en http://127.0.0.1:4020
```

## Cómo está hecho

Las razones de cada decisión están en [docs/adr/](docs/adr/), una por decisión.

- **El código ordena el circuito.** El camino es una tabla fija; el modelo solo responde dentro de
  las estaciones 3, 4 y 5, y su texto de entrada va delimitado como dato, nunca como instrucción
  ([ADR-0001](docs/adr/0001-codigo-ordena-el-circuito.md),
  [ADR-0010](docs/adr/0010-motor-y-eventos.md)).
- **El tablero se dibuja con eventos guardados.** Cada estación deja un evento en PostgreSQL, y el
  tablero es una función de esos eventos: los revela de a uno y anima el paso de una estación a
  la siguiente, sin inventar nada en el camino
  ([ADR-0011](docs/adr/0011-tablero-desde-eventos.md),
  [ADR-0018](docs/adr/0018-coreografia-del-paso.md)).
- **El CRM es otro proceso, y el permiso mínimo lo pone la base.** La llave del agente lee y
  escribe, pero no borra, no exporta y no ve otra cuenta: lo rechazan la API y la base, con
  seguridad por filas y un usuario sin atributos de administrador
  ([ADR-0005](docs/adr/0005-esquema-crm.md), [ADR-0008](docs/adr/0008-llaves-crm.md)).
- **Una persona aprueba.** Cierre solo escribe lo que la persona aprobó, en orden y una sola vez,
  y la bitácora guarda quién propuso y quién aprobó cada escritura
  ([ADR-0012](docs/adr/0012-aprobacion-y-cierre.md)).
- **El modelo está detrás de una interfaz.** Hoy responde un simulador, que da siempre la misma
  respuesta a la misma solicitud. Detrás de la misma interfaz está el adaptador de Anthropic, que
  pasa la misma batería de pruebas, pero solo contra un transporte falso: esta demostración no
  llama a la API ni muestra corridas reales
  ([ADR-0015](docs/adr/0015-modelo-real-y-repeticion.md)). Encenderlo es configuración:
  `CIRCUIT_MODEL=anthropic` y `ANTHROPIC_API_KEY` en `.env`.
- **Datos sintéticos.** La escuela, las empresas y las personas son inventadas, y los correos
  están bajo `.test`, un dominio que no entrega correo
  ([ADR-0009](docs/adr/0009-respaldo-y-semilla.md)).
- **Pruebas que muerden.** TypeScript estricto, Vitest con cobertura mínima de 80, casos dorados
  del circuito, pruebas de arquitectura y de seguridad contra bases desechables, y cada regla
  probada con un cambio que la rompe a propósito. GitHub Actions corre lo mismo que en local,
  con guardas de secretos y de frases prohibidas
  ([ADR-0004](docs/adr/0004-ci-guardas-y-cobertura.md)).

Stack: TypeScript, Fastify, Drizzle, PostgreSQL 18, React, zod, Vitest, Docker Compose y GitHub
Actions.

## Referencia

### Las pruebas

Con la base levantada y `npm run db:users` hecho:

```sh
npm run check   # tipos y pruebas con cobertura: 0 si todo pasa
```

Las guardas, en Git Bash:

```sh
bash guards/check-secrets.sh
bash guards/check-forbidden-phrases.sh forbidden-phrases.txt README.md apps database scenarios
```

### El tablero sin base de datos

```sh
npm run board:shots   # capturas del circuito y de cuatro salas en .shots/, con Chrome
npm run board:gif     # vuelve a grabar docs/media/circuito.gif en tiempo real
```

Los dos sirven los casos dorados desde la memoria. Circuit responde solo a `127.0.0.1` y
`localhost`, nunca responde CORS y sirve solo los archivos de su compilación. Con «reducir
movimiento» en el sistema, el tablero muestra cada corrida entera, sin animación.

### La semilla

`npm run db:seed` carga el escenario de `CIRCUIT_SCENARIO` (`scenarios/escuela/`) en una sola
transacción, una vez por cuenta: correrlo otra vez no duplica nada. La llave del agente queda en
`.secrets/crm-agent-key`, que git ignora, y nunca se imprime. El mentor que aprueba es
`CIRCUIT_MENTOR` (por defecto `mentor`); **no hay inicio de sesión**, porque la demostración es
local y de una sola persona.

### Respaldar y restaurar

```sh
npm run db:backup -- --label antes-de-migrar
npm run db:restore -- --file database/backups/<carpeta>/circuit.dump --into <base nueva>
```

El respaldo lleva su SHA-256 al lado, y la restauración solo crea una base nueva, nunca encima de
una que existe.

### Llaves del CRM

```sh
npm run db:keys -- issue --account <cuenta> --label <etiqueta> --permissions read,write
npm run db:keys -- list --account <cuenta>
npm run db:keys -- revoke --id <id>
```

Cada llave es `crmk_` y 256 bits al azar, se muestra una sola vez y la base guarda solo su
SHA-256. Los permisos son `read`, `write`, `delete` y `export`; toda llave lleva `read`. La API no
tiene ninguna ruta de llaves.

### Dónde está cada decisión

| Archivo | Qué guarda |
|---|---|
| [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) | Las fases, su estado y las recomendaciones abiertas |
| [docs/adr/](docs/adr/) | Las decisiones de arquitectura, con sus razones |
| [docs/reviews/](docs/reviews/) | Las líneas base y las auditorías de esas decisiones |
| [docs/diseno.md](docs/diseno.md) | El brief del tablero |
| [CLAUDE.md](CLAUDE.md) | Las reglas del proyecto y los comandos verificados |
