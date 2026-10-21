# AURA AI — Supabase setup

## What this adds
- Email/password sign-up and sign-in, persistent Supabase sessions, and sign-out.
- Per-account local settings/Knowledge Vault storage keys.
- Cloud chat history stored in `public.aura_chats`.
- `public.aura_profiles` created automatically when a Supabase Auth user is created.
- Row Level Security policies scope all profile/chat reads and writes to `auth.uid()`.

## 1. Apply the schema
Open the **AURA AI Supabase project** → SQL Editor and run the contents of:
`supabase/migrations/202610210001_aura_auth_and_chats.sql`

Do not run this in another project. The migration is safe to re-run for these named tables/policies, but always confirm the dashboard project ID first.

## 2. Configure the client environment
In Vercel → Project `aura-ai` → Settings → Environment Variables, add both variables for **Production** and **Preview**:

- `VITE_SUPABASE_URL`: `https://mhdgqdxgxkrojjdahlex.supabase.co`
- `VITE_SUPABASE_PUBLISHABLE_KEY`: the project's publishable key from Supabase → Project Settings → API Keys.

A publishable key is intended for browser use. Never use a Supabase `service_role` key or a secret API key in a `VITE_*` variable. Keep `GEMINI_API_KEY` server-only.

## 3. Configure Auth URLs
In Supabase → Authentication → URL Configuration:
- Site URL: `https://aura-ai-helpbot.vercel.app`
- Redirect URL allow list: `https://aura-ai-helpbot.vercel.app/**`
- Local development: `http://localhost:5173/**`

Email/password sign-up may require email confirmation depending on the Auth settings. For real users, configure a reliable SMTP provider rather than disabling confirmation long-term.

## 4. Verify after deployment
1. Create a test account and sign in.
2. Send a chat; confirm a row appears in `aura_chats` with your Auth user ID.
3. Sign out and sign in as a second test account; verify the first account's chats are not visible.
4. Check Supabase Database → Tables and run the Security Advisor.
5. Test sign-up email confirmation and password reset flows before inviting users.

## Current limitation
The connected Supabase integration does not currently have permission to the AURA project, so the migration has been committed to GitHub but has **not** been executed against the live database. The Vercel project currently has only the Gemini environment variable; add the two Supabase client variables before sign-in can work.
