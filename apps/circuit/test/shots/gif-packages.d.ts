// The few calls of gifenc 1.0.3 and pngjs 7.0.0 that board-gif.ts makes. Neither ships its own
// types, and a review tool does not justify two more @types packages.

declare module 'gifenc' {
  export type Palette = number[][];
  export interface Encoder {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options: { readonly palette?: Palette; readonly delay?: number; readonly repeat?: number; readonly transparent?: boolean; readonly transparentIndex?: number; readonly dispose?: number },
    ): void;
    finish(): void;
    bytes(): Uint8Array;
  }
  const gifenc: {
    GIFEncoder(): Encoder;
    quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number): Palette;
    applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette): Uint8Array;
  };
  export default gifenc;
}

declare module 'pngjs' {
  const pngjs: {
    PNG: { sync: { read(buffer: Buffer): { readonly width: number; readonly height: number; readonly data: Buffer } } };
  };
  export default pngjs;
}
