# Operation Valor

Russell Lubinski, 27-01

- Participants: https://valor.russelllubinski.us/ or enter `Valor` in OTS Trainer.
- Shared map: https://valor.russelllubinski.us/map (join the exercise first). All participants can see everyone’s latest check-in.
- Admin: https://valor.russelllubinski.us/control (Cloudflare Access sign-in).
- The admin starts/ends exercises, removes individual participants, and clears data. Other participants can view the map and submit their own check-ins.
- Each participant keeps one number and their latest check-in. Data clears 24 hours after exercise start.
- Five meters is the phone's reported accuracy target, not a guaranteed distance. Less precise fixes require explicit participant confirmation.

Development: `pnpm install`, `pnpm dev`, and `pnpm test`. Run `node test/integration.mjs` against the local preview for the concurrent registration/check-in tests and synthetic demo data. Local controller access is limited to `127.0.0.1`; the development configuration is generated inside ignored `.wrangler/`.

Deployment: configure `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` in `wrangler.jsonc`, protect `/control` and `/api/control/*` in the same Cloudflare Access application, and run `pnpm deploy`. Controller requests fail closed while sign-in is unconfigured. Never deploy the generated local configuration.
