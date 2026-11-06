# Plane Account Diagnostics

Route: `/<workspace>/settings/account/diagnostics/`, under Settings > Account.

This is a customer-facing, read-only view of the existing customer-local diagnostics service. It does not parse logs, generate reports, schedule analysis, upload reports or query company infrastructure from the browser. The existing Python service owns analysis and scheduling.

## Data and Access

The page uses the existing Plane session:

`Plane Web -> GET /api/workspaces/<slug>/diagnostics/ -> signed GET /api/product/overview -> customer-local diagnostics`

Only active administrators of the configured workspace can read installation data. The API rejects remote-source query parameters and write methods. Responses are private/no-store. The bridge sends pseudonymous actor claims, never browser cookies or user IDs. It enforces a private owned credential file, fixed upstream path, finite time/size limits, no redirects and verified HTTPS (explicit loopback/private service HTTP is permitted).

Set these **API-side** environment values when enabling an installation:

```dotenv
CUSTOMER_DIAGNOSTICS_ENABLED=true
CUSTOMER_DIAGNOSTICS_WORKSPACE=bhai-gurdas
CUSTOMER_DIAGNOSTICS_URL=http://plane-coach:3021
CUSTOMER_DIAGNOSTICS_BRIDGE_KEY_FILE=/run/secrets/customer-diagnostics.key
```

Mount a private regular file containing the **same key** as the diagnostics product bridge. The file must be owned by the API process UID, mode `0600`, not a symlink/hardlink, and mounted read-only. Provision it through the installation's secret-management process; never put the key in a `NEXT_PUBLIC_*` variable or source control. The example URL assumes the existing diagnostics companion shares Coach's namespace and both services share a private Docker network. For local development, use an endpoint actually reachable from the API process; container loopback is not the host's loopback.

Disabled installations show a configuration state instead of mock metrics. No database migration is required. Deployment needs updated **Plane Web and API** images plus the API's bridge configuration/key mount; worker/beat do not need replacement for this page. The existing diagnostics service does not need a code change. No production configuration is activated automatically by this implementation.

## Display Contract

- CPU is a measured interval ratio; memory and storage gauges show utilization from the reported totals and available bytes. Missing, invalid, future or older-than-two-minute observations are unknown, not zero.
- Network shows observed namespace/interface receive/send rates and error/drop counters. It does not claim Internet health, packet loss, jitter or total host bandwidth.
- Confirmation charts use retained analysis P50/P95 values, preserving missing-value gaps. Counts are per report window, not unique totals across potentially overlapping windows.
- Automatic analysis is shown as reported by the existing scheduler. Page reads do not start analysis. Refresh polling is every 30 seconds while visible/online and deduplicated per account/workspace. Refresh failures retain previously observed data; authorization failures hide it.
- Findings come from existing customer-safe report summaries. Resource pressure alone is not proof that memory, storage or the network caused a delay.
- Issue delivery is "Received by Kanavio" only when the backend reports `received`. Disabled sharing and local retention remain distinct from company receipt.

## Verification

```bash
node --experimental-strip-types --test core/components/profile/diagnostics/__tests__/model.test.mjs
node core/components/profile/diagnostics/__tests__/browser.mjs
node core/components/profile/diagnostics/__tests__/browser.mjs --preview
```

Run these from `apps/web` with Node 22. The browser test needs Playwright (`PLAYWRIGHT_MODULE` may point to an installed package) and Chrome (`CHROME_PATH` defaults to `/usr/bin/google-chrome`). It renders the actual account layout, sidebar, HTTP client and diagnostics components with fixture-only identity providers and synthetic loopback responses; it does not access production. It exercises charts, report expansion, issue filtering, refresh continuity, viewport overflow and unavailable/disabled/denied/stale/partial states. Screenshots are saved in the printed temporary directory.

`--preview` serves the same synthetic component preview on loopback port 3100 (`PREVIEW_PORT` overrides it); it does not enable installation diagnostics or connect to a customer server.

API contracts: `plane/tests/contract/app/test_workspace_diagnostics.py`. Run against an isolated disposable PostgreSQL/Redis test installation, not a customer database. Production browser acceptance and real installed bridge connectivity remain separate deployment checks.
