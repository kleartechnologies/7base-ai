import {
  CalendarDays,
  Image,
  LayoutGrid,
  Megaphone,
  Settings,
  Store,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react'
import { ROUTES } from '@/app/routes/paths'

export interface NavItem {
  label: string
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
  { label: 'Overview', to: ROUTES.overview, icon: LayoutGrid },
  { label: 'Campaigns', to: ROUTES.campaigns, icon: Megaphone },
  { label: 'Creative', to: ROUTES.creative, icon: Image },
  { label: 'Calendar', to: ROUTES.calendar, icon: CalendarDays },
  { label: 'Results', to: ROUTES.results, icon: TrendingUp },
  { label: 'Business', to: ROUTES.business, icon: Store },
]

export const SETTINGS_NAV: NavItem = {
  label: 'Settings',
  to: ROUTES.settings,
  icon: Settings,
}
