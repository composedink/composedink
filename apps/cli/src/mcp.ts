import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { mcpRegistry } from "@composedink/core/node";
import { call, composedHome } from "./client.ts";
export async function mcp() {
  const server = new Server(
    { name: "composed", version: "0.0.0" },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: mcpRegistry.map(({ name, inputSchema }) => ({ name, inputSchema })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    try {
      const tool = mcpRegistry.find((t) => t.name === request.params.name);
      if (!tool) throw Error("Unknown operation");
      const result = await call(
        composedHome(),
        tool.operation,
        tool.parse(request.params.arguments ?? {}),
        false,
        { kind: "agent", name: "mcp" },
      );
      return { content: [{ type: "text" as const, text: JSON.stringify(result ?? null) }] };
    } catch (error) {
      return { isError: true, content: [{ type: "text" as const, text: String(error) }] };
    }
  });
  await server.connect(new StdioServerTransport());
}
