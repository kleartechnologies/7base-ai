import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PenSquare } from 'lucide-react'
import { MarkaLogo } from '@/components/MarkaLogo'
import { EvaSpark } from '@/components/EvaMark'
import { UpgradeModal } from '@/features/billing/UpgradeModal'
import { ROUTES } from '@/app/routes/paths'
import { useI18n } from '@/hooks/useI18n'
import type { Conversation } from '@/types'
import { SETTINGS_NAV, TOP_NAV, WORKSPACE_NAV } from '../navigation'
import { ChatHistoryList } from './ChatHistoryList'
import { SidebarNavLink } from './SidebarNavLink'
import { UserMenu } from './UserMenu'

export interface SidebarConversations {
  conversations: Conversation[]
  loading: boolean
  error: string | null
  remove: (conversationId: string) => Promise<void>
}

/**
 * The persistent left rail, in the approved order: New chat and Overview on
 * top, the Workspace group, chat history below it, and a footer with the
 * upgrade entry point, Settings and the account row.
 *
 * The conversation list is owned by the shell, not this component: the shell
 * can mount two Sidebars at once (fixed rail + mobile drawer), and each must
 * not open its own Firestore listener over the same data.
 */
export function Sidebar({
  history,
  onNavigate,
}: {
  history: SidebarConversations
  onNavigate?: () => void
}) {
  const navigate = useNavigate()
  const { t } = useI18n()
  const { conversations, loading, error, remove } = history
  const [upgradeOpen, setUpgradeOpen] = useState(false)

  function handleNewChat() {
    navigate(ROUTES.chat)
    onNavigate?.()
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar">
      <div className="flex h-14 shrink-0 items-center px-4">
        <MarkaLogo />
      </div>

      <nav aria-label={t('shell.workspace')} className="shrink-0 space-y-px px-3">
        <button
          type="button"
          onClick={handleNewChat}
          className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-[7px] text-left text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent/60"
        >
          <PenSquare className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{t('shell.newChat')}</span>
        </button>
        {TOP_NAV.map((item) => (
          <SidebarNavLink key={item.to} item={item} onNavigate={onNavigate} />
        ))}

        <p className="px-2.5 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/70">
          {t('shell.workspace')}
        </p>
        {WORKSPACE_NAV.map((item) => (
          <SidebarNavLink key={item.to} item={item} onNavigate={onNavigate} />
        ))}
      </nav>

      <nav
        aria-label={t('shell.chatHistory')}
        className="mt-2 min-h-0 flex-1 overflow-y-auto px-3 py-2"
      >
        <p className="px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/70">
          {t('shell.recentChats')}
        </p>
        <ChatHistoryList
          conversations={conversations}
          loading={loading}
          error={error}
          onDelete={(id) => void remove(id)}
          onNavigate={onNavigate}
        />
      </nav>

      <div className="shrink-0 border-t border-sidebar-border px-3 pt-2">
        <button
          type="button"
          onClick={() => setUpgradeOpen(true)}
          className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-[7px] text-left text-[13.5px] text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
        >
          <EvaSpark className="size-[15px] shrink-0 text-eva" />
          <span className="truncate">{t('shell.upgradePlan')}</span>
        </button>
        <SidebarNavLink item={SETTINGS_NAV} onNavigate={onNavigate} />
      </div>

      <div className="shrink-0 p-2">
        <UserMenu />
      </div>

      {upgradeOpen ? <UpgradeModal onClose={() => setUpgradeOpen(false)} /> : null}
    </div>
  )
}
