# Cloudflare deployment

MyCP is a single Cloudflare Worker deployment: the Worker serves the Vite SPA, handles the same-origin API, adds the WebMCP security headers, and persists the seeded demo state in D1.

`assets.run_worker_first` is intentionally enabled in `wrangler.jsonc`: static assets must pass through the Worker so the document receives the origin-isolation and WebMCP permissions headers. Cloudflare documents this asset-routing behavior in its [static assets configuration guide](https://developers.cloudflare.com/workers/static-assets/binding/).

## One-time setup

1. Authenticate the Wrangler CLI with the Cloudflare account that will own the demo:

   ```sh
   npx wrangler login
   ```

2. Create the D1 database. Use a distinct name if `mycp` already exists in the account:

   ```sh
   npx wrangler d1 create mycp
   ```

3. Copy the returned `database_id` into the `d1_databases[0].database_id` field in `wrangler.jsonc`. The committed all-zero value is intentionally a non-deployable placeholder.

4. Apply the schema to the remote database:

   ```sh
   npm run db:migrate:remote
   ```

5. Build and publish:

   ```sh
   npm run deploy
   ```

Wrangler prints the stable `workers.dev` URL. A custom domain is optional; use it only after the workers.dev deployment passes the checks below.

## Release verification

Run these commands against the deployed URL, replacing `https://YOUR-WORKER.workers.dev`:

```sh
curl -i https://YOUR-WORKER.workers.dev/api/health
curl -i https://YOUR-WORKER.workers.dev/
```

Confirm that both responses include `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`, `Origin-Agent-Cluster: ?1`, and `Permissions-Policy: tools=(self)`. The API response must also have `Cache-Control: no-store`.

Open the root URL in Chrome, then run `crossOriginIsolated` in its developer tools. It must return `true`. For local WebMCP testing, enable `chrome://flags/#enable-webmcp-testing` as described in the [Chrome testing documentation](https://developer.chrome.com/docs/ai/webmcp#local-webmcp).

## Operational notes

- The demo stores no credentials and needs no Cloudflare Worker secrets.
- D1 contains fictional seeded data only. Do not load production calendars or contact data for this submission.
- Re-running the remote migration is safe: the migration uses `CREATE TABLE IF NOT EXISTS`.
- The D1 binding is an intentional deployment prerequisite; do not remove it or fall back to in-memory Worker state.
