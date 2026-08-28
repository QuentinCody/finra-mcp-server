# FINRA MCP Server

This is a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server. It lets MCP clients (Claude Desktop, Claude Code, Continue, etc.) query the upstream FINRA API in natural language. It is one of 100+ servers in the [Bio MCP](../../README.md) monorepo.

## Connect

The server is deployed and ready at:

```
https://finra-mcp-server.quentincody.workers.dev/mcp
```

Add it to your MCP client (Claude Desktop → Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "finra": {
      "command": "npx",
      "args": ["mcp-remote", "https://finra-mcp-server.quentincody.workers.dev/mcp"]
    }
  }
}
```

For local development the server runs at `http://localhost:8851/mcp` (start it with `./scripts/dev-servers.sh finra`):

```json
{
  "mcpServers": {
    "finra-local": {
      "command": "npx",
      "args": ["mcp-remote", "http://localhost:8851/mcp"]
    }
  }
}
```

## Tools

- `finra_search` — discover available API operations (Code Mode catalog search, 17 endpoints)
- `finra_execute` — **Code Mode**: write JavaScript in a V8 isolate (`api.get()` / `api.post()` / `searchSpec()`) instead of issuing tool calls one by one
- `finra_query_data` — run SQL over large responses auto-staged into a per-session SQLite database
- `finra_get_schema` — inspect the inferred schema of a staged dataset

Large responses (>30KB) are auto-staged into a queryable SQLite database; the tools return a `data_access_id` you can query with SQL.

Every tool returns both a human-readable `content` summary and a structured `structuredContent` payload.

## Data coverage and credentials

The server exposes FINRA's `otcMarket` dataset group, which FINRA serves **anonymously** — no credential
is needed for anything listed by `finra_search` (verified 2026-08-27 against `api.finra.org` with no
`Authorization` header). Datasets: Consolidated Short Interest, Reg SHO Daily Short Sale Volume,
Threshold Securities List, ATS Weekly/Monthly Summary, ATS and OTC Blocks Summary, and the OTC Daily List,
plus the anonymous `/metadata/{datasetName}` endpoint.

`FINRA_CLIENT_ID` and `FINRA_CLIENT_SECRET` are **optional** Worker secrets. When both are set the server
mints an OAuth 2.0 client-credentials token and attaches it; when either is missing it sends no
`Authorization` header at all. Credentials only unlock the gated groups (`fixedIncomeMarket`,
`equityMarket`, `firmMargin`, `regulatoryFilings`), which none of the catalog endpoints reference. A free
"Public" credential is provisioned from the [FINRA API Console](https://gateway.finra.org/app/api-console/v1/home).

**Filtering quirk.** FINRA silently ignores unrecognized GET query params: `api.get('/short-interest',
{ symbolCode: 'AAPL' })` returns HTTP 200 with the *unfiltered* first page. Filter with `api.post` and a
`compareFilters` body instead — see the catalog notes surfaced by `finra_execute`.

## Development

```bash
./scripts/dev-servers.sh finra            # run locally (port 8851)
pnpm --filter finra-mcp-server run deploy   # deploy to Cloudflare Workers
```

See [`docs/adding-mcp-servers.md`](../../docs/adding-mcp-servers.md) and the root [README](../../README.md) for the full architecture (Code Mode, staging, portals).

---

*Auto-generated baseline README — refine with server-specific detail as needed.*
