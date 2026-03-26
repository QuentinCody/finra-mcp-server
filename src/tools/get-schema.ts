import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createGetSchemaHandler } from "@bio-mcp/shared/staging/utils";

interface GetSchemaArgs {
    [key: string]: unknown;
    data_access_id?: string;
}

export function registerGetSchema(server: McpServer, env?: { FINRA_DATA_DO?: unknown }): void {
    const handler = createGetSchemaHandler("FINRA_DATA_DO", "finra");

    server.registerTool(
        "finra_get_schema",
        {
            title: "Get Staged Data Schema",
            description:
                "Get schema information for staged FINRA data. Shows table structures and row counts. " +
                "If called without a data_access_id, lists all staged datasets available in this session.",
            inputSchema: {
                data_access_id: z.string().min(1).optional().describe(
                    "Data access ID for the staged dataset. If omitted, lists all staged datasets in this session.",
                ),
            },
        },
        async (args, extra) => {
            const resolvedEnv = env ?? (extra as { env?: { FINRA_DATA_DO?: unknown } })?.env ?? {};
            const envRecord: Record<string, unknown> = { FINRA_DATA_DO: resolvedEnv.FINRA_DATA_DO };
            const typedArgs: GetSchemaArgs = {
                data_access_id: (args as GetSchemaArgs).data_access_id,
            };
            return handler(
                typedArgs,
                envRecord,
                (extra as { sessionId?: string })?.sessionId,
            );
        },
    );
}
