import {expect, it, vi} from "vitest";
import {finraCatalog} from "./catalog";
import {exportWorkflows} from "./exports";

it("discovers all three export steps through the existing Code Mode catalog", () => {
  expect(finraCatalog.endpointCount).toBe(finraCatalog.endpoints.length);
  expect(finraCatalog.endpoints.filter(endpoint => endpoint.category === "exports").map(endpoint => [endpoint.method, endpoint.path])).toEqual([
    ["POST", "/exports/group/{group}/name/{dataset}"],
    ["GET", "/exports/group/{group}/name/{dataset}/{requestId}"],
    ["GET", "/exports/group/{group}/name/{dataset}/{requestId}/result"],
  ]);
});

it("does not invent an export request ID or start a job in the resume recipe", async () => {
  const api = {get: vi.fn(), post: vi.fn()};
  const run = new Function("api", `return (async () => {${exportWorkflows[0].code}})()`);
  expect(await run(api)).toMatchObject({complete: false, selection_required: expect.any(String)});
  expect(api.get).not.toHaveBeenCalled(); expect(api.post).not.toHaveBeenCalled();
});

it.each([{export_state: "pending", complete: false}, {__staged: true, data_access_id: "fixture"}, {__api_error: true, status: 403}])("retains the whole resumed result %j", async result => {
  const id = "0ba2c6e6-c13b-4a47-989a-c47106ab98ce";
  const code = exportWorkflows[0].code.replace("'REPLACE_WITH_RECEIPT_REQUEST_ID'", `'${id}'`);
  const api = {get: vi.fn().mockResolvedValue(result), post: vi.fn()};
  expect(await new Function("api", `return (async () => {${code}})()`)(api)).toEqual(result);
  expect(api.get).toHaveBeenCalledExactlyOnceWith(`/exports/group/fixedIncomeMarket/name/treasuryDailyAggregates/${id}/result`);
  expect(api.post).not.toHaveBeenCalled();
});
