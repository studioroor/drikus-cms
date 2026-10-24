import { describe, expect, test } from 'bun:test'
import { MarkdownManager } from '@tiptap/markdown'
import { Node } from '@tiptap/pm/model'
import { getSchema } from '@tiptap/react'
import {
  joinImageSrc,
  richTextExtensions,
  splitImageSrc,
} from '../src/components/editor/rich-text-extensions'

const extensions = richTextExtensions().filter((e) => e.name !== 'markdown')
const markdown = new MarkdownManager({ extensions })
const schema = getSchema(extensions)

/** Markdown → editor document → Markdown, as loading and saving a field does. */
function roundTrip(source: string) {
  const doc = Node.fromJSON(schema, markdown.parse(source))
  doc.check()
  return markdown.serialize(doc.toJSON()).trim()
}

describe('rich text images', () => {
  test('keeps an image on its own line, with its style hint and caption', () => {
    const source = [
      'Intro text.',
      '',
      '![A cartoon](/uploads/2019/06/cartoon.jpg#medium "The caption — Copyright 2019")',
      '',
      '---',
      '',
      '![](/uploads/2018/06/cartoon-1.jpg "Een ‘ludieke’ kijk")',
    ].join('\n')
    expect(roundTrip(source)).toBe(source)
  })

  test('keeps an image inside a paragraph so text flows around it', () => {
    const source =
      '![Christ Klep bij Pauw](/uploads/2019/01/media.jpg#right)Regelmatig becommentarieer ik *actuele* zaken.'
    expect(roundTrip(source)).toBe(source)
  })

  test('keeps images in headings and lists', () => {
    const source = '## ![](/uploads/logo.png#small) Heading\n\n- ![](/uploads/a.jpg) item'
    expect(roundTrip(source)).toBe(source)
  })

  test('escapes captions, alt text and paths that would break the Markdown', () => {
    const doc = schema.node('doc', null, [
      schema.node('paragraph', null, [
        schema.node('image', {
          src: '/uploads/my photo (1).jpg',
          alt: 'a [bracketed] alt',
          title: 'She said "hi"',
        }),
      ]),
    ])
    const out = markdown.serialize(doc.toJSON())
    expect(out.trim()).toBe(
      '![a \\[bracketed\\] alt](</uploads/my photo (1).jpg> "She said \\"hi\\"")',
    )
    const image = markdown.parse(out).content?.[0]?.content?.[0]
    expect(image?.attrs).toMatchObject({
      src: '/uploads/my photo (1).jpg',
      alt: 'a [bracketed] alt',
      title: 'She said "hi"',
    })
  })
})

describe('image style hints', () => {
  test('splits and joins the hint after #', () => {
    expect(splitImageSrc('/uploads/a.jpg#right')).toEqual({
      path: '/uploads/a.jpg',
      style: 'right',
    })
    expect(splitImageSrc('/uploads/a.jpg')).toEqual({ path: '/uploads/a.jpg', style: '' })
    expect(joinImageSrc('/uploads/a.jpg', 'small')).toBe('/uploads/a.jpg#small')
    expect(joinImageSrc('/uploads/a.jpg', '')).toBe('/uploads/a.jpg')
  })
})
