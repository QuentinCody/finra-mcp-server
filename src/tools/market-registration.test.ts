import {afterEach, expect, it, vi} from "vitest";
import {McpServer} from "@bio-mcp/shared/mcp";
import {createApiProxyTool} from "@bio-mcp/shared/tools/api-proxy";
import {registerCodeMode} from "./code-mode";
import {registerGetSchema} from "./get-schema";
import {registerQueryData} from "./query-data";
import {finraCatalog} from "../spec/catalog";
import {createFinraApiFetch} from "../lib/api-adapter";
const json = (data: unknown) => new Response(JSON.stringify(data), {headers: {"Content-Type": "application/json"}});
afterEach(() => vi.unstubAllGlobals());
it("registers both aliases and both response fields", async () => {
  const server = new McpServer({name: "fixture", version: "1"});
  registerCodeMode(server, {CODE_MODE_LOADER: {get: () => ({})}} as unknown as Parameters<typeof registerCodeMode>[1]);
  registerGetSchema(server, {}); registerQueryData(server, {});
  const tools = (server as unknown as {_registeredTools: Record<string, {handler: (args: unknown, extra: unknown) => Promise<unknown>}>})._registeredTools;
  for (const suffix of ["search", "execute", "query_data", "get_schema"]) { expect(tools[`finra_${suffix}`]).toBeDefined(); expect(tools[`mcp_finra_${suffix}`]).toBeDefined(); }
  expect(await tools.finra_search.handler({query: "TRACE", max_results: 5}, {})).toMatchObject({content: expect.any(Array), structuredContent: {success: true}});
  expect(await tools.mcp_finra_query_data.handler({data_access_id: "finra_fixture", sql: "SELECT 1"}, {})).toMatchObject({isError: true, content: expect.any(Array), structuredContent: expect.any(Object)});
});
it("stages nested report-card peer membership and reporting context intact", async () => {
  const native = [{tradeReportingPeerGroup: [{peerGroupTier: 2, peerGroupFirms: Array.from({length: 800}, (_, i) => ({firmId: `F${i}`, firmName: `Synthetic α Firm ${i}`}))}], activityTotal: [{ValidReportCount: "9007199254740993"}]}];
  vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json(native)));
  const stored: unknown[] = [];
  const namespace = {idFromName: (name: string) => name, get: () => ({fetch: async (request: Request) => {
    if (new URL(request.url).pathname === "/process") { stored.push((await request.json() as {data: unknown}).data); return json({success: true, tables_created: ["peerGroupFirms"], total_rows: 800, input_rows: 800, table_row_counts: {peerGroupFirms: 800}}); }
    return json({success: true, schema: {tables: {peerGroupFirms: {columns: [{name: "firmId"}]}}}});
  }})} as unknown as DurableObjectNamespace;
  const proxy = createApiProxyTool({apiFetch: createFinraApiFetch({}), catalog: finraCatalog, doNamespace: namespace, stagingPrefix: "finra", maxInlineBytes: 30 * 1024});
  const result = await proxy.handler({method: "GET", path: "/trace-summary/traceCorporateBondSummary", params: {period: "2026-08-01", firmMarketIdentifier: "TEST"}}, {sql: () => []});
  expect(result).toMatchObject({__staged: true, data_access_id: expect.any(String)});
  expect(JSON.parse(stored[0] as string)).toMatchObject({data: native, _mcp: {request: {params: {period: "2026-08-01", firmMarketIdentifier: "TEST"}}, credential_requirement: "Firm"}});
  expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThan(100000);
});
it("propagates unauthorized reports as incomplete API errors", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unauthorized", {status: 401})));
  const proxy = createApiProxyTool({apiFetch: createFinraApiFetch({}), catalog: finraCatalog, stagingPrefix: "finra"});
  expect(await proxy.handler({method: "GET", path: "/trace-summary/traceTreasuriesSummary", params: {period: "2026-08-01", firmMarketIdentifier: "TEST"}}, {sql: () => []})).toMatchObject({__api_error: true, incomplete: true, data: {upstream_http_status: 401}});
});
