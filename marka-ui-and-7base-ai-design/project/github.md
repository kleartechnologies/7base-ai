repo: kleartechnologies/7base-ai
branch: main

## Last sync
date: 2026-09-05T07:02:27Z

### Updated in this project
- Recreated the current MARKA app UI (shell, chat, all workspace tabs) as MARKA Current UI.dc.html
- Phase 7 designs: 7BASE AI.dc.html (app), Onboarding, Mobile, Pricing
- Implementation Mapping.md: design → repo file mapping for handoff

## Screen map
| Project screen | Repo files |
|---|---|
| Shell + sidebar | src/features/shell/AppShell.tsx, Sidebar.tsx, SidebarNavLink.tsx, UserMenu.tsx, ChatHistoryList.tsx, navigation.ts, src/index.css, src/components/MarkaLogo.tsx |
| Chat (empty + conversation) | src/features/chat/ChatPage.tsx, components/EmptyState.tsx, ChatComposer.tsx, MessageBubble.tsx, blocks/RecommendationCard.tsx, CampaignCard.tsx, CreativePreview.tsx |
| Campaigns + detail | src/pages/CampaignsPage.tsx, CampaignDetailPage.tsx |
| Creative | src/pages/CreativePage.tsx |
| Assets | src/pages/AssetsPage.tsx |
| Library | src/pages/LibraryPage.tsx, src/features/library/libraryItem.ts |
| Business | src/pages/BusinessPage.tsx, src/features/business/* |
| Settings | src/pages/SettingsPage.tsx, src/services/billing/billing.service.ts |
| Overview/Calendar/Results | src/pages/OverviewPage.tsx, CalendarPage.tsx, ResultsPage.tsx, PlaceholderPage.tsx |
| Onboarding | src/features/onboarding/* |
| Auth | src/features/auth/* |
