import type { Field } from './config'
import type { Data } from './format'

export interface FieldIssue {
  path: string
  code: 'invalid' | 'required'
  message: string
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/
const COLOR = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const MAX_STRING = 1_000_000

const isEmpty = (v: unknown) =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)

const isPlainObject = (v: unknown): v is Data =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function optionValues(field: Field) {
  return (field.options ?? []).map((o) => (typeof o === 'object' ? o.value : o))
}

/**
 * Checks entry data against the configured fields. Type mismatches are
 * `invalid` (rejected on save); empty required fields are `required` (allowed
 * in drafts, blocking at publish). Unknown keys are left alone so content the
 * schema doesn't describe is never lost.
 */
export function checkFields(fields: Field[], data: Data, at = ''): FieldIssue[] {
  const issues: FieldIssue[] = []
  for (const field of fields) {
    const path = at ? `${at}.${field.name}` : field.name
    issues.push(...checkValue(field, data[field.name], path))
  }
  return issues
}

function checkValue(field: Field, value: unknown, path: string): FieldIssue[] {
  const invalid = (message: string): FieldIssue[] => [{ path, code: 'invalid', message }]
  if (isEmpty(value)) {
    return field.required ? [{ path, code: 'required', message: 'This field is required' }] : []
  }

  switch (field.type) {
    case 'string':
    case 'text':
    case 'markdown':
    case 'richtext':
    case 'image':
    case 'file':
    case 'url':
    case 'hidden': {
      if (field.type === 'hidden') return []
      if (typeof value !== 'string') return invalid('Expected text')
      const max = field.maxLength ?? MAX_STRING
      return value.length > max ? invalid(`At most ${max} characters`) : []
    }
    case 'date':
      return typeof value === 'string' && DATE.test(value)
        ? []
        : invalid('Expected a date (YYYY-MM-DD)')
    case 'datetime':
      return typeof value === 'string' && DATETIME.test(value)
        ? []
        : invalid('Expected a date and time')
    case 'color':
      return typeof value === 'string' && COLOR.test(value)
        ? []
        : invalid('Expected a colour like #ff8800')
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return invalid('Expected a number')
      if (field.min !== undefined && value < field.min) return invalid(`At least ${field.min}`)
      if (field.max !== undefined && value > field.max) return invalid(`At most ${field.max}`)
      return []
    }
    case 'boolean':
      return typeof value === 'boolean' ? [] : invalid('Expected yes or no')
    case 'select': {
      const allowed = optionValues(field)
      const values = field.multiple ? value : [value]
      if (!Array.isArray(values)) return invalid('Expected a list of choices')
      return values.every((v) => allowed.includes(v as string | number))
        ? []
        : invalid('Not one of the choices')
    }
    case 'reference': {
      const values = field.multiple ? value : [value]
      if (!Array.isArray(values) || !values.every((v) => typeof v === 'string'))
        return invalid('Expected a reference')
      return []
    }
    case 'object':
      return isPlainObject(value)
        ? checkFields(field.fields ?? [], value, path)
        : invalid('Expected a group of fields')
    case 'list': {
      if (!Array.isArray(value)) return invalid('Expected a list')
      const issues: FieldIssue[] = []
      if (field.maxItems !== undefined && value.length > field.maxItems) {
        issues.push(...invalid(`At most ${field.maxItems} items`))
      }
      if (field.minItems !== undefined && value.length < field.minItems) {
        issues.push({ path, code: 'required', message: `At least ${field.minItems} items` })
      }
      value.forEach((item, i) => {
        if (field.fields) {
          if (!isPlainObject(item)) issues.push(...invalid('Expected a group of fields'))
          else issues.push(...checkFields(field.fields, item, `${path}.${i}`))
        } else if (field.field) {
          issues.push(...checkValue({ ...field.field, required: false }, item, `${path}.${i}`))
        }
      })
      return issues
    }
    case 'blocks': {
      if (!Array.isArray(value)) return invalid('Expected a list of blocks')
      const issues: FieldIssue[] = []
      value.forEach((item, i) => {
        const block = isPlainObject(item)
          ? field.blocks?.find((b) => b.name === item[field.typeKey])
          : undefined
        if (!block || !isPlainObject(item)) {
          issues.push({ path: `${path}.${i}`, code: 'invalid', message: 'Unknown block type' })
        } else {
          issues.push(...checkFields(block.fields, item, `${path}.${i}`))
        }
      })
      return issues
    }
  }
}

/** Initial data for a new entry from the configured defaults. */
export function defaultData(fields: Field[]): Data {
  const data: Data = {}
  for (const f of fields) {
    if (f.default !== undefined) data[f.name] = f.default
    else if (f.type === 'boolean') data[f.name] = false
  }
  return data
}

/** The text used to represent an entry in lists. */
export function entryTitle(fields: Field[], data: Data, summary?: string): string | null {
  const key =
    summary ??
    (fields.some((f) => f.name === 'title')
      ? 'title'
      : fields.find((f) => f.type === 'string')?.name)
  const value = key ? data[key] : undefined
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null
}
