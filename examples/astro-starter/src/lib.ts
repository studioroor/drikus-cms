import { Marked } from 'marked'

// Rich text from the CMS is Markdown. Raw HTML in it is shown as text, so a
// pasted <script> can't run on the site.
const markdown = new Marked({
  renderer: {
    html: ({ text }) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
  },
})

export function renderMarkdown(source: string | undefined): string {
  return source ? (markdown.parse(source, { async: false }) as string) : ''
}

/** "15 juni 2026" */
export function formatDate(date: Date): string {
  return date.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' })
}
