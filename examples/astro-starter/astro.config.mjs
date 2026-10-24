import { defineConfig } from 'astro/config'

// The address the site is published at. Images uploaded in the CMS are linked
// from the root (/uploads/…), so publish on its own (sub)domain.
export default defineConfig({
  site: 'https://www.example.com',
})
