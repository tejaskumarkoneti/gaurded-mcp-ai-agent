import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";

export class McpStdioClient extends EventEmitter {
  constructor(server) {
    super();
    this.server = server;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = "";
  }

  start() {
    this.proc = spawn(this.server.command, this.server.args ?? [], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.proc.stdout.on("data", (chunk) => this.onData(chunk));
    this.proc.stderr.on("data", (chunk) => this.emit("stderr", chunk.toString()));
    this.proc.on("exit", (code) => {
      for (const { reject } of this.pending.values()) reject(new Error(`MCP server exited with code ${code}`));
      this.pending.clear();
      this.emit("exit", code);
    });
  }

  onData(chunk) {
    this.buffer += chunk.toString();
    let newline = this.buffer.indexOf("\n");
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.onMessage(JSON.parse(line));
      newline = this.buffer.indexOf("\n");
    }
  }

  onMessage(message) {
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message));
    else pending.resolve(message.result);
  }

  request(method, params = {}, timeoutMs = 15000) {
    const id = this.nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };
    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    this.proc.stdin.write(`${JSON.stringify(payload)}\n`);
    return promise;
  }

  async initialize() {
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "guarded-ai-agent", version: "1.0.0" }
    });
    return this.request("tools/list");
  }

  callTool(name, args) {
    return this.request("tools/call", { name, arguments: args });
  }
}

export class McpRegistry {
  constructor(configs, logger) {
    this.configs = configs.filter((server) => server.enabled);
    this.logger = logger;
    this.clients = new Map();
    this.tools = new Map();
  }

  async start() {
    for (const server of this.configs) {
      const client = new McpStdioClient(server);
      client.on("stderr", (text) => this.logger?.("mcp.stderr", { serverId: server.id, text }));
      client.start();
      this.clients.set(server.id, client);
      try {
        const result = await client.initialize();
        for (const tool of result.tools ?? []) {
          const id = `${server.id}.${tool.name}`;
          this.tools.set(id, { ...tool, id, serverId: server.id, toolName: tool.name });
        }
        this.logger?.("mcp.discovered", { serverId: server.id, tools: [...this.tools.keys()].filter((id) => id.startsWith(`${server.id}.`)) });
      } catch (error) {
        this.logger?.("mcp.discovery_failed", { serverId: server.id, error: error.message });
      }
    }
  }

  listTools() {
    return [...this.tools.values()];
  }

  async call(toolId, args) {
    const tool = this.tools.get(toolId);
    if (!tool) throw new Error(`Unknown tool: ${toolId}`);
    return this.clients.get(tool.serverId).callTool(tool.toolName, args);
  }
}
