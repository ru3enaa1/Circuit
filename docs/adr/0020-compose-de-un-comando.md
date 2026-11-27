# ADR-0020 · `docker compose up` levanta todo, sin `.env` y sin llave

- **Fecha:** 2026-11-27 · **Estado:** aceptada el 2026-11-27. Claude eligió las recomendaciones
  (CLAUDE.md §1b).
- **Tarea:** F6 de `DEVELOPMENT_PLAN.md`: «en una máquina limpia, clonar y un comando recorren el
  circuito sin llave».
- **Enmienda:** ADR-0011 B6 («ninguna variable cambia la dirección»: ahora una sola, y solo dentro de
  un contenedor), ADR-0012 A9 (`CRM_URL` acepta también `http://crm:<puerto>` dentro de Compose) y
  ADR-0002 D3 (se sigue publicando solo en `127.0.0.1`).
- **Depende de:** ADR-0002, ADR-0006, ADR-0009 (semilla y llave), ADR-0010 D11, ADR-0011.

## Contexto

Hasta hoy, verlo pedía Node en el equipo, copiar `.env`, inventar tres contraseñas y siete órdenes.
Quien recibe la demostración no es técnico (§1b): debe bastar Docker y una orden. Tres cosas lo
impedían: crm y circuit escuchaban y buscaban la base en `127.0.0.1` fijo (dentro de un contenedor,
eso es el propio contenedor); las contraseñas no tenían valor por defecto, a propósito; y la llave
del agente la escribe la semilla en un archivo del clon.

## Decisión

1. **Cuatro servicios.** `db` (el de siempre), `setup` (una vez: `db:migrate`, `db:users` y
   `db:seed`; sale con 0 y no se reinicia), `crm` y `circuit`. Los tres de Node usan una sola imagen,
   `circuit-app:local`, que construye el `Dockerfile` sobre `node:24.20.0-trixie-slim` fijada por
   digest, con `npm ci` y el tablero compilado adentro. Corren como el usuario `node`, no como root.
2. **Una sola variable, solo en un contenedor.** `CIRCUIT_IN_CONTAINER=1` hace que crm y circuit
   escuchen en `0.0.0.0`, que todo busque la base en `db:5432` y que `CRM_URL` pueda ser
   `http://crm:<puerto>`. Solo vale si existe `/.dockerenv`, el archivo que Docker pone en cada
   contenedor: fuera de uno, la variable detiene el arranque con su nombre. Así un `.env` del equipo
   no puede abrir crm o circuit a la red local. Cualquier otro valor, también la detiene.
3. **Puertos.** Se publican solo en `127.0.0.1` (lo vigila `compose.test.ts`): la base (`DB_PORT`,
   para el trabajo local del dueño) y el tablero (`CIRCUIT_PORT`, el mismo número adentro y afuera,
   para que la revisión de `Host` y de `Origin` de ADR-0011 B6 siga igual). El CRM no se publica: solo
   circuit le habla, por la red de Compose. Un puerto menos que puede estar ocupado.
4. **Contraseñas.** Si el entorno o `.env` las trae, se usan (el flujo del dueño no cambia). Si no,
   el contenedor de la base genera las que falten una sola vez, con `/dev/urandom`, en el volumen
   `secrets` (archivos `0640`, grupo 1000, el de `node`), y `docker/with-secrets.sh` las lee al
   arrancar cada servicio. Ninguna entra a la imagen ni al repositorio. Los servicios ven el volumen
   entero: es una demostración local, y separar archivos por servicio no cabe en un volumen con
   nombre.
5. **La llave del agente** vive en el volumen `agent-key`, montado en `/app/.secrets`: la escribe
   `setup` y circuit la lee sin poder cambiarla. Si el dueño corre Compose sobre su base de
   desarrollo, la semilla rota la llave de su `.secrets/` (ADR-0009 D19); `npm run db:seed` la vuelve
   a emitir.
6. **Sin modelo real.** Compose no pasa `ANTHROPIC_API_KEY` ni `CIRCUIT_MODEL`: siempre el simulador
   (ADR-0015 A1).
7. **`.dockerignore` es una lista de lo permitido.** Empieza con `*`; entra solo lo que la imagen
   necesita, y nunca `.env`, `.secrets/`, `docs/privado/`, `database/backups/` ni `node_modules/`.
8. **CI lo recorre en una máquina limpia.** El trabajo `compose` levanta todo sin `.env`, pide la
   muestra `normal`, la aprueba y comprueba que las siete estaciones quedaron completas
   (`docker/smoke.ts`, dentro del contenedor de circuit), y que el tablero responde en `127.0.0.1`.

## Pruebas que la vigilan

| Cláusula | Prueba | Mutante que debe ponerla en rojo |
|---|---|---|
| 2 | `config.test.ts` de crm y de circuit, `connection.test.ts`, `crm-client.test.ts` | Q1: aceptar la variable sin `/.dockerenv` · Q2: escuchar en `0.0.0.0` sin la variable |
| 3, 6 | `compose.test.ts` | Q3: publicar el CRM · Q4: pasar `ANTHROPIC_API_KEY` · Q5: un puerto sin `127.0.0.1` |
| 1 | `compose.test.ts` | Q6: el `FROM` sin digest |
| 7 | `dockerignore.test.ts` | Q7: permitir `.env` · Q8: quitar el `*` inicial |
| 8 | el trabajo `compose` de CI y `docker/smoke.ts` | se ve en CI, no en `npm run check` |

## Consecuencias

- El README baja a una orden: `docker compose up`, y abrir `http://127.0.0.1:4020`.
- La primera vez construye la imagen (unos minutos); las siguientes, segundos.
- `docker compose down -v` borra la base, las contraseñas generadas y la llave juntas: la próxima
  vez empieza de cero, coherente.
- Si alguien crea `.env` con otra `POSTGRES_PASSWORD` después de la primera vez, la base no la
  acepta (PostgreSQL fija la contraseña al crearse): `docker compose down -v` y de nuevo.
