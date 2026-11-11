import {fail, readBody} from "./market";
const FINRA_API_BASE = "https://api.finra.org";
const FINRA_TOKEN_URL = "https://ews.fip.finra.org/fip/rest/ews/oauth2/access_token";
export const FINRA_PUBLIC_GROUP = "otcMarket";
export const FINRA_API_CONSOLE_URL = "https://gateway.finra.org/app/api-console/v1/home";
export interface FinraFetchOptions {
  method?: string; body?: string | object; clientId?: string; clientSecret?: string;
  dataVersion?: string; refreshOnUnauthorized?: boolean; signal?: AbortSignal;
}
export function anonymousAuthErrorMessage(path: string): string {
  const group = /\/group\/([^/]+)\//.exec(path)?.[1] ?? "unknown";
  return `FINRA returned 401 for dataset group '${group}' without credentials. The dataset may also be misspelled. Configure FINRA_CLIENT_ID and FINRA_CLIENT_SECRET from ${FINRA_API_CONSOLE_URL}. Public credentials cover eligible market datasets; TRACE report cards require separately entitled Firm credentials. Existing otcMarket reads can remain anonymous.`;
}
/** Each adapter owns its cache. Identity is checked even if a direct caller changes credentials. */
export function createFinraTransport() {
  let cached: {id: string; secret: string; token: string; expires: number} | undefined;
  return async (path: string, params: Record<string, unknown> = {}, opts: FinraFetchOptions = {}): Promise<Response> => {
    const { id, secret, request, url, body } = prepareFinraTransport(opts, path, params);
    const token = async () => {
      if (!id || !secret) return undefined;
      if (cached?.id === id && cached.secret === secret && Date.now() < cached.expires) return cached.token;
      cached = await acquireFinraToken(request, id, secret);
      return cached.token;
    };
    const send = async (bearer?: string) => request(url, {method: opts.method ?? "GET", body, headers: {
      Accept: "application/json", "User-Agent": "finra-mcp-server/1.0 (bio-mcp)",
      ...(body ? {"Content-Type": "application/json"} : {}), ...(bearer ? {Authorization: `Bearer ${bearer}`} : {}),
      ...(opts.dataVersion ? {"Data-Version": opts.dataVersion} : {}),
    }});
    let response = await send(await token());
    if (response.status === 401 && id && secret && opts.refreshOnUnauthorized !== false) {
      await response.body?.cancel().catch(() => {}); cached = undefined;
      response = await send(await token());
    }
    return response;
  };
}
let directTransport = createFinraTransport();
function prepareFinraTransport(opts: FinraFetchOptions, path: string, params: Record<string, unknown>) {
  const timeout = AbortSignal.timeout(50000);
  const signal = opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout;
  const url = new URL(path, FINRA_API_BASE);
  if (url.origin !== FINRA_API_BASE || !/^\/(?:data|metadata|partitions|datasets|async-requests)(?:\/|$)/.test(path) || /[?#\\%]/.test(path)) fail("Invalid FINRA query path");
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  if (url.href.length > 16000) fail("FINRA query URL too large");
  const body = opts.body === undefined ? undefined : typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  if (body && new TextEncoder().encode(body).length > 64 * 1024) fail("FINRA query body exceeds 64 KiB");
  const id = opts.clientId; const secret = opts.clientSecret;
  const request = async (target: string | URL, init: RequestInit) => {
    try {
      const response = await fetch(target, { ...init, redirect: "manual", signal });
      if (signal.aborted) { void response.body?.cancel().catch(() => { }); fail("FINRA request timed out", 504); }
      return response;
    }
    catch { fail("FINRA request failed or timed out", 502); }
  };
  return { id, secret, request, url, body };
}

export function resetFinraTokenCache() { directTransport = createFinraTransport(); }
export function finraFetch(path: string, params?: Record<string, unknown>, opts?: FinraFetchOptions) { return directTransport(path, params, opts); }

async function acquireFinraToken(request: (target: string | URL, init: RequestInit) => Promise<Response>, id: string, secret: string) {
  const response = await request(FINRA_TOKEN_URL, {method: "POST", headers: {"Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${btoa(`${id}:${secret}`)}`}, body: "grant_type=client_credentials"});
  if (!response.ok) { await response.body?.cancel().catch(() => {}); fail(`FINRA OAuth failed (${response.status}); verify credential type and entitlement`, response.status); }
  let data: Record<string, unknown>;
  try { data = JSON.parse((await readBody(response, 64 * 1024)).replace(/^\uFEFF/, "")); } catch { fail("Invalid FINRA OAuth response", 502); }
  if (!data || typeof data.access_token !== "string" || !data.access_token) fail("FINRA OAuth response missing access_token", 502);
  const seconds = Number(data.expires_in ?? 300);
  return {id, secret, token: data.access_token, expires: Date.now() + (Number.isFinite(seconds) ? Math.max(0, seconds - 60) * 1000 : 0)};
}
