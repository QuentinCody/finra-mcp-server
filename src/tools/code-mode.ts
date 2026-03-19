import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { finraCatalog } from "../spec/catalog";
import { createFinraApiFetch } from "../lib/api-adapter";

/** Minimal shape required from the worker Env for Code Mode registration. */
interface CodeModeEnv {
    FINRA_DATA_DO: Pick<Env["FINRA_DATA_DO"], "get" | "idFromName">;
    CODE_MODE_LOADER: Env["CODE_MODE_LOADER"];
    FINRA_CLIENT_ID?: string;
    FINRA_CLIENT_SECRET?: string;
}


export function registerCodeMode(
    server: McpServer,
    env: CodeModeEnv,
) {
    const apiFetch = createFinraApiFetch({
        FINRA_CLIENT_ID: env.FINRA_CLIENT_ID ?? "",
        FINRA_CLIENT_SECRET: env.FINRA_CLIENT_SECRET ?? "",
    });

    const searchTool = createSearchTool({
        prefix: "finra",
        catalog: finraCatalog,
    });
    searchTool.register(server as unknown as { tool: (...args: unknown[]) => void });

    const executeTool = createExecuteTool({
        prefix: "finra",
        catalog: finraCatalog,
        apiFetch,
        doNamespace: env.FINRA_DATA_DO,
        loader: env.CODE_MODE_LOADER,
    });
    executeTool.register(server as unknown as { tool: (...args: unknown[]) => void });
}
