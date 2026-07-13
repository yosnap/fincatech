import { ConfirmDialog } from '#components'

export interface ConfirmDialogOptions {
  title: string
  description?: string
  confirmLabel?: string
  color?: 'error' | 'primary' | 'neutral'
}

// Sustituye a window.confirm() (bloqueante, sin estilo) en toda la app — modal consistente
// con el resto de la UI, basado en el patrón oficial de Nuxt UI (useOverlay).
export function useConfirmDialog() {
  const overlay = useOverlay()

  return (options: ConfirmDialogOptions): Promise<boolean> => {
    const modal = overlay.create(ConfirmDialog, {
      destroyOnClose: true,
      props: options
    })
    return modal.open()
  }
}
