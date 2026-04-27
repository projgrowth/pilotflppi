// Untyped Supabase client wrapper. The edge function does not have access to
// generated Database types, and inferring `never` for every table would break
// every insert in the pipeline. Every stage module imports `Admin` from here
// so the `as any` lives in exactly one place.

import { createClient as _createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

// deno-lint-ignore no-explicit-any
export const createClient = _createClient as unknown as (...args: any[]) => any;

export type Admin = ReturnType<typeof createClient>;
