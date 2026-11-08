// Formato de salida de las herramientas: los importes viajan en céntimos (fuente de verdad) y
// además formateados en euros, para que el modelo no tenga que dividir por 100 — y para que la
// respuesta al usuario sea legible sin post-procesado.

const eurosFormatter = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' })

export function euros(cents: number): string {
  return eurosFormatter.format(cents / 100)
}

// Recorta una lista larga avisando de cuántos elementos quedan fuera: el contexto del modelo es
// finito y el listado completo de una finca puede ser enorme.
export function truncate<T>(items: T[], limit: number): { items: T[], omitted: number } {
  if (items.length <= limit) return { items, omitted: 0 }
  return { items: items.slice(0, limit), omitted: items.length - limit }
}
