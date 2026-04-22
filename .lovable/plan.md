

## Comment letter (and all AI streaming) failing — fix the edge function gateway config

### Root cause

The `ai` edge function exists and looks correct in code, but **zero requests are reaching it**. Both `supabase--edge_function_logs` for `ai` and the analytics query for `/ai` requests return empty — meaning the Supabase gateway is rejecting every call before it ever runs.

`supabase/config.toml` currently contains only:
```toml
project_id = "iisgxjneamwbehipgcmg"
```

There is **no `[functions.ai]` block**, so the function deploys with the default `verify_jwt = true`. With Supabase's signing-keys auth system that this project uses, the gateway's built-in JWT check rejects the user access tokens that `streamAI` sends as `Bearer`, returning a 401 before the function executes. That's why "Send/Generate" silently fails with no logs and no network traces.

The function already validates JWTs in code (`supabaseAuth.auth.getClaims(token)` at line 431), so disabling gateway-side verification is the correct, secure fix — exactly the pattern the Lovable docs prescribe for streaming functions in this auth model.

### What changes (1 file)

**`supabase/config.toml`** — add a function-specific config block telling the gateway to skip its own JWT check (the function still does it):

```toml
project_id = "iisgxjneamwbehipgcmg"

[functions.ai]
verify_jwt = false
```

That's the entire fix. No other files need to change.

### Why nothing else needs touching

- `src/lib/ai.ts` `streamAI` is correctly:
  - using the user's session access token (not the anon key)
  - guarding against string payloads with `typeof payload === "object" ? payload : { text: payload }`
  - aborting on 60s inactivity
- The `ai/index.ts` function correctly validates the JWT in code, returns CORS headers on every response (success + error), and streams `text/event-stream` properly.
- `run-review-pipeline` already works (we have logs for it) — that function presumably has the right config inherited from prior deploys, or its `invoke()` path goes through a different code branch. Either way, only `ai` is broken right now.

### Verification after deploy

1. Open a project → Plan Review → click **Generate Letter**. Stream should start within ~2s.
2. Open `supabase--edge_function_logs("ai")` — you should now see entries per call.
3. The FBC County chatbot and AI Drawer Quick Q&A (which use the same `streamAI` path) will also start working.

### Files touched

- Edit: `supabase/config.toml` (add `[functions.ai]` block with `verify_jwt = false`)

