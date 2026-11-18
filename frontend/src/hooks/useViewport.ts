import { useSyncExternalStore } from 'react'

export type ViewportMode = 'mobile' | 'tablet' | 'desktop'

export interface ViewportInfo {
  mode: ViewportMode
  isMobile: boolean
  isTablet: boolean
  isDesktop: boolean
}

const MOBILE_QUERY = '(max-width: 767px)'
const TABLET_QUERY = '(min-width: 768px) and (max-width: 1023px)'

const VIEWPORT_SNAPSHOTS: Record<ViewportMode, ViewportInfo> = {
  mobile: { mode: 'mobile', isMobile: true, isTablet: false, isDesktop: false },
  tablet: { mode: 'tablet', isMobile: false, isTablet: true, isDesktop: false },
  desktop: { mode: 'desktop', isMobile: false, isTablet: false, isDesktop: true },
}

function getViewportMode(): ViewportMode {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'desktop'
  }
  if (window.matchMedia(MOBILE_QUERY).matches) return 'mobile'
  if (window.matchMedia(TABLET_QUERY).matches) return 'tablet'
  return 'desktop'
}

function subscribe(callback: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {}
  }
  const mobileMql = window.matchMedia(MOBILE_QUERY)
  const tabletMql = window.matchMedia(TABLET_QUERY)
  mobileMql.addEventListener('change', callback)
  tabletMql.addEventListener('change', callback)
  return () => {
    mobileMql.removeEventListener('change', callback)
    tabletMql.removeEventListener('change', callback)
  }
}

/**
 * Adaptive breakpoint hook returning `'mobile' | 'tablet' | 'desktop'` so
 * desktop web and mobile viewports can render distinct layout trees.
 */
export function useViewport(): ViewportInfo {
  const mode = useSyncExternalStore<ViewportMode>(subscribe, getViewportMode, () => 'desktop')
  return VIEWPORT_SNAPSHOTS[mode]
}
