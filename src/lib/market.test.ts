import {afterEach, expect, it, vi} from "vitest";
import {createFinraApiFetch} from "./api-adapter";
import {reportViews} from "./market";
import {marketWorkflows} from "../spec/market";
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(data), {status, headers: {"Content-Type": "application/json", ...headers}});
const env = {FINRA_CLIENT_ID: "fixture-id", FINRA_CLIENT_SECRET: "fixture-secret"};
afterEach(() => vi.unstubAllGlobals());
function stub(data: unknown, headers: Record<string, string> = {}) {
  const fetcher = vi.fn().mockImplementation((url: string | URL) => String(url).includes("oauth2/access_token") ? json({access_token: "fixture-token", expires_in: "300"}) : json(data, 200, headers));
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
it.each(Object.keys(reportViews))("retains nested peer evidence for %s", async dataset => {
  const native = [{tradeReportingPeerGroup: [{peerGroupTier: 4, peerGroupFirms: [{firmId: "TEST", firmName: "Synthetic Firm"}], TotalRankInNumber: "03"}], lateTrade: [{Count: 0, PeerAveragePercent: null}], futureField: ["kept"]}];
  const fetcher = stub(native, {"Data-Version": "1", "FINRA-api-request-id": "fixture-request"});
  const result = await createFinraApiFetch(env)({method: "GET", path: `/trace-summary/${dataset}`, params: {period: "2026-08-01", firmMarketIdentifier: "TEST", dataVersion: 1}});
  expect(result.data).toMatchObject({data: native, _mcp: {credential_requirement: "Firm", request: {params: {period: "2026-08-01", dataVersion: 1}}, response_headers: {"data-version": "1"}, complete_dataset_verified: false}});
  const [url, init] = fetcher.mock.calls[1];
  expect(String(url)).toContain(`/data/group/reportcard/name/${dataset}?period=2026-08-01&firmMarketIdentifier=TEST`);
  expect(String(url)).not.toContain("dataVersion"); expect(new Headers(init.headers).get("Data-Version")).toBe("1");
  expect(JSON.stringify(result)).not.toContain("fixture-secret"); expect(JSON.stringify(result)).not.toContain("fixture-token");
});
it("keeps native execution-time tables and absent peer fields without synthesizing zeros", async () => {
  const data = [{values: [{partition: "2026-07-01", data: {averageATSExceptionPercent: "0.0000000001"}}], tableName: "Synthetic"}];
  stub(data); const result = await createFinraApiFetch({})({method: "GET", path: "/trace-summary/traceExecutionTimeDifferenceTreasuriesFirmSummary", params: {period: "2026-08-01", firmMarketIdentifier: "TEST"}});
  expect(result.data).toMatchObject({data}); expect(JSON.stringify(result)).not.toContain("peerGroupTier");
});
it("keeps fixed-income precision, units and short-page headers", async () => {
  const data = [{tradeDate: "2026-09-01", valueAmount: "9007199254740993.000001", categoryCode: "$ TRADES (000'S)", recordLoadTimestamp: "2026-09-02 01:02:03", benchmark: null}];
  const fetcher = stub(data, {"Record-Total": "8000", "Record-Offset": "100", "Record-Limit": "5000", "Total-Records-On-Page": "1", "Response-Payload-Max-Size": "3"});
  const body = {limit: 5000, offset: 100, compareFilters: [{fieldName: "tradeDate", fieldValue: "2026-09-01", compareType: "EQUAL"}]};
  const result = await createFinraApiFetch({})({method: "POST", path: "/fixed-income/treasuryDailyAggregates", body});
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual(body);
  expect(result.data).toMatchObject({data, _mcp: {response_headers: {"record-total": "8000", "total-records-on-page": "1"}, complete_dataset_verified: false}});
});
it.each(["/datasets", "/metadata/group/fixedIncomeMarket/name/treasuryDailyAggregates", "/partitions/group/fixedIncomeMarket/name/treasuryDailyAggregates"])("preserves discovery envelope %s", async path => {
  const data = {fields: [{name: "tradeDate", type: "Date", description: "Synthetic field"}], datasets: [{name: "treasuryDailyAggregates", dataVersion: 2, supportsQuery: true, status: "Active"}], partitionFields: ["tradeDate"], availablePartitions: [{partitions: ["2026-09-01"]}]};
  stub(data); expect((await createFinraApiFetch({})({method: "GET", path})).data).toMatchObject({data});
});
it("preserves anonymous OTC array shape and POST filtering", async () => {
  const fetcher = stub([{symbolCode: "AAPL"}]);
  const body = {limit: 1, compareFilters: [{fieldName: "symbolCode", fieldValue: "AAPL", compareType: "EQUAL"}]};
  expect(await createFinraApiFetch({})({method: "POST", path: "/short-interest", body})).toEqual({status: 200, data: [{symbolCode: "AAPL"}]});
  expect(new Headers(fetcher.mock.calls[0][1].headers).has("Authorization")).toBe(false);
  expect(fetcher.mock.calls[0][1].method).toBe("POST"); expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual(body);
});
it("isolates OAuth tokens across adapters and reuses only within the same credential context", async () => {
  let counter = 0;
  const fetcher = vi.fn().mockImplementation((url: string | URL) => String(url).includes("oauth2/access_token") ? json({access_token: `token-${++counter}`, expires_in: "300"}) : json([]));
  vi.stubGlobal("fetch", fetcher);
  const a = createFinraApiFetch(env); const b = createFinraApiFetch({...env, FINRA_CLIENT_SECRET: "different"});
  for (const api of [a, b, a]) await api({method: "GET", path: "/fixed-income/treasuryDailyAggregates"});
  const calls = fetcher.mock.calls.filter(([url]) => !String(url).includes("oauth2"));
  expect(calls.map(([, init]) => new Headers(init.headers).get("Authorization"))).toEqual(["Bearer token-1", "Bearer token-2", "Bearer token-1"]);
});
it("refreshes a rejected token once, without anonymous fallback", async () => {
  let tokens = 0; let reads = 0;
  const fetcher = vi.fn().mockImplementation((url: string | URL) => String(url).includes("oauth2") ? json({access_token: `token-${++tokens}`}) : json([], ++reads === 1 ? 401 : 200));
  vi.stubGlobal("fetch", fetcher); await createFinraApiFetch(env)({method: "GET", path: "/fixed-income/treasuryDailyAggregates"});
  expect(tokens).toBe(2); expect(reads).toBe(2);
  expect(new Headers(fetcher.mock.calls[3][1].headers).get("Authorization")).toBe("Bearer token-2");
});
it.each([401, 403, 429, 500, 202])("returns actionable bounded errors for HTTP %s", async status => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({secret: "SHOULD-NOT-ESCAPE"}, status, {"Retry-After": "15", "FINRA-api-request-id": "fixture"})));
  const promise = createFinraApiFetch({})({method: "GET", path: "/fixed-income/treasuryDailyAggregates"});
  await expect(promise).rejects.toMatchObject({status: status === 202 ? 502 : status, data: {upstream_http_status: status, retry_after: "15", incomplete: true}});
  await promise.catch(error => expect(JSON.stringify(error)).not.toContain("SHOULD-NOT-ESCAPE"));
});
it("does not disclose OAuth error bodies", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({echo: "fixture-secret"}, 401)));
  await expect(createFinraApiFetch(env)({method: "GET", path: "/datasets"})).rejects.toThrow("FINRA OAuth failed (401)");
});
it.each([
  {method: "DELETE", path: "/datasets"},
  {method: "POST", path: "/metadata/group/fixedIncomeMarket/name/a", body: {}},
  {method: "GET", path: "https://other.example/data/group/a/name/b"},
  {method: "GET", path: "/fixed-income/a?token=x"},
  {method: "GET", path: "/fixed-income/a", params: {tradeDate: "2026-01-01"}},
  {method: "GET", path: "/fixed-income/a", params: {limit: 5001}},
  {method: "GET", path: "/fixed-income/a", params: {offset: 500001}},
  {method: "GET", path: "/fixed-income/a", params: {authorization: "x"}},
  {method: "POST", path: "/fixed-income/a", body: {async: true}},
  {method: "POST", path: "/fixed-income/a", body: "bad json"},
  {method: "POST", path: "/fixed-income/a", body: {fields: "tradeDate"}},
  {method: "GET", path: "/datasets", params: {dataVersion: 1.5}},
  {method: "GET", path: "/trace-summary/unknown"},
  {method: "GET", path: "/trace-summary/traceCorporateBondSummary", params: {period: "2026-08-02", firmMarketIdentifier: "TEST"}},
  {method: "GET", path: "/trace-summary/traceCorporateBondSummary", params: {period: "2026-08-01"}},
  {method: "GET", path: "/trace-summary/traceTreasuriesSummary", params: {period: "2026-08-01", firmMarketIdentifier: "TEST", reportView: "CMO"}},
  {method: "POST", path: "/trace-summary/traceCorporateBondSummary", body: {}},
])("rejects unsupported query %# before fetching", async request => {
  const fetcher = stub([]);
  await expect(createFinraApiFetch({})(request as Parameters<ReturnType<typeof createFinraApiFetch>>[0])).rejects.toMatchObject({status: 400}); expect(fetcher).not.toHaveBeenCalled();
});
it("bounds large UTF-8 responses", async () => {
  stub([{x: "α".repeat(3 * 1024 * 1024)}]);
  await expect(createFinraApiFetch({})({method: "GET", path: "/fixed-income/a"})).rejects.toThrow("size bound");
});
it("rejects invalid JSON on market routes", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("html")));
  await expect(createFinraApiFetch({})({method: "GET", path: "/fixed-income/a"})).rejects.toThrow("valid JSON");
});
it.each([{__api_error: true}, {__staged: true}, {__stage_error: true}, {data: {fields: []}}])("metadata recipe stops before querying when discovery is incomplete %j", async metadata => {
  const api = {get: vi.fn().mockResolvedValue(metadata), post: vi.fn()};
  const run = new Function("api", `return (async () => {${marketWorkflows[1].code}})()`);
  expect(await run(api)).toMatchObject({complete: false}); expect(api.post).not.toHaveBeenCalled();
});
it("metadata recipe retains observations and field units separately", async () => {
  const metadata = {data: {fields: [{name: "tradeDate", type: "Date"}, {name: "dealerCustomerVolume", description: "billions"}]}}; const observations = {data: [{tradeDate: "2026-09-01", dealerCustomerVolume: "1.000"}]};
  const api = {get: vi.fn().mockResolvedValue(metadata), post: vi.fn().mockResolvedValue(observations)};
  const result = await new Function("api", `return (async () => {${marketWorkflows[1].code}})()`)(api);
  expect(result).toEqual({metadata, observations, complete_dataset_verified: false});
});
