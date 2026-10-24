import { join } from 'node:path'
import { configJsonSchema } from '../src/content/config'

export const SCHEMA_PATH = join(import.meta.dir, '../../../schema/drikus-config.schema.json')

export function schemaText() {
  const schema = {
    $id: 'https://github.com/studioroor/drikus-cms/raw/main/schema/drikus-config.schema.json',
    title: 'Drikus CMS configuration (.drikus/config.yml)',
    ...configJsonSchema(),
  }
  return `${JSON.stringify(schema, null, 2)}\n`
}

if (import.meta.main) {
  await Bun.write(SCHEMA_PATH, schemaText())
  console.log(`Wrote ${SCHEMA_PATH}`)
}
