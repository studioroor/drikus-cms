import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { Format } from './config'

export type Data = Record<string, unknown>

/** In Markdown files this field holds the content below the frontmatter. */
export const BODY_FIELD = 'body'

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n?---[ \t]*(?:\r?\n|$)/

function asObject(value: unknown): Data {
  if (value === null || value === undefined) return {}
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The file does not contain an object at the top level')
  }
  return value as Data
}

export function parseDocument(format: Format, source: string): Data {
  switch (format) {
    case 'json':
      return asObject(source.trim() ? JSON.parse(source) : {})
    case 'yaml':
      return asObject(parseYaml(source))
    case 'md':
    case 'mdx': {
      const match = source.match(FRONTMATTER)
      const frontmatter = match ? asObject(parseYaml(match[1] ?? '')) : {}
      const body = match ? source.slice(match[0].length) : source
      return { ...frontmatter, [BODY_FIELD]: body.replace(/^\r?\n/, '') }
    }
  }
}

/** Drops empty optional values so files stay tidy. */
function compact(data: Data): Data {
  return Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined && v !== null))
}

export function serializeDocument(format: Format, data: Data): string {
  const clean = compact(data)
  switch (format) {
    case 'json':
      return `${JSON.stringify(clean, null, 2)}\n`
    case 'yaml':
      return stringifyYaml(clean, { lineWidth: 0 })
    case 'md':
    case 'mdx': {
      const { [BODY_FIELD]: body, ...frontmatter } = clean
      const text = typeof body === 'string' ? body.replace(/\s+$/, '') : ''
      const head = Object.keys(frontmatter).length
        ? `---\n${stringifyYaml(frontmatter, { lineWidth: 0 })}---\n`
        : ''
      return `${head}${head && text ? '\n' : ''}${text}${text ? '\n' : ''}`
    }
  }
}

export const FORMAT_EXTENSIONS: Record<Format, string[]> = {
  md: ['md', 'markdown'],
  mdx: ['mdx'],
  json: ['json'],
  yaml: ['yaml', 'yml'],
}
