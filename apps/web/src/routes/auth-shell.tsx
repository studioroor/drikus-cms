import type { ReactNode } from 'react'
import { LanguageSwitch } from '@/components/language-switch'
import { Logo } from '@/components/logo'

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-brand-50 to-stone-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center justify-center gap-2.5">
          <Logo />
          <span className="text-lg font-semibold tracking-tight">Drikus CMS</span>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-stone-600">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
        <div className="mt-6 flex justify-center">
          <LanguageSwitch />
        </div>
      </div>
    </div>
  )
}
