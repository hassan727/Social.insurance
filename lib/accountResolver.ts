import { supabaseServer } from '@/lib/supabaseServer';

// Resolve an operator-selected account against company_accounts (id, code,
// or alias). Returns null when unknown — callers reject, never default.
// Shared by every import route so preview and execute validate against the
// SAME source of truth (no hardcoded account allowlists).
export async function resolveAccountRecord(raw: string): Promise<{ id: number; account_code: string } | null> {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const { data, error } = await supabaseServer
    .from('company_accounts')
    .select('id, account_code, aliases')
    .eq('is_active', true);
  if (error || !data) return null;
  const asNum = Number(trimmed);
  const lowered = trimmed.toLowerCase();
  const match = data.find((a) =>
    (Number.isInteger(asNum) && a.id === asNum) ||
    a.account_code.toLowerCase() === lowered ||
    (Array.isArray(a.aliases) && a.aliases.some((al: string) => al.trim().toLowerCase() === lowered))
  );
  return match ? { id: match.id, account_code: match.account_code } : null;
}

export async function resolveAccountId(raw: string): Promise<number | null> {
  const rec = await resolveAccountRecord(raw);
  return rec ? rec.id : null;
}
