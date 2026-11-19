// Sends a push notification to the receiver of a "share my info".
// Called by the sender's app right after share_with(). The function re-checks everything server-side:
// the caller must be the sender, the share must still be pending, and the push goes out only once.
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2.45.4'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: cors })

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
  const { data: auth } = await db.auth.getUser(token)
  if (!auth.user) return json({ error: 'forbidden' }, 403)

  const { share_id } = await req.json().catch(() => ({}))
  if (!share_id) return json({ error: 'share_id required' }, 400)

  // Claim the share: only its sender, only while pending, only the first time.
  const { data: s } = await db.from('shares')
    .update({ notified_at: new Date().toISOString() })
    .eq('id', share_id).eq('from_user', auth.user.id).eq('status', 'pending').is('notified_at', null)
    .select('id, to_user, message, card').maybeSingle()
  if (!s) return json({ sent: 0 })

  webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!, Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!)
  const { data: subs } = await db.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', s.to_user)

  const name = (s.card as { name?: string }).name ?? 'Someone'
  const payload = JSON.stringify({
    title: `${name} shared their details 🤝`,
    body: s.message ? `“${s.message}”` : 'Tap to review and add them to your people.',
    url: `/?share=${s.id}`,
  })
  let sent = 0
  for (const sub of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)
      sent++
    } catch (e) {
      // device unsubscribed or app removed: forget it
      const code = (e as { statusCode?: number }).statusCode
      if (code === 404 || code === 410) await db.from('push_subscriptions').delete().eq('id', sub.id)
    }
  }
  return json({ sent })
})
