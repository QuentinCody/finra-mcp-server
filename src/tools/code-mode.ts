import type { McpServer } from "@bio-mcp/shared/mcp";
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
): void {
    // Pass the secrets through as `string | undefined`. Coercing an unset
    // secret to "" is indistinguishable from a configured-but-empty one, and
    // it used to trip a pre-flight throw that stopped every anonymous call.
    const apiFetch = createFinraApiFetch({
        FINRA_CLIENT_ID: env.FINRA_CLIENT_ID,
        FINRA_CLIENT_SECRET: env.FINRA_CLIENT_SECRET,
    });

    const registrar = {tool: (...args: unknown[]) => {
        const [name, ...rest] = args;
        const register = server.tool.bind(server) as (...values: unknown[]) => void;
        register(name, ...rest); register(`mcp_${String(name)}`, ...rest);
    }};

    const searchTool = createSearchTool({
        prefix: "finra",
        catalog: finraCatalog,
    });
    searchTool.register(registrar);

    const executeTool = createExecuteTool({
        prefix: "finra",
        // Verifiable provenance: finra_execute results carry a _meta.citation.
        source: { id: "finra", name: "FINRA", url: "https://www.finra.org" },
        catalog: finraCatalog,
        apiFetch,
        maxInlineBytes: 30 * 1024,
        timeout: 90_000,
        doNamespace: env.FINRA_DATA_DO,
        loader: env.CODE_MODE_LOADER,
    });
    executeTool.register(registrar);
}
