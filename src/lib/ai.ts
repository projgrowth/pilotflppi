import { supabase } from "@/integrations/supabase/client";

interface AIRequestOptions {
  action: string;
  payload: Record<string, unknown> | string;
  stream?: boolean;
}

export async function callAI({ action, payload }: AIRequestOptions): Promise<string> {
  const { data, error } = await supabase.functions.invoke("ai", {
    body: { action, payload },
  });

  if (error) throw new Error(error.message || "AI request failed");
  if (data?.error) throw new Error(data.error);
  return data?.content || "";
}

export async function streamAI({
  action,
  payload,
  onDelta,
  onDone,
}: AIRequestOptions & {
  onDelta: (text: string) => void;
  onDone: () => void;
}) {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify({ action, payload: { ...((typeof payload === "object" ? payload : { text: payload }) as Record<string, unknown>), stream: true } }),
  });

  if (!resp.ok) {
    const errData = await resp.json().catch(() => ({}));
    throw new Error(errData.error || `AI request failed (${resp.status})`);
  }

  if (!resp.body) throw new Error("No response body");

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      let line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (!line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6).trim();
      if (jsonStr === "[DONE]") { onDone(); return; }
      try {
        const parsed = JSON.parse(jsonStr);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) onDelta(content);
      } catch {
        buffer = line + "\n" + buffer;
        break;
      }
    }
  }
  onDone();
}
