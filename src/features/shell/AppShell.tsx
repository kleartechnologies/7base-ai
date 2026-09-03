import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { MarkaLogo } from '@/components/MarkaLogo'
import { Sidebar } from './components/Sidebar'

/**
 * The application frame: a fixed sidebar beside a scrollable main area.
 *
 * Below `lg` the sidebar becomes an overlay drawer rather than collapsing to
 * icons — a restaurant owner on a phone should get full labels, not glyphs.
 */
export function AppShell() {
  const [drawerOpen, setDrawerOpen] = useState(false)

  // The drawer closes from the interactions that dismiss it — a link, the
  // scrim, the close button — rather than by reacting to the location, which
  // would re-render the whole shell on every navigation.

  return (
    <div className="flex h-svh overflow-hidden bg-background">
      <aside className="hidden w-[264px] shrink-0 border-r border-sidebar-border lg:block">
        <Sidebar />
      </aside>

      {drawerOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-foreground/20"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="relative h-full w-[264px] border-r border-sidebar-border shadow-xl">
            <Sidebar onNavigate={() => setDrawerOpen(false)} />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close menu"
              className="absolute -right-11 top-3 text-background"
              onClick={() => setDrawerOpen(false)}
            >
              <X />
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3 lg:hidden">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Open menu"
            onClick={() => setDrawerOpen(true)}
          >
            <Menu />
          </Button>
          <MarkaLogo />
        </header>

        <main className="min-h-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
