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
  calendar: '/calendar',
  results: '/results',
  business: '/business',
  settings: '/settings',
} as const

export const DEFAULT_AUTHENTICATED_ROUTE = ROUTES.chat
