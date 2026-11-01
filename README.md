# Connections

Personal CRM for people you actually meet: selfie, visiting card, where you met, how they can help, map, and "who to call" reminders.

**Stack:** React + Vite + TypeScript, Supabase (auth, Postgres, storage), Leaflet + OpenStreetMap.

## Setup
1. Create a project at supabase.com.
2. SQL Editor → paste and run `supabase/schema.sql`.
3. Copy `.env.example` to `.env` and fill in URL + anon key (Project Settings → API).
4. `npm install` then `npm run dev`.

## Deploy
Push to GitHub; Vercel builds it. Production builds read Supabase settings from `.env.production`
(publishable key only, which is safe to be public). Vercel environment variables override it.
A production build without keys shows "App not configured"; it never falls back to test mode.

Supabase → Authentication → URL Configuration:
- Site URL: `https://connety-plum.vercel.app`
- Redirect URLs: `https://connety-plum.vercel.app/**` and `http://localhost:5173/**`

Supabase's built-in email sender is for testing only (a few emails per hour). For real users, add custom SMTP
(Authentication → Emails → SMTP Settings, e.g. Resend) or turn off "Confirm email".

`npm run dev:offline` runs a browser-storage test mode; `npm run preview` serves the production build.
