# Tether

OTS accountability at https://tether.russelllubinski.us. Staff: https://tether.russelllubinski.us/staff.

## Member workflow

1. Enter the campus password supplied by staff. Members do not use email verification.
2. On the first device, create a profile with name, flight, room and U.S. phone number.
3. **CHECK OUT** requires a destination and future return time, followed by confirmation.
4. **CHECK IN** confirms return to campus. **My history** retains previous trips.
5. **Profile → Connect another device** generates a private, one-use connection code valid for 24 hours. Enter the campus password on the new device, choose **Already have a Tether profile?**, and enter the code. Existing email profiles need a code from staff; they are not deleted or automatically claimable by name.

The roster is visible to members who know the campus password and have completed setup. It refreshes every 15 seconds while visible and after personal changes. Other members' phone numbers are excluded from member API responses. Times are always **America/Chicago**; daylight-saving gaps and ambiguous times are rejected. Expected return must be within seven days. Overdue trips remain active until checked in.

The password unlock lasts 24 hours. A separate secure cookie remembers the profile for up to one year. **Log out** locks the application but remembers the profile. **Profile → Forget this device** removes the device connection without deleting history. Browser-data clearing requires reconnecting with a code. On a shared phone, forget the device before handing it over.

Network failures never imply success: the app marks status unverified, disables the main action, and reconciles with the server. Retried actions reuse their request identifier; refreshing reads authoritative state. There is no GPS collection.

Use the phone browser's **Add to Home Screen** option. The manifest supports standalone display; there is no service worker or offline personnel-data cache.

## Staff workflow

Open **/staff** and use an approved staff email for email-code sign-in. Staff do not need the campus password. New staff complete their own profile before checking out; staff tools are available immediately.

- **Members → Connection code** reconnects an existing profile. **Reset existing devices** revokes that member's device sessions and outstanding codes before creating a replacement code. A reason is required.
- **Manage access** enables/disables a member. Close active trips before disabling access. Historical records remain intact.
- **Records** provides search, flight/date/status filters, and member history in pages of 50. Date filters use Central departure dates.
- **Check member in** records the staff-confirmed return and reason as ADMIN_CLOSED.
- **Correct record** edits destination or timestamps with a reason. Clearing actual return reopens a trip only when no other active trip exists. Before/after values, actor, reason and time remain in **Audit trail**.
- **Contact member** reveals a phone number to staff.

Campus counts include enabled members with completed profiles. Names, flights, rooms and phone numbers are snapshotted at checkout; profile edits do not rewrite historical identities.

## Architecture and security

A separate Cloudflare Worker and SQLite Durable Object follow the root website and Operation Valor deployment model. Native JavaScript/CSS use the existing navy/blue visual identity. Their routes and databases remain independent.

**Member authentication:** the Worker verifies MEMBER_PASSWORD server-side, issues a random 256-bit gate token and a separate random 256-bit device token, and stores only token hashes. Cookies use the __Host- prefix, Secure, HttpOnly, SameSite=Strict and Path=/. The database checks password version, session expiry and enabled user on every private request. Device authorization is always capped to Member, even for an underlying administrator profile. Setup cannot select or claim another member by name. Connection codes use 128 random bits, are stored hashed, are one-use, and expire after 24 hours. Lost-response retries are supported on the same gate.

**Staff authentication:** Cloudflare Access protects /staff and its subpaths, including /staff/api/*. Its allow policy names only approved staff emails. The Worker independently validates the Access JWT signature, issuer, audience, expiry, subject and email, then checks its own approved email list and an enabled database administrator role. The original bootstrap administrator remains included alongside STAFF_EMAILS. Newly configured staff accounts are created or promoted once with a STAFF_APPROVED audit event; subsequent deployments do not re-enable disabled accounts or overwrite profiles and history. Email verification alone is not two-factor authentication. Member routes cannot grant staff authority. Access sessions last 24 hours with Secure/HttpOnly cookies.

Sensitive operations enforce server authorization. Writes require the exact Origin, a custom request header and JSON; bodies are limited to 8 KiB. Persisted limits allow 60 login/setup attempts per source IP per 15 minutes (1,500 globally), 30 user mutations/minute and 180 reads/minute. IP addresses are hashed before storage. Public files contain generic interface code and graphics, not the password or personnel data.

Responses use no-store, HSTS, noindex/nofollow/noarchive, CSP, no-referrer, clickjacking protection and disabled geolocation/camera/microphone. Inputs are validated, SQL values are bound and output is rendered as text. There are no third-party analytics, localStorage profile copies, sensitive request logs or Worker observability. workers.dev and preview URLs are disabled.

## Data and integrity

Keep binding **ACCOUNTABILITY**, class **Accountability**, and object name **tether-accountability-v1** stable.

| Table | Purpose |
| --- | --- |
| users | Profile, account type, role, enabled flag, version and UTC timestamps |
| checkouts | Profile snapshot, destination, departure/expected/actual return, status and revision |
| sessions | Hashed gate/device/connection tokens, expiry and password version |
| audit | Actor, subject, trip, timestamp, event and correction details |
| requests | Per-user idempotency receipts retained seven days |
| limits | Persistent request-rate counters |
| schema_migrations, metadata | Migration versions and one-time bootstrap |

Device profiles use internal generated email identifiers for compatibility with the original unique-email schema. These identifiers are not exposed by profile/member-list responses and are not real mailboxes.

Trip statuses are ACTIVE, COMPLETED and ADMIN_CLOSED. A partial unique index prohibits multiple active trips per user. Mutations, revisions, audit entries and idempotency receipts commit atomically. Server UTC times govern departures and returns; expected return is validated input. Check-in targets a particular owned trip, so a delayed request cannot close a later departure. Revisions reject stale profile, checkout and correction requests. Corrections preserve history.

## Deployment and configuration

Use Node.js 24 and pnpm 11 from tether/:

    pnpm install --frozen-lockfile
    pnpm test
    pnpm build
    pnpm test:runtime
    pnpm deploy

**pnpm preview** runs a localhost-only synthetic harness at port 8791. Its test password is **preview-password**; /staff simulates staff only in this local harness. It is excluded from the Worker and public assets.

.env.example contains variable names only. It is documentation, not automatically loaded at runtime.

| Variable | Purpose |
| --- | --- |
| APP_ORIGIN | Exact HTTPS origin; Wrangler variable |
| ACCESS_TEAM_DOMAIN | Existing Access issuer; Wrangler variable |
| ACCESS_AUD | Tether staff Access audience; Wrangler variable |
| BOOTSTRAP_ADMIN_EMAIL | Worker secret: initial administrator, always included in the staff email list |
| STAFF_EMAILS | Worker secret: comma-separated additional approved staff emails |
| MEMBER_PASSWORD | Worker secret: shared campus password |
| TETHER_STAFF_EMAILS | Local setup script's complete staff list: bootstrap plus additional emails |
| CLOUDFLARE_ACCOUNT_ID | Account for token-based deployment |
| CLOUDFLARE_API_TOKEN | Optional deployment token instead of Wrangler OAuth |
| CLOUDFLARE_ACCESS_TOKEN_FILE | Local temporary Access setup token file |

Set secrets with **pnpm exec wrangler secret put MEMBER_PASSWORD** and **pnpm exec wrangler secret put BOOTSTRAP_ADMIN_EMAIL**; enter values interactively. Password rotation invalidates gate sessions while retaining profile connections. Never commit secrets or put the password in public assets.

Preserve the existing Tether Access app and audience. **node scripts/configure-access.mjs** reviews the planned scope; add **--apply** to set its policy to the complete TETHER_STAFF_EMAILS list at /staff. It needs a temporary account-scoped token with **Access: Apps and Policies — Edit**. It refuses unexpected configurations. When migrating from whole-site Access, deploy the password-protected Worker and set its password secret **before** applying the Access change. Delete the local token and revoke/expire it afterward.

GitHub CI runs tests/build/runtime checks without deployment credentials. Deploy with authorized Wrangler credentials. Never commit .dev.vars, .env, database exports or .wrangler state. NODE_USE_SYSTEM_CA=1 may be needed for a corporate CA; never disable TLS verification.

## DNS, migrations and recovery

Only **tether.russelllubinski.us** belongs to this Worker. Cloudflare manages DNS routing, TLS and renewal. The zone and Worker enforce HTTP-to-HTTPS. Do not add wildcard routes or modify root-site/Valor DNS.

001_initial.sql creates the original schema; 002_member_sessions.sql adds sessions and account type without replacing profiles or trips. The constructor applies numbered migrations transactionally. Add new numbered files, import them in src/worker.mjs and append their versions. Never edit an applied migration or change the object's identity. Test fresh and upgraded databases.

To add staff, preserve existing additional addresses and update the STAFF_EMAILS Worker secret with **pnpm exec wrangler secret put STAFF_EMAILS**. Deploy or activate the updated configuration; the Durable Object creates/promotes each newly configured staff account once, preserving existing records and adding an audit event. Set TETHER_STAFF_EMAILS to the complete list, including BOOTSTRAP_ADMIN_EMAIL, and apply the Access configuration script. Verify the account in **Staff → Members**. No mailbox address belongs in public source. A database promotion alone does not grant staff access, and members cannot promote themselves.

To revoke staff access, remove the email from both the Worker secret and Access policy, then disable its account if all member access should also end. Existing JWTs are denied immediately by the Worker's email check after configuration propagation. Disabled accounts remain disabled across deployments and must be deliberately enabled in **Manage access**. Preserve the original administrator unless an administration transfer is explicitly intended.

Correct individual errors through **Staff → Records → Correct record**; retain the reason and audit. Use **Connection code → Reset existing devices** for a lost phone.

Cloudflare provides a rolling [30-day SQLite Durable Object recovery window](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#pitr-point-in-time-recovery-api). Before material upgrades, capture a recovery bookmark via an account-controlled maintenance deployment. Disaster recovery requires pausing writes, choosing a bookmark/time, scheduling restoration with onNextSessionRestoreBookmark, retaining its undo bookmark and restarting the object. Verify the roster with staff before reopening writes. There is no public restore/delete endpoint.

History is not automatically deleted. No off-provider backup schedule is configured. Establish encrypted restricted backups if retention beyond Cloudflare's recovery window is required; never put personnel exports in this repository.

## Verification

Automated tests cover upgrades, passwords/sessions, connection codes, lost responses, expired/revoked sessions, staff JWTs, CSRF, unauthorized requests, ownership, validation, simultaneous checkout, idempotency, corrections, history, rate limits and Central Time/DST. Runtime tests use actual Cloudflare SQLite and verify state/session persistence across restart. Browser checks cover member/staff workflows and phone/tablet/desktop layouts. Synthetic identities stay local.
