import { Markdown } from '@tiptap/markdown'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
  Bold,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  type LucideIcon,
  Quote,
  Redo2,
  Undo2,
} from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'

/** WYSIWYG editor that reads and writes Markdown. */
export function RichTextEditor({
  id,
  value,
  onChange,
  readOnly,
}: {
  id: string
  value: string
  onChange: (markdown: string) => void
  readOnly?: boolean
}) {
  const { t } = useTranslation()
  const lastEmitted = useRef(value)
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        link: { openOnClick: false, autolink: true, protocols: ['mailto', 'tel'] },
      }),
      Markdown,
    ],
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
      <EditorContent editor={editor} />
    </div>
  )
}
