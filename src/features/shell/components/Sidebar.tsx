import { useNavigate } from 'react-router-dom'
import { PenSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MarkaLogo } from '@/components/MarkaLogo'
import { ROUTES } from '@/app/routes/paths'
import { useConversations } from '@/features/chat/useConversations'
import { SETTINGS_NAV, WORKSPACE_NAV } from '../navigation'
import { ChatHistoryList } from './ChatHistoryList'
import { SidebarNavLink } from './SidebarNavLink'
import { UserMenu } from './UserMenu'

/**
 * The persistent left rail.
 *
 * Order encodes the product philosophy: new chat and history first, workspace
 * tabs second. The chat is the product; the tabs are where its output lands.
 */
export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const navigate = useNavigate()
  const { conversations, loading, remove } = useConversations()

  function handleNewChat() {
    navigate(ROUTES.chat)
    onNavigate?.()
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar">
      <div className="flex h-14 shrink-0 items-center px-4">
        <MarkaLogo />
      </div>

      <div className="px-3 pb-2">
        <Button
          variant="outline"
          className="h-9 w-full justify-start gap-2.5 bg-card font-normal text-foreground"
          onClick={handleNewChat}
        >
          <PenSquare className="text-muted-foreground" />
          New chat
        </Button>
      </div>

      <nav aria-label="Chat history" className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <ChatHistoryList
          conversations={conversations}
          loading={loading}
          onDelete={(id) => void remove(id)}
          onNavigate={onNavigate}
        />
      </nav>

      <div className="shrink-0 border-t border-sidebar-border px-3 py-3">
        <nav aria-label="Workspace" className="space-y-px">
          {WORKSPACE_NAV.map((item) => (
            <SidebarNavLink key={item.to} item={item} onNavigate={onNavigate} />
          ))}
          <SidebarNavLink item={SETTINGS_NAV} onNavigate={onNavigate} />
        </nav>
      </div>

      <div className="shrink-0 border-t border-sidebar-border p-2">
        <UserMenu />
      </div>
    </div>
  )
}
