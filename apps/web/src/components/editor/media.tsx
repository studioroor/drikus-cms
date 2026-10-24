import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, FileText, ImagePlus, Search, Trash2, Upload } from 'lucide-react'
import { type DragEvent, type ReactNode, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Alert, Badge, EmptyState, Spinner } from '@/components/ui/feedback'
import { Input } from '@/components/ui/field'
import { cn } from '@/lib/cn'
import { type MediaItem, mediaQuery, previewUrl, removeMedia, uploadMedia } from '@/lib/content'
import { useErrorMessage } from '@/lib/queries'

type Kind = 'image' | 'file'

const ACCEPT: Record<Kind, string> = {
  image: 'image/jpeg,image/png,image/webp,image/gif,image/avif',
  file: '.pdf,.docx,.xlsx,.pptx,.zip,.txt,.csv,.mp3,.mp4,image/jpeg,image/png,image/webp,image/gif',
}

/** Uploads a file and refreshes everything that shows uploads or pending changes. */
export function useUpload(siteId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => uploadMedia(siteId, file),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sites', siteId, 'media'] })
      void queryClient.invalidateQueries({ queryKey: ['sites', siteId, 'content'] })
      void queryClient.invalidateQueries({ queryKey: ['sites', siteId, 'changes'] })
    },
  })
}

/**
 * A hidden file input plus drag-and-drop on its children. With `multiple`, every chosen or
 * dropped file goes to `onFiles`; otherwise the first one goes to `onFile`.
 */
export function DropZone({
  kind,
  disabled,
  multiple,
  onFile,
  onFiles,
  children,
  className,
}: {
  kind: Kind
  disabled?: boolean
  multiple?: boolean
  onFile?: (file: File) => void
  onFiles?: (files: File[]) => void
  children: (open: () => void) => ReactNode
  className?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const take = (list: FileList | null | undefined) => {
    const files = Array.from(list ?? [])
    if (!files.length || disabled) return
    if (multiple && onFiles) onFiles(files)
    else onFile?.(files[0] as File)
  }
  const drop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    take(e.dataTransfer.files)
  }
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop only; the button inside is the accessible way
    <div
      className={cn(className, over && 'ring-2 ring-brand-600 ring-offset-2')}
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      <input
        ref={input}
        type="file"
        accept={ACCEPT[kind]}
        className="hidden"
        disabled={disabled}
        multiple={multiple}
        onChange={(e) => {
          take(e.target.files)
          e.target.value = ''
        }}
      />
      {children(() => input.current?.click())}
    </div>
  )
}

function Thumb({ siteId, item }: { siteId: string; item: MediaItem }) {
  if (item.kind === 'file') {
    return (
      <div className="flex aspect-square items-center justify-center rounded-lg bg-stone-100 text-stone-400">
        <FileText className="size-10" />
      </div>
    )
  }
  return (
    <img
      src={previewUrl(item.src, siteId, 400) ?? ''}
      alt=""
      loading="lazy"
      className="aspect-square w-full rounded-lg bg-stone-100 object-cover"
    />
  )
}

/**
 * Browse, upload and pick images or files for a site. With `multiple`, clicking toggles a
 * selection that Add hands to `onSelectMany`; items whose src is in `current` can't be picked.
 */
export function MediaPicker({
  siteId,
  kind,
  open,
  onClose,
  onSelect,
  multiple,
  current,
  onSelectMany,
}: {
  siteId: string
  kind: Kind
  open: boolean
  onClose: () => void
  onSelect?: (src: string) => void
  multiple?: boolean
  current?: string[]
  onSelectMany?: (srcs: string[]) => void
}) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const queryClient = useQueryClient()
  const library = useQuery({ ...mediaQuery(siteId), enabled: open })
  const upload = useUpload(siteId)
  const [search, setSearch] = useState('')
  const remove = useMutation({
    mutationFn: (src: string) => removeMedia(siteId, src),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sites', siteId] }),
  })

  const [selected, setSelected] = useState<string[]>([])
  const added = new Set(current ?? [])

  const close = () => {
    setSelected([])
    onClose()
  }
  const pick = (src: string) => {
    onSelect?.(src)
    close()
  }
  const toggle = (src: string) =>
    setSelected((s) => (s.includes(src) ? s.filter((x) => x !== src) : [...s, src]))
  const choose = (src: string) => {
    if (!multiple) pick(src)
    else if (!added.has(src)) toggle(src)
  }
  const addSelected = () => {
    onSelectMany?.(selected)
    close()
  }
  /** In multi mode uploads run one after another and each new item is selected. */
  const uploadMany = async (files: File[]) => {
    for (const file of files) {
      try {
        const item = await upload.mutateAsync(file)
        setSelected((s) => (s.includes(item.src) || added.has(item.src) ? s : [...s, item.src]))
      } catch {
        // Shown through upload.error; carry on with the remaining files.
      }
    }
  }
  const term = search.trim().toLowerCase()
  const items = (library.data?.items ?? [])
    .filter((i) => kind === 'file' || i.kind === 'image')
    .filter((i) => !term || i.name.toLowerCase().includes(term))

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('media.library')}
      size="lg"
      footer={
        multiple ? (
          <>
            <span className="mr-auto self-center text-sm text-stone-600">
              {t('media.selected', { count: selected.length })}
            </span>
            <Button variant="secondary" onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button disabled={!selected.length} onClick={addSelected}>
              {t('media.add')}
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <DropZone
          kind={kind}
          disabled={upload.isPending}
          multiple={multiple}
          onFiles={(files) => void uploadMany(files)}
          onFile={(file) => upload.mutate(file, { onSuccess: (item) => pick(item.src) })}
          className="rounded-xl border-2 border-dashed border-stone-300 bg-stone-50 px-4 py-5 text-center"
        >
          {(browse) => (
            <>
              {upload.isPending ? (
                <p className="flex items-center justify-center gap-2 text-sm text-stone-600">
                  <Spinner className="size-4" /> {t('media.uploading')}
                </p>
              ) : (
                <p className="text-sm text-stone-600">
                  {kind === 'image' ? t('media.dropImage') : t('media.dropFile')}{' '}
                  <button
                    type="button"
                    onClick={browse}
                    className="font-medium text-brand-700 underline"
                  >
                    {t('media.browse')}
                  </button>
                </p>
              )}
              <p className="mt-1 text-xs text-stone-500">{t('media.hint')}</p>
            </>
          )}
        </DropZone>
        {upload.error && <Alert>{errorMessage(upload.error)}</Alert>}
        {remove.error && <Alert>{errorMessage(remove.error)}</Alert>}

        {(library.data?.items.length ?? 0) > 8 && (
          <div className="relative">
            <Search className="absolute top-3.5 left-3 size-4 text-stone-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('media.search')}
              aria-label={t('media.search')}
              className="pl-9"
            />
          </div>
        )}

        {library.isPending ? (
          <div className="flex justify-center py-8">
            <Spinner className="size-6" />
          </div>
        ) : library.error ? (
          <Alert>{errorMessage(library.error)}</Alert>
        ) : items.length === 0 ? (
          <EmptyState
            title={library.data?.items.length ? t('media.noResults') : t('media.empty')}
          />
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {items.map((item) => {
              const isAdded = !!multiple && added.has(item.src)
              const isSelected = !!multiple && selected.includes(item.src)
              return (
                <li key={item.path} className="group relative">
                  <button
                    type="button"
                    onClick={() => choose(item.src)}
                    disabled={isAdded}
                    aria-pressed={multiple && !isAdded ? isSelected : undefined}
                    className={cn(
                      'block w-full rounded-xl border border-stone-200 p-1.5 text-left hover:border-brand-600 hover:bg-brand-50 focus-visible:border-brand-600',
                      isSelected && 'border-brand-600 bg-brand-50 ring-2 ring-brand-600',
                      isAdded &&
                        'cursor-default opacity-50 hover:border-stone-200 hover:bg-transparent',
                    )}
                    title={item.name}
                  >
                    <Thumb siteId={siteId} item={item} />
                    <span className="mt-1.5 block truncate px-0.5 text-xs text-stone-600">
                      {isAdded ? t('media.alreadyAdded') : item.name}
                    </span>
                  </button>
                  {multiple && !isAdded && (
                    <span
                      aria-hidden
                      className={cn(
                        'pointer-events-none absolute top-3 left-3 flex size-5 items-center justify-center rounded border shadow',
                        isSelected
                          ? 'border-brand-700 bg-brand-700 text-white'
                          : 'border-stone-300 bg-white/90',
                      )}
                    >
                      {isSelected && <Check className="size-3.5" />}
                    </span>
                  )}
                  {item.status === 'new' && (
                    <span
                      className={cn(
                        'pointer-events-none absolute top-3',
                        multiple && !isAdded ? 'left-10' : 'left-3',
                      )}
                    >
                      <Badge tone="brand">{t('media.new')}</Badge>
                    </span>
                  )}
                  {item.status === 'new' && (
                    <button
                      type="button"
                      className="absolute top-3 right-3 rounded-md bg-white/90 p-1 text-stone-600 opacity-0 shadow group-hover:opacity-100 hover:text-red-700 focus-visible:opacity-100"
                      title={t('media.deleteUpload')}
                      aria-label={t('media.deleteUpload')}
                      onClick={() => confirm(t('media.confirmDelete')) && remove.mutate(item.src)}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Dialog>
  )
}

/** The widget for `image` and `file` fields: preview, upload, pick from the library. */
export function MediaField({
  id,
  siteId,
  kind,
  value,
  readOnly,
  onChange,
}: {
  id: string
  siteId: string
  kind: Kind
  value: string
  readOnly: boolean
  onChange: (src: string) => void
}) {
  const { t } = useTranslation()
  const errorMessage = useErrorMessage()
  const pathId = useId()
  const upload = useUpload(siteId)
  const [picking, setPicking] = useState(false)
  const preview = kind === 'image' && value ? previewUrl(value, siteId, 400) : null
  const name = value.split(/[?#]/)[0]?.split('/').pop() ?? ''

  return (
    <div className="space-y-2">
      <DropZone
        kind={kind}
        disabled={readOnly || upload.isPending}
        onFile={(file) => upload.mutate(file, { onSuccess: (item) => onChange(item.src) })}
        className="rounded-xl border border-stone-200 bg-white p-3"
      >
        {(browse) => (
          <div className="flex flex-wrap items-center gap-3">
            {value ? (
              preview ? (
                <img
                  src={preview}
                  alt=""
                  className="h-24 max-w-48 rounded-lg border border-stone-200 object-contain"
                />
              ) : (
                <span className="flex items-center gap-2 text-sm text-stone-700">
                  <FileText className="size-5 text-stone-400" /> {name}
                </span>
              )
            ) : (
              <span className="flex items-center gap-2 text-sm text-stone-500">
                <ImagePlus className="size-5 text-stone-400" />
                {kind === 'image' ? t('media.dropImage') : t('media.dropFile')}
              </span>
            )}
            {!readOnly && (
              <div className="ml-auto flex flex-wrap gap-2">
                <Button
                  id={id}
                  size="sm"
                  variant="secondary"
                  loading={upload.isPending}
                  onClick={browse}
                >
                  <Upload className="size-4" /> {value ? t('media.replace') : t('media.upload')}
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setPicking(true)}>
                  {t('media.choose')}
                </Button>
                {value && (
                  <Button size="sm" variant="ghost" onClick={() => onChange('')}>
                    {t('media.remove')}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </DropZone>
      {upload.error && <Alert>{errorMessage(upload.error)}</Alert>}
      {!readOnly && (
        <details className="text-sm">
          <summary className="cursor-pointer text-stone-500 hover:text-stone-800">
            {t('media.editPath')}
          </summary>
          <Input
            id={pathId}
            className="mt-2"
            value={value}
            placeholder="/uploads/…"
            onChange={(e) => onChange(e.target.value)}
          />
        </details>
      )}
      <MediaPicker
        siteId={siteId}
        kind={kind}
        open={picking}
        onClose={() => setPicking(false)}
        onSelect={onChange}
      />
    </div>
  )
}
