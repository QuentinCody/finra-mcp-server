export function fail(message: string, status = 400, data?: unknown): never {
  throw Object.assign(new Error(message), {status, data});
}
export const reportViews: Record<string, string[]> = {
  traceSovereignSummary: ["All", "P1", "S1"],
  traceAgencySummary: ["All", "P1", "S1"],
  traceTreasuriesSummary: ["All"],
  traceCorporateBondSummary: ["All", "P1", "S1"],
  traceSecuritizedProductSummary: ["All", "ABS", "ABSX", "CMO", "MBS"],
  traceExecutionTimeDifferenceTreasuriesFirmSummary: ["All"],
};
export function marketPath(path: string) {
  const fixed = /^\/fixed-income\/([A-Za-z0-9_-]+)$/.exec(path);
  if (fixed) return `/data/group/fixedIncomeMarket/name/${fixed[1]}`;
  const report = /^\/trace-summary\/([A-Za-z0-9_-]+)$/.exec(path);
  if (report) {
    if (!reportViews[report[1]]) fail("Select a documented TRACE summary dataset from the catalog");
    return `/data/group/reportcard/name/${report[1]}`;
  }
}
function requireSynchronous(params: Record<string, unknown>, body: unknown) {
  let query = body;
  if (typeof body === "string") { try { query = JSON.parse(body); } catch { /* Provider validates other legacy bodies. */ } }
  const bodyAsync = query && typeof query === "object" && "async" in query ? query.async : undefined;
  if ([params.async, bodyAsync].some(value => value !== undefined && value !== false && value !== "false")) {
    fail("Use the explicit /exports/group/{group}/name/{dataset} workflow for asynchronous requests");
  }
}
export function validateRead(path: string, method: string, params: Record<string, unknown>, body?: unknown) {
  if (!/^(?:\/datasets|\/(?:data|metadata|partitions)\/group\/[A-Za-z0-9_-]+\/name\/[A-Za-z0-9_-]+)$/.test(path)) fail("Use a FINRA Query API dataset, metadata or partition path");
  if (!["GET", "POST"].includes(method) || method === "POST" && !path.startsWith("/data/")) fail("Only GET discovery and GET/POST data reads are supported");
  if (method === "GET" && body !== undefined) fail("GET cannot carry a body");
  requireSynchronous(params, body);
  for (const [key, value] of Object.entries(params)) {
    if (/token|secret|authorization|api_?key|client_?id/i.test(key)) fail("Credentials belong in Worker secrets");
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean" || String(value).length > 4000) fail("Use bounded scalar query parameters");
  }
  const report = /\/data\/group\/reportcard\/name\/([^/]+)$/.exec(path);
  if (report && reportViews[report[1]]) {
    if (method !== "GET") fail("TRACE summaries support synchronous GET only");
    for (const key of Object.keys(params)) if (!["period", "firmMarketIdentifier", "reportView", "dataVersion"].includes(key)) fail(`Unsupported summary parameter: ${key}`);
    if (typeof params.period !== "string" || !/^\d{4}-(0[1-9]|1[0-2])-01$/.test(params.period)) fail("period must be the first day of a month: YYYY-MM-01");
    if (typeof params.firmMarketIdentifier !== "string" || !/^[A-Za-z0-9_-]{1,20}$/.test(params.firmMarketIdentifier)) fail("firmMarketIdentifier must identify the requesting firm's MPID");
    if (params.reportView !== undefined && !reportViews[report[1]].includes(String(params.reportView))) fail("Unsupported reportView for this TRACE summary");
  }
}
export function validateMarketQuery(method: string, params: Record<string, unknown>, body: unknown, maxRecords = 5000) {
  if (method === "GET") {
    for (const key of Object.keys(params)) if (!["limit", "offset", "dataVersion"].includes(key)) fail("Fixed-income filtering requires POST with documented filters; GET only samples limit/offset");
  } else {
    if (!body || typeof body !== "object" || Array.isArray(body)) fail("POST requires a JSON query object");
    if (Object.keys(params).some(key => key !== "dataVersion")) fail("Put POST filters and paging in the JSON body");
    const query = body as Record<string, unknown>;
    for (const key of Object.keys(query)) if (!["limit", "offset", "fields", "compareFilters", "domainFilters", "dateRangeFilters", "sortFields"].includes(key)) fail(`Unsupported query field: ${key}`);
    for (const key of ["fields", "compareFilters", "domainFilters", "dateRangeFilters", "sortFields"]) if (query[key] !== undefined && (!Array.isArray(query[key]) || (query[key] as unknown[]).length > 100)) fail(`${key} must be an array with at most 100 entries`);
  }
  const query = method === "POST" ? body as Record<string, unknown> : params;
  for (const [key, low, high] of [["limit", 1, maxRecords], ["offset", 0, 500000]] as const) {
    if (query[key] !== undefined && (typeof query[key] !== "number" || !Number.isInteger(query[key]) || (query[key] as number) < low || (query[key] as number) > high)) fail(`${key} must be an integer from ${low} to ${high}`);
  }
}
export async function readBody(response: Response, maxBytes = 4 * 1024 * 1024) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  let raw = ""; let bytes = 0;
  const decoder = new TextDecoder("utf-8", {fatal: true, ignoreBOM: true});
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([(async () => {
      const length = response.headers.get("content-length");
      if (length && /^\d+$/.test(length) && Number(length) > maxBytes) fail("FINRA response exceeds local size bound", 502);
      while (true) { const chunk = await reader.read(); if (chunk.done) break;
        bytes += chunk.value.byteLength; if (bytes > maxBytes) fail("FINRA response exceeds local size bound", 502);
        raw += decoder.decode(chunk.value, {stream: true});
      }
      return raw + decoder.decode();
    })(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error("FINRA response body timed out"), {status: 504})), 15000);
    })]);
  } catch (error) {
    if (error instanceof Error && "status" in error && error.status === 504) throw error;
    fail("FINRA response unreadable or exceeds local size bound", 502);
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {}); // Cleanup cannot extend the response deadline.
    reader.releaseLock();
  }
}
export async function marketEnvelope(data: unknown, raw: string, response: Response, path: string, params: Record<string, unknown>, body: unknown) {
  const headers = Object.fromEntries(["finra-api-request-id", "record-total", "record-offset", "record-limit", "total-records-on-page", "record-max-limit", "response-payload-max-size", "data-version"].flatMap(key => {
    const value = response.headers.get(key); return value === null ? [] : [[key, value]];
  }));
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return {data, _mcp: {source_url: `https://api.finra.org${path}`, request: {params, body}, retrieved_at: new Date().toISOString(),
    response_sha256: Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join(""), response_headers: headers,
    credential_requirement: path.includes("/reportcard/") ? "Firm" : "Dataset-dependent; Public/Firm/Organization for fixed-income market aggregates",
    response_schema_verified: false, complete_dataset_verified: false, point_in_time_availability_verified: false,
    note: "Preserve nested peer groups, field names, units and reporting periods. Report cards concern the authorized firm's reporting; market aggregates are different data. Missing peer fields are unknown, not zero. Pagination headers describe this request, not an atomic snapshot."}};
}
