#!/usr/bin/env bash
# One-time setup for "Share my info". Run from the project folder:
#   SUPABASE_ACCESS_TOKEN=<a NEW token> bash supabase/setup-sharing.sh
# Create the token at supabase.com/dashboard/account/tokens, and revoke it afterwards.
set -euo pipefail
REF=tsdkajtobvdtosxrnhth
: "${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN first}"

echo "1/2 Creating the shares table, rules and functions"
node -e 'process.stdout.write(JSON.stringify({query: require("fs").readFileSync("supabase/migrations/016_shares.sql", "utf8")}))' |
  curl -sf -X POST "https://api.supabase.com/v1/projects/$REF/database/query" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" --data-binary @- >/dev/null \
  || { echo "Could not run the SQL (check the token). You can also paste supabase/migrations/016_shares.sql into the Supabase SQL Editor."; exit 1; }

echo "2/2 Deploying the notification function"
npx -y supabase@latest functions deploy notify-share --yes --project-ref "$REF" --no-verify-jwt --use-api
echo "Done. Sharing is live."
