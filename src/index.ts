// FINRA MCP Server
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerQueryData } from "./tools/query-data";
import { registerGetSchema } from "./tools/get-schema";
import { registerCodeMode } from "./tools/code-mode";
import { FinraDataDO } from "./do";

export { FinraDataDO };

export class MyMCP extends McpAgent<Env> {
	server = new McpServer({
		name: "finra",
		version: "0.1.0",
	});

	async init() {
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
			return new Response("ok", {
				status: 200,
				headers: { "content-type": "text/plain" },
			});
		}

		if (url.pathname === "/mcp") {
			return MyMCP.serve("/mcp", { binding: "MCP_OBJECT" }).fetch(
				request,
				env,
				ctx,
			);
		}

		return new Response("Not found", { status: 404 });
	},
};
