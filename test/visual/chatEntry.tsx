import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext, type AuthContextValue } from '@/app/providers/auth-context'
import { LocaleContext } from '@/app/providers/locale-context'
import { ChatActionsContext } from '@/features/chat/chatActionsContext'
import { ActionProgress } from '@/features/chat/components/ActionProgress'
import { MessageBubble } from '@/features/chat/components/MessageBubble'
import { EmptyState, SuggestionChips } from '@/features/chat/components/EmptyState'
import { PlatformCopy } from '@/features/creative/PlatformCopy'
import OverviewPage from '@/pages/OverviewPage'
import { emptyBusiness } from '@/services/business/brain'
import { translate, type MessageKey } from '@/i18n/translate'
import type { Language } from '@/i18n/language'
import type { ActionProgressStep, Creative, Message } from '@/types'
import { CREATIVES, IMAGES } from './stubs/services'

/**
 * The browser half of the chat visual harness (Phase 7J §24).
 *
 * It renders the real chat components — the same MessageBubble, the same
 * cards, the same empty states the app ships — against fixture turns, so
 * what lands in the screenshot is the layout an owner would actually see at
 * that width and in that theme. Nothing here restyles or reimplements a
 * component; the fixtures are message documents, exactly as the server
 * writes them.
 */

declare global {
  interface Window {
    __renderChat: (payload: {
      scenarios: {
        title: string
        note: string
        kind: string
        language?: Language
        data: unknown
      }[]
      creatives: Creative[]
      images: Record<string, string>
      language: Language
    }) => Promise<{
      height: number
      width: number
      scenes: { title: string | null; top: number; height: number }[]
      overflow: string[]
    }>
    __chatReady?: boolean
  }
}

const user = {
  uid: 'visual',
  email: 'owner@example.com',
  displayName: 'Aisyah',
  photoURL: null,
} as AuthContextValue['user']

/* The real Brain shape, so every reader of it behaves as it would live. */
const base = emptyBusiness('visual', { name: 'Warung Pak Din', offering: 'Home-style Malay food' })
const business = {
  ...base,
  id: 'biz1',
  identity: { ...base.identity, category: 'restaurant' },
} as AuthContextValue['business']

function Locale({ language, children }: { language: Language; children: React.ReactNode }) {
  const locale = {
    language,
    setLanguage: () => {},
    t: (key: MessageKey, params?: Record<string, string | number>) =>
      translate(language, key, params),
  }
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
}

function Providers({ language, children }: { language: Language; children: React.ReactNode }) {
  const auth = {
    status: 'authenticated',
    user,
    profile: null,
    business,
    error: null,
    signOut: async () => {},
    refresh: async () => {},
  } as AuthContextValue
  const actions = { sendQuickReply: () => {}, busy: false }

  return (
    <MemoryRouter>
      <Locale language={language}>
        <AuthContext.Provider value={auth}>
          <ChatActionsContext.Provider value={actions}>{children}</ChatActionsContext.Provider>
        </AuthContext.Provider>
      </Locale>
    </MemoryRouter>
  )
}

/** One scenario, framed like a page so the screenshot shows real spacing. */
function Scene({
  title,
  note,
  kind,
  data,
  language,
  pageLanguage,
}: {
  title: string
  note: string
  kind: string
  data: unknown
  language?: Language
  pageLanguage: Language
}) {
  return (
    <section className="border-b border-border py-8" data-scene={title}>
      <p className="px-6 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        {title}
      </p>
      <p className="mb-4 px-6 text-[12px] text-muted-foreground/70">{note}</p>
      <Locale language={language ?? pageLanguage}>
        <div className="bg-background">{body(kind, data)}</div>
      </Locale>
    </section>
  )
}

function body(kind: string, data: unknown) {
  if (kind === 'thread') {
    const messages = data as Message[]
    return (
      <div className="mx-auto w-full max-w-3xl space-y-7 px-6 py-2">
        {messages.map((message, index) => (
          <MessageBubble
            key={message.id}
            message={message}
            isLatest={index === messages.length - 1}
          />
        ))}
      </div>
    )
  }
  if (kind === 'progress') {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-2">
        <ActionProgress steps={data as ActionProgressStep[]} />
      </div>
    )
  }
  if (kind === 'empty_chat') {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-4">
        <EmptyState />
        <SuggestionChips onPick={() => {}} />
      </div>
    )
  }
  if (kind === 'overview') {
    return <OverviewPage />
  }
  if (kind === 'platform_copy') {
    const creative = CREATIVES.get(data as string) ?? null
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-2">
        <div className="max-w-sm">
          <PlatformCopy creative={creative} defaultOpen />
        </div>
      </div>
    )
  }
  return null
}

window.__renderChat = async ({ scenarios, creatives, images, language }) => {
  for (const creative of creatives) CREATIVES.set(creative.id, creative)
  for (const [key, value] of Object.entries(images)) IMAGES[key] = value

  const root = document.getElementById('root')
  if (!root) throw new Error('no root')
  createRoot(root).render(
    <StrictMode>
      <Providers language={language}>
        <div className="bg-background text-foreground">
          {scenarios.map((scenario) => (
            <Scene key={scenario.title} {...scenario} pageLanguage={language} />
          ))}
        </div>
      </Providers>
    </StrictMode>,
  )

  // Posters draw on a canvas after their images and fonts settle.
  await new Promise((resolve) => setTimeout(resolve, 2000))

  /*
    Hand the runner the geometry it needs to size the window and cut the
    sheet into one image per scene — a scene has to be looked at at its own
    size, not as a strip of a 12,000px page.
  */
  const scenes = [...document.querySelectorAll('[data-scene]')].map((node) => {
    const box = (node as HTMLElement).getBoundingClientRect()
    return {
      title: node.getAttribute('data-scene'),
      top: Math.round(box.top + window.scrollY),
      height: Math.round(box.height),
    }
  })
  /* Anything reaching past the viewport, named — §24's mobile overflow. */
  const overflow: string[] = []
  for (const node of document.querySelectorAll('body *')) {
    const box = node.getBoundingClientRect()
    if (box.width > 0 && Math.round(box.right) > window.innerWidth + 1) {
      const element = node as HTMLElement
      const scene = element.closest('[data-scene]')?.getAttribute('data-scene') ?? '?'
      overflow.push(
        `${scene} · ${element.tagName.toLowerCase()}.${element.className.toString().slice(0, 60)} → ${Math.round(box.right)}px`,
      )
    }
  }

  window.__chatReady = true
  return {
    height: Math.ceil(document.documentElement.scrollHeight),
    width: Math.ceil(document.documentElement.scrollWidth),
    scenes,
    overflow: overflow.slice(0, 12),
  }
}
