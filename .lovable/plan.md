

# Fix: Edge Function Crash on Empty Request Body

## Problem

The `ai` edge function crashes with `SyntaxError: Unexpected end of JSON input` when it receives a request with no body (or an empty body). This happens at `await req.json()` (line 274) — before the CORS check can handle it. The error causes a blank screen because the function returns a 500 instead of a proper error response.

The edge function logs confirm this:
```
AI function error: SyntaxError: Unexpected end of JSON input
```

## Fix

Wrap `await req.json()` in a try-catch to handle empty/malformed request bodies gracefully, returning a 400 error with a clear message instead of crashing.

## File Changed

| File | Change |
|------|--------|
| `supabase/functions/ai/index.ts` | Wrap `req.json()` in try-catch at line 274, return 400 on parse failure |

## Code Change (line 273-274)

Replace:
```typescript
const { action, payload } = await req.json();
```

With:
```typescript
let action: string;
let payload: any;
try {
  const body = await req.json();
  action = body.action;
  payload = body.payload;
} catch {
  return new Response(
    JSON.stringify({ error: "Invalid or empty request body" }),
    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
```

This is a one-line-scope fix — no other files or migrations needed. After deploying, the function will return a clean 400 instead of crashing on empty requests.

