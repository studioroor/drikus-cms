import { NodeSelection } from '@tiptap/pm/state'
import { type Editor, EditorContent, useEditor, useEditorState } from '@tiptap/react'
import {
  Bold,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  type LucideIcon,
  Quote,
  Redo2,
  Trash2,
  Undo2,
} from 'lucide-react'
import { type ReactNode, useEffect, useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Input, Select } from '@/components/ui/field'
import { cn } from '@/lib/cn'
import { previewUrl } from '@/lib/content'
import { joinImageSrc, richTextExtensions, splitImageSrc } from './rich-text-extensions'

export interface ImageStyle {
  value: string
  label: string
}

/** WYSIWYG editor that reads and writes Markdown. */
export function RichTextEditor({
  id,
  value,
  onChange,
  readOnly,
  siteUrl = null,
  imageStyles = [],
}: {
  id: string
  value: string
  onChange: (markdown: string) => void
  readOnly?: boolean
  siteUrl?: string | null
  imageStyles?: ImageStyle[]
}) {
  const { t } = useTranslation()
  const lastEmitted = useRef(value)
  const editor = useEditor({
    extensions: richTextExtensions((path) => previewUrl(path, siteUrl)),
    content: value,
    contentType: 'markdown',
    editable: !readOnly,
    editorProps: {
      attributes: {
        id,
        class:
          'prose-editor min-h-40 px-3.5 py-3 focus:outline-none [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:text-lg [&_h3]:font-semibold [&_h4]:font-semibold [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6 [&_blockquote]:border-l-4 [&_blockquote]:border-stone-300 [&_blockquote]:pl-3 [&_blockquote]:text-stone-600 [&_a]:text-brand-700 [&_a]:underline [&>*+*]:mt-3',
      },
    },
    onUpdate: ({ editor }) => {
      const markdown = editor.getMarkdown()
      lastEmitted.current = markdown
      onChange(markdown)
    },
  })

  // Accept outside changes (e.g. discarding a draft) without clobbering typing.
  useEffect(() => {
    if (editor && value !== lastEmitted.current) {
      lastEmitted.current = value
      editor.commands.setContent(value, { contentType: 'markdown', emitUpdate: false })
    }
  }, [editor, value])

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive('bold'),
            italic: e.isActive('italic'),
            h2: e.isActive('heading', { level: 2 }),
            h3: e.isActive('heading', { level: 3 }),
            bullet: e.isActive('bulletList'),
            ordered: e.isActive('orderedList'),
            quote: e.isActive('blockquote'),
            link: e.isActive('link'),
            image: e.isActive('image') ? (e.getAttributes('image') as ImageAttrs) : null,
            canUndo: e.can().undo(),
            canRedo: e.can().redo(),
          }
        : null,
  })

  if (!editor) return null
  const chain = () => editor.chain().focus()
  const buttons: {
    icon: LucideIcon
    label: string
    active?: boolean
    disabled?: boolean
    run: () => void
  }[] = [
    {
      icon: Bold,
      label: t('editor.rich.bold'),
      active: state?.bold,
      run: () => chain().toggleBold().run(),
    },
    {
      icon: Italic,
      label: t('editor.rich.italic'),
      active: state?.italic,
      run: () => chain().toggleItalic().run(),
    },
    {
      icon: Heading2,
      label: t('editor.rich.heading'),
      active: state?.h2,
      run: () => chain().toggleHeading({ level: 2 }).run(),
    },
    {
      icon: Heading3,
      label: t('editor.rich.subheading'),
      active: state?.h3,
      run: () => chain().toggleHeading({ level: 3 }).run(),
    },
    {
      icon: List,
      label: t('editor.rich.bulletList'),
      active: state?.bullet,
      run: () => chain().toggleBulletList().run(),
    },
    {
      icon: ListOrdered,
      label: t('editor.rich.orderedList'),
      active: state?.ordered,
      run: () => chain().toggleOrderedList().run(),
    },
    {
      icon: Quote,
      label: t('editor.rich.quote'),
      active: state?.quote,
      run: () => chain().toggleBlockquote().run(),
    },
    {
      icon: Link2,
      label: t('editor.rich.link'),
      active: state?.link,
      run: () => {
        const previous = editor.getAttributes('link').href as string | undefined
        const href = window.prompt(t('editor.rich.linkPrompt'), previous ?? 'https://')
        if (href === null) return
        if (href.trim() === '' || href === 'https://')
          chain().extendMarkRange('link').unsetLink().run()
        else chain().extendMarkRange('link').setLink({ href: href.trim() }).run()
      },
    },
    {
      icon: ImagePlus,
      label: t('editor.rich.image'),
      active: !!state?.image,
      run: () => {
        const path = window.prompt(t('editor.rich.imagePrompt'), '/uploads/')
        if (!path?.trim() || path.trim() === '/uploads/') return
        const at = editor.state.selection.from
        chain()
          .insertContent({ type: 'image', attrs: { src: path.trim() } })
          .setNodeSelection(at)
          .run()
      },
    },
    {
      icon: Undo2,
      label: t('editor.rich.undo'),
      disabled: !state?.canUndo,
      run: () => chain().undo().run(),
    },
    {
      icon: Redo2,
      label: t('editor.rich.redo'),
      disabled: !state?.canRedo,
      run: () => chain().redo().run(),
    },
  ]

  return (
    <div className="overflow-hidden rounded-lg border border-stone-300 bg-white shadow-sm focus-within:border-brand-600 focus-within:ring-2 focus-within:ring-brand-600/20">
      {!readOnly && (
        <div className="flex flex-wrap gap-0.5 border-b border-stone-200 bg-stone-50 px-1.5 py-1">
          {buttons.map(({ icon: Icon, label, active, disabled, run }) => (
            <button
              key={label}
              type="button"
              title={label}
              aria-label={label}
              aria-pressed={active}
              disabled={disabled}
              onClick={run}
              className={cn(
                'rounded-md p-1.5 text-stone-600 hover:bg-stone-200 disabled:opacity-40',
                active && 'bg-stone-200 text-stone-900',
              )}
            >
              <Icon className="size-4" />
            </button>
          ))}
        </div>
      )}
      {!readOnly && state?.image && (
        <ImagePanel editor={editor} attrs={state.image} styles={imageStyles} />
      )}
      <EditorContent editor={editor} />
    </div>
  )
}

interface ImageAttrs {
  src: string | null
  alt: string | null
  title: string | null
}

/** Settings for the selected image: file, description, caption and style. */
function ImagePanel({
  editor,
  attrs,
  styles,
}: {
  editor: Editor
  attrs: ImageAttrs
  styles: ImageStyle[]
}) {
  const { t } = useTranslation()
  const id = useId()
  const src = attrs.src ?? ''
  // Without configured styles the hint stays part of the path, so nothing gets lost.
  const { path, style } = styles.length ? splitImageSrc(src) : { path: src, style: '' }
  const options =
    style && !styles.some((s) => s.value === style)
      ? [...styles, { value: style, label: style }]
      : styles

  // Change attributes in place: replacing the node would drop the selection and close this panel.
  const update = (next: Partial<ImageAttrs>) =>
    editor.commands.command(({ tr }) => {
      const { selection } = tr
      if (!(selection instanceof NodeSelection)) return false
      for (const [key, v] of Object.entries(next))
        tr.setNodeAttribute(selection.from, key, v || null)
      return true
    })

  return (
    <div className="grid gap-3 border-b border-stone-200 bg-brand-50/60 px-3 py-3 sm:grid-cols-2">
      <ImageSetting id={`${id}-path`} label={t('editor.rich.imagePath')}>
        <Input
          id={`${id}-path`}
          value={path}
          placeholder="/uploads/…"
          onChange={(e) => update({ src: joinImageSrc(e.target.value, style) })}
        />
      </ImageSetting>
      {styles.length > 0 && (
        <ImageSetting id={`${id}-style`} label={t('editor.rich.imageStyle')}>
          <Select
            id={`${id}-style`}
            value={style}
            onChange={(e) => update({ src: joinImageSrc(path, e.target.value) })}
          >
            <option value="">{t('editor.rich.imageStyleNone')}</option>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </ImageSetting>
      )}
      <ImageSetting id={`${id}-alt`} label={t('editor.rich.imageAlt')}>
        <Input
          id={`${id}-alt`}
          value={attrs.alt ?? ''}
          onChange={(e) => update({ alt: e.target.value })}
        />
      </ImageSetting>
      <ImageSetting id={`${id}-title`} label={t('editor.rich.imageCaption')}>
        <Input
          id={`${id}-title`}
          value={attrs.title ?? ''}
          onChange={(e) => update({ title: e.target.value })}
        />
      </ImageSetting>
      <div className="sm:col-span-2">
        <button
          type="button"
          onClick={() => editor.chain().focus().deleteSelection().run()}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-red-700 hover:bg-red-50"
        >
          <Trash2 className="size-4" />
          {t('editor.rich.imageRemove')}
        </button>
      </div>
    </div>
  )
}

function ImageSetting({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-xs font-medium text-stone-700">
        {label}
      </label>
      {children}
    </div>
  )
}
