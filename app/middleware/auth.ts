export default defineNuxtRouteMiddleware(async () => {
  const { data, error } = await useAuth().getSession()
  // Fallo transitorio de red/servidor — típico en dev: editar un fichero reinicia Nitro y
  // la petición cae en esa ventana. NO expulsa: la petición no afirma que no haya sesión,
  // solo que no se pudo comprobar. El middleware es conveniencia de navegación, no la
  // frontera de seguridad: cada endpoint de API aplica su propio requireRole con 401 real.
  if (error) return
  // Sin sesión O cuenta pendiente de aprobación (auto-registro sin rol asignado): no se
  // entra a ninguna página protegida — la aprobación del Admin es requisito para ver
  // cualquier dato (decisión de producto 2026-09-14).
  if (!data || data.user.pendingApproval) return navigateTo('/login')
})
