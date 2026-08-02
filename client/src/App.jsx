import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Bot, Check, Shield, Trash2, X } from "lucide-react";
import "./styles.css";

const apiBase = import.meta.env.VITE_API_URL || "http://127.0.0.1:4100";
const api = `${apiBase.replace(/\/$/, "")}/api`;
const wsUrl = apiBase.replace(/^http/, "ws").replace(/\/$/, "");

function App() {
  const [tools, setTools] = useState([]);
  const [policies, setPolicies] = useState([]);
  const [logs, setLogs] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [prompt, setPrompt] = useState("Create a note that says the policy layer is active.");
  const [result, setResult] = useState(null);
  const [form, setForm] = useState({ name: "", type: "block", toolId: "*", field: "", pattern: "^.*$" });

  async function refresh() {
    const [toolRows, policyRows, logRows, approvalRows] = await Promise.all([
      fetch(`${api}/tools`).then((r) => r.json()),
      fetch(`${api}/policies`).then((r) => r.json()),
      fetch(`${api}/logs`).then((r) => r.json()),
      fetch(`${api}/approvals`).then((r) => r.json())
    ]);
    setTools(toolRows);
    setPolicies(policyRows);
    setLogs(logRows);
    setApprovals(approvalRows);
  }

  useEffect(() => {
    refresh();
    const ws = new WebSocket(wsUrl);
    ws.onmessage = refresh;
    ws.onerror = () => ws.close();
    return () => ws.close();
  }, []);

  async function runAgent() {
    const response = await fetch(`${api}/agent/run`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt })
    });
    setResult(await response.json());
    refresh();
  }

  async function addPolicy(e) {
    e.preventDefault();
    await fetch(`${api}/policies`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form)
    });
    setForm({ ...form, name: "" });
    refresh();
  }

  const pending = approvals.filter((item) => item.status === "pending");
  const totalTokens = useMemo(() => logs.reduce((sum, row) => sum + (row.usage?.total_tokens || 0), 0), [logs]);

  return <main>
    <header>
      <div>
        <h1>Guarded MCP Agent</h1>
        <p>Live tool discovery, deterministic policy enforcement, and human approvals in one loop.</p>
      </div>
      <div className="metric"><Bot size={18} /> {tools.length} tools discovered</div>
      <div className="metric"><Shield size={18} /> {policies.filter((p) => p.enabled).length} active rules</div>
    </header>

    <section className="agent">
      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      <button onClick={runAgent}><Bot size={18} /> Run Agent</button>
      {result && <pre>{JSON.stringify(result, null, 2)}</pre>}
    </section>

    <div className="grid">
      <section>
        <h2>Guardrails</h2>
        <form onSubmit={addPolicy} className="rule-form">
          <input placeholder="Rule name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="block">Block tool</option>
            <option value="approval">Require approval</option>
            <option value="input_regex">Validate input</option>
            <option value="deny_prompt_injection">Deny prompt injection</option>
          </select>
          <select value={form.toolId} onChange={(e) => setForm({ ...form, toolId: e.target.value })}>
            <option value="*">All tools</option>
            {tools.map((tool) => <option key={tool.id} value={tool.id}>{tool.id}</option>)}
          </select>
          {form.type === "input_regex" && <>
            <input placeholder="Field" value={form.field} onChange={(e) => setForm({ ...form, field: e.target.value })} />
            <input placeholder="Regex" value={form.pattern} onChange={(e) => setForm({ ...form, pattern: e.target.value })} />
          </>}
          <button><Check size={16} /> Add Rule</button>
        </form>
        <div className="list">
          {policies.map((rule) => <article key={rule.id}>
            <div>
              <strong>{rule.name || rule.type}</strong>
              <span>{rule.type} - {rule.toolId}</span>
            </div>
            <button className={rule.enabled ? "toggle on" : "toggle"} onClick={() => updateRule(rule.id, { enabled: !rule.enabled })}>{rule.enabled ? "On" : "Off"}</button>
            <button className="icon" onClick={() => deleteRule(rule.id)}><Trash2 size={16} /></button>
          </article>)}
        </div>
      </section>

      <section>
        <h2>Discovered Tools</h2>
        <div className="list">
          {tools.map((tool) => <article key={tool.id}><div><strong>{tool.id}</strong><span>{tool.description}</span></div></article>)}
        </div>
      </section>

      <section>
        <h2>Approvals</h2>
        <div className="list">
          {(pending.length ? pending : approvals).map((item) => <article key={item.id}>
            <div><strong>{item.toolId}</strong><span>{item.status} - {item.reason}</span></div>
            {item.status === "pending" && <div className="actions">
              <button onClick={() => resolve(item.id, "approved")}><Check size={16} /></button>
              <button onClick={() => resolve(item.id, "denied")}><X size={16} /></button>
            </div>}
          </article>)}
        </div>
      </section>

      <section>
        <h2>Logs <small>{totalTokens} tokens</small></h2>
        <div className="log-list">
          {logs.slice(0, 30).map((row) => <pre key={row.id}>{JSON.stringify(row, null, 2)}</pre>)}
        </div>
      </section>
    </div>
  </main>;

  async function updateRule(id, patch) {
    await fetch(`${api}/policies/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
    refresh();
  }

  async function deleteRule(id) {
    await fetch(`${api}/policies/${id}`, { method: "DELETE" });
    refresh();
  }

  async function resolve(id, status) {
    await fetch(`${api}/approvals/${id}/${status}`, { method: "POST" });
    refresh();
  }
}

createRoot(document.getElementById("root")).render(<App />);



