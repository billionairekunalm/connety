// jsqr ships no types and there's no @types package; just enough of its shape for scanner.ts.
declare module 'jsqr' {
  interface QRCode { data: string }
  export default function jsQR(data: Uint8ClampedArray, width: number, height: number): QRCode | null
}
