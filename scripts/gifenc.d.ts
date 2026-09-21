declare module "gifenc" {
  export type Format = "rgb565" | "rgb444" | "rgba4444";
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number, options?: { format?: Format }): number[][];
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: number[][], format?: Format): Uint8Array;
  export interface Encoder {
    writeFrame(index: Uint8Array, width: number, height: number, options?: { palette?: number[][]; delay?: number; repeat?: number; transparent?: boolean }): void;
    finish(): void;
    bytes(): Uint8Array;
  }
  export function GIFEncoder(options?: { auto?: boolean }): Encoder;
}
