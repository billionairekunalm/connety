# Connections

Personal CRM for people you actually meet: selfie, visiting card, where you met, how they can help, map, and "who to call" reminders.

**Stack:** React + Vite + TypeScript, Supabase (auth, Postgres, storage), Leaflet + OpenStreetMap.

## Setup
1. Create a project at supabase.com.
2. SQL Editor → paste and run `supabase/schema.sql`.
3. Copy `.env.example` to `.env` and fill in URL + anon key (Project Settings → API).
4. `npm install` then `npm run dev`.

## Deploy
Push to GitHub, import in Vercel/Netlify, set the two `VITE_` env vars. Camera, location and `tel:` calls need HTTPS (Vercel gives you that).
Add the deployed URL in Supabase → Authentication → URL Configuration.
