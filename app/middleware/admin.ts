export default defineNuxtRouteMiddleware(async () => {
  const { data } = await useAuth().getSession()
  if (!data) return navigateTo('/login')
  if (data.user.role !== 'admin') return navigateTo('/')
})
