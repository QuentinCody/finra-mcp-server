import {afterEach, expect, it, vi} from "vitest";
import {createFinraApiFetch} from "./api-adapter";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const env = {FINRA_CLIENT_ID: "fixture-id", FINRA_CLIENT_SECRET: "fixture-secret"};
const id = "0ba2c6e6-c13b-4a47-989a-c47106ab98ce";
const base = "/exports/group/fixedIncomeMarket/name/treasuryDailyAggregates";
const remote = `/async-requests/group/fixedIncomeMarket/name/treasuryDailyAggregates/${id}`;
const resultLink = `https://5101-9919-3688-dapi.s3.amazonaws.com/asyncFiles/${id}/data.json?X-Amz-Signature=synthetic`;
const ready = {requestId: id, status: "complete", resultLink, expires: "2099-01-01T00:00:00Z", unknown_field: {retained: true}};

function upstream(responder: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fetcher = vi.fn(async (url: string, init: RequestInit = {}) => String(url).includes("oauth2/access_token")
    ? Response.json({access_token: "fixture-token", expires_in: 1800}) : responder(String(url), init));
  vi.stubGlobal("fetch", fetcher); return fetcher;
}

it("submits one filtered export and returns its verified receipt without polling", async () => {
  const fetcher = upstream(() => new Response(null, {status: 202, headers: {location: `https://api.finra.org${remote}`, "FINRA-api-request-id": "trace-fixture"}}));
  const body = {limit: 100000, offset: 100, fields: ["tradeDate", "volume"], compareFilters: [{fieldName: "tradeDate", fieldValue: "2026-09-01", compareType: "EQUAL"}]};
  const result = await createFinraApiFetch(env)({method: "POST", path: base, params: {dataVersion: 2}, body});
  expect(result).toMatchObject({status: 202, data: {export_state: "accepted", request_id: id, status_path: `${base}/${id}`, result_path: `${base}/${id}/result`, poll_after_seconds: 60, complete: false,
    observation: {_mcp: {request: {params: {dataVersion: "2"}, body: {...body, async: true}}, response_headers: {"finra-api-request-id": "trace-fixture"}}}}});
  expect(fetcher).toHaveBeenCalledTimes(2);
  const [url, init = {}] = fetcher.mock.calls[1];
  expect(String(url)).toBe("https://api.finra.org/data/group/fixedIncomeMarket/name/treasuryDailyAggregates");
  expect(init).toMatchObject({method: "POST", redirect: "manual"});
  expect(new Headers(init.headers).get("authorization")).toBe("Bearer fixture-token");
  expect(new Headers(init.headers).get("data-version")).toBe("2");
  expect(JSON.parse(init.body as string)).toEqual({...body, async: true});
});

it.each([null, "https://other.example/status", `/async-requests/group/otcMarket/name/other/${id}`, `${remote}?redirect=other`, `${remote}#x`])("retains an accepted but unusable receipt without following its location: %s", async location => {
  const fetcher = upstream(() => new Response(null, {status: 202, headers: location ? {location} : {}}));
  await expect(createFinraApiFetch(env)({method: "POST", path: base, body: {limit: 1}})).rejects.toMatchObject({status: 502, data: {export_submission_outcome: "accepted", complete: false, observation: {location}}});
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("does not replay submission after a rejected bearer token or expose credential error bodies", async () => {
  const fetcher = upstream(() => new Response("sensitive-provider-auth-detail", {status: 401, headers: {"Retry-After": "60"}}));
  const error = await createFinraApiFetch(env)({method: "POST", path: base, body: {limit: 1}}).catch(error => error);
  expect(error).toMatchObject({status: 401, data: {export_submission_outcome: "rejected", observation: {http_status: 401, credential_error_body_omitted: true, retry_after: "60", _mcp: {response_sha256: null}}}});
  expect(JSON.stringify(error)).not.toContain("sensitive-provider-auth-detail");
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("records an unknown submission outcome on transport failure without retrying", async () => {
  const fetcher = upstream(() => { throw new Error("connection lost"); });
  await expect(createFinraApiFetch(env)({method: "POST", path: base, body: {limit: 1}})).rejects.toMatchObject({status: 502, data: {export_submission_outcome: "unknown", complete: false}});
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("does not treat a server failure as proof that export submission was rejected", async () => {
  const native = {message: "server failure fixture"};
  const fetcher = upstream(() => Response.json(native, {status: 503}));
  await expect(createFinraApiFetch(env)({method: "POST", path: base, body: {limit: 1}})).rejects.toMatchObject({status: 503, data: {
    export_submission_outcome: "unknown", complete: false, observation: {http_status: 503, data: native},
  }});
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it.each(["", "/result"])("retains pending status without a download or automatic poll (%s)", async suffix => {
  const pending = {requestId: id, status: "pending", progress: "provider-specific"};
  const fetcher = upstream(() => Response.json(pending, {status: 202, headers: {"retry-after": "120"}}));
  expect(await createFinraApiFetch(env)({method: "GET", path: `${base}/${id}${suffix}`})).toMatchObject({status: 202, data: {export_state: "pending", complete: false, poll_after_seconds: 120, observation: {data: pending, retry_after: "120"}}});
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(String(fetcher.mock.calls[1][0])).toBe(`https://api.finra.org${remote}`);
});

it("preserves complete status, response headers and native expiry without downloading on a status-only call", async () => {
  const fetcher = upstream(() => Response.json(ready, {headers: {"Record-Total": "123456", "Total-Records-On-Page": "100000"}}));
  expect(await createFinraApiFetch(env)({method: "GET", path: `${base}/${id}`})).toMatchObject({data: {export_state: "ready", complete: false, observation: {data: ready, _mcp: {response_headers: {"record-total": "123456", "total-records-on-page": "100000"}}}}});
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it.each([
  {requestId: "another-export", status: "complete", resultLink, expires: ready.expires},
  {requestId: id, status: "failed", provider_error: "fixture"},
  {requestId: id, status: "pending"},
  [ready],
])("refuses mismatched or inconsistent native status without downloading: %j", async data => {
  const fetcher = upstream(() => Response.json(data));
  await expect(createFinraApiFetch(env)({method: "GET", path: `${base}/${id}/result`})).rejects.toMatchObject({status: 502, data: {complete: false, observation: {data}}});
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it.each([
  ["application/json", '\uFEFF[ { "volume": "9007199254740993", "price": "001.20", "note": "α" } ]\n'],
  ["text/plain", 'volume,price,price\r\n9007199254740993,001.20,\r\n'],
])("reads a %s result without OAuth and retains the exact text and hash", async (contentType, raw) => {
  const fetcher = upstream(url => url.startsWith("https://api.finra.org") ? Response.json(ready) : new Response(raw, {headers: {"content-type": contentType, etag: '"fixture"'}}));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
  const result = await createFinraApiFetch(env)({method: "GET", path: `${base}/${id}/result`});
  expect(result).toMatchObject({data: {export_state: "downloaded", complete: false, file_read_complete: true, observation: {data: ready}, result: {raw_response: raw,
    data: contentType === "application/json" ? [{volume: "9007199254740993", price: "001.20", note: "α"}] : raw,
    source: {url: resultLink.split("?")[0], decoded_utf8_sha256: hash, etag: '"fixture"'}}}});
  expect(fetcher).toHaveBeenCalledTimes(3);
  const [url, init = {}] = fetcher.mock.calls[2];
  expect(url).toBe(resultLink); expect(init).toMatchObject({method: "GET", redirect: "manual"});
  expect(new Headers(init.headers).get("authorization")).toBeNull();
});

it.each([
  {resultLink: "https://other.example/data"}, {resultLink: "http://5101-9919-3688-dapi.s3.amazonaws.com/data"},
  {resultLink: "https://5101-9919-3688-dapi.s3.amazonaws.com.evil.example/data"}, {resultLink: "https://user:pass@5101-9919-3688-dapi.s3.amazonaws.com/data"},
  {expires: "not a date"}, {expires: "2000-01-01T00:00:00Z"}, {resultLink: null},
])("does not download an unsafe or expired native result link: %j", async override => {
  const fetcher = upstream(() => Response.json({...ready, ...override}));
  await expect(createFinraApiFetch(env)({method: "GET", path: `${base}/${id}/result`})).rejects.toMatchObject({data: {complete: false}});
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it.each([302, 403, 503])("retains file HTTP %s as an error without redirects/retries", async status => {
  const fetcher = upstream(url => url.startsWith("https://api.finra.org") ? Response.json(ready) : new Response("file-error-fixture", {status, headers: {location: "https://other.example/", "retry-after": "60"}}));
  await expect(createFinraApiFetch(env)({method: "GET", path: `${base}/${id}/result`})).rejects.toMatchObject({status: status >= 400 ? status : 502, data: {complete: false, status_observation: {data: ready}, download: {raw_response: "file-error-fixture", source: {http_status: status, retry_after: "60"}}}});
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it.each([
  {method: "GET", path: base}, {method: "POST", path: `${base}/${id}`, body: {}},
  {method: "POST", path: base, body: {limit: 100001}}, {method: "POST", path: base, body: {async: true}},
  {method: "POST", path: base, body: {offset: 500001}}, {method: "POST", path: base, body: {fields: "price"}},
  {method: "POST", path: base.replace("fixedIncomeMarket", "reportcard"), body: {}},
  {method: "GET", path: `${base}/not-a-uuid`}, {method: "GET", path: `${base}/${id}`, params: {url: "https://other.example"}},
] as const)("rejects unsupported export input before IO: %j", async request => {
  const fetcher = upstream(() => Response.json({}));
  await expect(createFinraApiFetch(env)(request)).rejects.toBeInstanceOf(Error);
  expect(fetcher).not.toHaveBeenCalled();
});

it("requires both credentials for exports while anonymous OTC reads remain supported", async () => {
  const fetcher = upstream(() => Response.json([])); const api = createFinraApiFetch({});
  await expect(api({method: "POST", path: base, body: {limit: 1}})).rejects.toMatchObject({status: 503});
  expect(fetcher).not.toHaveBeenCalled();
  expect(await api({method: "GET", path: "/short-volume"})).toEqual({status: 200, data: []});
});

it("bounds a stalled export submission even when fetch ignores abort", async () => {
  vi.useFakeTimers(); const fetcher = upstream(() => new Promise(() => {}));
  const assertion = expect(createFinraApiFetch(env)({method: "POST", path: base, body: {limit: 1}})).rejects.toMatchObject({status: 504, data: {export_submission_outcome: "unknown"}});
  await vi.advanceTimersByTimeAsync(50001); await assertion;
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[1][1]?.signal?.aborted).toBe(true);
});

it.each([
  {method: "GET", path: "/short-volume", params: {async: true}},
  {method: "POST", path: "/short-volume", body: {async: true, limit: 1}},
  {method: "POST", path: "/short-volume", body: '{"async":true,"limit":1}'},
] as const)("rejects implicit export submission on a synchronous route before IO: %j", async request => {
  const fetcher = upstream(() => Response.json([]));
  await expect(createFinraApiFetch(env)(request)).rejects.toMatchObject({status: 400});
  expect(fetcher).not.toHaveBeenCalled();
});

it("preserves an explicitly synchronous OTC query", async () => {
  const fetcher = upstream(() => Response.json([]));
  expect(await createFinraApiFetch({})({method: "POST", path: "/short-volume", body: {async: false, limit: 1}})).toEqual({status: 200, data: []});
  expect(fetcher).toHaveBeenCalledTimes(1);
});
