# Supabase auth URL configuration

This is **dashboard config, not code**. The app builds its own redirect URLs
correctly from the request origin (`siteOrigin()` in `src/lib/auth/actions.ts`),
so nothing in the repo can fix a wrong setting here. Written down because the
failure it causes looks like an app bug.

Supabase project: **SQ-store**, ref `vnyfndqpdllwhvhinjoi`.
Dashboard → Authentication → URL Configuration.

## Required values

**Site URL**

```
https://dashboard.squareshare.eu
```

**Redirect URLs** (allowlist, one per line)

```
http://localhost:3000/**
https://dashboard.squareshare.eu/**
```

## Why the `/**`

GoTrue matches the allowlist against the **whole** URL, query string included.
Every redirect this app sends carries one:

```
http://localhost:3000/auth/callback?next=%2Fdashboard
```

So a bare `http://localhost:3000` or even `http://localhost:3000/auth/callback`
does **not** match. The trailing `/**` glob is what makes it match.

## The symptom when it is wrong

A rejected `redirect_to` is not an error. GoTrue silently discards it and sends
the browser to the **Site URL root** with the code attached:

```
https://squareshare.eu/?code=24588c03-...
```

That is the signature: landing on `/` of some other host with a `?code=`, when
the app asked for `/auth/callback`. The code is then never exchanged, so the
sign-in just quietly fails. If you see it, the URL you were signing in from is
missing from the allowlist — add it with `/**`.

Add a line here whenever a new origin needs to sign in (a preview deploy, a
teammate on a different dev port).
