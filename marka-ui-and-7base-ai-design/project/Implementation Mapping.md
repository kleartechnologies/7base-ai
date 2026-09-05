# 7BASE AI — Phase 7 implementation mapping

Design → existing architecture (kleartechnologies/7base-ai, main). No backend changes required; all designs map onto current routes, data models and AI workflows.

## Brand
- Rename MARKA → 7BASE AI: `src/components/MarkaLogo.tsx`, app title, auth pages. EVA naming already in place.
- New accent token for EVA moments: add `--accent` (oklch 0.49 0.12 275 family) to `src/index.css`. Used ONLY for: EVA spark icon, recommendation card label, "EVA suggests" card, launch-price/Recommended badges, profile progress bar. Everything else keeps existing warm-neutral tokens.
- EVA spark = simple 4-point star SVG path (`M12 3l1.9 6.1L20 11l-6.1 1.9L12 19l-1.9-6.1L4 11l6.1-1.9z`), stroke accent.

## Navigation (7BASE AI.dc.html sidebar)
Current `src/features/shell/navigation.ts` has 9 items. New IA:
- Top: New chat (ChatPage `/`), Overview
- Workspace group: Campaigns, Creative, Assets, Library, Business Brain (was "Business")
- Chat history moves below workspace group (same ChatHistoryList data)
- Footer: Upgrade plan (new, opens modal), Settings, UserMenu
- Calendar + Results removed from nav (routes kept; re-add when functional)

## Screen map (design → repo files)
| Design screen | File | Repo files to modify |
|---|---|---|
| Shell + sidebar | 7BASE AI.dc.html | AppShell.tsx, Sidebar.tsx, SidebarNavLink.tsx, navigation.ts, ChatHistoryList.tsx, UserMenu.tsx |
| Chat empty | 7BASE AI.dc.html (chatState=empty) | ChatPage.tsx, EmptyState.tsx, ChatComposer.tsx (pill composer, suggestion chips, explore cards) |
| Chat conversation | 7BASE AI.dc.html (chatState=conversation) | MessageBubble.tsx, StreamingMessage.tsx, blocks/RecommendationCard.tsx, CampaignCard.tsx, CreativePreview.tsx (EVA avatar spark, accent label, merged campaign+creative card) |
| Chat thinking | 7BASE AI.dc.html (chatState=thinking) | ThinkingIndicator.tsx (pulsing spark + "EVA is thinking…") |
| Overview | 7BASE AI.dc.html | OverviewPage.tsx (new 2-col layout: campaigns/creative left, EVA suggests + profile completeness right; data from existing campaigns/creatives/completion services) |
| Campaigns + detail | 7BASE AI.dc.html | CampaignsPage.tsx, CampaignDetailPage.tsx (read-view first, Edit reveals existing form; assumptions → "Worth confirming before launch") |
| Creative | 7BASE AI.dc.html | CreativePage.tsx (3-col grid, "Edit with EVA" deep-links to chat) |
| Assets | 7BASE AI.dc.html | AssetsPage.tsx (type filter pills replace Active/Archived as primary; "EVA can use this" line) |
| Library | 7BASE AI.dc.html | LibraryPage.tsx (same filters; Idea rows get accent badge) |
| Business Brain | 7BASE AI.dc.html | BusinessPage.tsx, features/business/* (completion prompt collapses to one-line accent card; provenance badges kept, relabelled "EVA's reading") |
| Settings + plan | 7BASE AI.dc.html + Pricing 1b/1c | SettingsPage.tsx, billing.service.ts (display only) |
| Upgrade modal | Pricing 1a | new PlanCard/UpgradeModal components; trigger from sidebar "Upgrade plan" |
| Pricing states | Pricing 1e | loading = existing skeleton pattern; error = quiet notice, "you haven't been charged" |
| Onboarding | 7BASE AI Onboarding.dc.html | OnboardingPage.tsx, MethodChoice.tsx, WebsiteStep.tsx, AnalysingStep.tsx (progressive found-items list), ReviewStep.tsx (inline Edit per row), AnalysisFailed.tsx, ManualStep.tsx (3 questions only) |
| Mobile | 7BASE AI Mobile.dc.html | responsive variants: drawer nav (hamburger), sticky bottom CTAs, full-screen upgrade sheet |

## Out of scope (unchanged)
Billing/Stripe, publishing, scheduling, analytics, agents, vector search, OCR, multi-business, Calendar/Results functionality, model routing and quota mechanics (never exposed in UI).
