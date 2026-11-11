import {afterEach, expect, it, vi} from "vitest";
import {createApiProxyTool} from "@bio-mcp/shared/tools/api-proxy";
import {createFinraApiFetch} from "../lib/api-adapter";
import {finraCatalog} from "../spec/catalog";

afterEach(() => vi.unstubAllGlobals());

it.each([200, 503])("stages the complete export evidence for file HTTP %s", async httpStatus => {
  const id = "0ba2c6e6-c13b-4a47-989a-c47106ab98ce";
  const native = [{volume: "9007199254740993", price: "001.20", unknown_native: "🧬α".repeat(15000)}];
  const raw = JSON.stringify(native);
  const status = {requestId: id, status: "complete", expires: "2099-01-01T00:00:00Z", resultLink: `https://5101-9919-3688-dapi.s3.amazonaws.com/asyncFiles/${id}/result.json?X-Amz-Signature=synthetic`};
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => String(url).includes("oauth2/access_token") ? Response.json({access_token: "fixture", expires_in: 1000})
    : String(url).startsWith("https://api.finra.org") ? Response.json(status) : new Response(raw, {status: httpStatus, headers: {"content-type": "application/json"}})));
  const stored: unknown[] = [];
  const namespace = {idFromName: (name: string) => name, get: () => ({fetch: async (request: Request) => {
    if (new URL(request.url).pathname === "/process") {
      stored.push((await request.json() as {data: unknown}).data);
      return Response.json({success: true, tables_created: ["evidence"], total_rows: 1});
    }
    return Response.json({success: true, schema: {tables: {evidence: {columns: [{name: "raw_response"}]}}}});
  }})};
  const proxy = createApiProxyTool({apiFetch: createFinraApiFetch({FINRA_CLIENT_ID: "fixture-id", FINRA_CLIENT_SECRET: "fixture-secret"}), catalog: finraCatalog,
    doNamespace: namespace, stagingPrefix: "finra", maxInlineBytes: 30 * 1024});
  const result = await proxy.handler({method: "GET", path: `/exports/group/fixedIncomeMarket/name/treasuryDailyAggregates/${id}/result`}, {sql: () => []});
  const plain = JSON.parse(JSON.stringify(result));
  if (httpStatus === 200) expect(plain).toMatchObject({__staged: true, complete: false, _staging: expect.any(Object)});
  else expect(plain).toMatchObject({__api_error: true, incomplete: true, status: 503, data: {__staged: true, _staging: expect.any(Object)}});
  const recovered = stored.map(value => typeof value === "string" ? JSON.parse(value) : value);
  expect(recovered).toContainEqual(expect.objectContaining(httpStatus === 200
    ? {observation: expect.objectContaining({data: status}), result: expect.objectContaining({data: native, raw_response: raw})}
    : {status_observation: expect.objectContaining({data: status}), download: expect.objectContaining({data: native, raw_response: raw})}));
  expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThan(100000);
});
