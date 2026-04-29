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

// Long-form letter generation can have a >60s first-token delay on a cold
// Gemini worker. Bumped to 120s so a slow start doesn't get reported as a
// stall on a stream that's about to start producing tokens normally.
const STREAM_INACTIVITY_TIMEOUT_MS = 120_000;

export async function streamAI({
  action,
  payload,
  onDelta,
  onDone,
  signal,
}: AIRequestOptions & {
  onDelta: (text: string) => void;
  onDone: () => void;
  signal?: AbortSignal;
}) {
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai`;

  // Use session access token instead of anon key
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) throw new Error("Not authenticated");

  // Internal controller chained to the optional external signal so we can
  // also abort on inactivity watchdog timeouts.
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onExternalAbort, { once: true });
  }

  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let stalled = false;
  const resetWatchdog = () => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      stalled = true;
      controller.abort();
    }, STREAM_INACTIVITY_TIMEOUT_MS);
  };

  try {
    resetWatchdog();
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        action,
        payload: {
          ...((typeof payload === "object" ? payload : { text: payload }) as Record<string, unknown>),
          stream: true,
        },
      }),
      signal: controller.signal,
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
      resetWatchdog();
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        let line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6).trim();
        if (jsonStr === "[DONE]") return;
        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) onDelta(content);
        } catch {
          // Partial JSON — push back unconsumed bytes and wait for more data.
          buffer = line + "\n" + buffer;
          break;
        }
      }
    }
  } catch (err) {
    if (stalled) throw new Error("AI stream stalled — no data received for 120s. Try again or switch to a smaller model.");
    if ((err as Error)?.name === "AbortError") throw new Error("AI request cancelled");
    throw err;
  } finally {
    if (watchdog) clearTimeout(watchdog);
    if (signal) signal.removeEventListener("abort", onExternalAbort);
    onDone();
  }
}
