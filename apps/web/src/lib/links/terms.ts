/**
 * Turning a page into the handful of words that make it distinctive.
 *
 * Used to ask "what else is about this?" without an embedding model: the rarest, longest words a
 * page uses are a cheap proxy for its subject, and FTS5 can already rank other pages by them.
 * Pure functions, no database — the ranking that uses them lives in `related.ts`.
 */

/**
 * Words too common to say anything about a page. Deliberately small: a stopword list is a
 * maintenance burden that grows forever, and FTS ranking already discounts words that appear
 * everywhere in the workspace. This only removes the ones that would otherwise dominate a query.
 */
const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "any", "can", "had", "her", "was",
  "one", "our", "out", "day", "get", "has", "him", "his", "how", "its", "new", "now", "old",
  "see", "two", "way", "who", "boy", "did", "she", "use", "man", "men", "put", "say", "too",
  "with", "this", "that", "from", "they", "have", "been", "were", "will", "your", "what",
  "when", "then", "than", "them", "some", "more", "into", "only", "just", "also", "like",
  "over", "such", "very", "much", "most", "each", "make", "made", "need", "want", "does",
  "about", "would", "could", "should", "there", "their", "which", "these", "those", "other",
  "after", "before", "still", "being", "where", "while", "untitled",
]);

/** Shorter than this and a word is noise: "q3", "we", "ok". */
const MIN_LENGTH = 3;

/**
 * The most distinctive words in a piece of text, best first.
 *
 * Ranked by how often a word appears multiplied by its length. Frequency alone promotes filler
 * the stopword list missed; length alone promotes one-off long words. Together they favour the
 * terms a page keeps coming back to, which is what "related" should mean.
 */
export function extractTerms(text: string, limit = 12): string[] {
  const counts = new Map<string, number>();

  for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    // Trailing digits are usually version or date noise ("v2", "2026"); a bare number says
    // nothing about a subject.
    if (raw.length < MIN_LENGTH || STOPWORDS.has(raw) || /^\d+$/.test(raw)) continue;
    counts.set(raw, (counts.get(raw) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] * b[0].length - a[1] * a[0].length)
    .slice(0, limit)
    .map(([term]) => term);
}
