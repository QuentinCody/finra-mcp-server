import {fail, validateMarketQuery} from "./market";

export const FINRA_ORIGIN = "https://api.finra.org";
const ID = "[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}";

export function exportRequest(method: string, path: string, params: Record<string, unknown> = {}, body?: unknown) {
  const match = new RegExp(`^/exports/group/(otcMarket|fixedIncomeMarket)/name/([A-Za-z0-9_-]{1,100})(?:/(${ID})(/result)?)?$`).exec(path);
  if (!match) fail("Use an OTC/fixed-income export path and a provider-issued UUID");
  const [, group, dataset, requestId, result] = match;
  if (method !== (requestId ? "GET" : "POST")) fail("POST starts an export; GET checks or downloads an existing export", 405);
  if (Object.keys(params).some(key => key !== "dataVersion")) fail("Only dataVersion is accepted as an export query parameter");
  const version = params.dataVersion;
  if (version !== undefined && !/^[1-9][0-9]{0,3}$/.test(String(version))) fail("dataVersion must be a positive integer version");
  let query: Record<string, unknown> | undefined;
  if (requestId) {
    if (body !== undefined) fail("Export GET requests cannot carry a body");
  } else {
    let parsed = body;
    if (typeof parsed === "string") { try { parsed = JSON.parse(parsed); } catch { fail("Export body must be valid JSON"); } }
    validateMarketQuery("POST", {}, parsed, 100000);
    query = {...parsed as Record<string, unknown>, async: true};
    if (new TextEncoder().encode(JSON.stringify(query)).length > 64 * 1024) fail("Export query exceeds 64 KiB");
  }
  const resource = `/group/${group}/name/${dataset}`;
  return {group, dataset, requestId, download: Boolean(result), query,
    dataVersion: version === undefined ? undefined : String(version),
    path: requestId ? `/async-requests${resource}/${requestId}` : `/data${resource}`,
    statusPrefix: `/async-requests${resource}/`, localPrefix: `/exports${resource}/`};
}

export function exportLocation(value: string | null, prefix: string) {
  if (!value || value.length > 2000) return null;
  let url: URL;
  try { url = new URL(value, FINRA_ORIGIN); } catch { return null; }
  if (url.origin !== FINRA_ORIGIN || url.username || url.password || url.search || url.hash || !url.pathname.startsWith(prefix)) return null;
  const requestId = url.pathname.slice(prefix.length);
  return new RegExp(`^${ID}$`).test(requestId) ? {requestId, url: url.href} : null;
}

/** Read only the production Query API's documented S3 bucket; no caller-supplied URLs. */
export function exportResultUrl(value: unknown, expires: unknown) {
  if (typeof value !== "string" || value.length > 16000 || typeof expires !== "string") fail("Export result link or expiry is missing", 502);
  const expiry = Date.parse(expires);
  if (!Number.isFinite(expiry)) fail("Export result expiry is unrecognized", 502);
  if (expiry <= Date.now()) fail("Export result link has expired; inspect status before requesting another export", 410);
  let url: URL;
  try { url = new URL(value); } catch { fail("Invalid FINRA export result URL", 502); }
  if (url.protocol !== "https:" || url.hostname !== "5101-9919-3688-dapi.s3.amazonaws.com" || url.port || url.username || url.password || url.hash) {
    fail("Export result is outside the documented production FINRA download host", 502);
  }
  return url;
}
