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
  no ve otra empresa; lo rechaza la API del CRM simulado.
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

2026-11-24: ADR-0003 aceptada (opción 4: monolito modular con el CRM aparte).
Remoto: https://github.com/ru3enaa1/Circuit. F0 en curso en `feat/f0-base`: F0.1 cerrado;
F0.2 cerrado (npm workspaces con `apps/circuit` y `apps/crm`, TypeScript estricto, Vitest
con un proyecto por app). F0.3 cerrado (los cinco módulos de circuit, vacíos, y la prueba
de arquitectura con controles positivos). F0.4 cerrado (PostgreSQL 18.7 en Compose, solo en
`127.0.0.1`; Drizzle; la migración inicial con los esquemas `circuit` y `crm`, y sus pruebas
contra una base desechable). Sin código de producto todavía. F0.5 hecho en local: cobertura
con piso de 80 (confirmado por el dueño), guarda de secretos con sus controles positivos y `.github/workflows/ci.yml`;
falta su prueba en GitHub, que necesita un push con el sí del dueño. ADR-0004 (retroactiva
de F0.5) aceptada el 2026-11-24, con su línea base en `docs/reviews/`; la auditoría va en una
sesión nueva, antes del push.

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
- `database/dev/` y `database/backups/` no entran a git.

## 8. Trampas

Se registran con el formato de pitfall-log: regla, síntoma, causa, chequeo y fecha.

**Entorno:**
- Windows con Git Bash: los guiones de `guards/` corren con `bash`; los archivos comparados
  byte a byte van en LF (`.gitattributes`).
- **npm se corre en PowerShell, no en Git Bash** (2026-11-24). Síntoma: `npm test` o `npx`
  fallan con `""node"" no se reconoce como un comando interno o externo`. Causa: el
  `cmd.exe` que abren los atajos de npm no ve `C:\Program Files\nodejs` en el PATH cuando
  lo lanza Git Bash. Se vio en el Bash de Claude Code; no se ha confirmado en otra terminal
  de Git Bash. Chequeo: desde bash, `cmd //c "where node"` debe encontrar node antes de
  usar npm.
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
npm run check       # tipos y pruebas con cobertura: lo que corre CI, sin las guardas
$env:CIRCUIT_INVERT_CONTROL='1'; npm test; echo $LASTEXITCODE; Remove-Item Env:CIRCUIT_INVERT_CONTROL   # control positivo: debe dar 1
Set-Content apps\circuit\src\modules\circuit\planted.ts "import '@anthropic-ai/sdk';"; npm test; echo $LASTEXITCODE; Remove-Item apps\circuit\src\modules\circuit\planted.ts   # arquitectura: debe dar 1
```

Verificados el 2026-11-24 en PowerShell, con seis violaciones plantadas (puerto en todas las
interfaces, imagen sin digest, `.sql` fuera del journal, `DROP`, SQL roto y un esquema que
falta), cada una en rojo en su prueba:

```powershell
Copy-Item .env.example .env                       # y poner POSTGRES_PASSWORD (sin BOM)
docker compose up -d --wait db                    # PostgreSQL 18.7 en 127.0.0.1, espera a que esté sano
npm run db:migrate                                # aplica las migraciones pendientes a la base de desarrollo
npm run db:generate -- --name <nombre>            # escribe una migración desde database/schema.ts
npx vitest run --project database                 # solo las pruebas de la base y de Compose
docker compose stop db                            # detiene la base y conserva el volumen
```

Verificados el 2026-11-24 (F0.5). La guarda de secretos, contra 16 casos plantados y cinco
mutantes de sí misma, todos en rojo; la cobertura, contra un archivo sin pruebas plantado en
`apps/circuit/src`, que la bajó a 65,62 % y la hizo salir con 1. Son los pasos de CI:

```sh
bash guards/check-secrets.test.sh                 # controles positivos de la guarda: 0 si los 16 casos pasan
bash guards/check-secrets.sh                      # lo versionado y lo nuevo sin ignorar: 0 limpio, 1 hallazgo, 2 nada revisado
bash guards/check-line-endings.sh '*.sh' '*.json' '*.sql' 'database/examples/**' '**/golden/**'
bash guards/check-forbidden-phrases.sh forbidden-phrases.txt apps database   # README.md se suma en F0.6
```

```powershell
npm audit --audit-level=low   # 0 sin vulnerabilidades conocidas (no se probó con una plantada)
npm run test:coverage         # pruebas con cobertura: bajo el piso de 80 sale con 1
```

Arrancar la app se agrega cuando exista un servidor (F1).

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
