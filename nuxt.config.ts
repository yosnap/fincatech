// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: [
    '@nuxt/eslint',
    '@nuxt/ui'
  ],

  devtools: {
    enabled: true
  },

  css: ['~/assets/css/main.css'],

  // Sin prerender: los plugins de Nitro (server/plugins/*) arrancan igual durante el
  // prerender de build y necesitan variables de entorno reales (DATABASE_URL, MinIO, etc.)
  // que en despliegue Docker solo existen en runtime, no en build — prerenderizar cualquier
  // ruta rompería el build de imagen. La home es contenido estático simple, no pierde nada
  // relevante sirviéndose por SSR normal en vez de prerenderizada.
  compatibilityDate: '2026-06-30',

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  }
})
