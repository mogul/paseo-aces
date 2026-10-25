import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";

export interface McpHandlers {
  listTeammates: () => { id: string; name: string }[];
  appendMemory: (teammate: string, text: string) => void;
  readMemory: (teammate: string, days?: number) => string;
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
}

const TOOLS = [
  {
    name: "teammate_list",
    description: "List the teammates.",
    inputSchema: { type: "object", properties: {} },
  },
  // IMPORTANT: Do not add teammate create/update/delete tools here. Editing a
  // teammate is a human-only operation exposed via plugin RPC (see
  // shared/contracts.ts). Exposing an edit tool here would let a teammate modify
  // itself or other teammates.
  {
    name: "teammate_memory_append",
    description: "Append a note to a teammate's memory.",
    inputSchema: {
      type: "object",
      properties: { teammate: { type: "string" }, text: { type: "string" } },
      required: ["teammate", "text"],
    },
  },
  {
    name: "teammate_memory_read",
    description: "Read a teammate's recent memory.",
    inputSchema: {
      type: "object",
      properties: { teammate: { type: "string" }, days: { type: "number" } },
      required: ["teammate"],
    },
  },
];

function mcpPortFile(): string {
  const base = process.env.PASEO_HOME || join(homedir(), ".paseo");
  return join(base, "aces", "teammates-mcp-port.json");
}

function readPersistedPort(): number {
  try {
    if (existsSync(mcpPortFile())) {
      const value = JSON.parse(readFileSync(mcpPortFile(), "utf8")) as unknown;
      return typeof value === "number" && value > 0 ? value : 0;
    }
  } catch {
    // ignore
  }
  return 0;
}

function persistPort(port: number): void {
  try {
    const base = process.env.PASEO_HOME || join(homedir(), ".paseo");
    mkdirSync(join(base, "aces"), { recursive: true });
    writeFileSync(mcpPortFile(), JSON.stringify(port), "utf8");
  } catch {
    // ignore
  }
}

export class McpServer {
  private server: Server | null = null;
  private port = 0;
  private handlers: McpHandlers | null = null;

  attachHandlers(handlers: McpHandlers): void {
    this.handlers = handlers;
  }

  start(): void {
    if (this.server) return;
    this.listenOn(readPersistedPort() || 0);
  }

  private listenOn(port: number): void {
    const server = createServer((req, res) => {
      void this.handleRequest(req, res);
    });
    this.server = server;
    const onError = (err: Error) => {
      if (port !== 0 && (err as { code?: string }).code === "EADDRINUSE") {
        this.server = null;
        this.listenOn(0);
      } else {
        console.error("[aces-teammates] MCP server failed to listen:", err);
      }
    };
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", onError);
      const address = server.address();
      if (address && typeof address === "object") {
        this.port = address.port;
        persistPort(this.port);
      }
      console.log(`[aces-teammates] MCP server listening at ${this.url()}`);
    });
  }

  url(): string {
    return "http://127.0.0.1:" + this.port + "/mcp";
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
      this.port = 0;
    }
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "POST" || req.url !== "/mcp") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32601, message: "Not found" } }));
      return;
    }

    let message: JsonRpcRequest;
    try {
      message = JSON.parse(await readBody(req)) as JsonRpcRequest;
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }));
      return;
    }

    if (message.id === undefined || message.id === null) {
      res.writeHead(202);
      res.end();
      return;
    }

    const id = message.id;
    const method = message.method ?? "";
    const params = message.params ?? {};

    switch (method) {
      case "initialize":
        this.respond(res, id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "aces-teammates", version: "0.1.0" },
        });
        return;
      case "tools/list":
        this.respond(res, id, { tools: TOOLS });
        return;
      case "tools/call":
        await this.handleToolCall(res, id, params);
        return;
      default:
        this.respondError(res, id, -32601, "Method not found: " + method);
        return;
    }
  }

  private async handleToolCall(res: ServerResponse, id: string | number, params: JsonRpcRequest["params"]): Promise<void> {
    const handlers = this.handlers;
    if (!handlers) {
      this.toolError(res, id, new Error("MCP handlers are not attached."));
      return;
    }

    const name = params?.name;
    const args = params?.arguments ?? {};

    if (name === "teammate_list") {
      try {
        this.toolResult(res, id, { teammates: handlers.listTeammates() });
      } catch (error) {
        this.toolError(res, id, error);
      }
      return;
    }

    if (name === "teammate_memory_append") {
      const teammate = args.teammate;
      const text = args.text;
      if (typeof teammate !== "string" || typeof text !== "string") {
        this.toolError(res, id, new Error("teammate and text are required string arguments."));
        return;
      }
      try {
        handlers.appendMemory(teammate, text);
        this.toolResult(res, id, { ok: true });
      } catch (error) {
        this.toolError(res, id, error);
      }
      return;
    }

    if (name === "teammate_memory_read") {
      const teammate = args.teammate;
      if (typeof teammate !== "string") {
        this.toolError(res, id, new Error("teammate is a required string argument."));
        return;
      }
      const days = typeof args.days === "number" ? args.days : undefined;
      try {
        this.toolResult(res, id, { memory: handlers.readMemory(teammate, days) });
      } catch (error) {
        this.toolError(res, id, error);
      }
      return;
    }

    this.toolError(res, id, new Error("Unknown tool: " + String(name)));
  }

  private respond(res: ServerResponse, id: string | number, result: unknown): void {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
  }

  private respondError(res: ServerResponse, id: string | number | null, code: number, message: string): void {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }));
  }

  private toolResult(res: ServerResponse, id: string | number, data: unknown): void {
    this.respond(res, id, {
      content: [{ type: "text", text: JSON.stringify(data) }],
      isError: false,
    });
  }

  private toolError(res: ServerResponse, id: string | number, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.respond(res, id, {
      content: [{ type: "text", text: message }],
      isError: true,
    });
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
