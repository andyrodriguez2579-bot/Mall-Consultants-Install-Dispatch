/**
 * Title for a duplicated job: "(copy)", then "(copy 2)", "(copy 3)".
 *
 * Duplicating is how a repeat visit to a site gets raised, so the same job is
 * duplicated again and again and the suffix used to accumulate. A real offer
 * went out reading "SSDC installation - Ebb & Bloom Cafe, Long Island City
 * (copy) (copy) (copy)" -- in a text message, where every character is billed
 * by the segment and the part a contractor needed had been pushed out of view.
 *
 * Counting rather than appending holds it to one suffix however many times the
 * job is copied. It lives here rather than beside the action because a
 * "use server" module may only export async functions, and this is worth
 * testing directly.
 */
export function copiedTitle(title: string): string {
  const match = title.match(/^(.*?)\s*\(copy(?:\s+(\d+))?\)$/i);
  if (!match) return `${title} (copy)`;

  const [, stem = "", count] = match;
  const next = Number(count ?? 1) + 1;

  // A title that was only ever "(copy)" leaves nothing behind when the suffix
  // is stripped; keep the suffix rather than returning a bare number.
  return stem ? `${stem} (copy ${next})` : `(copy ${next})`;
}
