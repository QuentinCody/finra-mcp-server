import { restFetch } from "@bio-mcp/shared/http/rest-fetch";
import type { RestFetchOptions } from "@bio-mcp/shared/http/rest-fetch";

const FINRA_API_BASE = "https://api.finra.org";
const FINRA_TOKEN_URL = "https://ews.fip.finra.org/fip/rest/ews/oauth2/access_token";

// Module-level token cache
let cachedToken: string | null = null;
let tokenExpiresAt = 0;

export interface FinraFetchOptions extends Omit<RestFetchOptions, "retryOn"> {
    baseUrl?: string;
    clientId: string;
    clientSecret: string;
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

/**
 * Fetch from the FINRA API with OAuth 2.0 bearer token authentication.
 * Automatically acquires and refreshes tokens.
 */
export async function finraFetch(
    path: string,
    params?: Record<string, unknown>,
    opts?: FinraFetchOptions,
): Promise<Response> {
    const baseUrl = opts?.baseUrl ?? FINRA_API_BASE;

    const token = await getAccessToken(opts!.clientId, opts!.clientSecret);

    const headers: Record<string, string> = {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(opts?.headers ?? {}),
    };

    const response = await restFetch(baseUrl, path, params, {
        ...opts,
        headers,
        retryOn: [429, 500, 502, 503],
        retries: opts?.retries ?? 3,
        timeout: opts?.timeout ?? 30_000,
        userAgent: "finra-mcp-server/1.0 (bio-mcp)",
    });

    // On 401, clear token cache and retry once with a fresh token
    if (response.status === 401) {
        clearToken();
        const freshToken = await getAccessToken(opts!.clientId, opts!.clientSecret);
        const retryHeaders: Record<string, string> = {
            Accept: "application/json",
            Authorization: `Bearer ${freshToken}`,
            ...(opts?.headers ?? {}),
        };

        return restFetch(baseUrl, path, params, {
            ...opts,
            headers: retryHeaders,
            retryOn: [429, 500, 502, 503],
            retries: opts?.retries ?? 3,
            timeout: opts?.timeout ?? 30_000,
            userAgent: "finra-mcp-server/1.0 (bio-mcp)",
        });
    }

    return response;
}
