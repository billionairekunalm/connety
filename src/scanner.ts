// Live QR scanning: samples the camera feed onto a canvas each frame and decodes it with the
// browser's native BarcodeDetector where available (fast, nothing to download), falling back to
// the jsQR library — loaded only when needed — on browsers that lack it (e.g. Safari/iOS).
export const scanSupported = () => !!navigator.mediaDevices?.getUserMedia

type Stop = () => void

export async function startScan(video: HTMLVideoElement, onDetect: (text: string) => void): Promise<Stop> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
  video.srcObject = stream
  await video.play()

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const native = 'BarcodeDetector' in window ? new (window as any).BarcodeDetector({ formats: ['qr_code'] }) : null
  const jsQR = native ? null : (await import('jsqr')).default

  let stopped = false
  const stop = () => { stopped = true; stream.getTracks().forEach(t => t.stop()) }

  const tick = async () => {
    if (stopped) return
    if (video.videoWidth) {
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      ctx.drawImage(video, 0, 0)
      try {
        const text = native
          ? (await native.detect(canvas))[0]?.rawValue
          : jsQR!(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)?.data
        if (text) onDetect(text)
      } catch { /* a frame with nothing decodable in it; just try the next one */ }
    }
    if (!stopped) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)

  return stop
}
