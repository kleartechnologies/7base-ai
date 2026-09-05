import {
  FolderOpen,
  Image,
  LayoutGrid,
  LibraryBig,
  Megaphone,
  MessageSquare,
  Settings,
  type LucideIcon,
} from 'lucide-react'
import { ROUTES } from '@/app/routes/paths'
import type { MessageKey } from '@/i18n/translate'

export interface NavItem {
  /** Dictionary key — resolved with `t()` at render time so labels re-translate. */
  labelKey: MessageKey
  to: string
  icon: LucideIcon
}

/**
 * Sits directly under "New chat", above the Workspace group.
 */
export const TOP_NAV: NavItem[] = [
  { labelKey: 'nav.overview', to: ROUTES.overview, icon: LayoutGrid },
]

/**
 * The "Workspace" group — where the chat's output is kept.
 *
 * Calendar and Results left the navigation in the approved design (their
 * routes still exist); Business Brain closes the group.
 */
export const WORKSPACE_NAV: NavItem[] = [
  { labelKey: 'nav.campaigns', to: ROUTES.campaigns, icon: Megaphone },
  { labelKey: 'nav.creative', to: ROUTES.creative, icon: Image },
  { labelKey: 'nav.assets', to: ROUTES.assets, icon: FolderOpen },
  { labelKey: 'nav.library', to: ROUTES.library, icon: LibraryBig },
  { labelKey: 'nav.business', to: ROUTES.business, icon: MessageSquare },
]

export const SETTINGS_NAV: NavItem = {
  labelKey: 'nav.settings',
  to: ROUTES.settings,
  icon: Settings,
}
