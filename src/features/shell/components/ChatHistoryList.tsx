import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { MoreHorizontal, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { ROUTES } from '@/app/routes/paths'
import { useI18n } from '@/hooks/useI18n'
import { cn } from '@/lib/utils'
import type { Conversation } from '@/types'

interface ChatHistoryListProps {
  conversations: Conversation[]
  loading: boolean
  error?: string | null
  onDelete: (conversationId: string) => void
  onNavigate?: () => void
}

export function ChatHistoryList({
  conversations,
  loading,
  error,
  onDelete,
  onNavigate,
}: ChatHistoryListProps) {
  const { t } = useI18n()
  // Deleting a conversation is permanent, so the menu action only *asks* —
  // the row swaps to an inline confirm and nothing is removed until the owner
  // clicks Delete a second time.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  if (loading) {
    return (
      <div className="space-y-1.5 px-1 py-1">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-7 w-full" />
        ))}
      </div>
    )
  }

  // Error before empty: when the listener fails, the list is cleared, and
  // "Your conversations will appear here" over a broken subscription would
  // be a lie. An error alongside a populated list (a failed delete) renders
  // as a banner above the rows instead.
  if (conversations.length === 0) {
    if (error) {
      return (
        <p role="alert" className="px-2.5 py-2 text-[13px] leading-relaxed text-destructive">
          {error}
        </p>
      )
    }
    return (
      <p className="px-2.5 py-2 text-[13px] leading-relaxed text-muted-foreground">
        {t('shell.historyEmpty')}
      </p>
    )
  }

  return (
    <>
      {error ? (
        <p role="alert" className="px-2.5 py-2 text-[13px] leading-relaxed text-destructive">
          {error}
        </p>
      ) : null}
      <ul className="space-y-px">
        {conversations.map((conversation) =>
          pendingDeleteId === conversation.id ? (
            <li
              key={conversation.id}
              className="rounded-md border border-border bg-card px-2.5 py-2"
            >
              <p className="truncate text-[13px] text-foreground">{conversation.title}</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                {t('shell.deleteConversationConfirm')}
              </p>
              <div className="mt-1.5 flex items-center gap-1.5">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    setPendingDeleteId(null)
                    onDelete(conversation.id)
                  }}
                >
                  {t('common.delete')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setPendingDeleteId(null)}>
                  {t('common.cancel')}
                </Button>
              </div>
            </li>
          ) : (
        <li key={conversation.id} className="group/item relative">
          <NavLink
            to={ROUTES.conversation(conversation.id)}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'block truncate rounded-md py-[7px] pl-2.5 pr-8 text-sm transition-colors',
                isActive
                  ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                  : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
              )
            }
          >
            {conversation.title}
          </NavLink>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('shell.conversationOptions', { title: conversation.title })}
                className="absolute right-0.5 top-1/2 size-7 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover/item:opacity-100 data-[state=open]:opacity-100"
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                variant="destructive"
                onSelect={() => setPendingDeleteId(conversation.id)}
              >
                <Trash2 />
                {t('common.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </li>
          ),
        )}
      </ul>
    </>
  )
}
