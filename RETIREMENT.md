# OTS site retirement

Retired November 8, 2026 at the owner's request.

| Site | Hosting change |
| --- | --- |
| Tether (both classes) | Detached `tether.russelllubinski.us`; removed nightly report schedule. |
| Operation Valor | Detached `valor.russelllubinski.us`. |
| OPS spreadsheet summary | Detached `ops.russelllubinski.us`. |
| OPS exercise staging | Disabled its `workers.dev` address. |
| OTS Trainer / study guide and games | Disabled GitHub Pages for `rlubin-supracoder/ots-study-guide`. |

All four deployed OTS Workers have `workers.dev` and preview URLs disabled, with no Cron Triggers. Their source, secrets, Durable Object bindings and stored data were not deleted. The main `russelllubinski.us` and `www` website were left unchanged. Retained database storage may still incur charges.

Deployment configurations have empty public routes; Tether also has an empty cron list. The local OPS exercise configuration, including staging, is disabled as well. GitHub Pages stays disabled even when source changes are pushed. Existing checks only test/build; they do not publish.

Hosting configuration and Worker source backups are in the ignored local directory `.local/ots-retirement/`. This is not a database export; application records remain in their existing Cloudflare storage. Keep that directory private.

Reactivation requires an explicit decision: restore the intended custom-domain routes, review authentication and retained data, then deploy. Restore Tether's `*/5 2,3 * * *` Cron Trigger only if nightly captures should resume. Preserve existing Worker names, Durable Object bindings and names, and secrets to retain profile continuity. The study guide can be republished by re-enabling GitHub Pages from `main` at `/`. Do not re-enable any of these as part of routine maintenance.
