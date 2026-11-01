// Pull a name out of a voice note: "Met Ravi Kumar, does solar" -> "Ravi Kumar".
// ponytail: keyword + capitalised-words heuristic; swap for an AI extractor if it misses too often.
const STOP = new Set(['at', 'from', 'in', 'who', 'he', 'she', 'they', 'does', 'and', 'is', 'works', 'wants', 'the', 'a', 'an', 'on', 'today', 'yesterday', 'during'])

export function nameFrom(text: string): string | undefined {
  const m = text.match(/\b(?:met|meet|meeting|name is|this is|called)\s+(?:with\s+)?(.+)/i)
  if (!m) return
  const out: string[] = []
  for (const w of m[1].split(/[.,!?;:]/)[0].split(/\s+/)) {
    if (!w || STOP.has(w.toLowerCase()) || out.length === 3) break
    if (out.length && !/^\p{Lu}/u.test(w)) break // later words must be capitalised to count as surname
    out.push(w[0].toUpperCase() + w.slice(1))
  }
  return out.length ? out.join(' ') : undefined
}
