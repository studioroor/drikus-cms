import { describe, expect, test } from 'bun:test'
import { adminClient, PASSWORD, setup } from './helpers'

async function editor(ctx: ReturnType<typeof setup>, email: string, siteIds: string[]) {
  await ctx.createUser({ email, siteIds })
  const c = ctx.client()
  await c.post('/api/auth/login', { email, password: PASSWORD })
  return c
}

describe('site access', () => {
  test('editors only see and open their own sites', async () => {
    const ctx = setup()
    const bakery = ctx.createSite('Bakkerij Jansen')
    const barber = ctx.createSite('Kapper Piet')
    const anna = await editor(ctx, 'anna@bakkerij.nl', [bakery.id])

    const list = await anna.get('/api/sites')
    expect(list.json.sites.map((s: { name: string }) => s.name)).toEqual(['Bakkerij Jansen'])
    expect((await anna.get(`/api/sites/${bakery.id}`)).status).toBe(200)

    // Someone else's site and a non-existent site are indistinguishable.
    const other = await anna.get(`/api/sites/${barber.id}`)
    const missing = await anna.get('/api/sites/does-not-exist')
    expect(other.status).toBe(404)
    expect(missing.status).toBe(404)
    expect(other.json).toEqual(missing.json)
    expect((await anna.get(`/api/sites/${barber.id}/anything`)).status).toBe(404)
  })

  test('removing membership revokes access immediately', async () => {
    const ctx = setup()
    const admin = await adminClient(ctx)
    const bakery = ctx.createSite('Bakkerij Jansen')
    const anna = await editor(ctx, 'anna@bakkerij.nl', [bakery.id])
    expect((await anna.get(`/api/sites/${bakery.id}`)).status).toBe(200)
    await admin.put(`/api/admin/sites/${bakery.id}/members`, { userIds: [] })
    expect((await anna.get(`/api/sites/${bakery.id}`)).status).toBe(404)
  })

  test('anonymous users get 401', async () => {
    const ctx = setup()
    expect((await ctx.client().get('/api/sites')).status).toBe(401)
  })
})

describe('admin routes', () => {
  test('are forbidden for editors', async () => {
    const ctx = setup()
    const anna = await editor(ctx, 'anna@bakkerij.nl', [])
    expect((await anna.get('/api/admin/users')).status).toBe(403)
    expect((await anna.post('/api/admin/sites', { name: 'Mine now' })).status).toBe(403)
  })

  test('superadmin manages sites, users and memberships', async () => {
    const ctx = setup()
    const admin = await adminClient(ctx)
    const site = await admin.post('/api/admin/sites', {
      name: 'Bakkerij Jansen',
      siteUrl: 'https://bakkerijjansen.nl',
      repoFullName: 'studioroor/bakkerij-jansen',
    })
    expect(site.status).toBe(201)

    const user = await admin.post('/api/admin/users', {
      email: 'anna@bakkerij.nl',
      name: 'Anna',
      siteIds: [site.json.id, 'bogus-site'],
    })
    const users = await admin.get('/api/admin/users')
    const anna = users.json.users.find((u: { email: string }) => u.email === 'anna@bakkerij.nl')
    expect(anna).toMatchObject({ status: 'invited', siteIds: [site.json.id] })

    const sites = await admin.get('/api/admin/sites')
    expect(sites.json.sites[0]).toMatchObject({
      repoFullName: 'studioroor/bakkerij-jansen',
      memberIds: [user.json.id],
    })

    const dup = await admin.post('/api/admin/users', { email: 'ANNA@bakkerij.nl', name: 'Anna 2' })
    expect(dup.status).toBe(409)

    const audit = await admin.get('/api/admin/audit')
    expect(audit.json.entries.map((e: { action: string }) => e.action)).toContain('user.created')
  })

  test('rejects invalid repo names', async () => {
    const ctx = setup()
    const admin = await adminClient(ctx)
    const res = await admin.post('/api/admin/sites', { name: 'X', repoFullName: '../../etc' })
    expect(res.status).toBe(400)
  })

  test('superadmin cannot lock themselves out', async () => {
    const ctx = setup()
    const admin = await adminClient(ctx)
    const me = (await admin.get('/api/auth/me')).json.user
    expect((await admin.patch(`/api/admin/users/${me.id}`, { disabled: true })).status).toBe(400)
    expect((await admin.patch(`/api/admin/users/${me.id}`, { role: 'editor' })).status).toBe(400)
    expect((await admin.del(`/api/admin/users/${me.id}`)).status).toBe(400)
  })
})
