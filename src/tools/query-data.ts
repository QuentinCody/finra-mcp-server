import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createQueryDataHandler } from "@bio-mcp/shared/staging/utils";

interface QueryDataArgs {
    [key: string]: unknown;
    data_access_id: string;
    sql: string;
    limit?: number;
}

export function registerQueryData(server: McpServer, env?: { FINRA_DATA_DO?: unknown }): void {
    const handler = createQueryDataHandler("FINRA_DATA_DO", "finra");

    server.registerTool(
        "finra_query_data",
        {
            title: "Query Staged FINRA Data",
            description:
                "Query staged FINRA market data using SQL. Use this when responses are too large and have been staged with a data_access_id.",
            inputSchema: {
                data_access_id: z.string().min(1).describe("Data access ID for the staged dataset"),
                sql: z.string().min(1).describe("SQL query to execute against the staged data"),
                limit: z.number().int().positive().max(10000).default(100).optional().describe("Maximum number of rows to return (default: 100)"),
            },
        },
        async (args, extra) => {
            const resolvedEnv = env ?? (extra as { env?: { FINRA_DATA_DO?: unknown } })?.env ?? {};
            const envRecord: Record<string, unknown> = { FINRA_DATA_DO: resolvedEnv.FINRA_DATA_DO };
            const typedArgs: QueryDataArgs = {
                data_access_id: String((args as QueryDataArgs).data_access_id ?? ""),
                sql: String((args as QueryDataArgs).sql ?? ""),
                limit: (args as QueryDataArgs).limit,
            };
            return handler(typedArgs, envRecord);
        },
    );
}
