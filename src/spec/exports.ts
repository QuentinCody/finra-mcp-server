import type {ApiEndpoint, WorkflowRecipe} from "@bio-mcp/shared/codemode/catalog";
const base = "/exports/group/{group}/name/{dataset}";
const pathParams = [
  {name: "group", type: "string" as const, required: true, description: "otcMarket or fixedIncomeMarket; other FINRA asynchronous products have different contracts."},
  {name: "dataset", type: "string" as const, required: true, description: "Exact dataset name from /datasets; verify support, fields, filters and entitlement first."},
];
const id = {name: "requestId", type: "string" as const, required: true, description: "Provider-issued UUID from the export receipt; never invent one."};
const queryParams = [{name: "dataVersion", type: "number" as const, required: false, description: "Use the same supported Data-Version schema header across steps; not a pinned data release."}];
export const exportEndpoints: ApiEndpoint[] = [
  {method: "POST", path: base, category: "exports", summary: "Start one filtered market-data export; returns a resumable receipt, not dataset rows", pathParams, queryParams,
    body: {contentType: "application/json", description: "Query object: limit 1–100000 (provider default 1000), offset 0–500000, fields[], compareFilters[], domainFilters[], dateRangeFilters[], sortFields[]. async:true is supplied by the helper; do not provide it. Same filter/partition restrictions as the synchronous dataset."},
    usageHint: "Creates an upstream export. Requires both Worker credentials, even for OTC status retrieval. No automatic retry/token-refresh replay, polling or resubmission. On transport failure the outcome is unknown. Preserve the receipt and wait at least 60 seconds before a separate status/result call. FINRA limits submissions to 20/minute/dataset/account; this stateless helper does not enforce aggregate client traffic."},
  {method: "GET", path: `${base}/{requestId}`, category: "exports", summary: "Read one export status, preserving native pending/complete state, expiry, result link and paging headers", pathParams: [...pathParams, id], queryParams,
    usageHint: "One authenticated GET, no loop. Poll no more than once per minute. A ready file is not proof of complete dataset coverage. HTTP 202 pending is preserved; mismatched IDs and unrecognized states return explicit errors."},
  {method: "GET", path: `${base}/{requestId}/result`, category: "exports", summary: "Check an existing export and, only when ready, read its bounded UTF-8 result with a source hash", pathParams: [...pathParams, id], queryParams,
    usageHint: "This call also checks status: use it as an alternative to the status-only call after waiting at least 60 seconds. Preserves the status and whole JSON/text file with numeric strings and native fields. Requires an unexpired result link on the documented production 5101-9919-3688-dapi.s3.amazonaws.com host. Sends no Authorization header to S3 and follows no redirects. Maximum file 8 MiB, body 15 seconds, entire step 50 seconds. Larger files require a separate bulk client. complete:false survives staging; no background task or automatic resubmission."},
];

export const exportWorkflows: WorkflowRecipe[] = [{
  title: "Resume a previously requested FINRA market-data export",
  keywords: ["async", "export", "resultLink", "requestId", "download", "fixedIncomeMarket"],
  description: "First use POST /exports/group/{group}/name/{dataset} with a validated filter and retain its request_id. In a later invocation, after at least one minute, replace the placeholder below. This recipe does not submit a job or poll in a loop. Retain the whole response or staged handle; pending is not empty data.",
  code: `const requestId = 'REPLACE_WITH_RECEIPT_REQUEST_ID';
if (requestId === 'REPLACE_WITH_RECEIPT_REQUEST_ID') return {complete: false, selection_required: 'Use the request_id from an existing export receipt, after waiting at least 60 seconds.'};
return await api.get('/exports/group/fixedIncomeMarket/name/treasuryDailyAggregates/' + requestId + '/result');`,
}];
