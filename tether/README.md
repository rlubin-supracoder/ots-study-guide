# Tether

OTS accountability at https://tether.russelllubinski.us. Staff: https://tether.russelllubinski.us/staff.

## Classes

| Class | Member link | Staff link |
| --- | --- | --- |
| 27-01 | https://tether.russelllubinski.us/ | https://tether.russelllubinski.us/staff |
| 27-02 | https://tether.russelllubinski.us/class/27-02/ | https://tether.russelllubinski.us/staff/class/27-02 |

The common sign-in page recognizes either class password. Class links at the top switch spaces. Each class has separate profiles, sessions, PIN recovery, connection codes, rosters, history and audit records. Global staff can administer both classes. Class-specific staff can administer only their assigned class, with each screen explicitly labeled. Both the Worker and database service enforce the class allowlist; the navigation shows only authorized staff classes. Corrections affect only the selected class. A flight number is a profile field, not a class selection or authorization mechanism.

27-01 retains its original database, cookies, password secret and polling behavior. No records are moved, reset or rewritten to add 27-02. Both class connections can coexist on one device; logging out or forgetting one class does not remove the other connection. Install 27-02 from its own member link to retain that class in its home-screen shortcut.

## Member workflow

1. Enter the campus password supplied by staff. Members do not use email verification.
2. On the first device, create a profile with name, flight, room, U.S. phone number and a confirmed four-digit profile PIN. Existing members keep their profiles, status, history and device connections; they create a PIN before their next checkout. Check-in remains available without a PIN.
3. **CHECK OUT** requires a destination and future return time, followed by confirmation.
4. **CHECK IN** confirms return to campus. **My history** retains previous trips.
5. On a new device, enter the campus password and open **Already have a Tether profile?**. Reconnect using your saved full name, phone number and PIN, or use a connection code. **Profile → Connect another device** generates a private, one-use code valid for 24 hours. Staff can also supply a code. Reconnection preserves the same profile and current accountability status.

**Profile → Create/Change profile PIN** sets or changes your PIN from an authenticated device. PINs retain leading zeroes and never appear in staff lists or logs. Five unsuccessful attempts lock PIN recovery across devices until you set a new PIN from a connected device. This does not block check-in/out or connection codes. Forgotten PINs can be replaced after reconnecting with a code. Recovery requires a unique match for full name and contact number; ambiguous matches use the connection-code fallback.

The roster is visible only within the authenticated class after profile setup. 27-01 and staff views refresh every 15 seconds while visible. 27-02 members use authenticated live notifications, with five-minute reconciliation and 15-second polling if the live connection is unavailable. Personal changes always reconcile immediately. Other members' phone numbers are excluded from member API responses. Times are always **America/Chicago**; daylight-saving gaps and ambiguous times are rejected. Expected return must be within seven days. Overdue trips remain active until checked in.

The password unlock lasts 24 hours. A separate secure cookie remembers the profile for up to one year. **Log out** locks the application but remembers the profile. **Profile → Forget this device** removes the device connection without deleting history. Browser-data clearing requires reconnecting with a PIN or connection code. On a shared phone, forget the device before handing it over.

Network failures never imply success: the app marks status unverified, disables the main action, and reconciles with the server. Retried actions reuse their request identifier; refreshing reads authoritative state. There is no GPS collection.

Use the phone browser's **Add to Home Screen** option. The manifest supports standalone display; there is no service worker or offline personnel-data cache.

## Staff workflow

Open **/staff** and use an approved staff email for email-code sign-in. Staff do not need the campus password. Class-27-02-only staff should use **/staff/class/27-02**; the generic /staff page redirects them there after sign-in. Their administrator profile is provisioned on first authorized access in 27-02 only. New staff complete their own profile before checking out; staff tools are available immediately.

- **Members → Connection code** reconnects an existing profile. **Reset devices and PIN** revokes that member's device sessions, outstanding codes and PIN before creating a replacement code. A reason is required. The member creates a new PIN after reconnecting, before their next checkout.
- **Manage access** enables/disables a member. Close active trips before disabling access. Historical records remain intact.
- **Records** provides search, flight/date/status filters, and member history in pages of 50. Date filters use Central departure dates.
- **Check member in** records the staff-confirmed return and reason as ADMIN_CLOSED.
- **Correct record** edits destination or timestamps with a reason. Clearing actual return reopens a trip only when no other active trip exists. Before/after values, actor, reason and time remain in **Audit trail**.
- **Contact member** reveals a phone number to staff.

Campus counts include enabled members with completed profiles. Names, flights, rooms and phone numbers are snapshotted at checkout; profile edits do not rewrite historical identities.

## Daily Class 27-01 spreadsheet

Open **Staff → Audit Trail**. The top panel downloads the latest `.xlsx`; **Previous daily reports** opens the archive. Reports are saved at **21:00 America/Chicago**, following daylight saving. The first file appears at the next scheduled capture after deployment; earlier days are not reconstructed.

Each workbook includes all 27-01 accounts, including disabled accounts and incomplete staff/member profiles. Columns contain last name, full name, flight, room, phone, campus status, overdue flag, latest trip's departure/expected return/arrival/destination, account state, profile completeness, role and account ID. Profile fields reflect capture time; trip fields describe the latest trip. An active trip takes priority. Incomplete profiles without an active trip are marked **PROFILE INCOMPLETE**. Names are sorted by the surname inferred from the stored full name (comma notation and common suffixes/particles supported), then full name. The source full name remains unchanged; accounts without names sort last. Compound names may require staff review because profiles have a single full-name field.

The private `daily_reports` table stores immutable Excel bytes, local report date, scheduled UTC time, actual UTC capture time and account count. Migration `004_daily_reports.sql` only adds this table. Capturing a report does not alter users, trips, PINs or sessions. A transaction commits the snapshot and audit entry together; the date primary key prevents duplicate files. Later corrections do not rewrite saved reports. Keep downloaded files restricted as they include contact and accountability information. Reports are retained with the existing database and its backup/recovery policy; do not commit exports to Git.

Cloudflare's `*/5 2,3 * * *` UTC trigger checks both possible Central evening hours. The scheduled handler calls only the original 27-01 Durable Object and captures once during local hour 21. Subsequent five-minute ticks retry a failed capture until 21:55 and otherwise do nothing. A delayed file shows its actual capture time rather than claiming an exact 21:00 snapshot. A whole missed window is not backfilled from today's state. Check **Workers → tether → Triggers / Cron events** for failures or missed files. New triggers can take several minutes to propagate.

Listing (`/staff/api/admin/reports`) and downloading (`/staff/api/admin/reports/YYYY-MM-DD.xlsx`) require verified, enabled 27-01 staff authorization in both server layers. Member sessions and 27-02-only staff cannot access these files. Responses are `no-store` and `noindex`; no reports are public assets. Creation and successful authorized download requests are audited without workbook contents. The panel checks for newly saved reports every minute while open.

Deployment uses the existing `pnpm deploy`; no new secrets, DNS or Access policies are required. Keep the Durable Object identity unchanged. `pnpm test` covers scheduling/DST, privacy, migration preservation, sorting, literal-string safety and idempotency. After `pnpm build`, `pnpm test:reports` exercises scheduled events, RPC, SQLite workbook storage, class isolation and persistence in the actual local Cloudflare runtime. The production writer fills the generic artifact-authored Excel layout in `src/report-template.mjs` using `fflate`; the desktop artifact tool is not a production dependency.

## Architecture and security

A separate Cloudflare Worker and SQLite Durable Object follow the root website and Operation Valor deployment model. Native JavaScript/CSS use the existing navy/blue visual identity. Their routes and databases remain independent.

**Member authentication:** the Worker verifies the selected class password server-side, issues a random 256-bit gate token and a separate random 256-bit device token, and stores only token hashes. Cookies use the __Host- prefix, Secure, HttpOnly, SameSite=Strict and Path=/. The database checks password version, session expiry and enabled user on every private request. Device authorization is always capped to Member, even for an underlying administrator profile. Setup cannot select or claim another member by name. Connection codes use 128 random bits, are stored hashed, are one-use, and expire after 24 hours. Lost-response retries are supported on the same gate.

Profile PINs are hashed with PBKDF2-SHA256 (100,000 iterations), a random 128-bit salt, and a separate 256-bit Worker secret used for HMAC preprocessing. The secret is not stored in the database. PIN credentials live in a separate table and never leave the server. PIN attempts require the campus password, share the login IP/global limits, and reserve one of five account attempts transactionally before verification, so parallel requests cannot evade lockout. Identity, enabled status and PIN revision are rechecked before issuing a member-only device session. Staff still require their approved email and Cloudflare Access verification.

**Staff authentication:** Cloudflare Access protects /staff and its subpaths, including /staff/api/*. Its allow policy names only approved staff emails. The Worker independently validates the Access JWT signature, issuer, audience, expiry, subject and email, then checks its own approved email list and an enabled database administrator role. The original bootstrap administrator remains included alongside STAFF_EMAILS. Newly configured staff accounts are created or promoted once with a STAFF_APPROVED audit event; subsequent deployments do not re-enable disabled accounts or overwrite profiles and history. Email verification alone is not two-factor authentication. Member routes cannot grant staff authority. Access sessions last 24 hours with Secure/HttpOnly cookies.

Sensitive operations enforce server authorization. Writes require the exact Origin, a custom request header and JSON; bodies are limited to 8 KiB. Persisted limits allow 60 incorrect login attempts per source IP per 15 minutes (1,500 globally), 30 user mutations/minute and 180 reads/minute. 27-01 retains its existing combined sign-in/setup limit. For 27-02, verified-password sign-ins and authenticated setups use a separate 600-per-IP/1,500-global allowance per 15 minutes so 200 members can join on shared Wi-Fi. Failed PIN attempts remain capped at five per profile. New-class read throttles are in memory and may reset on hibernation; authentication, PIN and mutation limits remain persistent. All limits are per class. IP addresses are hashed before storage. Public files contain generic interface code and graphics, not the password or personnel data.

Responses use no-store, HSTS, noindex/nofollow/noarchive, CSP, no-referrer, clickjacking protection and disabled geolocation/camera/microphone. Inputs are validated, SQL values are bound and output is rendered as text. There are no third-party analytics, localStorage profile copies, sensitive request logs or Worker observability. workers.dev and preview URLs are disabled.

## Data and integrity

Keep binding **ACCOUNTABILITY** and class **Accountability** stable. Permanent object names: **tether-accountability-v1** for 27-01, **tether-accountability-class-27-02-v1** for 27-02. Legacy cookies retain their names; 27-02 gate/device cookies use the **-27-02** suffix. Class routing is server-controlled and allowlisted. The 27-02 addition requires no new migration and reuses the existing schema in a separate SQLite object.

| Table | Purpose |
| --- | --- |
| users | Profile, account type, role, enabled flag, version and UTC timestamps |
| checkouts | Profile snapshot, destination, departure/expected/actual return, status and revision |
| sessions | Hashed gate/device/connection tokens, expiry and password version |
| profile_pins | Salted, peppered PIN credentials, revision and persistent failed-attempt count |
| daily_reports | Private, immutable 27-01 daily Excel snapshots and capture metadata |
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
    pnpm test:capacity
    pnpm deploy

**pnpm preview** runs a localhost-only synthetic harness at port 8791. Its test passwords are **preview-password** for 27-01 and **preview-new-password** for 27-02; /staff simulates staff only in this local harness. It is excluded from the Worker and public assets.

.env.example contains variable names only. It is documentation, not automatically loaded at runtime.

| Variable | Purpose |
| --- | --- |
| APP_ORIGIN | Exact HTTPS origin; Wrangler variable |
| ACCESS_TEAM_DOMAIN | Existing Access issuer; Wrangler variable |
| ACCESS_AUD | Tether staff Access audience; Wrangler variable |
| BOOTSTRAP_ADMIN_EMAIL | Worker secret: initial administrator, always included in the staff email list |
| STAFF_EMAILS | Worker secret: additional global staff emails with access to both classes |
| STAFF_EMAILS_27_02 | Worker secret: staff emails authorized only for class 27-02 |
| MEMBER_PASSWORD | Worker secret: original 27-01 campus password; retain unchanged |
| MEMBER_PASSWORD_27_02 | Worker secret: 27-02 campus password |
| PIN_PEPPER | Worker secret: 64 hexadecimal characters generated from 32 random bytes; protect and retain this key |
| TETHER_STAFF_EMAILS | Local setup script's complete staff list: bootstrap plus additional emails |
| CLOUDFLARE_ACCOUNT_ID | Account for token-based deployment |
| CLOUDFLARE_API_TOKEN | Optional deployment token instead of Wrangler OAuth |
| CLOUDFLARE_ACCESS_TOKEN_FILE | Local temporary Access setup token file |

Set secrets with **pnpm exec wrangler secret put MEMBER_PASSWORD** and **pnpm exec wrangler secret put BOOTSTRAP_ADMIN_EMAIL**; enter values interactively. Password rotation invalidates gate sessions while retaining profile connections. Never commit secrets or put the password in public assets.

Before enabling 27-02, set **pnpm exec wrangler secret put MEMBER_PASSWORD_27_02** using the staff-supplied password. Leave MEMBER_PASSWORD, PIN_PEPPER, Access audience, staff secrets, routes and Durable Object bindings unchanged. No Access policy or DNS update is needed for the new class. Roll back the Worker deployment if needed; keep both object names stable so rollback does not delete either class’s records.

Before deploying PIN support, generate a cryptographically random 32-byte secret and store its hexadecimal encoding with **pnpm exec wrangler secret put PIN_PEPPER**. Keep it stable across deployments. Losing or changing this secret makes existing PINs unusable; use existing device sessions or connection codes to set replacements. Never store this secret with a database export or in source control.

Preserve the existing Tether Access app and audience. **node scripts/configure-access.mjs** reviews the planned scope; add **--apply** to set its policy to the complete TETHER_STAFF_EMAILS list at /staff. It needs a temporary account-scoped token with **Access: Apps and Policies — Edit**. It refuses unexpected configurations. When migrating from whole-site Access, deploy the password-protected Worker and set its password secret **before** applying the Access change. Delete the local token and revoke/expire it afterward.

GitHub CI runs tests/build/runtime checks without deployment credentials. Deploy with authorized Wrangler credentials. Never commit .dev.vars, .env, database exports or .wrangler state. NODE_USE_SYSTEM_CA=1 may be needed for a corporate CA; never disable TLS verification.

## DNS, migrations and recovery

Only **tether.russelllubinski.us** belongs to this Worker. Cloudflare manages DNS routing, TLS and renewal. The zone and Worker enforce HTTP-to-HTTPS. Do not add wildcard routes or modify root-site/Valor DNS.

001_initial.sql creates the original schema; 002_member_sessions.sql adds sessions and account type. 003_profile_pins.sql creates the PIN table; 004_daily_reports.sql adds saved Excel reports. These additions do not update or delete users, trips, audit history or sessions. The constructor applies numbered migrations transactionally. Add new numbered files, import them in src/worker.mjs and append their versions. Never edit an applied migration or change the object's identity. Test fresh and upgraded databases.

To add staff, preserve existing additional addresses and update the STAFF_EMAILS Worker secret with **pnpm exec wrangler secret put STAFF_EMAILS**. Deploy or activate the updated configuration; the Durable Object creates/promotes each newly configured staff account once, preserving existing records and adding an audit event. Set TETHER_STAFF_EMAILS to the complete list, including BOOTSTRAP_ADMIN_EMAIL, and apply the Access configuration script. Verify the account in **Staff → Members**. No mailbox address belongs in public source. A database promotion alone does not grant staff access, and members cannot promote themselves.

For staff restricted to 27-02, add the address to **STAFF_EMAILS_27_02**, preserving its existing entries. Do not add it to global STAFF_EMAILS. The Cloudflare Access allow policy must include the union of global and class-specific staff; it authenticates identity while the Worker independently restricts class access. Preserve the Access app audience, routes and existing policy conditions. Never broaden access using an email-domain or Everyone rule. The constructor provisions only global staff; class-specific accounts are provisioned once after an authorized request to their class. Disabled accounts remain disabled.

To revoke staff access, remove the email from the applicable Worker secret and Access policy, then disable its account if all member access should also end. Existing JWTs are denied immediately by the Worker's email check after configuration propagation. Disabled accounts remain disabled across deployments and must be deliberately enabled in **Manage access**. Preserve the original administrator unless an administration transfer is explicitly intended.

Correct individual errors through **Staff → Records → Correct record**; retain the reason and audit. Use **Connection code → Reset devices and PIN** for a lost phone.

Cloudflare provides a rolling [30-day SQLite Durable Object recovery window](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#pitr-point-in-time-recovery-api). Before material upgrades, capture a recovery bookmark via an account-controlled maintenance deployment. Disaster recovery requires pausing writes, choosing a bookmark/time, scheduling restoration with onNextSessionRestoreBookmark, retaining its undo bookmark and restarting the object. Verify the roster with staff before reopening writes. There is no public restore/delete endpoint.

History is not automatically deleted. No off-provider backup schedule is configured. Establish encrypted restricted backups if retention beyond Cloudflare's recovery window is required; never put personnel exports in this repository.

## Verification

The daily-report release passes 61 unit/security tests, the original runtime suite, scheduled-report runtime tests and the 200-user capacity test. Browser checks verified the empty report panel, downloaded XLSX, archive and class separation at phone/tablet sizes, including 320px without horizontal overflow. A downloaded synthetic workbook was independently opened to verify its contents. Excel layout previews and independent workbook reads checked dates, literal text identifiers, filtering and frozen panes. Run `pnpm preview -- --reports` (or `node scripts/preview.mjs --reports`) for local synthetic report examples; this harness never deploys and is not a production route.

Automated tests cover non-destructive upgrades, PIN setup/recovery/lockout, passwords/sessions, connection codes, lost responses, expired/revoked sessions, staff JWTs, CSRF, unauthorized requests, ownership, validation, simultaneous checkout, idempotency, corrections, history, rate limits and Central Time/DST. Runtime tests use actual Cloudflare SQLite and verify PIN hashing, recovery and state/session persistence across restart. Synthetic identities stay local. The class extension passes 53 unit/security tests, including signed-JWT class-specific staff authorization, denied cross-class requests, preserved global access and disabled-account handling and the original runtime suite. Its local Cloudflare capacity test registers 200 members behind one IP, holds 200 authenticated live connections, performs 200 simultaneous roster reads and complete checkout/check-in cycles, checks isolation, and confirms both classes survive restart plus PIN reconnection. The initial run completed 1,415 requests with p95 1.96 seconds on the local Windows runtime; this is a local test, not a production performance guarantee. New browser visual checks could not run because the browser-control tool failed to initialize; class navigation uses the existing responsive styles and 44-pixel targets.


## Capacity and live updates

27-02 is tested for 200 members. Its storage guard allows 1,000 account rows per class, including staff. The live channel sends only a `refresh` signal after a committed change, then each client fetches an authorized roster. Notifications are coalesced, connections use Cloudflare hibernation, and at most five live connections per member are retained (1,000 per object). Gate/device validity and enabled status are rechecked before notifications. Logout and device resets close invalid connections. Hidden pages disconnect; reopening reconciles with the server. A role-specific roster cache lasts at most five seconds and is invalidated immediately on mutations.

Cloudflare account quotas remain shared with the existing apps; no paid plan is enabled by this change. 200 continuously visible new-class clients reconciling every five minutes generate roughly 57,600 scheduled state reads per day, plus sign-ins, actions and refreshes after changes. Fallback polling uses more. Size the account plan for actual aggregate usage before sustained all-day use; connection capacity does not remove request/storage limits. See [Cloudflare pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) and [limits](https://developers.cloudflare.com/durable-objects/platform/limits/).
