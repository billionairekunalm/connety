#!/usr/bin/env bash
# One-time setup for push reminders. Run from the project folder:  bash supabase/setup-reminders.sh
# Needs: SUPABASE_ACCESS_TOKEN set to a fresh token from supabase.com/dashboard/account/tokens
set -euo pipefail
REF=tsdkajtobvdtosxrnhth
set -a; . ./.env; set +a
: "${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN first}"

echo "1/3 Storing push keys as function secrets"
npx -y supabase@latest secrets set --yes --project-ref "$REF" \
  "VAPID_PUBLIC_KEY=$VITE_VAPID_PUBLIC_KEY" "VAPID_PRIVATE_KEY=$VAPID_PRIVATE_KEY" \
  "CRON_SECRET=$CRON_SECRET" "VAPID_SUBJECT=https://connety-plum.vercel.app"

echo "2/3 Deploying the send-reminders function"
npx -y supabase@latest functions deploy send-reminders --yes --project-ref "$REF" --no-verify-jwt --use-api

echo "3/3 Scheduling it daily at 9:00 AM IST"
run_sql() { printf %s "$1" | node -e 'process.stdout.write(JSON.stringify({query: require("fs").readFileSync(0, "utf8")}))' |
  curl -sf -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" --data-binary @- >/dev/null; }
run_sql "select vault.create_secret('$CRON_SECRET', 'cron_secret') where not exists (select 1 from vault.secrets where name = 'cron_secret')"
run_sql "$(cat supabase/migrations/004_schedule_reminders.sql)"
echo "Done. Open the app, tap 'Turn on' on the reminder card, then My Card → Test."
