type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
type Message = { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string };

const toolDescriptions = {
  watering_plan: "Get exact demo watering estimates for the current farm under both weather scenarios.",
  avalanche_block: "Read the latest block number on the configured Avalanche C-Chain.",
  binance_price: "Read the public Binance AVAX/USDT spot price. Use only for requested market data.",
};

async function readTool(name: string, plan: unknown, signal: AbortSignal) {
  try {
    if (name === "watering_plan") return plan;
    if (name === "avalanche_block") {
      const response = await fetch(process.env.AVALANCHE_RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal,
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }),
      });
      const data = await response.json();
      if (!response.ok || typeof data.result !== "string" || !/^0x[0-9a-f]+$/i.test(data.result)) throw new Error();
      return { source: "Avalanche C-Chain", block: BigInt(data.result).toString() };
    }
    if (name === "binance_price") {
      const response = await fetch("https://data-api.binance.vision/api/v3/ticker/price?symbol=AVAXUSDT", { signal });
      const data = await response.json();
      if (!response.ok || data.symbol !== "AVAXUSDT" || typeof data.price !== "string" || !/^\d+(\.\d+)?$/.test(data.price)) throw new Error();
      return { source: "Binance Spot", symbol: data.symbol, price: data.price, receivedAt: new Date().toISOString() };
    }
    return { error: "Unknown tool." };
  } catch {
    return { error: `${name} is currently unavailable.` };
  }
}

async function trace(start: string, model: string, tools: string[], requests: number, successful: boolean) {
  const key = process.env.LANGSMITH_API_KEY;
  if (!key || process.env.LANGSMITH_TRACING !== "true") return;
  try {
    const base = (process.env.LANGSMITH_ENDPOINT || "https://api.smith.langchain.com").replace(/\/$/, "");
    const response = await fetch(`${base}/runs`, {
      method: "POST", signal: AbortSignal.timeout(2000),
      headers: { "Content-Type": "application/json", "x-api-key": key,
        ...(process.env.LANGSMITH_WORKSPACE_ID ? { "x-tenant-id": process.env.LANGSMITH_WORKSPACE_ID } : {}) },
      body: JSON.stringify({
        id: crypto.randomUUID(), name: "WaterWise agent", run_type: "chain",
        session_name: process.env.LANGSMITH_PROJECT || "waterwise",
        start_time: start, end_time: new Date().toISOString(),
        inputs: { model }, outputs: { tools, requests, successful },
        ...(successful ? {} : { error: "Groq request or tool loop failed" }),
      }),
    });
    if (!response.ok) console.warn("WaterWise LangSmith trace rejected", response.status);
  } catch {
    console.warn("WaterWise LangSmith trace unavailable");
  }
}

export async function runAgent(question: string, plan: unknown) {
  const start = new Date().toISOString();
  const signal = AbortSignal.timeout(20000);
  const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
  const tools = Object.entries(toolDescriptions).map(([name, description]) => ({
    type: "function", function: { name, description, parameters: { type: "object", properties: {}, additionalProperties: false } },
  }));
  const messages: Message[] = [
    { role: "system", content: "You are WaterWise, a BACISS demo assistant for small-scale farmers in South Africa. Use watering_plan for every question about watering, clearly call the input demo data, and explain the results in plain English. For Avalanche or Binance facts from the live APIs, use the relevant tools and report unavailable data honestly. Keep answers concise. Do not give investment recommendations. You can only read data." },
    { role: "user", content: question },
  ];
  const called: string[] = [];
  const results = new Map<string, unknown>();
  let successful = false;
  let requests = 0;
  try {
    for (let step = 0; step < 4; step++) {
      requests++;
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST", signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
        body: JSON.stringify({ model, messages, tools, tool_choice: step === 3 ? "none" : "auto", max_completion_tokens: 600 }),
      });
      if (!response.ok) throw new Error("Groq request failed");
      const message = (await response.json()).choices?.[0]?.message as Message | undefined;
      if (!message) throw new Error("Groq response was empty");
      const calls = message.tool_calls ?? [];
      if (!calls.length && message.content?.trim()) {
        successful = true;
        return { answer: message.content.trim(), tools: called };
      }
      if (!calls.length || calls.length > 3 || step === 3) break;
      messages.push({ role: "assistant", content: message.content ?? null, tool_calls: calls });
      for (const call of calls) {
        const name = call.function.name;
        if (!results.has(name)) {
          if (Object.hasOwn(toolDescriptions, name)) called.push(name);
          results.set(name, await readTool(name, plan, signal));
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(results.get(name)) });
      }
    }
    throw new Error("Agent did not finish");
  } finally {
    await trace(start, model, called, requests, successful);
  }
}
