export default defineNuxtRouteMiddleware(async () => {
  // Espejo del middleware auth: las páginas solo-para-invitados (login) no tienen sentido
  // con sesión activa — redirigir evita el "he iniciado sesión pero sigo viendo el
  // formulario" cuando se vuelve a /login con un marcador o autocompletado.
  const { data } = await useAuth().getSession()
  if (data) return navigateTo('/')
})
