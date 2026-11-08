import cron from 'node-cron'
import { generateDueCharges } from '../services/mortgage-service'

// Cron de la hipoteca (fase 7): cada día a las 06:00 de Madrid crea el cargo del mes si ya
// llegó su día de cargo. `generateDueCharges` es idempotente por marca de agua + índice único
// de `mortgage_period`, así que también se ejecuta una vez al arrancar para recuperar días en
// los que el contenedor estuvo caído.
export default defineNitroPlugin(() => {
  // Igual que notification-dispatcher.ts: no registrar cron en el prerender del build.
  if (import.meta.prerender) return

  // Arranque: recupera lo perdido. Con retardo para no competir con las migraciones/seed.
  setTimeout(() => {
    generateDueCharges()
      .then((result) => {
        if (result.created.length > 0) {
          console.log('[mortgage-scheduler] cargos generados al arrancar:', result.created)
        }
      })
      .catch(error => console.error('[mortgage-scheduler] fallo al generar cargos al arrancar', error))
  }, 30_000)

  const task = cron.schedule('0 6 * * *', async () => {
    try {
      const result = await generateDueCharges()
      if (result.created.length > 0) {
        console.log('[mortgage-scheduler] cargos generados:', result.created)
      }
    } catch (error) {
      console.error('[mortgage-scheduler] fallo generando el cargo de la hipoteca', error)
    }
  }, { timezone: 'Europe/Madrid' })

  console.log('[mortgage-scheduler] registrado, próxima ejecución:', task.getNextRun())
})
