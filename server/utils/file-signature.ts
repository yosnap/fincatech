// El Content-Type de un multipart lo declara el cliente y no es de fiar (content-type
// spoofing). Antes de aceptar un comprobante verificamos los primeros bytes reales del
// archivo contra la firma esperada para el tipo declarado.
const SIGNATURES: Record<string, number[]> = {
  'image/jpeg': [0xFF, 0xD8, 0xFF],
  'image/png': [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
  'application/pdf': [0x25, 0x50, 0x44, 0x46]
}

export function matchesDeclaredType(buffer: Buffer, declaredType: string): boolean {
  const signature = SIGNATURES[declaredType]
  if (!signature) return false
  if (buffer.length < signature.length) return false
  return signature.every((byte, index) => buffer[index] === byte)
}
