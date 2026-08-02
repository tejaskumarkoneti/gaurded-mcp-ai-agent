export class PolicyEngine {
  constructor(store) {
    this.store = store;
  }

  async evaluate({ toolId, args }) {
    const rules = (await this.store.get()).filter((rule) => rule.enabled);
    const matching = rules.filter((rule) => rule.toolId === "*" || rule.toolId === toolId);

    for (const rule of matching.filter((rule) => rule.type === "block")) {
      return { decision: "block", rule, reason: rule.reason || "Tool is blocked by policy" };
    }

    for (const rule of matching.filter((rule) => rule.type === "input_regex")) {
      const value = String(args?.[rule.field] ?? "");
      if (!new RegExp(rule.pattern).test(value)) {
        return { decision: "block", rule, reason: `${rule.field} failed validation` };
      }
    }

    for (const rule of matching.filter((rule) => rule.type === "deny_prompt_injection")) {
      const text = JSON.stringify(args ?? {}).toLowerCase();
      if (/(ignore|bypass|override).{0,24}(policy|guardrail|instruction|rule)|system prompt|developer message/.test(text)) {
        return { decision: "block", rule, reason: "Input resembles a prompt-injection attempt" };
      }
    }

    const approval = matching.find((rule) => rule.type === "approval");
    if (approval) return { decision: "approval", rule: approval, reason: approval.reason || "Human approval required" };

    return { decision: "allow", reason: "No matching blocking policy" };
  }
}
