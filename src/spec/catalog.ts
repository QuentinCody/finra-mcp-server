import type { ApiCatalog, ApiEndpoint } from "@bio-mcp/shared/codemode/catalog";

/**
 * The `otcMarket` dataset group. FINRA serves every one of these with no
 * credential at all — verified live 2026-08-27, HTTP 200 with no Authorization
 * header on each path below. `partitionKeys` come from the (also anonymous)
 * /metadata/group/otcMarket/name/{dataset} endpoint and matter because FINRA
 * rejects a sort unless every partition key carries an EQUAL compareFilter.
 */
interface FinraDataset {
    /** Friendly Code Mode path (mapped in src/lib/api-adapter.ts). */
    alias: string;
    /** FINRA dataset name, for /metadata lookups and error messages. */
    dataset: string;
    category: string;
    summary: string;
    partitionKeys: string[];
    /** A real field of this dataset, used in the POST filter example. */
    filterField: string;
    filterValue: string;
    /** A few real response fields, so the model can write `fields` up front. */
    sampleFields: string[];
}

const DATASETS: FinraDataset[] = [
    {
        alias: "/short-interest",
        dataset: "consolidatedShortInterest",
        category: "short-interest",
        summary:
            "Consolidated Short Interest — biweekly short positions reported under FINRA Rule 4560, across OTC and exchange-listed securities",
        partitionKeys: ["settlementDate"],
        filterField: "symbolCode",
        filterValue: "AAPL",
        sampleFields: [
            "symbolCode",
            "issueName",
            "settlementDate",
            "currentShortPositionQuantity",
            "previousShortPositionQuantity",
            "averageDailyVolumeQuantity",
            "daysToCoverQuantity",
            "marketClassCode",
        ],
    },
    {
        alias: "/short-volume",
        dataset: "regShoDaily",
        category: "short-volume",
        summary: "Reg SHO Daily Short Sale Volume — daily short and short-exempt volume by security and market",
        partitionKeys: ["tradeReportDate"],
        filterField: "securitiesInformationProcessorSymbolIdentifier",
        filterValue: "AAPL",
        sampleFields: [
            "securitiesInformationProcessorSymbolIdentifier",
            "tradeReportDate",
            "marketCode",
            "reportingFacilityCode",
            "shortParQuantity",
            "shortExemptParQuantity",
            "totalParQuantity",
        ],
    },
    {
        alias: "/threshold-list",
        dataset: "thresholdList",
        category: "threshold-list",
        summary: "Threshold Securities List — securities with persistent fails to deliver under Reg SHO",
        partitionKeys: ["tradeDate"],
        filterField: "issueSymbolIdentifier",
        filterValue: "AACAY",
        sampleFields: [
            "issueSymbolIdentifier",
            "issueName",
            "tradeDate",
            "marketClassCode",
            "marketCategoryDescription",
            "regShoThresholdFlag",
            "thresholdListFlag",
            "rule4320Flag",
        ],
    },
    {
        alias: "/weekly-summary",
        dataset: "weeklySummary",
        category: "ats-summary",
        summary:
            "ATS Weekly Summary — weekly share and trade counts per alternative trading system (MPID) and security tier",
        partitionKeys: ["weekStartDate", "tierIdentifier"],
        filterField: "issueSymbolIdentifier",
        filterValue: "AAPL",
        sampleFields: [
            "issueSymbolIdentifier",
            "issueName",
            "weekStartDate",
            "tierIdentifier",
            "MPID",
            "marketParticipantName",
            "totalWeeklyShareQuantity",
            "totalWeeklyTradeCount",
        ],
    },
    {
        alias: "/monthly-summary",
        dataset: "monthlySummary",
        category: "ats-summary",
        summary: "ATS Monthly Summary — monthly share and trade counts per alternative trading system and security tier",
        partitionKeys: ["monthStartDate", "tierIdentifier"],
        filterField: "issueSymbolIdentifier",
        filterValue: "AAPL",
        sampleFields: [
            "issueSymbolIdentifier",
            "issueName",
            "monthStartDate",
            "tierIdentifier",
            "marketParticipantName",
            "totalMonthlyShareQuantity",
            "totalMonthlyTradeCount",
            "totalNotionalSum",
        ],
    },
    {
        alias: "/blocks-summary",
        dataset: "blocksSummary",
        category: "block-trading",
        summary: "ATS Blocks Summary — monthly block-trade share, percentage and rank per alternative trading system",
        partitionKeys: ["monthStartDate"],
        filterField: "MPID",
        filterValue: "UBSA",
        sampleFields: [
            "MPID",
            "marketParticipantName",
            "monthStartDate",
            "ATSBlockCount",
            "ATSBlockQuantity",
            "ATSBlockSharePercent",
            "averageBlockSize",
            "totalShareQuantity",
        ],
    },
    {
        alias: "/otc-blocks-summary",
        dataset: "otcBlocksSummary",
        category: "block-trading",
        summary: "OTC (non-ATS) Blocks Summary — monthly block-trade share, percentage and rank per OTC firm",
        partitionKeys: ["monthStartDate"],
        filterField: "crdFirmName",
        filterValue: "CITADEL SECURITIES LLC",
        sampleFields: [
            "crdFirmName",
            "monthStartDate",
            "OTCBlockCount",
            "OTCBlockQuantity",
            "OTCBlockSharePercent",
            "averageBlockSize",
            "totalShareQuantity",
            "totalTradeCount",
        ],
    },
    {
        alias: "/otc-daily-list",
        dataset: "otcDailyList",
        category: "corporate-actions",
        summary:
            "OTC Daily List — daily corporate actions on OTC equities: symbol changes, splits, dividends, additions and deletions",
        partitionKeys: ["calendarDay"],
        filterField: "dailyListEventCode",
        filterValue: "SC",
        sampleFields: [
            "calendarDay",
            "dailyListEventCode",
            "dailyListReasonDescription",
            "oldSymbolCode",
            "newSymbolCode",
            "newSecurityDescription",
            "exDate",
            "paymentDate",
        ],
    },
];

function browseEndpoint(ds: FinraDataset): ApiEndpoint {
    return {
        method: "GET",
        path: ds.alias,
        summary: `${ds.summary} — unfiltered browse (only limit/offset are honored on GET)`,
        category: ds.category,
        queryParams: [
            { name: "limit", type: "number", required: false, description: "Rows to return (max 5000)" },
            { name: "offset", type: "number", required: false, description: "Pagination offset" },
        ],
        responseShape: `Array<{ ${ds.sampleFields.join(", ")}, ... }>`,
        example: `const rows = await api.get('${ds.alias}', { limit: 10 });`,
        usageHint:
            `Returns the first rows of ${ds.dataset} in storage order — NOT the newest rows. ` +
            "Any other query param (a symbol, a date) is silently ignored and you get this same unfiltered page back, " +
            `so use the POST form on ${ds.alias} to filter.`,
        featured: ds.alias === "/short-interest",
    };
}

function queryEndpoint(ds: FinraDataset): ApiEndpoint {
    const filter = `{ fieldName: '${ds.filterField}', fieldValue: '${ds.filterValue}', compareType: 'EQUAL' }`;
    return {
        method: "POST",
        path: ds.alias,
        summary: `${ds.summary} — filtered query (compareFilters / dateRangeFilters / fields)`,
        category: ds.category,
        body: {
            contentType: "application/json",
            description:
                "{ limit?, offset?, fields?: string[], compareFilters?: [{fieldName, fieldValue, compareType}], " +
                "domainFilters?: [{fieldName, values: string[]}], dateRangeFilters?: [{fieldName, startDate, endDate}], sortFields?: string[] }",
        },
        responseShape: `Array<{ ${ds.sampleFields.join(", ")}, ... }>`,
        example:
            `const rows = await api.post('${ds.alias}', {\n` +
            "  limit: 25,\n" +
            `  fields: ${JSON.stringify(ds.sampleFields.slice(0, 4))},\n` +
            `  compareFilters: [${filter}],\n` +
            "});",
        usageHint:
            `Partition keys: ${ds.partitionKeys.join(", ")}. ` +
            "sortFields is rejected with HTTP 400 unless every partition key has an EQUAL compareFilter, " +
            "so page with limit/offset instead of sorting. " +
            `Discover the full field list with api.get('/metadata/${ds.dataset}').`,
        featured: ds.alias === "/short-interest",
    };
}

const endpoints: ApiEndpoint[] = [
    ...DATASETS.flatMap((ds) => [browseEndpoint(ds), queryEndpoint(ds)]),
    {
        method: "GET",
        path: "/metadata/{datasetName}",
        summary: "Dataset metadata — description, partition keys and record counts for one otcMarket dataset",
        category: "metadata",
        pathParams: [
            {
                name: "datasetName",
                type: "string",
                required: true,
                description: `FINRA dataset name: ${DATASETS.map((d) => d.dataset).join(", ")}`,
            },
        ],
        responseShape: "{ datasetGroup, datasetName, description, partitionFields: string[] }",
        example: "const meta = await api.get('/metadata/consolidatedShortInterest');",
        usageHint: "Anonymous, like the data endpoints. Use it before writing compareFilters to confirm field names.",
    },
];

export const finraCatalog: ApiCatalog = {
    name: "FINRA Short Interest & Market Data",
    baseUrl: "https://api.finra.org",
    version: "1.0",
    auth: "none",
    endpointCount: endpoints.length,
    notes:
        "AUTH: none. Every dataset below is in FINRA's `otcMarket` group, which is served anonymously\n" +
        "(verified 2026-08-27 by direct request with no Authorization header). FINRA_CLIENT_ID and\n" +
        "FINRA_CLIENT_SECRET are optional; when set, a bearer token is attached, which unlocks nothing here\n" +
        "but is required for the gated groups (fixedIncomeMarket, equityMarket, firmMargin, regulatoryFilings).\n" +
        "\n" +
        "FILTERING — the one quirk that matters:\n" +
        "- GET honors ONLY `limit` and `offset`. Every other query param is SILENTLY IGNORED: FINRA returns\n" +
        "  HTTP 200 with the same unfiltered first page, which reads as a plausible but wrong answer.\n" +
        "  `api.get('/short-interest', { symbolCode: 'AAPL' })` returns Agilent, not Apple.\n" +
        "- Real filtering is POST with a JSON body:\n" +
        "    api.post('/short-interest', {\n" +
        "      limit: 25,\n" +
        "      fields: ['symbolCode', 'issueName', 'settlementDate', 'currentShortPositionQuantity'],\n" +
        "      compareFilters: [{ fieldName: 'symbolCode', fieldValue: 'AAPL', compareType: 'EQUAL' }],\n" +
        "      dateRangeFilters: [{ fieldName: 'settlementDate', startDate: '2024-01-01', endDate: '2024-12-31' }],\n" +
        "    })\n" +
        "- compareType: EQUAL, NOT_EQUAL, GT, LT, GTE, LTE. domainFilters take {fieldName, values: [...]} for IN.\n" +
        "- Dates are yyyy-MM-dd (or 'yyyy-MM-dd HH:mm:ss.SSS'); range ends are inclusive.\n" +
        "- sortFields returns HTTP 400 unless EVERY partition key of the dataset is pinned by an EQUAL\n" +
        "  compareFilter. Page with limit/offset instead.\n" +
        "\n" +
        "OTHER CONVENTIONS:\n" +
        "- Responses are JSON arrays of objects; an empty array is a real 200, not an error.\n" +
        "- limit maxes out at 5000 per request; the response payload cap is 3 MB.\n" +
        "- Rate limits: 1,200 synchronous requests/min per IP; 20 async requests/min per dataset per account.\n" +
        "- Code Mode paths map to FINRA dataset names: /short-interest, /short-volume, /threshold-list,\n" +
        "  /weekly-summary, /monthly-summary, /blocks-summary, /otc-blocks-summary, /otc-daily-list,\n" +
        "  plus /metadata/{datasetName}. A raw /data/group/{group}/name/{dataset} path also passes through.\n" +
        "- Symbol field names differ per dataset: symbolCode (short interest),\n" +
        "  securitiesInformationProcessorSymbolIdentifier (Reg SHO daily), issueSymbolIdentifier (the rest).",
    endpoints,
};
