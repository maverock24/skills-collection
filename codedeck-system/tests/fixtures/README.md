# codedeck-system test fixtures

- `mini-fleet/` - a synthetic 3-service fleet (checkout-api, orders-api,
  catalog-api) plus a `not-a-repo` decoy. It is committed WITHOUT its nested
  `.git` dirs so it stays clean in this collection. `discover` only recognizes
  directories that contain `.git`, so to run the pipeline against it, git-init
  each service first:

  ```bash
  for d in checkout-api orders-api catalog-api; do
    git -C mini-fleet/$d init -q
  done
  node ../../scripts/run.mjs mini-fleet \
    --mock mock-nr/runtime.json --out /tmp/sample-out
  ```

- `mock-nr/runtime.json` - a normalized New Relic runtime response so the
  runtime layer is testable offline (see `references/newrelic.md`).

- `sample-output/system-map.html` - a rendered example (generated with the mock).
