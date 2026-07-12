export default defineNuxtRouteMiddleware(async () => {
  const { data } = await useAuth().getSession()
  if (!data) return navigateTo('/login')
})
