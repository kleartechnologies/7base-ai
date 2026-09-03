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
import { cn } from '@/lib/utils'
import type { Conversation } from '@/types'

interface ChatHistoryListProps {
  conversations: Conversation[]
  loading: boolean
  onDelete: (conversationId: string) => void
  onNavigate?: () => void
}

export function ChatHistoryList({
  conversations,
  loading,
  onDelete,
  onNavigate,
}: ChatHistoryListProps) {
  if (loading) {
    return (
      <div className="space-y-1.5 px-1 py-1">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-7 w-full" />
        ))}
      </div>
    )
  }

  if (conversations.length === 0) {
    return (
      <p className="px-2.5 py-2 text-[13px] leading-relaxed text-muted-foreground">
        Your conversations with MARKA will appear here.
      </p>
    )
  }

  return (
    <ul className="space-y-px">
      {conversations.map((conversation) => (
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
                aria-label={`Options for ${conversation.title}`}
                className="absolute right-0.5 top-1/2 size-7 -translate-y-1/2 text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover/item:opacity-100 data-[state=open]:opacity-100"
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem variant="destructive" onSelect={() => onDelete(conversation.id)}>
                <Trash2 />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </li>
      ))}
    </ul>
  )
}
