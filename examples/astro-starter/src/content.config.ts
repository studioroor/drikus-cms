import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
import { z } from 'astro/zod'

// Mirrors the "posts" collection in .drikus/config.yml. The CMS writes the
// fields as frontmatter and the rich text below it.
const posts = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    cover: z.string().optional(),
    draft: z.boolean().default(false),
  }),
})

export const collections = { posts }
