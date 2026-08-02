import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const file = join(process.cwd(), "server", "data", "notes.json");
let buffer = "";

process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  let newline = buffer.indexOf("\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line) handle(JSON.parse(line));
    newline = buffer.indexOf("\n");
  }
});

async function handle(request) {
  try {
    if (request.method === "initialize") return send(request.id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "notes-mcp", version: "1.0.0" } });
    if (request.method === "tools/list") return send(request.id, { tools });
    if (request.method === "tools/call") return send(request.id, await callTool(request.params.name, request.params.arguments ?? {}));
    sendError(request.id, -32601, "Method not found");
  } catch (error) {
    sendError(request.id, -32000, error.message);
  }
}

const tools = [
  tool("notes.create", "Create a note", { title: string("Title"), body: string("Body") }, ["title", "body"]),
  tool("notes.list", "List notes", {}, []),
  tool("notes.get", "Get one note by id", { id: string("Note id") }, ["id"]),
  tool("notes.update", "Update a note by id", { id: string("Note id"), title: string("Title"), body: string("Body") }, ["id"]),
  tool("notes.delete", "Delete a note by id", { id: string("Note id") }, ["id"])
];

async function callTool(name, args) {
  const notes = await load();
  if (name === "notes.create") {
    const note = { id: crypto.randomUUID(), title: args.title, body: args.body, createdAt: new Date().toISOString() };
    notes.unshift(note);
    await save(notes);
    return content(note);
  }
  if (name === "notes.list") return content(notes);
  const note = notes.find((item) => item.id === args.id);
  if (!note) throw new Error(`Note not found: ${args.id}`);
  if (name === "notes.get") return content(note);
  if (name === "notes.update") {
    Object.assign(note, { title: args.title ?? note.title, body: args.body ?? note.body, updatedAt: new Date().toISOString() });
    await save(notes);
    return content(note);
  }
  if (name === "notes.delete") {
    await save(notes.filter((item) => item.id !== args.id));
    return content({ deleted: args.id });
  }
  throw new Error(`Unknown tool: ${name}`);
}

async function load() {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    await save([]);
    return [];
  }
}

async function save(notes) {
  await mkdir(join(process.cwd(), "server", "data"), { recursive: true });
  await writeFile(file, JSON.stringify(notes, null, 2));
}

function send(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

function sendError(id, code, message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } })}\n`);
}

function tool(name, description, properties, required) {
  return { name, description, inputSchema: { type: "object", properties, required, additionalProperties: false } };
}

function string(description) {
  return { type: "string", description, minLength: 1 };
}

function content(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}
