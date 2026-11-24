# ADR-0005 · El esquema `crm` aísla cada cuenta, no borra y no deja escribir sin bitácora, y lo impone la base

- **Fecha:** 2026-11-24
- **Estado:** aceptada el 2026-11-24. El dueño delegó en Claude las siete preguntas («toma
  estas decisiones con enfoque al mejor resultado final») y pidió seguir sin la auditoría de
  `adr-guard`. Las respuestas y las enmiendas que salieron al implementarla están en
  «Aceptación», al final. Auditada después, a pedido del dueño, el mismo día: APROBAR CON
  CONDICIONES (`docs/reviews/ADR-0005-audit-2026-11-24.md`). Las enmiendas A6–A9, ya en las
  cláusulas, cierran sus condiciones (ver «Auditoría y enmiendas A6–A9»)
- **Tarea:** F1.1 de `DEVELOPMENT_PLAN.md`: «esquema y migración» del CRM simulado
  (cuentas, empresas, contactos, notas, tareas, etapas, bitácora y llaves). F1 está
  terminada cuando «la llave del agente no borra, no exporta y no ve otra empresa» y las
  pruebas «fallan por la razón correcta». Incluye R8: `database/schema.sql` generado y
  comparado.
- **Retroactiva:** no. Base `2eb4c74` (F0 integrada a `main`, más el commit de cierre).
- **Cita sin reescribir:** ADR-0001 D4 (nada se escribe sin aprobación), ADR-0003 M3 y M4
  (el CRM aparte; el usuario de circuit no ve el esquema del CRM) y la regla de producto 4
  (el núcleo es genérico; el escenario es un paquete).

## Contexto

F1.1 crea las primeras tablas. Tres innegociables de `CLAUDE.md` dependen de ellas: el
permiso mínimo lo impone el CRM y no el prompt; toda escritura queda en bitácora con quién
la propuso y quién la aprobó; los datos son sintéticos. Si estas reglas viven solo en el
código de la API, basta un `WHERE` olvidado en F1.2 para que una cuenta vea a otra, y basta
un camino de escritura sin bitácora para que la bitácora mienta.

Hay además un choque de nombres. En el plan, «empresa» es a la vez la cuenta del CRM (el
alcance de la llave: la escuela) y la empresa del prospecto que escribe. En el esquema
tienen que ser dos cosas distintas.

## Opciones consideradas

1. **Todo en la API:** tablas simples; la API filtra por cuenta, escribe la bitácora en la
   misma transacción y nunca borra. Es lo más corto de escribir. Una consulta olvidada
   filtra datos de otra cuenta, y nada en la base lo detecta.
2. **La base impone las reglas:** un rol sin `DELETE`, seguridad por filas (RLS) por cuenta,
   llaves foráneas compuestas con la cuenta, una bitácora que escribe un trigger y llaves que
   se resuelven solo por una función. Son más SQL a mano y más pruebas contra la base. Un
   error en la API falla cerrado: cero filas o la escritura rechazada.
3. **Una base por cuenta:** el aislamiento más fuerte. Es demasiado para una demostración
   local con una sola escuela, y complica las migraciones y las pruebas.

## Decisión

Opción 2 (pregunta 3).

- **Nombres:** la cuenta del CRM es `account` (en la interfaz, «cuenta»). La empresa del
  prospecto es `company` («empresa») (pregunta 1).
- **Ocho tablas en `crm`:** `accounts`, `api_keys`, `pipeline_stages`, `companies`,
  `contacts`, `notes`, `tasks` y `audit_log` (la bitácora). La etapa va en el contacto
  (`contacts.stage_id`), porque la estación 5 «busca el contacto, propone la nota, la tarea
  y el cambio de etapa» (pregunta 2). Las etapas son filas por cuenta que trae la
  semilla del escenario, no un `enum` del esquema (regla de producto 4). `companies` lleva
  sector, tamaño y rango de facturación (`industry`, `size_range`, `revenue_range`), los
  tres opcionales, porque la semilla de F1.5 los trae (enmienda A1).
- **Identificadores:** `bigint` con `GENERATED ALWAYS AS IDENTITY`. En una base nueva, la
  misma semilla y la misma entrada dan los mismos ids, que es lo que pide «Reproducible»
  (pregunta 4).
- **Dónde viven las tablas:** en `apps/crm/src/db/schema.ts`. El CRM es dueño de su
  esquema (ADR-0003). `drizzle.config.ts` lista ese archivo y `database/schema.ts`, y las
  migraciones siguen en `database/migrations/`, con una sola historia (pregunta 5).
- **Dos migraciones:** `0001` la genera `npm run db:generate` (tablas, restricciones e
  índices). `0002` se escribe a mano (`npm run db:generate -- --custom --name
  crm_security`): roles, permisos, RLS, funciones y el trigger, en un solo archivo que se
  lee de una vez. drizzle-kit no genera triggers.
- **Roles de base:** `crm_service` y `circuit_service`, sin login (`NOLOGIN`). Los usuarios
  con contraseña que heredan de ellos llegan en F1.2, desde variables de entorno. Ninguna
  migración lleva una contraseña.
- **Contexto por transacción:** la API fija `crm.account_id`, `crm.api_key_id`,
  `crm.proposed_by`, `crm.approved_by` y `crm.approval_ref` con `set_config(…, true)`, que
  dura solo la transacción. Las políticas y el trigger leen esos valores. Sin cuenta, no se
  ve nada; sin autor, no se escribe nada.

## Cláusulas

Cada chequeo se corre tal como está en «Chequeos, tal como se corren». «Como
`crm_service`» quiere decir `SET ROLE crm_service` dentro de una base desechable.

| Id | Regla | Chequeo | Crítica |
|---|---|---|---|
| D1 | `crm` tiene exactamente las ocho tablas de la decisión, con las columnas de una lista fija; la lista coincide con `apps/crm/src/db/schema.ts` | `crm-structure-db.test.ts`: «crm tiene las tablas y columnas de la lista» y «la base migrada coincide con schema.ts» | no |
| D2 | Los únicos datos personales del esquema son `contacts.full_name` y `contacts.email`. No hay teléfono, dirección ni documento | La misma lista fija de D1, revisada columna por columna | sí |
| D3 | Toda tabla de `crm`, salvo `accounts`, tiene `account_id bigint NOT NULL`. Toda llave foránea entre tablas de `crm` que no apunta a `accounts` es compuesta, `(account_id, …)` | `crm-structure-db.test.ts`: «cada llave foránea lleva la cuenta», leyendo `pg_constraint`; `crm-rules-db.test.ts`: una nota de la cuenta A que apunta a un contacto de B falla con 23503 | sí |
| D4 | Las ocho tablas tienen RLS. Como `crm_service`, solo se ven y se escriben filas de la cuenta de `crm.account_id`; sin esa variable, o con la variable vacía, se ven 0 filas y toda inserción falla | Estructura: `relrowsecurity` en cada tabla de `crm`. Conducta: con A fijada se cuentan solo las filas de A; sin cuenta, 0; insertar con la cuenta de B teniendo A fijada falla con 42501. Insertar sin cuenta o con la cuenta vacía, y un `UPDATE` sin `WHERE` que movería las filas a B, también fallan con 42501, y cada 42501 de D4 comprueba que el mensaje es el de una política (A7) | sí |
| D5 | `crm_service` no tiene `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER` ni `MAINTAIN` sobre ninguna tabla, ni permisos por columna, ni permisos sobre las secuencias. Solo lee `accounts`, `pipeline_stages` y `audit_log`, y no tiene ningún permiso sobre `api_keys`. Ninguna política deja quitar filas | `crm-structure-db.test.ts`: la matriz de las ocho tablas por los ocho permisos (`has_any_column_privilege` para los cuatro que admiten columnas), comparada con una matriz fija, y las secuencias sin permisos; `crm-rules-db.test.ts`: un `DELETE` y un vaciado reales fallan con 42501 | sí |
| D6 | Borrar es archivar: `companies`, `contacts`, `notes` y `tasks` tienen `archived_at timestamptz NULL` | La lista fija de D1 | no |
| D7 | Cada `INSERT` o `UPDATE` sobre `companies`, `contacts`, `notes` y `tasks` escribe una fila en `audit_log`, en la misma transacción. Esa fila guarda la tabla, el id, la operación, los nombres de las columnas cambiadas, `api_key_id`, `proposed_by`, `approved_by` y `approval_ref`, y nunca un valor. Esos tres últimos son identificadores opacos (`AUDIT_AUTHOR_PATTERN`): nunca un nombre ni un correo (A8) | `crm-rules-db.test.ts`: cambiar el correo de un contacto deja una fila con `changed_columns = {email}`, y el texto de esa fila no contiene ni el correo viejo ni el nuevo. Un nombre en `proposed_by`, un correo en `approved_by`, y una frase o más de 40 caracteres en `approval_ref` fallan con 23514 en su restricción (A8) | sí |
| D8 | Una escritura en esas cuatro tablas sin `crm.proposed_by` o sin `crm.approved_by` falla con SQLSTATE `P0001` y el mensaje «crm: escritura sin autor», y no deja ni la fila ni la bitácora | `crm-rules-db.test.ts`: se comprueban el código, el mensaje y que los conteos no cambian | sí |
| D9 | `audit_log` solo crece. `crm_service` no puede hacer `UPDATE` ni `DELETE` en ella, y la escribe solo a través del trigger | `crm-rules-db.test.ts`: como `crm_service`, `UPDATE` y `DELETE` en `audit_log` fallan con 42501, y un `INSERT` directo también | sí |
| D10 | Una llave se guarda solo como su SHA-256: `key_hash bytea` único, con `octet_length = 32`. Ninguna columna guarda la llave. `crm_service` resuelve una llave solo con `crm.resolve_api_key(bytea)`, que devuelve el id, la cuenta (id y `slug`) y los permisos de una llave no revocada | `crm-rules-db.test.ts`: un hash de 31 bytes falla con 23514; como `crm_service`, `SELECT` en `api_keys` falla con 42501; la función devuelve la llave vigente y nada para la revocada | sí |
| D11 | Los permisos de una llave son un conjunto cerrado, `read`, `write`, `delete` y `export`, y nunca vacío | `crm-rules-db.test.ts`: `{admin}` y `{}` fallan con 23514 | sí |
| D12 | Toda función de `crm` fija `search_path = pg_catalog, pg_temp`, nombra cada objeto de `crm` con su esquema y no deja `EXECUTE` a `PUBLIC`; `crm_service` ejecuta solo `context_account_id` y `resolve_api_key` | `crm-structure-db.test.ts`: consulta a `pg_proc` (`prosecdef`, `proconfig`) y `has_function_privilege` para `public` y para `crm_service`, comparada con una lista fija | sí |
| D13 | ADR-0003 M4 en los dos sentidos: `circuit_service` no tiene ningún permiso en `crm`, ni `crm_service` en `circuit` | `crm-rules-db.test.ts`: como `circuit_service`, `SELECT` en `crm.contacts` falla con 42501; `has_schema_privilege` es falso en los dos sentidos | sí |
| D14 | Los roles los crea la migración, `NOLOGIN` y de forma idempotente, también con dos bases migrando a la vez en el mismo servidor. Si un rol ya existe con login, atributos de administrador o membresías, la migración falla en vez de usarlo. Ninguna migración tiene `LOGIN` ni `PASSWORD` | `migrations-db.test.ts`: dos bases desechables migradas a la vez (`Promise.all`) y los roles sin atributos ni membresías de más. En CI, ese par corre antes de `db:migrate`, sobre un servidor que nunca tuvo los roles, con `CIRCUIT_FRESH_ROLES=1`, que lo pone en rojo si ya existían (A6). La guarda de `0002`, tal como está escrita, falla con P0001 y su mensaje con `crm_service` en `LOGIN`, con una membresía y con `circuit_service` en `BYPASSRLS`, en una transacción que se deshace (A6). `migration-files.test.ts`: ninguna migración tiene esas dos palabras (la regla y sus controles, en `migration-rules.test.ts`) | sí |
| D15 | Las migraciones siguen yendo solo hacia adelante. `0000_init.sql` no cambia, ni ninguna migración ya fijada en `database/test/migration-hashes.ts`. Todo se aplica a una base vacía, y una segunda corrida no aplica nada | `migration-files.test.ts` y `migrations-db.test.ts` (los de F0.4, ampliados y no debilitados). `migration-files.test.ts` compara el SHA-256 de cada migración del journal con esa lista, que solo crece (A9); `git diff --exit-code 2eb4c74 -- database/migrations/0000_init.sql` | sí |
| D16 | `database/schema.sql` es el `pg_dump --schema-only --no-owner --restrict-key=circuit` de una base desechable recién migrada, con los permisos y las políticas. Una prueba falla si difiere, y nombra el comando que lo regenera (`npm run db:dump-schema`) | `schema-dump-db.test.ts`; control: una columna plantada en el archivo la pone en rojo, con el comando en el mensaje | no |
| D17 | F1.1 no agrega dependencias. Fastify y zod entran en F1.2 | `git diff --exit-code 2eb4c74 -- package.json package-lock.json` (sin cambios en `dependencies` ni en el lockfile; `scripts` sí puede cambiar) | no |

### Chequeos, tal como se corren

En PowerShell (CLAUDE.md §8):

```powershell
docker compose up -d --wait db
npx vitest run --project database          # D1–D16: las pruebas de la base, sobre bases desechables
npm run check; echo $LASTEXITCODE          # todo, con el piso de cobertura: debe dar 0
```

En Git Bash:

```sh
# C15 y C17: deben salir con 0 y dar 0 líneas
git diff --exit-code 2eb4c74 -- database/migrations/0000_init.sql; echo $?
git diff 2eb4c74 -- package-lock.json | wc -l
```

C14 ya no es un `grep` a mano: la regla vive en `database/test/migration-rules.ts`
(`findCredentialClauses`), con sus controles, y corre en CI sobre cada migración.

La carrera de D14 (A6) solo se ejerce en un servidor que nunca tuvo los roles. CI la corre
antes de `db:migrate`. En local, contra un PostgreSQL desechable (la imagen de
`compose.yaml`, sin volumen, en otro puerto y con una contraseña de un solo uso), nunca
contra la base de desarrollo. Así se corrió el 2026-11-24:

```powershell
$pw = [guid]::NewGuid().ToString('N')
docker run -d --rm --name circuit-race-check -p 127.0.0.1:55432:5432 -e POSTGRES_USER=circuit_admin -e "POSTGRES_PASSWORD=$pw" -e POSTGRES_DB=circuit postgres:18.7-trixie@sha256:c699303802144847d238196173655dbbecf7a96aeca1565f2b02eb671a1f0b6b
do { Start-Sleep 1; docker exec circuit-race-check pg_isready -U circuit_admin -h 127.0.0.1 } until ($LASTEXITCODE -eq 0)
$env:DB_PORT='55432'; $env:POSTGRES_PASSWORD=$pw; $env:CIRCUIT_FRESH_ROLES='1'
npx vitest run --project database migrations-db -t "two disposable databases"; echo $LASTEXITCODE   # 0; una segunda vez en el mismo servidor, 1
Remove-Item Env:DB_PORT, Env:POSTGRES_PASSWORD, Env:CIRCUIT_FRESH_ROLES; docker stop circuit-race-check
```

### Mutantes

Cada uno, plantado en la migración real y restaurado después (comprobado por hash), debe
poner en rojo su prueba: quitar la política de `contacts` (D4); dar `DELETE` sobre `notes`
a `crm_service` (D5); quitar el trigger de `tasks` (D7); guardar el valor nuevo en
`audit_log` (D7); aceptar `approved_by` vacío (D8); dar `SELECT` sobre `api_keys` (D10);
quitar `search_path` de `resolve_api_key` (D12); crear los roles sin la guarda de
idempotencia (D14). Se agregaron cuatro: la llave foránea de `notes` sin la cuenta (D3),
el contexto sin `nullif` (D4), los permisos sin la lista cerrada (D11) y un `UPDATE` que
registra todas las columnas (D7).

Con A6–A9 entran los que la auditoría vio escaparse, cada uno en rojo en su prueba: una
política de inserción que acepta la cuenta vacía (M01, D4); `WITH CHECK (true)` en el
`UPDATE` de `companies` (M20, D4); quitar `INSERT` del permiso de `companies` (M23, D4: el
mensaje de RLS lo distingue de un permiso que falta); la guarda de roles cambiada por `NULL`
(M02) o sin la membresía (M19), los dos de D14; una línea agregada a `0000_init.sql` (M16,
D15: solo la ve el hash); la restricción de `approved_by` cambiada por `IS NOT NULL` (M22,
D7); y, solo en el paso de CI, los roles sin la rama `unique_violation` (M21, D14).

## Cerco

- **Puede cambiar:** `apps/crm/src/db/schema.ts` (nuevo); `database/schema.ts`, `config.ts`
  y `drizzle.config.ts` (la lista de archivos de esquema y los nombres de los roles);
  `database/migrations/` (solo archivos nuevos y el journal); `database/schema.sql`;
  `database/test/` (pruebas nuevas, y un ayudante de base desechable sacado de
  `migrations-db.test.ts`); `scripts` de `package.json` (`db:dump-schema`); los comandos de
  CLAUDE.md §9 y el estado del plan.
- **No debe cambiar:** `0000_init.sql` ni su entrada en el journal; las dependencias y el
  lockfile; `compose.yaml`; `.github/workflows/ci.yml` (las pruebas nuevas corren dentro de
  `npm run test:coverage`), salvo el paso de la carrera que agrega A6; `apps/circuit`;
  `guards/`; ninguna prueba existente se debilita.
- **Fuera de alcance:** el servidor HTTP y zod (F1.2). La función que fija el contexto por
  transacción, y que `proposed_by` salga de la llave y no del cliente (F1.2 y F1.3). El
  formato de la llave, el código que la genera y los 403 con motivo (F1.4). La semilla y el
  respaldo R6 (F1.5). Los usuarios con login (F1.2). Una tabla de programas o de negocios
  (oportunidades): no están en el plan. Las tablas de `circuit` (F2.1).

## Restricciones

- Solo datos sintéticos. Las pruebas crean cuentas y contactos inventados dentro de bases
  desechables; nunca tocan la base de desarrollo (CLAUDE.md §7).
- PostgreSQL 18.7, la imagen fijada. `pg_dump` y `psql` corren dentro del contenedor
  (`docker compose exec -T db`), porque en esta máquina no están instalados. Dentro del
  contenedor, el socket local entra con `trust` (visto en `pg_hba.conf`, línea base).
- Largos máximos como constantes con nombre en `schema.ts`, para que nadie meta un texto
  sin límite: nombre, título y etiqueta, 200 caracteres; nota, 4000; correo, 254 (RFC 5321
  §4.5.3.1.3); `slug` de cuenta y clave de etapa, `^[a-z0-9-]{1,40}$`.
- El correo se guarda en minúsculas (`CHECK (email = lower(email))`), y es único por cuenta
  entre los contactos no archivados.

## Daño a vigilar

- **La base de desarrollo del dueño:** `npm run db:migrate` le aplica `0001` y `0002`. Hoy
  tiene 0 tablas y nada que respaldar (línea base). Igual se dice antes de migrarla.
  Migrada el 2026-11-24, después de un `pg_dump` a `database/backups/` (fuera de git).
- **Los roles son de todo el servidor de PostgreSQL**, no de una base. Quedan creados
  aunque se borre la base, y dos pruebas en paralelo pueden chocar al crearlos (D14). El
  choque devuelve `unique_violation` y no `duplicate_object`, y dos `ALTER ROLE` a la vez
  fallan con «tuple concurrently updated»; por eso la migración atrapa los dos códigos y
  comprueba los atributos sin alterarlos. En un servidor donde los roles ya existen, la
  prueba de D14 no vuelve a ejercer la carrera; se ejerció una vez en un servidor desechable
  (ver «Aceptación»).
- **`pg_dump` cambia en cada corrida:** pone una clave `\restrict` al azar (líneas 5 y 107
  del volcado de la línea base) y el dueño de los objetos sale del `POSTGRES_USER` de
  `.env`. Por eso D16 fija `--restrict-key` y `--no-owner`. Si un nombre de administrador
  aparece igual en un permiso, la prueba lo reemplaza por un marcador.
- **drizzle-kit no conoce las políticas ni el trigger.** `generate` compara contra su
  snapshot y no los toca, pero `drizzle-kit push` los borraría. En Circuit nunca se usa
  `push`; queda escrito en CLAUDE.md §9.
- **RLS protege contra errores, no contra un servicio comprometido:** quien controla el
  proceso del CRM puede fijar otra cuenta. Lo que protege del agente es que el agente nunca
  toca la base. Solo tiene la llave, y la API saca la cuenta de la llave. Tampoco puede el
  CRM comprobar por sí mismo que el mentor aprobó: guarda `approved_by` y `approval_ref`
  como los afirma circuit, y la verificación cruzada queda en los eventos de circuit.

## Reversión

Las migraciones solo avanzan. Antes de que haya datos, la forma de deshacerlo en local es
revertir el commit y recrear la base (`docker compose down -v`), lo que borra la base de
desarrollo. Los roles se borran a mano (`DROP ROLE crm_service, circuit_service`) después
de borrar las bases que los usan; nunca se hace desde una migración. Con datos, se revierte
con una migración nueva hacia adelante. No se puede deshacer lo ya publicado: después del
push, el diseño del esquema es público (no lleva secretos).

## Consecuencias

- F1.2–F1.4 necesitan un solo ayudante que abra una transacción y fije el contexto. Si
  alguien lo olvida, la API falla cerrada: 0 filas o «escritura sin autor», nunca datos de
  otra cuenta.
- Para que «no ve otra cuenta» dé un 403 con motivo y no un 404 casual, la cuenta va en la
  ruta (`/accounts/:slug/…`). La API compara esa cuenta con la de la llave antes de buscar
  nada, así que el 403 no revela si un registro existe. Se decide en F1.4.
- Cada tabla nueva de `crm` necesita RLS, permisos y, si es de negocio, el trigger. Si
  falta algo, D1, D4 y D5 se ponen en rojo.
- Hay SQL escrito a mano que drizzle-kit no revisa. Lo cubren pruebas contra una base real,
  y el SQL se lee completo en `database/schema.sql`.
- La bitácora no guarda valores, así que archivar un contacto no deja su correo copiado en
  una tabla que no se puede borrar.

## Aceptación

El dueño delegó las siete preguntas en Claude el 2026-11-24, con el criterio del mejor
resultado final. Las respuestas:

1. **`account` («cuenta») para la escuela y `company` («empresa») para el prospecto:** sí.
   «No ve otra empresa» pasa a «no ve otra cuenta» en CLAUDE.md y en el plan (hecho).
2. **La etapa va en el contacto:** sí, como lo dice la estación 5. Las etiquetas son datos
   del escenario.
3. **La base impone las reglas (opción 2):** sí. Es lo que demuestra el permiso mínimo
   donde no se puede saltar, que es la tesis de Circuit.
4. **Ids `bigint` de identidad:** sí, por reproducibilidad; D4 impide recorrer ids ajenos.
5. **Las tablas del CRM en `apps/crm/src/db/schema.ts`:** sí.
6. **Solo nombre y correo como datos personales:** sí. El caso no necesita teléfono.
7. **La semilla (F1.5) escribe con autor:** sí, con `proposed_by = approved_by = 'seed'`
   (identificador en inglés, como el resto del código) y sin llave (`api_key_id` nulo), así
   que también deja bitácora. Se confirma al escribir la semilla.

Enmiendas que salieron al implementarla, todas ya en las cláusulas:

- **A1 · Empresa con sector, tamaño y facturación.** La propuesta privada pide «empresas
  inventadas con sector, tamaño y un rango de facturación»; son tres columnas opcionales y
  no son datos personales.
- **A2 · `search_path = pg_catalog, pg_temp` y no `''` (D12).** Con la ruta vacía,
  PostgreSQL busca primero en el esquema temporal de la sesión los nombres de tablas y de
  tipos; quien puede crear objetos temporales podría poner uno en su lugar. La
  documentación de PostgreSQL recomienda `pg_temp` al final. Aplica a toda función de
  `crm`, no solo a las `SECURITY DEFINER`. `context_account_id` y `resolve_api_key` además
  usan `BEGIN ATOMIC`, que resuelve su cuerpo al crearlas.
- **A3 · D5 más estricto.** `MAINTAIN` (PostgreSQL 17) entra en la matriz, se leen los
  permisos por columna y se exige que las secuencias no tengan ninguno. Una política por
  comando y ninguna para quitar filas: un `DELETE` concedido por error no borraría nada.
- **A4 · D14 más estricto.** La migración falla si encuentra un rol de servicio con login,
  atributos de administrador o membresías. C14 pasa de un `grep` a mano a una regla con
  controles que corre en CI.
- **A5 · `resolve_api_key` devuelve también el `slug` de la cuenta**, para que F1.4 compare
  la cuenta de la ruta con la de la llave sin otra consulta.

Verificado el 2026-11-24, sin auditoría de `adr-guard` (decisión del dueño): 144 pruebas en
verde (68 nuevas, todas en el proyecto `database`), cobertura 98,43 / 92,3 / 100 / 98,21; los doce mutantes de
«Mutantes» en rojo, cada uno en su prueba, y la columna plantada de D16 en rojo. La carrera
de D14 se ejerció en un PostgreSQL 18.7 desechable sin los roles: con la guarda, las dos
bases migran a la vez; sin la rama `unique_violation`, una falla al crear `crm_service`.

### Auditoría y enmiendas A6–A9 (2026-11-24)

La auditoría de `adr-guard`, en una sesión aparte, dio APROBAR CON CONDICIONES: 0
bloqueantes, 1 mayor, 5 menores y 8 notas (`docs/reviews/ADR-0005-audit-2026-11-24.md`).
El código cumplía las 17 cláusulas; lo que fallaba eran chequeos que no mordían. El dueño
pidió arreglar y mejorar lo que se pudiera. Claude aplicó la recomendación de la auditoría
en cada decisión que era barata y reversible, y dejó las demás para la fase que las
necesita. El dueño puede revertir cualquiera de ellas.

- **A6 · D14 muerde (H1).** (b) `migrations-db.test.ts` corre la guarda de `0002`, leída del
  archivo, con cada rol de servicio cambiado dentro de una transacción que siempre se
  deshace, y comprueba al final que los roles siguen limpios. (a) La opción que recomendó la
  auditoría: el paso «Carrera de roles en un servidor nuevo» de `ci.yml`, antes de
  `db:migrate`, con `CIRCUIT_FRESH_ROLES=1`. Es el único cambio en `ci.yml`. Cumple C7 y C9
  de ADR-0004, porque su comando está en CLAUDE.md §9. Probado en servidores PostgreSQL 18.7
  nuevos: el código real pasa 3 de 3; en el mismo servidor, con los roles ya creados, falla
  con el aviso; M21 falla 3 de 3 con `pg_authid_rolname_index`.
- **A7 · D4 completa (H2).** Tres casos más (insertar sin cuenta, con la cuenta vacía y un
  `UPDATE` sin `WHERE`), y cada 42501 de D4 comprueba el mensaje de RLS. M01, M20 y M23 en
  rojo.
- **A8 · Autores opacos (H4).** Se decidió ahora y no en F1.3, porque la base no tiene
  filas. `0003_audit_author_format.sql` (generada) cambia las tres comprobaciones de largo
  por `AUDIT_AUTHOR_PATTERN`, que es `SLUG_PATTERN` y también limita a 40 caracteres.
  `approval_ref` entra también, porque una frase libre podría llevar un nombre. `seed`,
  `agente`, `mentor` y los ids de aprobación ya cumplen. M22 en rojo.
- **A9 · D15 automática (H6).** `database/test/migration-hashes.ts` fija el SHA-256 de
  cada migración, el mismo que drizzle guarda en `drizzle.__drizzle_migrations`: los de
  `0000` a `0002` coinciden con los de la base de desarrollo. M16 en rojo.

Quedan, cada uno con su dueño:

- **H3, de F1.2:** las funciones `SECURITY DEFINER` son del superusuario de `.env`. Entra en
  ADR-0006, junto con el usuario con login: un rol `NOLOGIN` sin superusuario, dueño de las
  tablas y funciones de `crm`, comprobado en `pg_proc.proowner` y `pg_class.relowner`.
  Claude recomienda que sí; lo decide el dueño con esa ADR.
- **H7, rechazada salvo que el dueño diga otra cosa:** elegir `id` con `OVERRIDING SYSTEM
  VALUE` o reescribir `created_at`. Los permisos por columna contradicen D5, y el riesgo
  necesita un servicio comprometido, que esta ADR deja fuera. A cambio, F1.3 nunca manda
  `id` ni `created_at`, y su prueba lo comprueba.
- **H8, H10 y H11, de ADR-0006:** los documentos de estado en «Puede cambiar»; una prueba de
  que los únicos miembros de `crm_service` son los esperados; D4 y D5 repetidas conectando
  como el usuario con login, sin `SET ROLE`.
- **H12, de F1.4:** llaves de al menos 128 bits al azar. **H13, de F1.5:** la semilla firma
  con `seed`, como dice la respuesta 7.
- **H5, H9 y H14, hechas:** dos trampas en CLAUDE.md §8 y la frase de §1. H5 es más amplia
  que lo visto: `drizzle-kit migrate` esconde cualquier error de SQL, y el registro de
  PostgreSQL lo muestra. H14 tiene la misma causa que la trampa de npm, así que quedaron en
  una.

También apareció una carrera vieja en `disposable-db.ts`: `pool.end()` no espera a que se
cierren los sockets, y `DROP … WITH (FORCE)` cortaba un backend que todavía se cerraba (2
corridas en 10 salían con 1). Está arreglada (0 en 20) y anotada en CLAUDE.md §8. Además se
plantaron los seis mutantes de «Mutantes» que la auditoría no había vuelto a plantar, y
los seis dieron rojo.

Verificado el 2026-11-24: 164 pruebas en verde, cobertura 98,46 / 92,3 / 100 / 98,24,
`npm run check` en 0. La base de desarrollo se respaldó y se migró hasta `0003`.
