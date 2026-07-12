import cron from 'node-cron'
import { dispatchPendingNotifications } from '../services/notification-service'

// Proceso en background dentro del mismo contenedor (Easypanel = VPS/Docker persistente,
// no serverless — ver Key Insights de la Fase 5). Vacía el outbox cada 30s.
export default defineNitroPlugin(() => {
  // noOverlap: si un tick tarda más de 30s (SMTP lento, muchos pendientes), el siguiente
  // tick no arranca en paralelo — defensa adicional junto al reclamo atómico en
  // dispatchPendingNotifications (que ya evita el reenvío aunque llegaran a solaparse).
  const task = cron.schedule('*/30 * * * * *', async () => {
    try {
      const result = await dispatchPendingNotifications()
      if (result.sent > 0 || result.failed > 0) {
        console.log('[notification-dispatcher] tick', result)
      }
    } catch (error) {
      console.error('[notification-dispatcher] fallo procesando el outbox', error)
    }
  }, { noOverlap: true })
  console.log('[notification-dispatcher] registrado, próxima ejecución:', task.getNextRun())
})
