import { useSettingsStore } from '@/core/settings/settingsStore'

type NetworkInformation = { saveData?: boolean; effectiveType?: string }
type DeviceNavigator = Navigator & { connection?: NetworkInformation; deviceMemory?: number }

/**
 * Whether this visitor should get the live 3D hero. Anyone who fails a check keeps the still
 * picture, which is a render of the same scene.
 */
export function shouldRun3D(): boolean {
  if (typeof window === 'undefined') return false
  // ?force3d lets us test the scene on machines that would otherwise be filtered out.
  if (new URLSearchParams(window.location.search).has('force3d')) return true

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false
  // The player's own data-saver switch (Settings).
  if (useSettingsStore.getState().dataSaver) return false

  const nav = navigator as DeviceNavigator
  // Data saver on, or a connection where a 3D library download would cost the visitor real money and time.
  if (nav.connection?.saveData) return false
  if (nav.connection?.effectiveType && ['slow-2g', '2g'].includes(nav.connection.effectiveType)) return false
  // Low-end hardware.
  if (nav.deviceMemory !== undefined && nav.deviceMemory <= 2) return false
  if (nav.hardwareConcurrency !== undefined && nav.hardwareConcurrency <= 2) return false

  // A real GPU, not a software fallback.
  try {
    const canvas = document.createElement('canvas')
    const options = { failIfMajorPerformanceCaveat: true }
    const gl = canvas.getContext('webgl2', options) ?? canvas.getContext('webgl', options)
    if (!gl) return false
    ;(gl as WebGLRenderingContext).getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    return false
  }
  return true
}
