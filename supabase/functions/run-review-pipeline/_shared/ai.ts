// Lovable AI Gateway client. Every AI call in the pipeline goes through here
// so cost telemetry, billing-error handling, and tool-schema unwrapping live
// in one place.

import { LOVABLE_API_KEY } from "./env.ts";
import { recordCostMetric } from "./cost.ts";
import type { ChatMessage } from "./types.ts";

export async function callAI(
  messages: ChatMessage[],
  toolSchema?: Record<string, unknown>,
  model = "google/gemini-2.5-flash",
) {
  const body: Record<string, unknown> = { model, messages };
  if (toolSchema) {
    body.tools = [{ type: "function", function: toolSchema }];
    body.tool_choice = {
      type: "function",
      function: { name: (toolSchema as { name: string }).name },
    };
  }

  const startedAt = Date.now();
  const resp = await fetch(
    "https://ai.gateway.lovable.dev/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  if (resp.status === 429) throw new Error("rate_limited");
  if (resp.status === 402) throw new Error("payment_required");
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`ai gateway ${resp.status}: ${t.slice(0, 200)}`);
  }

  const data = await resp.json();
  // Fire-and-forget telemetry. Lovable AI Gateway returns OpenAI-shaped
  // usage: { prompt_tokens, completion_tokens, total_tokens }.
  const usage = data?.usage ?? {};
  void recordCostMetric({
    model,
    ms: Date.now() - startedAt,
    input_tokens: usage.prompt_tokens ?? null,
    output_tokens: usage.completion_tokens ?? null,
    total_tokens: usage.total_tokens ?? null,
    has_tool: !!toolSchema,
  });

  if (toolSchema) {
    const args =
      data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) throw new Error("no tool args returned");
    return JSON.parse(args);
  }
  return data.choices?.[0]?.message?.content ?? "";
}
