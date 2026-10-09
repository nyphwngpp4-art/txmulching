# Apps Script redeploy

`Code.gs` is the source of truth for the lead Sheet and the owner email. The
live script does not read this file. Someone signed in as
`agavi.aiconsulting@gmail.com` has to paste it into the Apps Script project
and deploy a new version.

Do this in one sitting with the Worker secret, or real leads will 502 (or sit
in D1 unforwarded) until both sides agree on the token.

## Before you paste

1. Cloudflare → Workers → `txmulching` → Settings → Variables and Secrets.
   Confirm `GOOGLE_SCRIPT_URL` is the current `/exec` URL and not the archived
   one. The Worker no longer has a fallback URL.
2. Add a header row on the leads Sheet if columns J–S are empty. The script
   writes them on every new row. Headers, in order, starting at J:

   Address, City, County, Density, Timeline, Callback window, Budget, Photo links, Ref, Source

   A–I stay: Timestamp, Name, Phone, Email, ZIP, Acreage, Service, Details, Request ID.
3. Generate a long random token (`openssl rand -hex 32`). You will put the
   same value in two places.

## Deploy

1. Open the Apps Script project bound to the "TX Mulching Quote Leads" Sheet.
2. Replace the whole script with `apps-script/Code.gs`.
3. Project Settings → Script properties → Add `TOKEN` = the random token.
4. Deploy → Manage deployments → pencil → Version: New version → Deploy.
   Execute as: Me. Who has access: Anyone.
5. If this is a brand-new deployment (new URL), copy the `/exec` URL.
   Cloudflare → `txmulching` → Settings → Variables and Secrets → set
   `GOOGLE_SCRIPT_URL` to that URL. Archive the previous deployment only
   after one real test row lands.
6. Cloudflare → add secret `APPS_SCRIPT_TOKEN` with the same token value.
   The Worker sends it as `token`. Posts without it get `{ok:false}` and no
   row.

## Check

1. Run `testNotification` once from the editor. Confirm the new subject
   (`New lead: …`) reaches Hal, Kim, `info@`, and Jay. Delete the test from
   their inboxes if you do not want it kept. This function does not write a
   row.
2. From a preview or local Worker with the secrets set, submit one lead
   named `TEST — delete me`. Confirm one Sheet row, the literal text if you
   use the name `=1+1` (not a calculated `2`), and one email whose subject
   includes acreage, service, city, and phone.
3. `POST` the `/exec` URL with no token. The response is `{ok:false}` and
   the Sheet does not grow.

## Demo sink

Demo submissions (`?demo=1`) do not call `GOOGLE_SCRIPT_URL`. To keep a copy
outside D1, deploy this same script a second time (or point a second Sheet
at it) and set the Worker secret `DEMO_SCRIPT_URL` to that `/exec` URL. Use
the same `TOKEN`. The script writes `demo: true` posts to a tab named
`Demo Leads` and does not email the owners.

If `DEMO_SCRIPT_URL` is unset, demo leads stay in the D1 `demo_leads` table
when the `LEADS` binding exists, and in the local stub when `DEMO_STUB=1`.

## Quota

The script sends one email per lead (owners in BCC) after checking
`MailApp.getRemainingDailyQuota()`. Under about 8 remaining sends it emails
Jay once that day. Under 1 it returns `{ok:false}` so the Worker keeps the
D1 row and retries. A consumer Gmail account is still about 100 recipients
a day; four owners means about 25 leads before the quota warning.
