import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

export function getSupabaseServerClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables');
  }

  return createClient<Database>(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

// Trusted server-execution client: uses the SERVICE ROLE key, which is a
// server-only secret (never NEXT_PUBLIC_*, never shipped to the browser).
// Mutating transfer RPCs are granted to the service_role Postgres role ONLY,
// so this is the sole execution path for them. Fails closed: if the key is
// not configured there is NO fallback to the anon key for mutations.
export function getSupabaseServiceClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not configured — server-side trusted execution is unavailable');
  }

  return createClient<Database>(supabaseUrl, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

// Lazy proxy that initializes the client per call, ensuring env vars are loaded even in serverless edge/node workers
export const supabaseServer = new Proxy({} as ReturnType<typeof getSupabaseServerClient>, {
  get(_target, prop) {
    const client = getSupabaseServerClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const val = (client as any)[prop];
    if (typeof val === 'function') {
      return val.bind(client);
    }
    return val;
  },
});
