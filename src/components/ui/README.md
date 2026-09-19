# coss UI

Copied from the official registry at https://coss.com/ui/r/{name}.json on 2026-09-18/19 using the documented manual installation. Component styling and behavior are upstream defaults; only `@/registry/default/` imports were mapped to this app's `@/components`, `@/lib`, and `@/hooks` aliases.

See `components.json` for the registry configuration and `scripts/sync-coss.mjs` for the import script. Shared tokens in `src/style.css` supply snip's neutral light/dark palette and yellow primary color. Avoid styling overrides in this directory.

Upstream source: https://github.com/cosscom/coss/tree/main/apps/ui/registry
License: MIT for `apps/ui/`, per https://github.com/cosscom/coss/blob/main/LICENSING.md. The notice is included in `public/licenses/coss-MIT.txt`.
