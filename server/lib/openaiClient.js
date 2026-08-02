export async function chatWithTools({ messages, tools }) {
  if (process.env.AGENT_MODE !== "openai") return mockToolChoice(messages, tools);
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages,
      tools: tools.map(toOpenAiTool),
      tool_choice: "auto"
    })
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function toOpenAiTool(tool) {
  return {
    type: "function",
    function: {
      name: tool.id.replaceAll(".", "__"),
      description: tool.description || tool.name,
      parameters: tool.inputSchema || { type: "object", properties: {} }
    }
  };
}

function mockToolChoice(messages, tools) {
  const last = messages.at(-1)?.content ?? "";
  const noteTool = tools.find((tool) => tool.id.endsWith(".notes.create")) || tools[0];
  const listTool = tools.find((tool) => tool.id.endsWith(".notes.list"));
  const wantsList = /list|show|all/i.test(last) && listTool;
  const tool = wantsList ? listTool : noteTool;
  return {
    usage: { prompt_tokens: 120, completion_tokens: 35, total_tokens: 155 },
    choices: [{
      message: {
        role: "assistant",
        content: null,
        tool_calls: tool ? [{
          id: crypto.randomUUID(),
          type: "function",
          function: {
            name: tool.id.replaceAll(".", "__"),
            arguments: JSON.stringify(wantsList ? {} : { title: "Agent note", body: last || "Created by guarded agent" })
          }
        }] : []
      }
    }]
  };
}
