import type { media } from '../db/schema'
import { getSignedUrl } from '../services/storage'

type MediaRow = typeof media.$inferSelect

export interface MediaWithUrl {
  id: string
  type: string
  createdAt: Date
  uploadedBy: string
  url: string
}

// Miniaturas + lightbox necesitan la URL firmada ya resuelta en el listado (no una por
// click) — expiración más larga que una descarga puntual porque la galería se puede quedar
// abierta un rato navegando fotos.
const GALLERY_URL_EXPIRY_SECONDS = 3600

export async function resolveMediaUrls(rows: MediaRow[]): Promise<MediaWithUrl[]> {
  return Promise.all(rows.map(async row => ({
    id: row.id,
    type: row.type,
    createdAt: row.createdAt,
    uploadedBy: row.uploadedBy,
    url: await getSignedUrl(row.objectName, GALLERY_URL_EXPIRY_SECONDS)
  })))
}
