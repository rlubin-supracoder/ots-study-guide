# OPS spreadsheet summary

Russell Lubinski, 27-01

Read-only red-cell reporting at https://ops.russelllubinski.us.

## Current operating mode

**File mode works without a service connection. Live SharePoint reading is disabled until approved Microsoft access and private viewer authentication are configured.** Browser sign-in cookies are not exported or reused by the Worker.

Download the `.xlsx` workbook through your existing SharePoint access, then choose it on the page. Parsing runs in a dedicated browser worker. The file and summary stay in page memory, with no upload, localStorage, analytics or offline cache. Clear results or close the page to remove that state. File snapshots never appear as live results.

The summary groups red-font/red-fill cells by worksheet and row. It includes the cell reference, saved value, up to three nearby text labels, detected color, and formatting source. Search, worksheet filtering and copying are available. Source values are displayed as text, never HTML.

## Detection and limits

- Direct font and solid-fill colors, indexed and theme colors with tints, inherited row/column styles, red rich-text runs, and red numeric-format sections.
- Conditional cell comparisons, text matches, blank/error checks and bounded expressions with cell references, comparisons, arithmetic, AND, OR, NOT, ISBLANK, ISERROR, ISNUMBER, ISTEXT, LEN and ABS.
- Conditional priority, stopIfTrue and relative/absolute references are respected within a worksheet. Workbook code, macros and formulas are never executed.
- Unsupported expressions, cross-sheet references, color scales, data bars, icon sets, extended formats and table styles produce **partial coverage** warnings. Other rules can override a detected red style; affected results are explicitly marked for review. This is not a full Excel rendering engine.
- Values come from the last saved workbook. Formula results are not recalculated. Missing results and explicit recalculation indicators are reported. Save a recalculated workbook before relying on its snapshot.
- Red is a documented color heuristic: hue within 18° of red on the orange side or 15° on the magenta side, red channel at least 90, and channel spread at least 24. Red styling does not independently prove an error or capacity problem.
- Limits: 16 MB compressed, 64 MB XML total, 12 MB per XML part, 600,000 cells total, 100,000 cells per sheet and 10,000 flagged cells. Exceeding a limit fails visibly instead of truncating a successful report. Hidden worksheets are included and labeled.

## Live connection setup

The supplied edit-page URL is not a download API and its document GUID is not a Graph driveItem ID. The workbook owner or tenant administrator must provide the correct drive ID and item ID and authorize this hosting arrangement.

1. Register an approved confidential Microsoft application. Prefer `Files.SelectedOperations.Selected` with an explicit **read** grant on this file, or `Sites.Selected` restricted to the necessary site. Do not grant write or tenant-wide access just for this reader. [Microsoft selected permissions](https://learn.microsoft.com/en-us/graph/permissions-selected-overview).
2. Set Worker secrets with `pnpm exec wrangler secret put NAME`: `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `GRAPH_DRIVE_ID`, `GRAPH_ITEM_ID`, `SOURCE_SHAREPOINT_HOST`, and `SOURCE_ITEM_GUID` (the GUID from the edit link). This implementation supports the global Graph/Microsoft login endpoints and the configured `*.sharepoint.com` host. Other cloud environments require an explicit configuration change.
3. Configure a separate Cloudflare Access application for `ops.russelllubinski.us/live` and `ops.russelllubinski.us/api/*`, with only approved viewers. Set `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, and `ALLOWED_EMAILS` as Worker secrets. The Worker independently validates JWT signatures, issuer, audience, expiry and allowed email. Existing Tether/Valor applications and audiences must remain unchanged.
4. Set `LIVE_ENABLED` to `true`, add `"*/5 * * * *"` to `triggers.crons`, and deploy. Validate anonymous API denial and sign in at `/live`. Use **Refresh live workbook** for the initial read.

Live reads obtain a client-credentials Graph token and request file metadata/content only. File identity and host must match the configured source. Tokens are never forwarded to the download URL, returned to the browser, or logged. Changes during download are rejected and retried on the next refresh. [Microsoft file download API](https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0).

Only the latest summary is retained in an isolated SQLite Durable Object. Raw workbooks are not persisted. Same-object concurrent refreshes share one task, with a minimum 60-second refresh interval. Five-minute scheduled checks and one-minute browser polling provide periodic updates, not an instantaneous stream. Results older than ten minutes or followed by a failed refresh are labeled stale. A failure retains the last successful snapshot with an explicit error.

The public file reader contains no source credentials or document contents. Live routes fail closed while configuration is absent. API results use no-store and noindex headers; no request bodies or workbook data are logged. Keep binding `SHEETS`, class `SheetMonitor`, and object name `sheet-summary-v1` stable. Cloudflare manages custom-domain DNS and TLS; the Worker redirects HTTP to HTTPS.

## Development and deployment

Use Node 24 and pnpm 11 from this directory:

```
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm test:runtime
pnpm deploy
```

`pnpm build` bundles the browser parser and performs a Wrangler dry run. Rebuild before deploying parser changes. `pnpm dev` starts a local preview after building. `.env.example` lists variable names only. Store secrets through Wrangler; never commit tokens, workbook copies, downloaded summaries or `.dev.vars`.

There is no live connection to the original source until its owner supplies approved credentials. Tests use synthetic workbooks and mocked Graph responses; local format/performance checks do not upload source files.
