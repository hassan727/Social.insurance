import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';

export function getSupabaseServerClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://cwahfoeehmlppifffapx.supabase.co';
  const supabaseServiceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    'dummy-fallback-key-for-build-time-safety';

  return createClient<Database>(supabaseUrl, supabaseServiceKey, {
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
