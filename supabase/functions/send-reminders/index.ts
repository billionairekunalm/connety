// Sends "time to call" push notifications.
// - Daily cron (header x-cron-secret): everyone with people due today.
// - Signed-in user (Authorization: Bearer <their token>, body {test:true}): a test push to just their devices.
// ponytail: loads all due contacts in one query; fine for thousands of rows, page by user if it grows past that.
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

const DAY = 864e5
const GRAVE_DAYS = 180 // same as the app
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  let onlyUser: string | null = null
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) {
    const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    const { data } = await db.auth.getUser(token)
    if (!data.user) return new Response('forbidden', { status: 403, headers: cors })
    onlyUser = data.user.id
  }

  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!, Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!)

  let subsQ = db.from('push_subscriptions').select('*')
  let contactsQ = db.from('contacts').select('user_id, name, importance, last_contacted_at, contact_every_days')
  if (onlyUser) { subsQ = subsQ.eq('user_id', onlyUser); contactsQ = contactsQ.eq('user_id', onlyUser) }
  const [{ data: subs }, { data: contacts }] = await Promise.all([subsQ, contactsQ])

  const due = new Map<string, { name: string; importance: number }[]>()
  for (const c of contacts ?? []) {
    const last = new Date(c.last_contacted_at).getTime()
    if (last + c.contact_every_days * DAY > Date.now()) continue
    if (Date.now() - last > GRAVE_DAYS * DAY) continue // in the graveyard: no daily nagging, matches the app
    due.set(c.user_id, [...(due.get(c.user_id) ?? []), c])
  }

  let sent = 0
  for (const s of subs ?? []) {
    const list = (due.get(s.user_id) ?? []).sort((a, b) => a.importance - b.importance)
    if (!list.length && !onlyUser) continue
    const names = list.slice(0, 3).map(c => c.name).join(', ') + (list.length > 3 ? ` +${list.length - 3} more` : '')
    const msg = !list.length
      ? { title: 'Reminders are on ✓', body: "Nobody to call right now. We'll remind you when it's time." }
      : list.length === 1
        ? { title: `Time to call ${list[0].name} 📞`, body: 'Keep in touch: open the app to call.' }
        : { title: `${list.length} people to call today 📞`, body: names }
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ ...msg, url: '/' }))
      sent++
    } catch (e) {
      // Phone unsubscribed or app removed: forget this device.
      if ((e as { statusCode?: number }).statusCode === 404 || (e as { statusCode?: number }).statusCode === 410)
        await db.from('push_subscriptions').delete().eq('id', s.id)
    }
  }
  return Response.json({ sent }, { headers: cors })
})
