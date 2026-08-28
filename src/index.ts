import { buildHealthResponse, configureCitationSigning } from "@bio-mcp/shared";
// FINRA MCP Server — short interest, daily short volume, Reg SHO thresholds
// Code Mode only: finra_search, finra_execute, query_data, get_schema
// The otcMarket dataset group is anonymous-public; FINRA_CLIENT_ID/SECRET are optional (see src/lib/http.ts)
import { StatelessMcpWorker } from "@bio-mcp/shared/mcp";
import { McpServer } from "@bio-mcp/shared/mcp";
import { registerQueryData } from "./tools/query-data";
import { registerGetSchema } from "./tools/get-schema";
import { registerCodeMode } from "./tools/code-mode";
import { FinraDataDO } from "./do";

export { FinraDataDO };

export class MyMCP extends StatelessMcpWorker<Env> {
	server = new McpServer({
		name: "finra",
		version: "0.1.0",
	});

	async init() {

		configureCitationSigning(this.env);
		const env = this.env;
		registerQueryData(this.server, env);
		registerGetSchema(this.server, env);
		registerCodeMode(this.server, env);
	}
}

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);

		if (url.pathname === "/health") {
			return buildHealthResponse("finra");
		}

		if (url.pathname === "/mcp") {
			return MyMCP.serve("/mcp").fetch(
				request,
				env,
				ctx,
			);
		}

		return new Response("Not found", { status: 404 });
	},
};
