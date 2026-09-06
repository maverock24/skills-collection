# New Relic layer (codedeck-system)

New Relic is the **runtime** fact source. It is optional: when absent the
dashboard renders static-only with a clear notice. It lives on the **target
machine** where the `newrelic` CLI and an API key exist.

## What we consume

Normalized into `runtime.json` (shape consumed by `scripts/reconcile.mjs`):

```json
{
  "generated_at": "...", "accountId": 0, "source": "newrelic",
  "windowMinutes": 60,
  "services": [
    { "nrName": "orders-api", "guid": "...", "type": "APM-APPLICATION",
      "language": "python",
      "vitals": { "apdex": 0.52, "errorRatePct": 11.7, "throughputRpm": 96, "latencyP95Ms": 610 } }
  ],
  "connections": [ { "source": "checkout-api", "target": "orders-api", "type": "http", "samples": 4820 } ]
}
```

`scripts/newrelic.mjs --live` fills this; `--mock` loads one for tests/dry runs
(the mock lives at `tests/fixtures/mock-nr/runtime.json`).

## Where the numbers come from (NerdGraph)

Service list + identity (APM applications):

```graphql
{ actor { entitySearch(query: "domainType = 'APM-APPLICATION'")
  { results { entities { name guid accountId } } } } }
```

Dependency / service-map edges (entity relationships, "similar to service maps"):

```graphql
query { actor { entity(guid: "ENTITY_GUID") {
  name relatedEntities { results {
    source { entity { name } } target { entity { name } } type } } } } }
```

Vitals (per service, over `windowMinutes`). NRQL through NerdGraph:

```graphql
{ actor { account(id: ACCOUNT_ID) {
  nrql(query: "SELECT apdex(duration), percentile(duration, 95) AS p95,
                      filter(count(*), where error IS TRUE) AS errs,
                      rate(count(*), 1 minute) AS rpm
               FROM Transaction WHERE appName = 'orders-api' SINCE 60 minutes ago")
  { results } } } }
```

Real prod edges may point at APM apps whose name matches no repo in the folder
(e.g. `payment-gateway`). Reconcile reports these as **runtime-only** so you can
see dependencies the static scan cannot.

## Identity mapping (repo <-> NR name)

Repo-derived names rarely equal NR entity names. Resolution order in
`reconcile.mjs`:

1. manifest override (`codedeck-system.json`): `{ services:[{ name, nrName }] }` or `{ nrAliases }`
2. exact match
3. normalized fallback (case-insensitive, strips `-api`/`-service`/`-svc`/`-app`)

Unmatched NR entities go under `runtimeOnly`; our services with no NR entity get
`matched: false` and are shown with static health only.

## Setup (target machine, once)

1. Install the CLI: `brew install newrelic-cli` (macOS) or use the official
   installer; on Linux download the release binary.
2. Set an API key: `NEW_RELIC_API_KEY` (or user key) and `NEW_RELIC_ACCOUNT_ID`.
3. Verify: `newrelic nerdgraph query '{ actor { account(id: <acct>) { name } } }'`
4. Produce the runtime file:
   `node scripts/newrelic.mjs --live --accountId <acct> --window 60 --out runtime.json`

If you prefer, export the same JSON yourself and pass it to reconcile via
`--runtime`; the schema above is the only contract.
