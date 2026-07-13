// drizzle-orm 0.45.2 (driver node-postgres) envuelve el error real de `pg` en un
// DrizzleQueryError cuyo `.code` NO existe — el código de error de Postgres (23505,
// 23P01...) queda en `.cause.code`. Verificado empíricamente contra la versión instalada;
// se comprueba `.code` primero por si una versión futura del driver deja de envolver.
export function getPgErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  if ('code' in error && typeof error.code === 'string') return error.code
  const cause = 'cause' in error ? error.cause : undefined
  if (cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string') {
    return cause.code
  }
  return undefined
}
