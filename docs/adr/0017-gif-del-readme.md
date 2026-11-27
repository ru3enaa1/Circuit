# ADR-0017 · El GIF del README se graba en tiempo real desde el caso dorado, con dos paquetes de desarrollo

- **Fecha:** 2026-11-27 · **Estado:** aceptada el 2026-11-27. Claude eligió (CLAUDE.md §1b): no
  cambia la arquitectura ni el producto; agrega dos dependencias de desarrollo y nada sale del
  repositorio.
- **Tarea:** F6 de `DEVELOPMENT_PLAN.md` (la portada del README).
- **Depende de:** ADR-0011 B10 (`board:shots`), ADR-0016 (el movimiento), CLAUDE.md §8 (el tiempo
  virtual no lleva las animaciones al paso).

## Contexto

La primera pantalla del README tiene que ser un GIF del circuito. `board:shots` no sirve para eso:
corre con tiempo virtual y sus cuadros intermedios no muestran el movimiento. En la máquina no hay
ffmpeg, ImageMagick ni gifski, y CLAUDE.md pide que quien clone el repositorio no necesite
instalar nada fuera de npm.

## Decisión

1. **`npm run board:gif`** (`apps/circuit/test/shots/board-gif.ts`) sirve el caso dorado `normal`
   desde la memoria con el mismo servidor de `board:shots` (`startBoard`), abre Chrome sin ventana con
   el puerto de depuración y graba con `Page.startScreencast` los cuadros que Chrome pinta, con su
   hora. La grabación empieza cuando la página cargó, a 1280 × 720 y con `--disable-lcd-text`, porque
   el texto con subpíxeles deja bordes azules y rosados que el GIF guarda como colores.
2. **El GIF:** como mucho 20 cuadros por segundo; cada cuadro dura lo que tardó el siguiente, y el
   último, 2,5 s. Una sola paleta de 256 colores, sacada del último cuadro (que tiene todos los
   colores de la corrida), para que nada parpadee. Se escribe en `docs/media/circuito.gif`, que sí
   entra a git (`*.gif binary`). Los cuadros quedan además como PNG en `.shots/gif/`, para revisarlos.
3. **Dos dependencias de desarrollo**, con versión exacta, verificadas en el registro el 2026-11-27:
   `gifenc` 1.0.3 (cuantiza y codifica; MIT, sin dependencias) y `pngjs` 7.0.0 (lee cada cuadro;
   MIT, sin dependencias). Ninguna trae tipos: `gif-packages.d.ts` declara las pocas llamadas que se
   usan. Solo las importa `board-gif.ts`; `npm audit` sigue en 0.
4. **Peso:** como mucho 5 MB (GitHub muestra hasta 10 MB; la mitad abre rápido). El script falla
   si se pasa, y `apps/circuit/test/readme-gif.test.ts` vigila en cada `npm test` el formato, el
   tamaño de 1280 × 720 y el peso. Un tope de 1 MB la pone en rojo.

## Límites conocidos

- El GIF no es igual byte a byte en cada grabación: cuántos cuadros pinta Chrome depende de la
  máquina (de 49 a 116 en cuatro grabaciones; de 1,4 a 2,4 MB). La corrida sí es siempre la misma.
- El primer cuadro dice «Cargando el circuito…» unos 150 ms, antes de la primera consulta.
