import "dotenv/config";
import cors from "cors";
import express from "express";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { WebSocketServer } from "ws";
import { Agent } from "./lib/agent.js";
import { McpRegistry } from "./lib/mcpClient.js";
import { PolicyEngine } from "./lib/policyEngine.js";
import { ApprovalStore, JsonStore, LogStore } from "./lib/stores.js";

const root = process.cwd();
const dataDir = join(root, "server", "data");
const policies = new JsonStore(join(dataDir, "policies.json"), defaultPolicies());
const logs = new LogStore(join(dataDir, "logs.json"));
const approvals = new ApprovalStore(join(dataDir, "approvals.json"));
const policy = new PolicyEngine(policies);
const config = JSON.parse(await readFile(join(root, "server", "config", "mcpServers.json"), "utf8"));
const mcp = new McpRegistry(config, (type, payload) => logs.append(type, payload));
await policies.get();
policies.watch();
await mcp.start();
const agent = new Agent({ mcp, policy, approvals, logs });

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true, tools: mcp.listTools().length }));
app.get("/api/tools", (_req, res) => res.json(mcp.listTools()));
app.get("/api/policies", async (_req, res) => res.json(await policies.get()));
app.post("/api/policies", async (req, res) => {
  const current = await policies.get();
  const rule = { id: crypto.randomUUID(), enabled: true, ...req.body };
  const next = [rule, ...current];
  await policies.set(next);
  broadcast({ type: "policies.changed", policies: next });
  res.status(201).json(rule);
});
app.patch("/api/policies/:id", async (req, res) => {
  const next = (await policies.get()).map((rule) => rule.id === req.params.id ? { ...rule, ...req.body } : rule);
  await policies.set(next);
  broadcast({ type: "policies.changed", policies: next });
  res.json(next.find((rule) => rule.id === req.params.id));
});
app.delete("/api/policies/:id", async (req, res) => {
  const next = (await policies.get()).filter((rule) => rule.id !== req.params.id);
  await policies.set(next);
  broadcast({ type: "policies.changed", policies: next });
  res.status(204).end();
});
app.post("/api/agent/run", async (req, res) => {
  try {
    const result = await agent.run(req.body.prompt || "");
    broadcast({ type: "logs.changed" });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.get("/api/logs", async (_req, res) => res.json(await logs.list()));
app.get("/api/approvals", async (_req, res) => res.json(await approvals.list()));
app.post("/api/approvals/:id/:status", async (req, res) => {
  if (!["approved", "denied"].includes(req.params.status)) return res.status(400).json({ error: "Invalid status" });
  const row = await approvals.resolve(req.params.id, req.params.status);
  await logs.append("approval.resolved", { approvalId: req.params.id, status: req.params.status });
  broadcast({ type: "approvals.changed" });
  res.json(row);
});

const port = Number(process.env.PORT || 4100);
const server = app.listen(port, () => console.log(`API listening on http://127.0.0.1:${port}`));
const wss = new WebSocketServer({ server });
function broadcast(payload) {
  const text = JSON.stringify(payload);
  for (const client of wss.clients) if (client.readyState === 1) client.send(text);
}

function defaultPolicies() {
  return [
    {
      id: "default-prompt-injection",
      name: "Deny prompt injection content",
      type: "deny_prompt_injection",
      toolId: "*",
      enabled: true,
      reason: "External policy blocks attempts to bypass instructions"
    },
    {
      id: "notes-delete-approval",
      name: "Approve destructive note deletion",
      type: "approval",
      toolId: "notes.notes.delete",
      enabled: true,
      reason: "Deleting records requires admin approval"
    }
  ];
}
