# Circuit

![Una solicitud recorre las siete estaciones del circuito: se tachan sus datos personales, se clasifica, se responde con una fuente, se proponen acciones en el CRM, una persona las aprueba y se cierra.](docs/media/circuito.gif)

**Un agente que atiende los mensajes que llegan y trabaja dentro de un CRM. El código decide el
camino, la IA solo opina, y nada se escribe sin que una persona lo apruebe.**

- 🛤️ **Siete estaciones, siempre en el mismo orden.** Cada mensaje entra, se filtra, se
  clasifica, se responde, se proponen acciones, una persona decide y se cierra. Lo que ves en el
  tablero sale de lo que de verdad quedó guardado.
- 🧑‍⚖️ **La última palabra es de una persona.** La IA trabaja en tres estaciones, nunca elige la
  siguiente, responde citando un documento, y lo que propone para el CRM espera aprobación.
- 🧪 **Todo es inventado y local.** Una escuela de negocios ficticia, datos sintéticos y un
  simulador en lugar de la IA real. Lo levantas con un comando, sin llaves ni costos.

¿Sin tiempo para correrlo? **[El recorrido, cuadro a cuadro](docs/recorrido.md)** lo cuenta en
diez capturas del tablero, como un video de 90 segundos.

¿Prefieres la historia completa? En **[el caso](docs/caso.md)** está para qué sirve, cuatro
mensajes con su recorrido y qué tanto se puede creer de cada cifra.

## Pruébalo en tu equipo

Solo necesitas [Docker](https://www.docker.com/products/docker-desktop/) encendido. Nada de Node,
ni archivos de configuración, ni llaves de API.

```sh
git clone https://github.com/ru3enaa1/Circuit.git
cd Circuit
docker compose up --wait
```

Cuando la orden vuelve, todo está listo. Abre **http://127.0.0.1:4020**.

La primera vez construye la imagen y tarda un poco (en una máquina limpia de GitHub Actions, 32 s);
las siguientes, segundos. Para apagarlo: `docker compose down` (guarda lo hecho) o
`docker compose down -v` (borra todo y la próxima vez empieza de cero).

## Un recorrido de dos minutos

1. **Abre «Probar una solicitud»** (abajo a la derecha) y elige **«Pide un programa para su
   empresa»**. Mira la trenza amarilla y rosada cruzar cada tubo: es el mensaje en camino.
2. **Fíjate en el Filtro.** El mensaje traía correo, celular y cédula; la IA solo ve `[correo]`,
   `[teléfono]` y `[documento]`.
3. **Haz clic en cualquier estación** para entrar a su sala y ver lo que guardó: la confianza de
   la clasificación, la frase del documento que se citó, las acciones propuestas. `Esc` te
   devuelve.
4. **Llega a Persona y decide.** El circuito se detiene y te espera: **Aprobar**, **Corregir** o
   **Rechazar**. Si apruebas, Cierre escribe en el CRM, una sola vez, y deja en la bitácora quién
   lo propuso y quién lo aprobó.
5. **Ahora intenta engañarlo.** Elige **«Intenta dar órdenes al agente»**: se detiene en el
   Filtro y queda registrado. La IA nunca lo lee.
6. **Prueba las otras dos.** Una queja (**«Reclama por un cobro repetido»**) y una duda vaga
   (**«Pregunta sin saber por dónde empezar»**) saltan directo a Persona: no son para responder
   en automático.

Los personajes son decoración: llegan caminando o por una puerta, y al cerrar uno se va en
tobogán. No dicen nada del estado.

## Lo que Circuit nunca hace

| Nunca… | Porque… |
|---|---|
| deja que la IA elija el camino | el orden es una tabla fija en el código ([ADR-0001](docs/adr/0001-codigo-ordena-el-circuito.md)) |
| trata el mensaje como una orden | va delimitado como dato, y un intento de inyección se detiene en el Filtro ([ADR-0010](docs/adr/0010-motor-y-eventos.md)) |
| responde sin fuente | Conocimiento cita la frase exacta del documento, o no responde |
| escribe en el CRM sin aprobación | Cierre solo aplica lo que la persona aprobó, en orden y una vez ([ADR-0012](docs/adr/0012-aprobacion-y-cierre.md)) |
| borra, exporta o mira otra cuenta | la llave del agente no puede: lo rechazan la API y la base de datos, no el prompt ([ADR-0005](docs/adr/0005-esquema-crm.md), [ADR-0008](docs/adr/0008-llaves-crm.md)) |
| inventa cifras | el simulador no gasta tokens, así que el tablero no muestra tokens ni costos ([el caso](docs/caso.md#las-medidas-y-de-dónde-salen)) |

## Cómo está hecho

Para quien quiere mirar el código. Cada decisión tiene su registro en [docs/adr/](docs/adr/),
con lo que se eligió y lo que se descartó.

- **Dos procesos.** `apps/circuit` es el circuito (un monolito modular con su servidor y el
  tablero) y `apps/crm` es un CRM simulado aparte, al que el circuito solo le habla por HTTP con
  una llave de permiso mínimo ([ADR-0003](docs/adr/0003-monolito-modular.md)).
- **El tablero es una función de los eventos.** Cada estación guarda un evento en PostgreSQL, y
  el tablero (React) los revela de a uno y anima el paso entre estaciones sin inventar nada
  ([ADR-0011](docs/adr/0011-tablero-desde-eventos.md),
  [ADR-0018](docs/adr/0018-coreografia-del-paso.md)).
- **La IA está detrás de una interfaz.** Hoy responde un simulador, que da siempre la misma
  respuesta a la misma entrada. El adaptador de Anthropic ya existe y pasa la misma batería de
  pruebas, contra un transporte falso: encenderlo es configuración
  (`CIRCUIT_MODEL=anthropic` y `ANTHROPIC_API_KEY` en `.env`), no código
  ([ADR-0015](docs/adr/0015-modelo-real-y-repeticion.md)).
- **Seguridad en la base, no solo en el código.** Seguridad por filas, usuarios sin atributos de
  administrador, bitácora por trigger y llaves guardadas solo como hash.
- **Pruebas que muerden.** TypeScript estricto, 1551 pruebas con cobertura mínima de 80 %, casos
  dorados comparados byte a byte, pruebas de arquitectura y de seguridad contra bases
  desechables, y cada regla comprobada rompiéndola a propósito. GitHub Actions corre lo mismo,
  más las guardas de secretos y un `docker compose up` en una máquina limpia
  ([ADR-0004](docs/adr/0004-ci-guardas-y-cobertura.md),
  [ADR-0020](docs/adr/0020-compose-de-un-comando.md)).

**Stack:** TypeScript, Fastify, Drizzle, PostgreSQL 18, React, zod, Vitest, Docker Compose y
GitHub Actions.

## Referencia

<details>
<summary><b>Para trabajar en el código</b></summary>

Hace falta además Node 24 con npm 11 (verificado con Node 24.20.0 y npm 11.19.0); en Windows, npm
se corre en PowerShell. `cp .env.example .env`, y poner en `.env` una contraseña distinta en
`POSTGRES_PASSWORD`, `CRM_DB_PASSWORD` y `CIRCUIT_DB_PASSWORD` (de 16 a 128 letras, dígitos, `-`,
`_`, `.` o `~`; `.env.example` trae un comando para generarlas), guardado en UTF-8 sin BOM.
Después:

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

Si el puerto 4020 o el 5432 ya está ocupado, pon otro número libre en `.env`, por ejemplo
`CIRCUIT_PORT=4030` o `DB_PORT=5433`. Todo se publica solo en `127.0.0.1`. Sin `.env`, el
contenedor de la base genera las contraseñas la primera vez y las guarda en un volumen de Docker;
ninguna entra a la imagen ni al repositorio.

</details>

<details>
<summary><b>Las pruebas</b></summary>

Con la base levantada y `npm run db:users` hecho:

```sh
npm run check   # tipos y pruebas con cobertura: 0 si todo pasa
```

Las guardas, en Git Bash:

```sh
bash guards/check-secrets.sh
bash guards/check-forbidden-phrases.sh forbidden-phrases.txt README.md apps database scenarios
```

</details>

<details>
<summary><b>El tablero sin base de datos</b></summary>

```sh
npm run board:shots   # capturas del circuito y de cuatro salas en .shots/, con Chrome
npm run board:gif     # vuelve a grabar docs/media/circuito.gif en tiempo real
npm run board:storyboard   # vuelve a tomar los diez cuadros de docs/recorrido.md, en tiempo real
```

Los tres sirven los casos dorados desde la memoria. Circuit responde solo a `127.0.0.1` y
`localhost`, nunca responde CORS y sirve solo los archivos de su compilación. Con «reducir
movimiento» en el sistema, el tablero muestra cada corrida entera, sin animación.

</details>

<details>
<summary><b>La semilla, el respaldo y las llaves del CRM</b></summary>

`npm run db:seed` carga el escenario de `CIRCUIT_SCENARIO` (`scenarios/escuela/`) en una sola
transacción, una vez por cuenta: correrlo otra vez no duplica nada. La llave del agente queda en
`.secrets/crm-agent-key`, que git ignora, y nunca se imprime. El mentor que aprueba es
`CIRCUIT_MENTOR` (por defecto `mentor`); no hay inicio de sesión, porque la demostración es local
y de una sola persona.

```sh
npm run db:backup -- --label antes-de-migrar
npm run db:restore -- --file database/backups/<carpeta>/circuit.dump --into <base nueva>
```

El respaldo lleva su SHA-256 al lado, y la restauración solo crea una base nueva, nunca encima de
una que existe.

```sh
npm run db:keys -- issue --account <cuenta> --label <etiqueta> --permissions read,write
npm run db:keys -- list --account <cuenta>
npm run db:keys -- revoke --id <id>
```

Cada llave es `crmk_` y 256 bits al azar, se muestra una sola vez y la base guarda solo su
SHA-256. Los permisos son `read`, `write`, `delete` y `export`; toda llave lleva `read`. La API no
tiene ninguna ruta de llaves.

</details>

<details>
<summary><b>Dónde está cada decisión</b></summary>

| Archivo | Qué guarda |
|---|---|
| [docs/caso.md](docs/caso.md) | El caso: para qué sirve, cuatro recorridos y sus medidas |
| [docs/recorrido.md](docs/recorrido.md) | El recorrido en diez cuadros, en lugar del video |
| [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) | Las fases, su estado y las recomendaciones abiertas |
| [docs/adr/](docs/adr/) | Las decisiones de arquitectura, con sus razones |
| [docs/reviews/](docs/reviews/) | Las líneas base y las auditorías de esas decisiones |
| [docs/diseno.md](docs/diseno.md) | El brief del tablero |
| [CLAUDE.md](CLAUDE.md) | Las reglas del proyecto y los comandos verificados |

</details>
