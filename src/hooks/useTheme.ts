import { useContext } from 'react'
import { ThemeContext, type ThemeContextValue } from '@/app/providers/theme-context'

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used inside <ThemeProvider>.')
  }
  return context
}
