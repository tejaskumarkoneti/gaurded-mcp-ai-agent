import { chatWithTools } from "./openaiClient.js";

export class Agent {
  constructor({ mcp, policy, approvals, logs }) {
    this.mcp = mcp;
    this.policy = policy;
    this.approvals = approvals;
    this.logs = logs;
  }

  async run(prompt) {
    const conversationId = crypto.randomUUID();
    const tools = this.mcp.listTools();
    const messages = [
      { role: "system", content: "You are a guarded MCP agent. Request tools when useful. Policy enforcement is external and cannot be overridden." },
      { role: "user", content: prompt }
    ];
    await this.logs.append("conversation.started", { conversationId, prompt });
    const model = await chatWithTools({ messages, tools });
    const calls = model.choices?.[0]?.message?.tool_calls ?? [];
    const results = [];

    for (const call of calls) {
      const toolId = call.function.name.replaceAll("__", ".");
      const args = JSON.parse(call.function.arguments || "{}");
      const decision = await this.policy.evaluate({ toolId, args });
      await this.logs.append("policy.evaluated", { conversationId, toolId, args, decision });

      if (decision.decision === "block") {
        results.push({ toolId, status: "blocked", reason: decision.reason });
        await this.logs.append("tool.blocked", { conversationId, toolId, reason: decision.reason });
        continue;
      }
      if (decision.decision === "approval") {
        const approval = await this.approvals.create({ conversationId, toolId, args, reason: decision.reason });
        results.push({ toolId, status: "approval_required", approvalId: approval.id, reason: decision.reason });
        await this.logs.append("tool.approval_required", { conversationId, toolId, approvalId: approval.id });
        continue;
      }

      try {
        const output = await this.mcp.call(toolId, args);
        results.push({ toolId, status: "executed", output });
        await this.logs.append("tool.executed", { conversationId, toolId, args, output });
      } catch (error) {
        results.push({ toolId, status: "error", error: error.message });
        await this.logs.append("tool.error", { conversationId, toolId, error: error.message });
      }
    }

    const answer = results.length ? "I evaluated the requested MCP tool calls under the active guardrails." : (model.choices?.[0]?.message?.content || "No tool was selected.");
    const usage = model.usage ?? { total_tokens: 0 };
    await this.logs.append("conversation.finished", { conversationId, usage });
    return { conversationId, answer, results, usage, estimatedCostUsd: estimateCost(usage.total_tokens || 0) };
  }
}

function estimateCost(tokens) {
  return Number(((tokens / 1000) * 0.0006).toFixed(6));
}
