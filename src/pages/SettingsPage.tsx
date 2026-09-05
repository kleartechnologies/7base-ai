import { Check, LogOut, Monitor, Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useAuth } from '@/hooks/useAuth'
import { useI18n } from '@/hooks/useI18n'
import { useTheme } from '@/hooks/useTheme'
import { LANGUAGE_LABELS, LANGUAGE_OPTIONS, type Language } from '@/i18n/language'
import type { MessageKey } from '@/i18n/translate'
import { APPEARANCE_OPTIONS, type AppearancePreference } from '@/lib/theme'
import { getCurrentPlan, getPlanName } from '@/services/billing/billing.service'

const APPEARANCE_LABEL_KEYS: Record<AppearancePreference, MessageKey> = {
  light: 'settings.appearanceLight',
  dark: 'settings.appearanceDark',
  system: 'settings.appearanceSystem',
}

const APPEARANCE_ICONS: Record<AppearancePreference, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
}

export default function SettingsPage() {
  const { user, signOut } = useAuth()
  const { t, language, setLanguage } = useI18n()
  const { preference, setPreference } = useTheme()
  const plan = getCurrentPlan()

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-8 py-12">
        <header className="mb-10">
          <h1 className="text-[22px] font-semibold tracking-[-0.015em] text-foreground">
            {t('settings.title')}
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
            {t('settings.subtitle')}
          </p>
        </header>

        <section className="space-y-4">
          <h2 className="text-sm font-medium text-foreground">{t('settings.account')}</h2>
          <dl className="space-y-3 rounded-xl border border-border bg-card px-5 py-4 text-sm">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted-foreground">{t('settings.name')}</dt>
              <dd className="truncate text-foreground">{user?.displayName ?? '—'}</dd>
            </div>
            <Separator />
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted-foreground">{t('settings.email')}</dt>
              <dd className="truncate text-foreground">{user?.email ?? '—'}</dd>
            </div>
          </dl>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-sm font-medium text-foreground">{t('settings.appearance')}</h2>
          <div className="rounded-xl border border-border bg-card px-5 py-4">
            <div
              role="radiogroup"
              aria-label={t('settings.appearance')}
              className="grid grid-cols-3 gap-2"
            >
              {APPEARANCE_OPTIONS.map((option) => {
                const Icon = APPEARANCE_ICONS[option]
                const selected = preference === option
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setPreference(option)}
                    className={`flex flex-col items-center gap-2 rounded-lg border px-3 py-3 text-[13px] transition-colors ${
                      selected
                        ? 'border-foreground/40 bg-accent font-medium text-foreground'
                        : 'border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                    }`}
                  >
                    <Icon className="size-4" aria-hidden />
                    {t(APPEARANCE_LABEL_KEYS[option])}
                  </button>
                )
              })}
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
              {t('settings.appearanceHint')}
            </p>
          </div>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-sm font-medium text-foreground">{t('settings.language')}</h2>
          <div className="rounded-xl border border-border bg-card px-5 py-4">
            <div
              role="radiogroup"
              aria-label={t('settings.language')}
              className="grid grid-cols-2 gap-2"
            >
              {LANGUAGE_OPTIONS.map((option: Language) => {
                const selected = language === option
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setLanguage(option)}
                    className={`flex items-center justify-between gap-2 rounded-lg border px-4 py-3 text-[13px] transition-colors ${
                      selected
                        ? 'border-foreground/40 bg-accent font-medium text-foreground'
                        : 'border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                    }`}
                  >
                    {LANGUAGE_LABELS[option]}
                    {selected && <Check className="size-4" aria-hidden />}
                  </button>
                )
              })}
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
              {t('settings.languageHint')}
            </p>
          </div>
        </section>

        <section className="mt-10 space-y-4">
          <h2 className="text-sm font-medium text-foreground">{t('settings.plan')}</h2>
          <div className="rounded-xl border border-border bg-card px-5 py-4">
            <p className="text-sm font-medium text-foreground">{getPlanName(plan)}</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
              {t('settings.planNote')}
            </p>
          </div>
        </section>

        <section className="mt-10">
          <Button variant="outline" onClick={() => void signOut()}>
            <LogOut />
            {t('shell.signOut')}
          </Button>
        </section>
      </div>
    </div>
  )
}
