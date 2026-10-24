import { getCollection } from 'astro:content'

/** Published posts, newest first. Posts marked "Verborgen" in the CMS are left out. */
export async function publishedPosts() {
  const posts = await getCollection('posts', (p) => !p.data.draft)
  return posts.sort((a, b) => b.data.date.getTime() - a.data.date.getTime())
}
