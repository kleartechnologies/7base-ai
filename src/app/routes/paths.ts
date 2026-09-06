/** Every route in one place, so links never drift from the router. */
export const ROUTES = {
  signIn: '/sign-in',
  signUp: '/sign-up',
  onboarding: '/onboarding',
  chat: '/chat',
  conversation: (id: string) => `/chat/${id}`,
  overview: '/overview',
  campaigns: '/campaigns',
  campaignDetail: (id: string) => `/campaigns/${id}`,
  creative: '/creative',
  assets: '/assets',
  library: '/library',
  calendar: '/calendar',
  results: '/results',
  business: '/business',
  /** The Business page's second tab — same page component, no new sidebar item. */
  businessBrand: '/business/brand',
  settings: '/settings',
} as const

export const DEFAULT_AUTHENTICATED_ROUTE = ROUTES.chat
