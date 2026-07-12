import { createError } from 'h3'

// Fuera de Nitro (vitest puro) los globals auto-importados de h3 no existen. Este setup
// solo corre en el proceso de vitest — nunca toca el bundle de Nitro — así que es seguro
// importar 'h3' aquí directamente sin riesgo de que el bundler mezcle versiones de h3.
(globalThis as unknown as { createError: typeof createError }).createError = createError
