import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import { type Locale, setLocale } from '@/lib/i18n'

export function LanguageSwitch() {
  const { t, i18n } = useTranslation()
  return (
    <div className="inline-flex rounded-lg border border-stone-200 bg-white p-0.5 text-sm">
      {(['nl', 'en'] as Locale[]).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLocale(l)}
          aria-pressed={i18n.language === l}
          className={cn(
            'rounded-md px-2.5 py-1 font-medium',
            i18n.language === l ? 'bg-stone-900 text-white' : 'text-stone-600 hover:text-stone-900',
          )}
        >
          {t(`language.${l}`)}
        </button>
      ))}
    </div>
  )
}
