import { useCallback, useState } from 'react'
import Cropper, { type Area } from 'react-easy-crop'

interface Props {
  /** Object URL or remote URL of the source image. */
  src: string
  /** Pixel size of the output square (default 512). */
  outputSize?: number
  onCancel: () => void
  onConfirm: (blob: Blob) => Promise<void> | void
}

/**
 * Mobile-friendly square cropper. Pinch-to-zoom and drag on touch devices,
 * mouse-wheel + drag + slider on desktop. Returns a JPEG blob at the chosen
 * output size so we don't upload the user's full-resolution photo.
 */
export function AvatarCropper({ src, outputSize = 512, onCancel, onConfirm }: Props) {
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [pixelArea, setPixelArea] = useState<Area | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const onCropComplete = useCallback((_visible: Area, pixels: Area) => {
    setPixelArea(pixels)
  }, [])

  const apply = async () => {
    if (!pixelArea) return
    setBusy(true)
    setErr(null)
    try {
      const blob = await renderCroppedBlob(src, pixelArea, outputSize)
      await onConfirm(blob)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95">
      <div className="relative flex-1 min-h-0">
        <Cropper
          image={src}
          crop={crop}
          zoom={zoom}
          aspect={1}
          cropShape="round"
          showGrid={false}
          minZoom={1}
          maxZoom={4}
          zoomSpeed={0.5}
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onCropComplete={onCropComplete}
        />
      </div>
      <div className="bg-slate-950 text-white px-4 py-3 space-y-3 pb-safe">
        <div className="flex items-center gap-3">
          <span className="text-xs uppercase tracking-wider w-12 text-slate-400">Zoom</span>
          <input
            type="range"
            min={1}
            max={4}
            step={0.05}
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="flex-1"
            aria-label="Zoom"
          />
        </div>
        <p className="text-xs text-slate-400 text-center">
          Drag to reposition · pinch or scroll to zoom
        </p>
        {err && <div className="text-sm text-red-400 text-center">{err}</div>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 rounded-md border border-slate-600 px-4 py-2 text-sm font-medium hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={busy || !pixelArea}
            className="flex-1 rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold hover:bg-brand-500 disabled:opacity-60"
          >
            {busy ? 'Processing…' : 'Use photo'}
          </button>
        </div>
      </div>
    </div>
  )
}

async function renderCroppedBlob(src: string, area: Area, size: number): Promise<Blob> {
  const img = await loadImage(src)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not get 2D context')
  ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, size, size)
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Failed to encode image'))),
      'image/jpeg',
      0.9,
    )
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    // Handle blob: and data: URLs without CORS — for cross-origin URLs the
    // server must include `Access-Control-Allow-Origin` for canvas to be
    // export-safe. Object URLs from local files always work.
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load image'))
    img.src = src
  })
}
