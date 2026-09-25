# Tether

Private OTS campus accountability at **https://tether.russelllubinski.us**.

## Member workflow

1. Ask staff to approve the exact email you will use to sign in.
2. Open Tether and enter the email verification code. Complete **Profile** with your full name, flight, room and U.S. phone number.
3. Select **CHECK OUT**, enter a destination and future return time, review your details, then confirm.
4. On returning to campus, select **CHECK IN** and confirm. **My history** retains your trips.

The roster refreshes every 15 seconds while the app is visible and immediately after your own changes. All displayed and entered times use **America/Chicago**, even when your phone uses another timezone. Ambiguous or nonexistent daylight-saving transition times are rejected with an explanation. Expected return must be within seven days. Overdue trips remain active until checked in; there is no automatic check-in.

If the connection fails, the app marks the status unverified and disables the main action. It never assumes a failed response means the write did not happen. Reconnect and verify the refreshed status. Retrying the same pending action reuses its request identifier. Refreshing the page retrieves the authoritative server state.

Use Safari **Share → Add to Home Screen**, or the equivalent browser menu on Android. The manifest and icons support standalone display. There is no service worker or offline personnel-data cache.

## Staff workflow

Sign in at the same address with an approved administrator account, then open **Staff**.

- **Members → Approve email** allows a new member to sign in. Share the website address separately; Tether does not send invitation emails.
- **Manage access** enables/disables accounts or promotes another approved member to Administrator. Every change requires a reason and is audited. An active trip must be closed before an account can be disabled. Administrators cannot remove their own access; at least one enabled administrator must remain.
- **Records** provides search, flight/date/status filters and member-specific history. Date ranges apply to departure dates in Central Time. Results load in pages of 50.
- **Check member in** records a staff-confirmed return and reason, retaining the trip as `ADMIN_CLOSED`.
- **Correct record** edits destination or timestamps with a required reason. Clear actual check-in to reopen an erroneous return; the database rejects reopening if another trip is active. The original values, new values, actor, reason and timestamp remain in **Audit trail**.
- **Contact member** reveals the phone number only to staff. Ordinary members never receive other members’ phone numbers in API responses.

Campus counts include enabled members with completed profiles. Approved accounts awaiting setup are counted separately. Names, flights, rooms and phone numbers are snapshotted when checking out; editing a profile does not rewrite historical trip identity.

## Architecture and authentication

Tether follows the existing Cloudflare Workers deployment model used by the root website and Operation Valor. It is a separate Worker, custom domain and SQLite-backed Durable Object, with no dependency on their data or routes. The interface uses small native JavaScript modules and CSS, matching the root site’s navy and blue styling.

Cloudflare Access protects the entire hostname, including assets and APIs, using the existing email one-time PIN identity provider. The Access application permits verified-email authentication; **Tether’s database allowlist is a second mandatory authorization layer**. A valid Cloudflare token alone does not grant application access. Unapproved or disabled emails receive no app, roster or profile data.

The Worker validates the assertion’s RS256 signature, issuer, audience, expiry, subject and email. It checks database membership on every request and checks roles again on every staff operation. `workers.dev` and preview URLs are disabled. There is no production authentication bypass. Local preview identities exist only in `scripts/preview.mjs`, outside the deployed entry point and asset directory.

Access sessions last 24 hours and use its Secure, HTTPOnly cookie with SameSite=Lax. Cloudflare manages email-code abuse protection; Tether additionally enforces persisted per-user limits of 30 mutation attempts and 180 reads per minute. Mutations and private queries require the exact application Origin, a custom request header and JSON. Bodies are limited to 8 KiB. CORS access is not granted.

All application responses use `no-store`, HSTS, `noindex/nofollow/noarchive`, a restrictive CSP, no-referrer, clickjacking protection and disabled geolocation/camera/microphone. Inputs are bounded and validated, SQL values are bound, and UI data is rendered as text. There are no analytics, GPS collection, browser-storage profile copies, request-body logs or application console logs. Worker observability is disabled to avoid unintended personnel logging. Audit information is stored privately in the database, not application logs.

## Data and integrity

The binding `ACCOUNTABILITY` addresses `Accountability`, object name `tether-accountability-v1`. Keep that identity stable across deployments.

| Table | Purpose |
| --- | --- |
| `users` | Unique approved email, required profile when completed, role, enabled flag, revision and timestamps |
| `checkouts` | Profile snapshot, destination, UTC departure/expected/actual return, status, revision |
| `audit` | Actor, subject, trip, server timestamp, event and correction details |
| `requests` | Per-user idempotency key, request hash and committed result; seven-day retention |
| `limits` | Persisted request-rate counters |
| `schema_migrations`, `metadata` | Applied migration versions and one-time bootstrap state |

Statuses are `ACTIVE`, `COMPLETED` and `ADMIN_CLOSED`. Corrections retain the operational status and add a `RECORD_CORRECTED` audit event. A partial unique index prohibits more than one `ACTIVE` trip per user. Constraints also enforce valid active/closed timestamp combinations. Status changes, audit entries, user revisions and idempotency receipts commit in one SQLite transaction. All departure/check-in timestamps are server-generated UTC. Expected return is user-selected but validated by the server.

Optimistic revision checks reject stale checkouts, profile edits and staff corrections. Check-in targets a specific owned trip, so a delayed request cannot close a later trip. Duplicate check-ins succeed without duplicating audit events. A server restart preserves all authoritative data.

## Configuration and deployment

Use Node.js 24 and pnpm 11. Run commands from `tether/`.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm test:runtime
pnpm deploy
```

`pnpm preview` starts a localhost-only synthetic UI harness on port 8791. It is never a production server. `/preview/member` and `/preview/staff` switch local test roles. Runtime tests use Cloudflare’s actual local SQLite runtime and verify persistence across a restart. Test data stays in local memory or ignored `.wrangler/` storage.

`wrangler.jsonc` contains public deployment configuration. `.env.example` lists variable names without values; it is documentation, not automatically loaded by the Worker.

| Variable | Where / purpose |
| --- | --- |
| `APP_ORIGIN` | Wrangler variable: exact HTTPS origin for routing and CSRF |
| `ACCESS_TEAM_DOMAIN` | Wrangler variable: existing Cloudflare Access issuer |
| `ACCESS_AUD` | Wrangler variable: Tether’s own Access audience; not Valor’s |
| `BOOTSTRAP_ADMIN_EMAIL` | **Worker secret**: creates one initial administrator when the database is first initialized |
| `CLOUDFLARE_ACCOUNT_ID` | Deployment environment, when using a scoped automation token |
| `CLOUDFLARE_API_TOKEN` | Deployment secret, if using token-based deployment instead of Wrangler OAuth |
| `CLOUDFLARE_ACCESS_TOKEN_FILE` | Local path to a temporary Access setup token; never a runtime binding |

Provision the initial administrator with `pnpm exec wrangler secret put BOOTSTRAP_ADMIN_EMAIL`. Changing this secret after bootstrap does **not** modify existing administrators. Use **Staff → Members → Manage access** for later promotions.

The Access setup script `node scripts/configure-access.mjs` requires a temporary account-scoped token with **Access: Apps and Policies — Edit** and **Access: Organizations, Identity Providers, and Groups — Read**. It only creates/inspects Tether’s own application and updates its audience in the Wrangler configuration. It refuses to overwrite unexpected existing policies. Remove the token file and revoke the temporary token after setup. Runtime operation needs no Cloudflare management token or database password; only the private Durable Object binding can access the database.

Deployment follows the existing manual Wrangler convention. The GitHub workflow runs tests and a bundle check on Tether changes; it does not deploy or need production credentials. Review those checks, then deploy with the authorized Cloudflare account. Do not commit `.dev.vars`, `.env`, credentials, database exports or Wrangler state. `NODE_USE_SYSTEM_CA=1` may be needed on a machine with an enterprise certificate authority; never disable TLS verification.

## DNS and HTTPS

The Worker custom-domain route owns only `tether.russelllubinski.us`. Cloudflare provisions its DNS routing and managed TLS certificate. The existing zone redirects HTTP to HTTPS; the Worker also enforces HTTPS. The root website and Valor custom domains remain assigned to their original Workers. Do not add a wildcard route or replace their DNS records.

Cloudflare Access application: **Tether — OTS Accountability**. It uses the existing account’s Access organization, so the sign-in page may display that organization’s Operation Valor heading.

## Migrations, backup and recovery

`migrations/001_initial.sql` defines the initial schema. The Durable Object constructor applies numbered migrations transactionally and records each version in `schema_migrations`. To change the schema, add a new numbered SQL file, import it in `src/worker.mjs`, and append it to the migration list. Never edit an already-applied migration. Test both an empty database and an existing database upgrade before deploying. Wrangler’s `v1` migration creates the SQLite-backed class; future SQL schema changes do not require recreating that class or changing the object name.

Cloudflare provides a rolling **30-day point-in-time recovery window** for SQLite-backed Durable Objects. That recovery window is separate from application history, which Tether does not automatically delete. See [Cloudflare’s recovery API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#pitr-point-in-time-recovery-api).

Before a material schema upgrade, the deployment operator should capture a current bookmark with `ctx.storage.getCurrentBookmark()` using an account-controlled maintenance procedure. For disaster recovery, temporarily stop accountability writes, choose a bookmark/time in the recovery window, call `onNextSessionRestoreBookmark`, retain its undo bookmark, then restart the object. This is an operator procedure requiring a reviewed maintenance deployment; there is deliberately no web endpoint that restores or erases the entire database. Verify the resulting roster with staff before reopening writes. Never use a whole-database restore to fix one incorrect trip; use the audited staff correction flow.

For retention beyond the recovery window or independent disaster recovery, establish an approved encrypted off-provider backup/export schedule before relying on long-term archives. No off-provider backup schedule is configured by this application. Restrict backup access to authorized operators and never store exports in this public repository. Keep the Cloudflare account’s recovery methods current and maintain a second approved administrator. If the only administrator loses their mailbox, recover that mailbox or have the Cloudflare account owner perform a reviewed, audited administrator-recovery migration; the bootstrap secret cannot silently replace existing access.

## Verification

Tests cover membership, signed/forged/expired tokens, role boundaries, CSRF, validation, snapshots, duplicates, concurrent checkout, idempotency, stale devices, manual check-in, correction audit, disabled accounts, database failures, filters, rate limits, Central Time and DST. The runtime test checks real Cloudflare SQLite migrations and restart persistence. Browser checks cover the member/staff workflows, keyboard confirmation and phone/tablet/desktop layouts. Synthetic records are confined to local testing.
