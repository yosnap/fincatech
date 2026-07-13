interface CompressImageOptions {
  maxDimension?: number
  quality?: number
  minSizeBytes?: number
}

// Redimensiona + recodifica a JPEG en el navegador (Canvas nativo, sin librerías) antes de
// subir. Solo se usa en el flujo "seleccionar y subir ya" (PhotoUpload.vue) — el ticket de
// OCR y los adjuntos PDF de cotización pasan por FilePicker.vue sin pasar por aquí, porque
// reducir resolución/calidad podría perjudicar la lectura del ticket por el modelo de OCR.
export async function compressImage(file: File, options: CompressImageOptions = {}): Promise<File> {
  const { maxDimension = 1920, quality = 0.82, minSizeBytes = 300 * 1024 } = options

  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return file
  if (file.size <= minSizeBytes) return file

  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height))
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    return file
  }
  // JPEG no tiene canal alfa: sin este relleno, los píxeles transparentes de un PNG
  // (esquinas, capturas de pantalla con fondo transparente) se codificarían en negro.
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
  if (!blob || blob.size >= file.size) return file

  return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
}
