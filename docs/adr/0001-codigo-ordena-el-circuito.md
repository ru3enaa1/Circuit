# ADR-0001 · El código ordena el circuito; el modelo va detrás de una interfaz

- **Fecha:** 2026-11-23
- **Estado:** aceptada

## Contexto

Circuit debe mostrar un agente útil dentro de un CRM sin perder control: qué hizo, cuánto
costó y quién aprobó. Hoy no hay llave de la API ni tope de gasto, así que el modelo va
simulado, y encenderlo después no debe obligar a reescribir.

## Opciones consideradas

1. **Agente libre que elige herramientas y pasos:** más «agéntico»; no se puede dibujar un
   mapa fiable, ni acotar permisos, ni reproducir corridas.
2. **Circuito fijo en código, modelo solo en estaciones 3–5, detrás de una interfaz:** mapa
   y bitácora deterministas, simulable y probable; menos libertad del modelo.

## Decisión

Opción 2. El orden de estaciones y las ramas viven en código. Las estaciones 3, 4 y 5
llaman al modelo solo a través de una interfaz; la implementación se elige por configuración
(simulador por defecto). El modelo propone; aplicar en el CRM exige aprobación humana.

## Cláusulas

| Id | Regla | Chequeo | Crítica |
|---|---|---|---|
| D1 | La siguiente estación la decide el núcleo, nunca la salida del modelo | Prueba: una salida del simulador que «pide» otra estación no cambia la ruta | sí |
| D2 | El núcleo no importa el SDK de Anthropic ni adaptadores concretos | Prueba de arquitectura en F0 | sí |
| D3 | Cambiar de simulador a modelo real es solo configuración | Una batería de contrato corre contra ambos adaptadores | sí |
| D4 | Ninguna escritura al CRM sin evento de aprobación | Prueba negativa: aplicar sin aprobación falla | sí |
| D5 | Cada estación guarda un evento (estado, duración, tokens, costo) | Prueba: una corrida produce un evento por estación visitada | no |

## Cerco

- **Puede cambiar:** adaptadores, prompts, el paquete de escenario.
- **No debe cambiar sin otra ADR:** el orden de estaciones, la interfaz del modelo, la regla de aprobación.

## Consecuencias

- Mapa, bitácora y pruebas son deterministas con el simulador.
- Mientras esté simulado, no se demuestra uso real de herramientas, costo ni evals no deterministas.
- Se impone con la prueba de arquitectura y las pruebas de D1, D3 y D4.
