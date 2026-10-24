import { createHash } from 'node:crypto'

/** The SHA Git gives a blob with this content, so we can track files without asking GitHub. */
export function gitBlobSha(content: string | Buffer): string {
  const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : content
  return createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex')
}
