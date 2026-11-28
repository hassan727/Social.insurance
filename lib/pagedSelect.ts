// Reads EVERY row of a query, page by page.
//
// Why this exists: the Supabase API returns at most 1000 rows per request
// (project max-rows). A plain `.select()` on a table with more rows silently
// returns the first 1000 and no error. Import matching and snapshot logic that
// relied on one plain select saw only a fraction of the employees. This helper
// pages with a stable order and FAILS (throws) on any error instead of
// returning a partial list.
type PageResult<T> = { data: T[] | null; error: { message: string } | null };

export async function fetchAllRows<T>(
  buildPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = 1000
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildPage(from, from + pageSize - 1);
    if (error) throw new Error(`paged read failed at row ${from}: ${error.message}`);
    const rows = data || [];
    all.push(...rows);
    if (rows.length < pageSize) break;
  }
  return all;
}
