import { useContext } from 'react'
import { LocaleContext, type LocaleContextValue } from '@/app/providers/locale-context'

export function useI18n(): LocaleContextValue {
  const context = useContext(LocaleContext)
  if (!context) {
    throw new Error('useI18n must be used inside <LocaleProvider>.')
  }
  return context
}
