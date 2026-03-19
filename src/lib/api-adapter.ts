import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { finraFetch } from "./http";

interface FinraAdapterEnv {
    FINRA_CLIENT_ID: string;
    FINRA_CLIENT_SECRET: string;
}

export function createFinraApiFetch(env: FinraAdapterEnv): ApiFetchFn {
    return async (request) => {
        let path = request.path;

        // /short-interest -> FINRA Consolidated Short Interest endpoint
        if (path === "/short-interest" || path.startsWith("/short-interest?") || path.startsWith("/short-interest/")) {
            const subPath = path.replace("/short-interest", "");
            path = `/data/group/otcMarket/name/consolidatedShortInterest${subPath}`;
        }
        // /short-volume -> Reg SHO Daily Short Sale Volume
        else if (path === "/short-volume" || path.startsWith("/short-volume?") || path.startsWith("/short-volume/")) {
            const subPath = path.replace("/short-volume", "");
            path = `/data/group/OTCMarket/name/regShoDaily${subPath}`;
        }
        // /threshold-list -> Threshold securities
        else if (path === "/threshold-list" || path.startsWith("/threshold-list?") || path.startsWith("/threshold-list/")) {
            const subPath = path.replace("/threshold-list", "");
            path = `/data/group/otcMarket/name/thresholdList${subPath}`;
        }

        const response = await finraFetch(path, request.params, {
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
            const error = new Error(`HTTP ${response.status}: ${errorBody.slice(0, 200)}`) as Error & {
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
