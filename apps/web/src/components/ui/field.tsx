import { type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, useId } from 'react'
import { cn } from '@/lib/cn'

const control =
  'block w-full rounded-lg border border-stone-300 bg-white px-3 text-stone-900 shadow-sm placeholder:text-stone-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 disabled:bg-stone-100'

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, 'h-11', className)} {...props} />
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(control, 'h-11', className)} {...props} />
}

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  children: (id: string) => ReactNode
}) {
  const id = useId()
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-stone-800">
        {label}
      </label>
      {children(id)}
      {hint && !error && <p className="text-sm text-stone-500">{hint}</p>}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  )
}

export function Checkbox({
  label,
  description,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; description?: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-stone-100">
      <input type="checkbox" className="mt-0.5 size-4 accent-brand-700" {...props} />
      <span>
        <span className="block text-sm font-medium text-stone-800">{label}</span>
        {description && <span className="block text-sm text-stone-500">{description}</span>}
      </span>
    </label>
  )
}
