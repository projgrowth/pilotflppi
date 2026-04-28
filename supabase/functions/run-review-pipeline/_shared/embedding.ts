// Shared embedding helper for the review pipeline.
// Uses OpenAI text-embedding-3-small (1536-dim) so vectors are compatible with
// the pgvector index on fbc_code_sections.embedding_vector.

const EMBED_MODEL = "text-embedding-3-small";

export async function embedText(text: string): Promise<number[] | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return null;
  if (!text || text.trim().length === 0) return null;
  try {
    const r = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: EMBED_MODEL, input: text.slice(0, 8000) }),
    });
    if (!r.ok) {
      console.warn("[embed] failed", r.status, (await r.text()).slice(0, 200));
      return null;
    }
    const j = await r.json();
    const v = j?.data?.[0]?.embedding;
    return Array.isArray(v) ? v : null;
  } catch (e) {
    console.warn("[embed] threw", e);
    return null;
  }
}
