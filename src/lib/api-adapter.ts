import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { anonymousAuthErrorMessage, createFinraTransport, FinraFetchOptions } from "./http";
import { finraExport } from "./exports";

import {marketPath, validateRead, validateMarketQuery, marketEnvelope, readBody, fail} from "./market";

interface FinraAdapterEnv {
    /** Absent when the secret is unset — never coerce to "" (see http.ts). */
    FINRA_CLIENT_ID?: string;
    FINRA_CLIENT_SECRET?: string;
}

/**
 * Friendly Code Mode path -> FINRA data-API path. Every target lives in the
 * anonymous-public `otcMarket` group. A path that is already a raw FINRA path
 * (/data/... or /metadata/group/...) falls through untouched.
 */
const DATASET_PATHS: Record<string, string> = {
    "/short-interest": "/data/group/otcMarket/name/consolidatedShortInterest",
    "/short-volume": "/data/group/otcMarket/name/regShoDaily",
    "/threshold-list": "/data/group/otcMarket/name/thresholdList",
    "/weekly-summary": "/data/group/otcMarket/name/weeklySummary",
    "/monthly-summary": "/data/group/otcMarket/name/monthlySummary",
    "/blocks-summary": "/data/group/otcMarket/name/blocksSummary",
    "/otc-blocks-summary": "/data/group/otcMarket/name/otcBlocksSummary",
    "/otc-daily-list": "/data/group/otcMarket/name/otcDailyList",
};

/** `/metadata/<datasetName>` -> the anonymous field/partition metadata endpoint. */
const METADATA_ALIAS = /^\/metadata\/([A-Za-z0-9_-]+)$/;

export function resolveFinraPath(path: string): string {
    for (const [alias, target] of Object.entries(DATASET_PATHS)) {
        if (path === alias || path.startsWith(`${alias}?`) || path.startsWith(`${alias}/`)) {
            return `${target}${path.slice(alias.length)}`;
        }
    }

    const metadata = METADATA_ALIAS.exec(path);
    if (metadata) {
        return `/metadata/group/otcMarket/name/${metadata[1]}`;
    }

    return path;
}

export function createFinraApiFetch(env: FinraAdapterEnv): ApiFetchFn {
    const transport = createFinraTransport();
    return async (request) => {
        if (request.path.startsWith("/exports/")) return finraExport(request, transport, {clientId: env.FINRA_CLIENT_ID, clientSecret: env.FINRA_CLIENT_SECRET});
        const path = marketPath(request.path) ?? resolveFinraPath(request.path);
        let { enriched, response, data, raw, params, dataVersion, body } = await readFinraResponse(request, env, path, transport);
        if (enriched || response.headers.get("content-type")?.includes("json")) {
            try { data = JSON.parse(raw.replace(/^\uFEFF/, "")); } catch { fail("FINRA response was not valid JSON", 502); }
            if (data === null || typeof data !== "object") fail("Invalid FINRA dataset response", 502);
        }
        return {status: response.status, data: enriched ? await marketEnvelope(data, raw, response, path, {...params, ...(dataVersion === undefined ? {} : {dataVersion})}, body) : data};
    };
}

async function readFinraResponse(request: Parameters<ApiFetchFn>[0], env: FinraAdapterEnv, path: string, transport: (path: string, params?: Record<string, unknown>, opts?: FinraFetchOptions) => Promise<Response>) {
  const params = { ...request.params };
  const credentialed = Boolean(env.FINRA_CLIENT_ID && env.FINRA_CLIENT_SECRET);
  let body = request.body;
  const fixed = path.includes("/data/group/fixedIncomeMarket/");
  if (fixed && typeof body === "string") {
    try { body = JSON.parse(body); } catch { fail("POST body must be valid JSON"); }
  }
  validateRead(path, request.method, params, body);
  if (fixed) validateMarketQuery(request.method, params, body);
  const dataVersion = params.dataVersion;
  if (dataVersion !== undefined && !/^[1-9][0-9]{0,3}$/.test(String(dataVersion))) fail("dataVersion must be a positive integer version");
  delete params.dataVersion;
  const response = await transport(path, params, {
    method: request.method,
    body: body as string | object | undefined,
    clientId: env.FINRA_CLIENT_ID,
    clientSecret: env.FINRA_CLIENT_SECRET,
    dataVersion: dataVersion === undefined ? undefined : String(dataVersion),
  });
  if (!response.ok || response.status !== 200) {
    await response.body?.cancel().catch(() => { });
    const message = response.status === 401 && !credentialed
      ? anonymousAuthErrorMessage(path)
      : `FINRA HTTP ${response.status}; verify request, credential entitlement or retry later`;
    fail(message, response.status === 202 ? 502 : response.status, {
      upstream_http_status: response.status,
      request_id: response.headers.get("FINRA-api-request-id"),
      retry_after: response.headers.get("Retry-After"),
      incomplete: true,
    });
  }
  const raw = await readBody(response);
  const enriched = fixed || path.includes("/reportcard/") || path === "/datasets" || path.includes("/fixedIncomeMarket/");
  let data: unknown = raw;
  return { enriched, response, data, raw, params, dataVersion, body };
}
