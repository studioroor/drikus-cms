import { Globe } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/cn'

/** The site's favicon or logo from its repository, or a globe when it has none. */
export function SiteIcon({ siteId, className }: { siteId: string; className?: string }) {
  const [state, setState] = useState<'loading' | 'loaded' | 'missing'>('loading')
  return (
    <div
      className={cn(
        'flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl',
        state === 'loaded'
          ? 'border border-stone-200 bg-white p-1.5'
          : 'bg-brand-50 text-brand-700',
        className,
      )}
    >
      {state === 'missing' ? (
        <Globe className="size-5" />
      ) : (
        <img
          src={`/api/sites/${siteId}/icon`}
          alt=""
          className={cn('size-full object-contain', state === 'loading' && 'invisible')}
          onLoad={() => setState('loaded')}
          onError={() => setState('missing')}
        />
      )}
    </div>
  )
}
