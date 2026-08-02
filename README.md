# Guarded AI Agent with MCP Support

Full-stack MERN-style app that runs an AI tool-use loop against live MCP servers with a policy layer between the model and every tool call.

## What is included

- Express backend hosting the agent loop
- React dashboard for guardrail rules, approvals, logs, and token/cost estimates
- Live policy store; dashboard changes affect the running agent immediately
- MCP stdio transport with runtime tool discovery
- Custom plug-and-play MCP server exposing notes CRUD/search tools
- Example config for an existing remote MCP server (`context7`) discovered the same way

## Quick Start

```bash
npm install
cp .env.example .env
npm run dev
```

Open:

- Dashboard: http://127.0.0.1:5173
- API health: http://127.0.0.1:4100/api/health

By default `AGENT_MODE=mock`, so the demo works without an LLM key. Set `AGENT_MODE=openai` and `OPENAI_API_KEY` to let the model choose tools itself.


## Deploy

Netlify should host the React dashboard only. Deploy the Express/MCP backend on a Node host such as Render, Railway, Fly.io, or an EC2/VPS because MCP stdio servers need a long-running Node process.

Netlify settings:

- Build command: `npm run build`
- Publish directory: `dist`
- Environment variable: `VITE_API_URL=https://your-backend-url`

Backend host settings:

- Start command: `npm start`
- Environment variables: `PORT`, `AGENT_MODE`, `OPENAI_API_KEY`, `OPENAI_MODEL`

If you enable Context7 in `server/config/mcpServers.json`, make sure the backend host allows `npx`/network startup or install that MCP package ahead of time.

## MCP Servers

Servers are configured in `server/config/mcpServers.json`. Tool lists are never hardcoded; the backend starts each server, calls `tools/list`, and registers whatever is returned.

The included custom server:

```bash
npm run mcp:notes
```

It exposes `notes.create`, `notes.list`, `notes.get`, `notes.update`, and `notes.delete`.

The sample remote existing server uses Context7 through `npx`. It can be enabled by setting `"enabled": true` in `server/config/mcpServers.json`; it requires network access the first time `npx` downloads the package.

## Guardrails

The dashboard supports:

- Blocking a tool entirely
- Requiring human approval
- Validating input fields with regex
- Denying prompt-injection-like input

Rules live in `server/data/policies.json`; the backend watches this file and also updates in memory when rules are changed through the dashboard.

## Edge Case Posture

- MCP server crash mid-call: the transport rejects the pending call, logs a tool error, and the agent receives an error observation instead of raw process failure.
- Prompt injection: policy is enforced outside the LLM loop. Even if the model asks to ignore rules, every tool call is checked by deterministic policy before execution.
- Conflicting rules: deny/block wins, then approval, then allow.
- Approval offline: approval requests expire as pending; the agent does not execute the tool until an admin approves.

