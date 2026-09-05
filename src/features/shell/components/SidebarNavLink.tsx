import { NavLink } from 'react-router-dom'
import { useI18n } from '@/hooks/useI18n'
import { cn } from '@/lib/utils'
import type { NavItem } from '../navigation'

export function SidebarNavLink({ item, onNavigate }: { item: NavItem; onNavigate?: () => void }) {
  const { t } = useI18n()
  const Icon = item.icon
  return (
    <NavLink
      to={item.to}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-sm transition-colors',
          isActive
            ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
            : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
        )
      }
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="truncate">{t(item.labelKey)}</span>
    </NavLink>
  )
}
