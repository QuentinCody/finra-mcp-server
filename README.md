# FINRA MCP Server

This is a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server. It lets MCP clients (Claude Desktop, Claude Code, Continue, etc.) query the upstream FINRA API in natural language. It is one of 100+ servers in the [Bio MCP](../../README.md) monorepo.

## Connect

The configured production endpoint is:

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

- `finra_search` — discover available API operations (Code Mode catalog search)
- `finra_execute` — **Code Mode**: write JavaScript in a V8 isolate (`api.get()` / `api.post()` / `searchSpec()`) instead of issuing tool calls one by one
- `finra_query_data` — run SQL over large responses auto-staged into a per-session SQLite database
- `finra_get_schema` — inspect the inferred schema of a staged dataset

Large responses (>30KB) are auto-staged into a queryable SQLite database; the tools return a `data_access_id` you can query with SQL.

Every tool returns both a human-readable `content` summary and a structured `structuredContent` payload.

## Data coverage and credentials

Existing `otcMarket` aliases remain available anonymously, with native array responses.
`FINRA_CLIENT_ID` and `FINRA_CLIENT_SECRET` are optional Worker secrets. Set both
for authenticated datasets; missing or partial pairs send no Authorization header.
A token cache belongs to one adapter and checks credential identity before reuse.

The [FINRA API documentation](https://developer.finra.org/docs) distinguishes
Public/Firm/Organization access to fixed-income aggregates from **Firm** access to
TRACE report cards. A Public credential does not authorize firm reports. The separate
TRACE transaction API is outside this platform. No automatic mock-data substitution
occurs when access fails.

New catalog paths:

- `/datasets`: discover active datasets, schema versions and supported methods.
- `/metadata/group/{group}/name/{dataset}` and `/partitions/group/{group}/name/{dataset}`:
  inspect native field descriptions and partition values.
- `/fixed-income/{dataset}`: GET samples and filtered POST reads of discovered datasets.
- `/trace-summary/<dataset>`: six documented monthly summaries, using the requesting
  firm's `firmMarketIdentifier`, first-of-month `period`, and dataset-specific `reportView`.

Market and report routes return `{data: nativePayload, _mcp: context}`. Complete nested
report sections and peer membership remain intact. The context retains request,
retrieval time, response hash and paging headers. Preserve native units and dates;
a reporting period is not a publication date. Schema version selection uses the
`dataVersion` parameter as a `Data-Version` header, not as a snapshot selector.
Missing peer fields are unknown, not zero. The [September 4 release](https://developer.finra.org/release-notes/api-platform-september-4-2026-release-notes)
added peer-group tier and firms to TRACE summary responses.

For fixed-income predicates, use POST. GET samples intentionally allow only limit,
offset and schema version. A short page can reflect the payload cap: inspect the
retained record totals/offsets and advance by records actually returned. No response
claims complete coverage or an atomic snapshot. Synchronous routes reject implicit
async submission; use the explicit export workflow below to retain its receipt.

All four tool families also register `mcp_finra_*` aliases. Upstream bodies are bounded
at 4 MiB and queries at 64 KiB; Code Mode stages responses over 30 KiB. Credential
errors do not expose provider response bodies. HTTP retry context is retained;
a rejected credentialed token is refreshed once for reads, without anonymous
fallback. Export submission is never replayed after a rejected token.

## Resumable market-data exports

The October 2 follow-up implements the [documented Query API export lifecycle](https://developer.finra.org/docs#asynchronous-requests)
for `otcMarket` and `fixedIncomeMarket` through the existing Code Mode tools:

- `POST /exports/group/{group}/name/{dataset}` creates one filtered export and
  returns a receipt with `request_id`, `status_path`, `result_path` and
  `poll_after_seconds`. It supplies `async:true` to FINRA. Query fields match
  the synchronous market helper, with a maximum limit of 100,000 and offset of
  500,000. Discover dataset capabilities and partition/filter rules first.
- `GET /exports/group/{group}/name/{dataset}/{requestId}` checks status once.
  Pending and ready states preserve the native response, expiry, request ID,
  response headers and hash. A mismatched ID or unknown state is an error.
- `GET /exports/group/{group}/name/{dataset}/{requestId}/result` checks status
  once and downloads only a ready, unexpired result. It returns the complete
  UTF-8 text plus parsed native JSON when available, with a file hash and HTTP
  metadata. CSV stays raw text, retaining repeated columns and numeric strings.

All export steps require both Worker credentials. Submission never retries,
including after HTTP 401; a lost response or server failure reports an unknown submission outcome.
An unusable HTTP 202 receipt remains explicitly accepted and is not resubmitted.
Polling is caller-controlled: wait at least the returned `poll_after_seconds`
(60 minimum, increased by Retry-After). The result operation also checks status,
so use it instead of an immediately preceding status-only call. The stateless
helper does not enforce the provider's aggregate account submission limits.

Downloads accept only the provider-advertised production
`5101-9919-3688-dapi.s3.amazonaws.com` host, send no OAuth header, and follow no
redirects. Native status retains the signed link; the file's source label omits
its query parameters. A new provider host requires separate qualification.
Each step has a 50-second limit, each body a 15-second limit, and file reads an
8 MiB cap. Larger files need a bulk client. Native success/error evidence stages
above 30 KiB; `complete:false` prevents file completion from implying complete
market coverage or historical point-in-time availability.

The resume recipe requires an existing receipt and makes one read. It starts no
job or background poll. Firm report-detail/registration exports use separate
contracts and are not routed through these market-data helpers.

101 local behavioral tests, seven authentication regressions, TypeScript and lint
pass, including complete success/error staging, bounded stalled bodies and unchanged
anonymous OTC reads. Tests use synthetic examples. Authenticated response schemas, report entitlement,
real data and live MCP/staged-SQL acceptance remain pending. The current environment
cannot resolve the provider from the shell or bind a local Worker. See the
[implementation tracker](../../docs/plans/2026-09-26-upstream-api-implementation.md)
for verification results. No live export was submitted or downloaded and these
changes have not been deployed.

## Development

```bash
./scripts/dev-servers.sh finra            # run locally (port 8851)
pnpm --filter finra-mcp-server run deploy   # deploy to Cloudflare Workers
```

See [`docs/adding-mcp-servers.md`](../../docs/adding-mcp-servers.md) and the root [README](../../README.md) for the full architecture (Code Mode, staging, portals).

---

*Auto-generated baseline README — refine with server-specific detail as needed.*

<!-- license-and-data-terms:start -->
## License and data terms

The code in this repository is licensed under the Apache License 2.0 (see `LICENSE`).
If you use it in your work, please cite it (see `CITATION.cff`). Citation is requested, not required.

The license covers the code only. Data that this server returns comes from FINRA APIs and stays under the terms of that source: Non-commercial use / no redistribution for several datasets.
You are responsible for your use of the data under those terms.
<!-- license-and-data-terms:end -->
