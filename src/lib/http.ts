import { restFetch } from "@bio-mcp/shared/http/rest-fetch";
import type { RestFetchOptions } from "@bio-mcp/shared/http/rest-fetch";

const FINRA_API_BASE = "https://api.finra.org";
const FINRA_TOKEN_URL = "https://ews.fip.finra.org/fip/rest/ews/oauth2/access_token";
const FINRA_USER_AGENT = "finra-mcp-server/1.0 (bio-mcp)";

/** The one dataset group FINRA serves with no credential at all. */
export const FINRA_PUBLIC_GROUP = "otcMarket";

/** Where a human obtains the free "Public" credential for the gated groups. */
export const FINRA_API_CONSOLE_URL = "https://gateway.finra.org/app/api-console/v1/home";

// Module-level token cache
let cachedToken: string | null = null;
let tokenExpiresAt = 0;

export interface FinraFetchOptions extends Omit<RestFetchOptions, "retryOn"> {
    baseUrl?: string;
    /**
     * OAuth 2.0 client credentials. OPTIONAL — the `otcMarket` group, which is
     * every dataset this server exposes, is anonymous-public (verified live
     * 2026-08-27: HTTP 200 with no Authorization header). Credentials only
     * unlock the gated groups (fixedIncomeMarket, equityMarket, firmMargin,
     * regulatoryFilings), which 401 anonymously. Send a token when we hold one
     * and no Authorization header at all when we do not.
     */
    clientId?: string;
    clientSecret?: string;
}

interface OAuthTokenResponse {
    access_token: string;
    expires_in?: number;
    token_type?: string;
}

function isOAuthTokenResponse(value: unknown): value is OAuthTokenResponse {
    if (!value || typeof value !== "object") return false;
    const obj = value as Record<string, unknown>;
    return typeof obj.access_token === "string";
}

/**
 * Acquire an OAuth 2.0 access token using client credentials grant.
 * Caches the token until expiry (with 60s buffer).
 */
async function getAccessToken(clientId: string, clientSecret: string): Promise<string> {
    const now = Date.now();
    if (cachedToken && now < tokenExpiresAt) {
        return cachedToken;
    }

    const credentials = btoa(`${clientId}:${clientSecret}`);
    const response = await fetch(FINRA_TOKEN_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${credentials}`,
        },
        body: "grant_type=client_credentials",
    });

    if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        throw new Error(`FINRA OAuth token request failed (${response.status}): ${errorText.slice(0, 300)}`);
    }

    const raw: unknown = await response.json();
    if (!isOAuthTokenResponse(raw)) {
        throw new Error("FINRA OAuth token response missing access_token field");
    }

    cachedToken = raw.access_token;
    // Cache with 60-second safety buffer
    const expiresInMs = (raw.expires_in ?? 300) * 1000;
    tokenExpiresAt = now + expiresInMs - 60_000;

    return cachedToken;
}

/**
 * Clear the cached token (e.g., on 401 to force re-auth).
 */
function clearToken() {
    cachedToken = null;
    tokenExpiresAt = 0;
}

/** For tests: drop the module-level token cache between cases. */
export function resetFinraTokenCache(): void {
    clearToken();
}

/**
 * Message for a 401 seen with NO credentials configured. FINRA returns a
 * byte-identical 401 for a gated group and for a group that does not exist, so
 * the wording covers both rather than asserting either.
 */
export function anonymousAuthErrorMessage(path: string): string {
    const group = /\/(?:data|metadata)\/group\/([^/]+)\//i.exec(path)?.[1];
    const subject = group ? `dataset group '${group}'` : `path '${path}'`;
    return (
        `FINRA returned 401 for ${subject} and no credentials are configured. ` +
        `Anonymous access is limited to the '${FINRA_PUBLIC_GROUP}' group; every other group — ` +
        "and every group that does not exist — returns this same 401, so the dataset may also be misspelled. " +
        "To reach the gated groups (fixedIncomeMarket, equityMarket, firmMargin, regulatoryFilings) set the " +
        `FINRA_CLIENT_ID and FINRA_CLIENT_SECRET secrets; a free "Public" credential is provisioned from the ` +
        `FINRA API Console at ${FINRA_API_CONSOLE_URL}.`
    );
}

/**
 * Fetch from the FINRA API, attaching an OAuth 2.0 bearer token only when both
 * halves of the client-credentials pair are configured.
 *
 * There is no pre-flight credential check: refusing to call an API that needs
 * no credentials is what kept this server permanently red, since the datasets
 * in the catalog are all served anonymously.
 */
export async function finraFetch(
    path: string,
    params?: Record<string, unknown>,
    opts?: FinraFetchOptions,
): Promise<Response> {
    const baseUrl = opts?.baseUrl ?? FINRA_API_BASE;
    const clientId = opts?.clientId;
    const clientSecret = opts?.clientSecret;
    const credentials = clientId && clientSecret ? { clientId, clientSecret } : undefined;

    const buildHeaders = (token?: string): Record<string, string> => ({
        Accept: "application/json",
        // No credentials => no Authorization header at all.
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opts?.headers ?? {}),
    });

    // `...opts` carries `method` and `body` through to restFetch, so a POST
    // from the isolate stays a POST instead of degrading to an unfiltered GET.
    const send = (headers: Record<string, string>) =>
        restFetch(baseUrl, path, params, {
            ...opts,
            headers,
            retryOn: [429, 500, 502, 503],
            retries: opts?.retries ?? 3,
            timeout: opts?.timeout ?? 30_000,
            userAgent: FINRA_USER_AGENT,
        });

    const token = credentials
        ? await getAccessToken(credentials.clientId, credentials.clientSecret)
        : undefined;
    const response = await send(buildHeaders(token));

    // A 401 while credentialed usually means a stale token: clear the cache and
    // retry once. Anonymously there is nothing to refresh, so the 401 is handed
    // back untouched for the adapter to turn into an actionable error.
    if (response.status === 401 && credentials) {
        clearToken();
        const freshToken = await getAccessToken(credentials.clientId, credentials.clientSecret);
        return send(buildHeaders(freshToken));
    }

    return response;
}
