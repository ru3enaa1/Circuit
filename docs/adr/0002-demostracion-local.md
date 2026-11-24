# ADR-0002 · Demostración local con corridas grabadas, sin despliegue

- **Fecha:** 2026-11-23
- **Estado:** aceptada (decisión del dueño)

## Contexto

Circuit es una prueba de habilidades para una vacante, no un negocio en marcha. El
despliegue real y el uso de tokens como producción se descartaron por poco encaje de
mercado. Aun así, la demostración debe mostrar el modelo real trabajando, y quien la evalúa
tiene poco tiempo: primero lo atrapa una visual corta y después, si quiere, va al repositorio.

## Opciones consideradas

1. **Demostración en la nube con enlace público:** se ve sin instalar nada; cuesta dinero,
   expone la llave a abuso y contradice la decisión del dueño.
2. **Local con el simulador solamente:** gratis y reproducible; no muestra valor real del modelo.
3. **Local, con corridas reales grabadas y reproducibles sin llave:** muestra el modelo real
   y sus medidas; quien clona no gasta nada. Exige grabar sin filtrar secretos.

## Decisión

Opción 3. La aplicación corre en local con `docker compose up`, sin llave. El autor graba
corridas reales en su máquina; el mapa las reproduce desde sus eventos. La atención se capta
con un GIF, un video corto y tres líneas que llevan al repositorio.

## Cláusulas

| Id | Regla | Chequeo | Crítica |
|---|---|---|---|
| D1 | `docker compose up` sin `ANTHROPIC_API_KEY` levanta todo y recorre el circuito | Trabajo de CI que arranca Compose sin la variable y corre una solicitud de prueba | sí |
| D2 | Ninguna corrida grabada contiene llaves ni encabezados de autenticación | Guarda de patrones de secretos sobre las corridas, en CI | sí |
| D3 | Compose publica puertos solo en `127.0.0.1` | Prueba que lee `compose.yaml` y rechaza otro anfitrión | sí |
| D4 | Toda cifra del README o de la página del caso sale de una corrida grabada | La página del caso se genera con un guion a partir de las corridas; CI comprueba que esté al día | no |
| D5 | Sin infraestructura aplicada en la nube | No hay credenciales de nube en CI ni pasos de despliegue | no |

## Cerco

- **Puede cambiar:** el formato de las corridas, el guion de la página del caso, el GIF y el video.
- **No debe cambiar sin otra ADR:** correr sin llave, la ausencia de enlace público.

## Consecuencias

- Revisar Circuit no cuesta nada a nadie; la llave nunca sale de la máquina del autor.
- La habilidad de desplegar en la nube no se demuestra aquí (sí en otros proyectos del
  autor); Terraform, si entra, solo se valida.
- Grabar corridas añade una superficie de fuga de secretos, cubierta por D2.
