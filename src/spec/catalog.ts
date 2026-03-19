import type { ApiCatalog } from "@bio-mcp/shared/codemode/catalog";

export const finraCatalog: ApiCatalog = {
    name: "FINRA Short Interest & Market Data",
    baseUrl: "https://api.finra.org",
    version: "1.0",
    auth: "oauth2",
    endpointCount: 3,
    notes:
        "AUTH: OAuth 2.0 client credentials. Requires FINRA_CLIENT_ID and FINRA_CLIENT_SECRET env vars.\n" +
        "- Token endpoint: https://ews.fip.finra.org/fip/rest/ews/oauth2/access_token\n" +
        "- Rate limit: 1,200 req/min (sync), 20 req/min (async)\n" +
        "- Code Mode paths: use /short-interest, /short-volume, /threshold-list (mapped to FINRA data API paths)\n" +
        "- Responses are JSON arrays of objects; pagination via offset/limit params\n" +
        "- symbolCode identifies securities (e.g., 'AAPL', 'TSLA')",
    endpoints: [
        {
            method: "GET",
            path: "/short-interest",
            summary: "Consolidated Short Interest data — biweekly short position reports for OTC and exchange-listed securities",
            category: "short-interest",
            queryParams: [
                { name: "symbolCode", type: "string", required: false, description: "Security symbol (e.g., 'AAPL')" },
                { name: "settlementDate", type: "string", required: false, description: "Settlement date (YYYY-MM-DD)" },
                { name: "marketClassCode", type: "string", required: false, description: "Market class code filter" },
                { name: "offset", type: "number", required: false, description: "Pagination offset" },
                { name: "limit", type: "number", required: false, description: "Number of records to return" },
            ],
        },
        {
            method: "GET",
            path: "/short-volume",
            summary: "Reg SHO Daily Short Sale Volume — daily short sale volume by security and market",
            category: "short-volume",
            queryParams: [
                { name: "symbolCode", type: "string", required: false, description: "Security symbol" },
                { name: "tradeReportDate", type: "string", required: false, description: "Trade report date (YYYY-MM-DD)" },
                { name: "marketCode", type: "string", required: false, description: "Market code filter" },
                { name: "offset", type: "number", required: false, description: "Pagination offset" },
                { name: "limit", type: "number", required: false, description: "Number of records to return" },
            ],
        },
        {
            method: "GET",
            path: "/threshold-list",
            summary: "Threshold Securities List — securities with persistent fails to deliver under Reg SHO",
            category: "threshold-list",
            queryParams: [
                { name: "symbolCode", type: "string", required: false, description: "Security symbol" },
                { name: "effectiveDate", type: "string", required: false, description: "Effective date (YYYY-MM-DD)" },
                { name: "offset", type: "number", required: false, description: "Pagination offset" },
                { name: "limit", type: "number", required: false, description: "Number of records to return" },
            ],
        },
    ],
};
