# ADR-0004 · La rama se integra solo con la construcción local completa en verde en GitHub Actions

- **Fecha:** 2026-11-24
- **Estado:** aceptada (el dueño, 2026-11-24, con los supuestos de las preguntas abiertas).
  Enmendada el mismo día tras su auditoría (ver «Enmiendas», al final)
- **Enmendada por:** ADR-0008 A2, el 2026-11-25. En C12, con `--range`, la guarda revisa
  también el mensaje de cada commit del rango, con las reglas que leen todo archivo. Así el
  hook de `pre-push` vigila los mensajes que publica.
- **Tarea:** F0.5 de `DEVELOPMENT_PLAN.md`: «GitHub Actions: tipos, pruebas con cobertura,
  frases prohibidas sobre el README y las apps, finales de línea y patrones de secretos».
  Terminado cuando «la rama en verde; una frase plantada la pone en rojo».
- **Retroactiva:** sí. Se escribe después del código, para que la auditoría tenga un contrato.
  Base `040b09c` (F0.4), cambio `fad8728` (F0.5). Los hashes son los de después de
  reescribir el correo de los commits el 2026-11-24; antes eran `5dcc5ab` y `4134bfa`.
- **Complementa:** ADR-0002 D2 (guarda de secretos en CI) y D5 (sin infraestructura en la nube).

## Contexto

El repositorio es público. Una llave publicada una vez queda en la historia, en los forks y
en las cachés, y la única salida es rotarla. Los registros de GitHub Actions de un
repositorio público también son públicos: lo que un paso imprime, cualquiera lo lee.

Hasta F0.4, las guardas, los tipos y las pruebas solo corrían en la máquina del autor, en
Windows. La construcción tiene trampas que solo se ven en otra máquina: CRLF, binarios
nativos que faltan en el lockfile, códigos de salida que una tubería tapa (CLAUDE.md §8).
Además, la mayor parte del código la escriben agentes, así que «pasa en mi máquina» no
alcanza como prueba.

Una sola decisión, con tres partes que juntas forman la puerta de integración: qué corre CI
y con qué permisos, qué piso de cobertura hace fallar las pruebas y qué guarda detecta un
secreto. CI corre después del push: detecta, no impide. Impedir que se publique es trabajo
del hook de `pre-push` (R9), con la misma guarda sobre cada commit que se publica. Por
separado ninguna sirve como puerta. Por eso es una ADR y no tres.

## Opciones consideradas

1. **Solo local, con disciplina:** cero configuración. Depende de acordarse, no prueba nada
   en Linux y nadie de fuera puede ver la rama en verde. Descartada.
2. **GitHub Actions con los mismos comandos que en local:** gratis para un repositorio
   público. Corre en Linux limpio y deja la prueba visible. Añade superficie: el token del
   workflow, acciones de terceros y registros públicos.
3. **Un servicio de CI externo:** otra cuenta y otra credencial para una demostración sin
   despliegue (ADR-0002). No aporta nada sobre la opción 2.

Para los secretos: **gitleaks u otra herramienta externa** detecta más formas. Son una
dependencia nueva o una imagen de terceros, y su salida, si no se configura, puede imprimir
el valor. **Una guarda propia con `git grep`** solo detecta las formas que conoce, pero
corre sin dependencias, en Windows y en Linux, y se prueba con casos plantados.

## Decisión

Opción 2. El workflow corre con un token de solo lectura, con acciones fijadas por SHA, en
una máquina y una versión de Node fijas, y con los mismos comandos que CLAUDE.md §9
documenta para uso local. La base de datos se levanta con el mismo `compose.yaml` y una
contraseña generada para esa corrida (recomendación R7). Las pruebas fallan bajo 80 % en
cualquiera de las cuatro medidas de cobertura (confirmado por el dueño el 2026-11-24). Una
guarda propia con `git grep` (`guards/check-secrets.sh`) revisa lo versionado, lo nuevo sin
ignorar y el índice; con `--range`, cada commit de un rango. Nunca imprime la línea que
encuentra.

## Cláusulas

Cada chequeo se corre tal como está escrito en «Chequeos, tal como se corren», más abajo.
En la tabla solo va lo que debe dar.

| Id | Regla | Debe dar | Crítica |
|---|---|---|---|
| C1 | El token del workflow es de solo lectura: un único `permissions:`, en la raíz, con `contents: read`, y ningún permiso `write` | Una sola línea, `12:permissions:`, y `contents: read` en la 13 | sí |
| C2 | El checkout no deja el token en `.git/config` | Un único `actions/checkout`, con `persist-credentials: false` en ese paso | sí |
| C3 | Toda acción se fija a un SHA completo de 40 caracteres, con su etiqueta en un comentario, y ese SHA es el de la etiqueta | 2 acciones, ninguna fuera del formato, y cada SHA igual al de su etiqueta en GitHub | sí |
| C4 | CI no usa secretos del repositorio, credenciales de nube ni pasos de despliegue (ADR-0002 D5) | Ninguna línea (salida 1) | sí |
| C5 | La contraseña de PostgreSQL de CI se genera en la corrida y se enmascara antes de cualquier otro uso; `.env.example` la deja vacía | `openssl rand`, `add-mask` y `GITHUB_ENV` en tres líneas seguidas y en ese orden; `POSTGRES_PASSWORD` sin valor en `.env.example` | sí |
| C6 | La variable del entorno del proceso gana sobre `.env`, en las herramientas y en Compose | La prueba sale con 0 y 1 pasada; Compose da «con: True · sin: False» | sí |
| C7 | Ningún paso puede fallar sin que falle la corrida: sin `continue-on-error`, sin forzar un `true` tras un comando que falla, sin `set +e`, y con `bash` por defecto (que agrega `-o pipefail`) | Ninguna línea de lo prohibido, y `shell: bash` bajo `defaults:` | sí |
| C8 | Ninguna versión de la máquina de CI es una etiqueta móvil: Ubuntu y Node son los de CLAUDE.md §5 | Exactamente `runs-on: ubuntu-24.04` y `node-version: 24.20.0` | no |
| C9 | Cada comando de verificación de CI es uno de los que CLAUDE.md §9 documenta para uso local | Ninguna línea `FALTA:`. Se excluyen el paso del entorno (C5) y el registro que corre solo `if: failure()` | no |
| C10 | En la cabeza, la construcción completa de CI sale con 0 en local | Cada comando, con su código de salida real, en 0 | sí |
| C11 | `npm run test:coverage` sale con 1 si cualquiera de las cuatro medidas baja de 80, medidas sobre `apps/*/src/**/*.ts` y `database/*.ts` | 0 con las cuatro medidas en 80 o más; con el archivo plantado, 1 | no |
| C12 | `guards/check-secrets.sh` revisa todo archivo versionado o nuevo sin ignorar y lo que está en el índice; con `--range <rango>`, el árbol de cada commit del rango. Sale con 0 si está limpio, 1 si encuentra algo y 2 si no revisó nada | El script de prueba en 0 con «all 25 check-secrets cases pass», la guarda en 0, y cada mutante en 1 | sí |
| C13 | `guards/check-secrets.sh` imprime solo archivo, línea y regla, nunca el texto de la línea (el registro de CI es público) | Sin el `cut`, el script de prueba sale con 1 y nombra «output repeats the secret» | sí |
| C14 | La única dependencia nueva es `@vitest/coverage-v8`, en la misma versión exacta que `vitest` | El diff de `package.json` solo trae esa `devDependency` y los scripts `test:coverage` y `check`; las dos en 5.1.1 | no |
| C15 | En GitHub, la rama sale en verde y un commit con una frase prohibida plantada sale en rojo (lo que pide el dueño para dar F0.5 por terminado) | `success` en la cabeza y `failure` en el commit plantado. Antes del push que decide el dueño: NO VERIFICABLE | no |

### Chequeos, tal como se corren

Los de `bash` se corren en Git Bash, desde la raíz del repositorio:

```sh
# C1
grep -nE '^[[:space:]]*permissions:|:[[:space:]]*write\b' .github/workflows/*.yml
sed -n '13p' .github/workflows/ci.yml

# C2
grep -c 'actions/checkout' .github/workflows/ci.yml
grep -n -A3 'actions/checkout' .github/workflows/ci.yml

# C3: el primero debe dar 2 y el segundo no debe imprimir nada; ls-remote lee etiquetas públicas
grep -cE 'uses:' .github/workflows/*.yml
grep -nE 'uses:' .github/workflows/*.yml | grep -vE 'uses: [^@ ]+@[0-9a-f]{40} # v[0-9]+\.[0-9]+\.[0-9]+$'
git ls-remote https://github.com/actions/checkout 'refs/tags/v7.0.1*'     # 3d3c42e5aac5ba805825da76410c181273ba90b1
git ls-remote https://github.com/actions/setup-node 'refs/tags/v7.1.0*'   # 949feb2413d6458794dcd2491c4babbbce0c15c1
# Si la etiqueta es anotada, el SHA del commit está en la línea que termina en ^{}

# C4
grep -niE '\$\{\{[[:space:]]*secrets\.|deploy|terraform|aws|gcloud|azure|kubectl|id-token' .github/workflows/*.yml; echo "salida $?"

# C5
grep -nE 'openssl rand|add-mask|GITHUB_ENV' .github/workflows/ci.yml
grep -nE '^POSTGRES_PASSWORD=$' .env.example

# C7: el primero debe dar salida 1; el segundo, una sola línea, «23:    shell: bash»
grep -nE 'continue-on-error|\|\||set \+e' .github/workflows/*.yml; echo "salida $?"
grep -nE '^[[:space:]]+shell:' .github/workflows/ci.yml

# C8
grep -nE '^[[:space:]]*(runs-on|node-version):' .github/workflows/ci.yml

# C9
grep -E '^[[:space:]]+run: ' .github/workflows/ci.yml | grep -vE 'run: \|$|docker compose logs' \
  | sed -E 's/^[[:space:]]+run: //' \
  | while IFS= read -r c; do grep -qF -- "$c" CLAUDE.md || echo "FALTA: $c"; done

# C10, las guardas, en el orden de CI
bash guards/check-secrets.test.sh; echo "salida $?"
bash guards/check-secrets.sh; echo "salida $?"
bash guards/check-line-endings.sh '*.sh' '*.json' '*.sql' 'database/examples/**' '**/golden/**'; echo "salida $?"
bash guards/check-forbidden-phrases.sh forbidden-phrases.txt apps database; echo "salida $?"

# C12 (las dos primeras líneas de C10) y C14
git diff 040b09c fad8728 -- package.json
```

Los de `npm` y `docker` se corren en PowerShell (CLAUDE.md §8), con la base levantada:

```powershell
# C6
npx vitest run --project database -t 'lets the process environment win over the file'; echo $LASTEXITCODE
# Una sola línea, para que $prueba exista en las dos lecturas. Debe dar «con: True · sin: False».
$prueba = 'desde-entorno'; $env:POSTGRES_PASSWORD = $prueba; $con = (docker compose config --format json | ConvertFrom-Json).services.db.environment.POSTGRES_PASSWORD -eq $prueba; Remove-Item Env:POSTGRES_PASSWORD; $sin = (docker compose config --format json | ConvertFrom-Json).services.db.environment.POSTGRES_PASSWORD -eq $prueba; "con: $con · sin: $sin"

# C10, el resto, en el orden de CI
npm ci; echo $LASTEXITCODE
npm audit --audit-level=low; echo $LASTEXITCODE
npm run db:migrate; echo $LASTEXITCODE
npm run typecheck; echo $LASTEXITCODE
npm run test:coverage; echo $LASTEXITCODE   # también C11: las cuatro medidas en 80 o más

# C14
npm ls vitest @vitest/coverage-v8
```

Los controles positivos se plantan en un worktree desechable, nunca en el árbol de trabajo:

- **C11:** un archivo de unas 30 líneas de código, sin pruebas, en `apps/circuit/src`.
  `npm run test:coverage` debe salir con 1.
- **C12:** se cambia una regla de `SECRET_RULES` (por ejemplo, `sk-ant-` por `sk-anx-`).
  `bash guards/check-secrets.test.sh` debe salir con 1 y nombrar ese caso. Igual con cada
  parte que agregó la enmienda 2: sin la pasada del índice, sin las reglas o los nombres
  en `--range`, y la regla YAML leyendo todo archivo o sin anclar a la clave.
- **C13:** se quita `| cut -d: -f1,2` de `guards/check-secrets.sh`, o `| cut -d: -f1,2,3`
  en `--range`. `bash guards/check-secrets.test.sh` debe salir con 1 con «output repeats
  the secret».

C15 se corre después del push, que decide el dueño:

```sh
gh run list --branch feat/f0-base --workflow CI --limit 3 --json conclusion,headSha,displayTitle
```

## Cerco

- **Puede cambiar:** `.github/workflows/ci.yml`; `guards/check-secrets.sh` y
  `guards/check-secrets.test.sh`; el bloque `coverage` de `vitest.config.ts`; en
  `package.json`, los scripts `test:coverage` y `check` y la `devDependency`
  `@vitest/coverage-v8`; `package-lock.json` por esa dependencia; el comentario de
  `database/env.ts`; `CLAUDE.md` y `DEVELOPMENT_PLAN.md`; esta ADR y
  `docs/reviews/ADR-0004-*`.
- **No debe cambiar sin otra ADR:** el comportamiento de `database/env.ts` (en F0.5 solo
  cambia el comentario); `compose.yaml`; `.env.example`; `.gitignore`; las migraciones;
  `apps/*/src` y `apps/*/test`; el mapa de módulos; las otras guardas.
- **Fuera de alcance:**
  - La primera corrida en GitHub (C15), que necesita el push del dueño.
  - El hook de `pre-push` con la lista privada (R9).
  - La parte de ADR-0002 D2 que revisa las corridas grabadas y los encabezados de
    autenticación (F3).
  - ADR-0002 D1, Compose sin llave recorriendo el circuito (F2).
  - El README en la guarda de frases (F0.6).
  - La protección de `main` en GitHub.

## Restricciones

- Repositorio y registros de CI públicos: ningún paso imprime un secreto ni lo escribe en
  un archivo versionado.
- Local en Windows y CI en Linux: los guiones corren con `bash` y los archivos comparados
  byte a byte van en LF (`.gitattributes`).
- Reproducible: versiones exactas (`save-exact`, lockfile, Node, Ubuntu, acciones por SHA,
  imagen por digest).
- Sin costo: GitHub Actions es gratis en un repositorio público; no hay otro servicio.

## Daño a vigilar

- **Una puerta que no puede fallar:** un código de salida tapado o un `continue-on-error`
  deja la corrida en verde sin probar nada. Lo cubren C7 y los controles positivos de C11,
  C12 y C13.
- **Un secreto en un registro público:** la contraseña de la corrida o una línea que
  encuentra la guarda. Lo cubren C5 y C13.
- **El token o una acción de terceros con más poder del necesario:** lo cubren C1, C2 y C3.
  `cache: npm` guarda la caché de dependencias por rama; con `npm ci` y el lockfile, una
  caché alterada no cambia las versiones instaladas, que npm verifica contra la integridad
  del lockfile.
- **Falsos rojos:** `npm audit` puede ponerse en rojo sin un cambio de código, cuando sale
  un aviso nuevo, y el piso de cobertura puede frenar trabajo legítimo. Es el precio de la
  puerta; ver las preguntas abiertas.

## Reversión

Revertir el commit de F0.5 quita el workflow, la guarda y el piso, y CI deja de correr. No
hay datos que migrar ni nada escrito fuera del repositorio. Lo que no se deshace: lo que un
registro público ya imprimió (si fue un secreto, se rota) y una historia ya publicada.

## Consecuencias

- Cada push deja una prueba pública de que la rama compila, pasa las guardas y cubre el
  80 %. Integrar a `main` sin CI en verde queda a la vista.
- Agregar una dependencia, una acción o un permiso al workflow es un cambio visible en el
  diff y se revisa contra estas cláusulas.
- La guarda propia no detecta formas de secreto que no conoce. Cada forma nueva entra con su
  caso plantado en `check-secrets.test.sh`.
- Una rama propia con PR hacia `main` corre CI dos veces (`push` y `pull_request`). Se
  acepta: no cuesta nada.

## Preguntas abiertas

Respondidas por el dueño el 2026-11-24: se aceptan los cuatro supuestos como decisión. La 2
y la 4 se vuelven a mirar al abrir F3 y F2.

1. **¿Se exige CI en verde para integrar a `main`** (protección de rama en GitHub)?
   SUPUESTO: no, por ahora. El dueño solo integra con CI en verde, y la protección se
   configura cuando la rama se publique. Responde el dueño.
2. **ADR-0002 D2 pide revisar «encabezados de autenticación» en las corridas grabadas.**
   SUPUESTO: en F3, cuando existan corridas, la guarda gana reglas para `x-api-key` y
   `authorization: bearer`, cada una con su caso plantado. Hoy no hay corridas que revisar.
   Responde el dueño al abrir F3.
3. **¿`npm audit --audit-level=low` debe tumbar CI por un aviso de severidad baja?**
   SUPUESTO: sí. En rojo, se revisa el aviso y se decide con una nota en el plan; nunca se
   baja el nivel para salir del paso. Responde el dueño.
4. **El piso de cobertura solo sube.** SUPUESTO: el núcleo apunta a cerca de 90 cuando
   tenga código (F2), como dice `vitest.config.ts`. Responde el dueño en F2.

## Enmiendas

2026-11-24, tras la auditoría `docs/reviews/ADR-0004-audit-2026-11-24.md` (APROBAR CON
CONDICIONES). El dueño delegó la decisión de mejorar antes de cerrar F0.5.

1. **C7, el chequeo (H4).** Ahora busca cualquier `||`, no solo `|| true`, y exige una sola
   línea `shell:`. El de antes no veía `|| :`, `|| echo …` ni un `shell: bash {0}` propio de
   un paso, que quita `-e` y `pipefail`. Comprobado contra una copia plantada del workflow.
2. **C12, la guarda (H1, H2, H3).** Tres cambios:
   - **Índice (H3):** revisa también lo que está en el índice (`git grep --cached`). Una
     versión agregada con `git add` puede llevar un secreto que el archivo ya no tiene.
   - **`--range <rango>` (H1):** revisa el árbol de cada commit del rango. Una llave que
     entra en un commit y sale en el siguiente no está en la cabeza, pero sí en la historia
     que publica un push. Es la forma que usa R9.
   - **Forma YAML (H2):** `postgres-password` reconoce la clave YAML seguida de `:` y un
     valor, solo en `*.yml` y `*.yaml` y solo como clave al inicio de la línea. La forma que
     propuso la auditoría (`[=:]` en todo archivo) daba un falso rojo en
     `database/test/connection.test.ts:13`, una constante de TypeScript, y en el `${…:?…}`
     de `compose.yaml:13`.

   La batería pasa de 16 a 25 casos, y cada parte nueva tiene su mutante en rojo.
3. **Contexto (H1).** La guarda de CI detecta; impedir es trabajo de R9.
