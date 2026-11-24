# ADR-0003 · Monolito modular para Circuit, con el CRM simulado aparte

- **Fecha:** 2026-11-24
- **Estado:** propuesta (la decide el dueño)

## Contexto

F0.2 crea la estructura del código. La primera propuesta fue un monorepo con paquetes y
aplicaciones separados (`packages/core`, `packages/model-sim`, `apps/server`, `apps/crm`,
`apps/board`). El dueño prefiere un monolito modular, como en sus proyectos anteriores:
da más alcance y no limita a quien retome el código, aunque Circuit sea una demostración.

Hay dos fuerzas en tensión:

- **Simplicidad para correr y retomar:** un comando, pocas piezas y un código que se lee
  de una vez (ADR-0002).
- **El permiso mínimo lo impone el CRM, no el prompt** (`CLAUDE.md`, innegociables). En la
  realidad el CRM es un sistema de un tercero, al que se llega por la red y con una llave.

## Opciones consideradas

1. **Monolito sin módulos:** una aplicación con carpetas libres. Es lo más rápido de
   empezar, pero las fronteras se borran solas. El permiso del CRM quedaría en una
   convención que nadie comprueba. Descartada.
2. **Monolito modular con todo dentro, el CRM incluido:** un proceso, una base y módulos
   con API pública y prueba de arquitectura. Es simple de correr y de retomar. En contra:
   el agente y el CRM comparten proceso y credenciales de base, así que la frontera de
   permisos la sostiene una prueba y no la red. La frase «la API del CRM rechaza la llave
   del agente» pierde fuerza.
3. **Paquetes y servicios separados (primera propuesta):** fronteras fuertes por paquete.
   Son más piezas, más configuración por paquete y más camino para quien retome. Da una
   modularidad que una demostración no necesita.
4. **Híbrido: Circuit como monolito modular y el CRM simulado como servicio aparte:** el
   circuito, el modelo, las aprobaciones, los eventos y el escenario viven en un proceso con
   módulos. El CRM queda fuera porque representa un sistema externo. Son dos procesos y una
   base, con un esquema y un usuario por servicio.

## Decisión propuesta

Opción 4.

```
apps/
  circuit/          un solo proceso Fastify; también sirve el tablero compilado
    src/modules/
      circuit/      núcleo: estaciones, ramas, eventos (genérico)
      model/        interfaz del modelo, simulador y, en F3, el adaptador de Anthropic
      crm-client/   adaptador HTTP hacia el CRM, con la llave del agente
      approval/     estación 6: aprobar, corregir, rechazar
      scenario/     carga el paquete de escenario
  board/            React con Vite; en Compose lo sirve circuit
  crm/              servicio aparte: su API, sus llaves, su esquema, su bitácora
scenarios/
  escuela/          datos sintéticos y material del programa (cambiable)
```

Los nombres en el código van en inglés (decidido por el dueño el 2026-11-24). La interfaz,
los documentos y los commits van en español.

Si más adelante se quiere separar un módulo, su `index.ts` ya es la costura: se mueve sin
reescribir a quien lo usa.

## Cláusulas

| Id | Regla | Chequeo | Crítica |
|---|---|---|---|
| M1 | Un módulo solo se usa por su `index.ts`; importar el interior de otro módulo falla | Prueba de arquitectura en F0.3 con una importación plantada | sí |
| M2 | El módulo `circuit` no importa implementaciones de `model` ni el SDK de Anthropic | Prueba de arquitectura (ADR-0001 D2) | sí |
| M3 | `apps/circuit` no importa código de `apps/crm`; solo le habla por HTTP con su llave | Prueba de arquitectura entre workspaces y ninguna dependencia declarada | sí |
| M4 | El usuario de base de circuit no puede leer ni escribir el esquema del CRM | Prueba en F1 que se conecta como circuit, consulta el CRM y espera el rechazo | sí |
| M5 | Compose levanta tres servicios: base, crm y circuit | Prueba que lee `compose.yaml` | no |

## Cerco

- **Puede cambiar:** los módulos internos de circuit, mientras cumplan M1 y M2.
- **No debe cambiar sin otra ADR:** que el CRM sea un proceso aparte, ni las cláusulas M3 y M4.

## Consecuencias

- Hay dos procesos y una base, en vez de tres aplicaciones y dos paquetes: un `docker compose up` más corto.
- La frontera de permisos del CRM es real (red, llave y usuario de base), no una convención.
- Cuesta mantener un adaptador HTTP en vez de una llamada directa. Ese mismo adaptador es
  la pieza que se cambia por un CRM de verdad.
