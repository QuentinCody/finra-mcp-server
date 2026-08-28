import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { anonymousAuthErrorMessage, finraFetch } from "./http";

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
    return async (request) => {
        const path = resolveFinraPath(request.path);
        const credentialed = Boolean(env.FINRA_CLIENT_ID && env.FINRA_CLIENT_SECRET);
        // Forward method AND body: FINRA silently ignores unrecognized GET
        // query params, so a filtered query is only honored as a POST.
        const body =
            typeof request.body === "string" ||
            (typeof request.body === "object" && request.body !== null)
                ? (request.body as string | object)
                : undefined;

        const response = await finraFetch(path, request.params, {
            method: request.method,
            body,
            clientId: env.FINRA_CLIENT_ID,
            clientSecret: env.FINRA_CLIENT_SECRET,
        });

        if (!response.ok) {
            let errorBody: string;
            try {
                errorBody = await response.text();
            } catch {
                errorBody = response.statusText;
            }
            // A 401 we hit anonymously is actionable; say what would fix it
            // instead of relaying FINRA's opaque "check your authentication
            // token". The call still fails — it is never downgraded to success.
            const message =
                response.status === 401 && !credentialed
                    ? anonymousAuthErrorMessage(path)
                    : `HTTP ${response.status}: ${errorBody.slice(0, 200)}`;
            const error = new Error(message) as Error & {
                status: number;
                data: unknown;
            };
            error.status = response.status;
            error.data = errorBody;
            throw error;
        }

        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("json")) {
            const text = await response.text();
            return { status: response.status, data: text };
        }

        const data: unknown = await response.json();
        return { status: response.status, data };
    };
}
