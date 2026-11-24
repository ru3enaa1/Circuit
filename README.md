# Circuit

Pieza de portafolio en construcción. La meta: un agente de texto que atiende solicitudes
entrantes y trabaja dentro de un CRM, con un tablero donde cada solicitud recorre siete
estaciones y una persona aprueba lo que el modelo no debe decidir.

**Estado: fase F1, el CRM simulado.** Existe su esquema de base de datos; todavía no hay
servidor del CRM, ni agente, ni tablero. Lo que sigue está en el
[plan de desarrollo](DEVELOPMENT_PLAN.md).

## Qué hay hoy

- Un monorepo TypeScript con npm workspaces: `apps/circuit`, con sus cinco módulos vacíos,
  y `apps/crm`, con el esquema del CRM y sin servidor.
- El esquema del CRM, donde la base impone las reglas aunque la API se equivoque: cada
  cuenta ve solo sus filas (seguridad por filas), el rol del servicio no puede borrar, cada
  escritura deja una fila de bitácora con quién la propuso y quién la aprobó, y las llaves
  se guardan solo como SHA-256 ([ADR-0005](docs/adr/0005-esquema-crm.md)). El esquema
  completo se lee en [database/schema.sql](database/schema.sql), generado desde una base
  migrada.
- Una prueba de arquitectura: el núcleo no importa ningún otro módulo ni el SDK de
  Anthropic, y cada módulo se usa solo por su `index.ts`
  ([ADR-0001](docs/adr/0001-codigo-ordena-el-circuito.md),
  [ADR-0003](docs/adr/0003-monolito-modular.md)).
- PostgreSQL 18.7 en Docker Compose, publicado solo en `127.0.0.1`, con las migraciones
  probadas contra bases desechables.
- Guardas de secretos, de frases prohibidas y de finales de línea, y GitHub Actions con los
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

Abrir `.env` y poner una contraseña en `POSTGRES_PASSWORD`. Se guarda en UTF-8 sin BOM. Si
otro PostgreSQL ya usa el puerto 5432, cambiar `DB_PORT`.

```sh
docker compose up -d --wait db
npm run db:migrate
npm run check
```

`npm run check` corre los tipos y las pruebas con cobertura: sale con 0 si todo pasa.
`docker compose stop db` detiene la base y conserva sus datos.

Las guardas, en Git Bash:

```sh
bash guards/check-secrets.sh
bash guards/check-forbidden-phrases.sh forbidden-phrases.txt README.md apps database
```

## Dónde está cada decisión

| Archivo | Qué guarda |
|---|---|
| [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) | Las fases, su estado y las recomendaciones abiertas |
| [docs/adr/](docs/adr/) | Las decisiones de arquitectura, con sus razones |
| [docs/reviews/](docs/reviews/) | Las líneas base y las auditorías de esas decisiones |
| [CLAUDE.md](CLAUDE.md) | Las reglas del proyecto y los comandos verificados |
