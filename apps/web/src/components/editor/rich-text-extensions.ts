import Image, { type ImageOptions } from '@tiptap/extension-image'
import Paragraph from '@tiptap/extension-paragraph'
import { Markdown } from '@tiptap/markdown'
import StarterKit from '@tiptap/starter-kit'

/** Splits "/uploads/a.jpg#right" into the file and its style hint. */
export function splitImageSrc(src: string): { path: string; style: string } {
  const hash = src.indexOf('#')
  return hash === -1
    ? { path: src, style: '' }
    : { path: src.slice(0, hash), style: src.slice(hash + 1) }
}

export const joinImageSrc = (path: string, style: string) => (style ? `${path}#${style}` : path)

// Tiptap unwraps a paragraph that holds only an image, which suits block images. Ours are inline
// (so text can flow around them, as in the Markdown), and need to stay inside their paragraph.
const ImageParagraph = Paragraph.extend({
  parseMarkdown(token, helpers) {
    const tokens = token.tokens ?? []
    if (tokens.length === 1 && tokens[0]?.type === 'image') {
      return helpers.createNode('paragraph', undefined, helpers.parseInline(tokens))
    }
    return this.parent?.(token, helpers) ?? []
  },
})

const SiteImage = Image.extend<ImageOptions & { resolveSrc: (path: string) => string | null }>({
  addOptions() {
    return { ...(this.parent?.() as ImageOptions), resolveSrc: () => null }
  },

  renderHTML({ node }) {
    const { path, style } = splitImageSrc(node.attrs.src ?? '')
    const preview = this.options.resolveSrc(path)
    return [
      'span',
      { class: 'rich-image', 'data-style': style || null, title: node.attrs.title || null },
      preview
        ? ['img', { src: preview, alt: node.attrs.alt ?? '', draggable: 'false' }]
        : ['span', { class: 'rich-image-missing' }, node.attrs.alt || path || '?'],
    ]
  },

  renderMarkdown: (node) => {
    const alt = String(node.attrs?.alt ?? '').replace(/([[\]\\])/g, '\\$1')
    const src = String(node.attrs?.src ?? '')
    const title = String(node.attrs?.title ?? '').replace(/(["\\])/g, '\\$1')
    const target = /[\s()<>]/.test(src) ? `<${src}>` : src
    return title ? `![${alt}](${target} "${title}")` : `![${alt}](${target})`
  },
})

/** The editor's schema and its Markdown conversion; shared with the round-trip tests. */
export function richTextExtensions(resolveSrc: (path: string) => string | null = () => null) {
  return [
    StarterKit.configure({
      heading: { levels: [2, 3, 4] },
      link: { openOnClick: false, autolink: true, protocols: ['mailto', 'tel'] },
      paragraph: false,
    }),
    ImageParagraph,
    SiteImage.configure({ inline: true, resolveSrc }),
    Markdown,
  ]
}
