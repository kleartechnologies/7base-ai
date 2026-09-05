import {
  CalendarDays,
  FolderOpen,
  Image,
  LayoutGrid,
  LibraryBig,
  Megaphone,
  Settings,
  Store,
  TrendingUp,
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
 * The workspace tabs, below the chat history divider.
 *
 * Chat is where thinking happens; these are where its output is kept. Settings
 * is separated so the working tabs read as one group.
 */
export const WORKSPACE_NAV: NavItem[] = [
  { labelKey: 'nav.overview', to: ROUTES.overview, icon: LayoutGrid },
  { labelKey: 'nav.campaigns', to: ROUTES.campaigns, icon: Megaphone },
  { labelKey: 'nav.creative', to: ROUTES.creative, icon: Image },
  { labelKey: 'nav.assets', to: ROUTES.assets, icon: FolderOpen },
  { labelKey: 'nav.library', to: ROUTES.library, icon: LibraryBig },
  { labelKey: 'nav.calendar', to: ROUTES.calendar, icon: CalendarDays },
  { labelKey: 'nav.results', to: ROUTES.results, icon: TrendingUp },
  { labelKey: 'nav.business', to: ROUTES.business, icon: Store },
]

export const SETTINGS_NAV: NavItem = {
  labelKey: 'nav.settings',
  to: ROUTES.settings,
  icon: Settings,
}
