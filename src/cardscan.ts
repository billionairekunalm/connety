// Turn the raw text read off a visiting card into contact fields.
// ponytail: regex + keyword heuristics; good on typical cards, swap for an AI extractor if it misses too often.
export type CardInfo = { name?: string; phone?: string; email?: string; company?: string }

const COMPANY = /\b(pvt|private|ltd|limited|llp|inc|corp|corporation|technologies|technology|tech|solutions|enterprises?|industries|group|company|co\.|consult\w*|services|studio|labs?|systems|ventures|capital|realty|infra|global|international|associates|agency|foundation|traders)\b/i
const TITLE = /\b(founder|co-?founder|ceo|cto|cfo|coo|director|manager|engineer|designer|consultant|partner|head|lead|owner|president|officer|executive|developer|sales|marketing|proprietor|architect|advocate|doctor|dr\.|chairman|md|analyst|associate|vp)\b/i
const WEB = /\b(www\.|https?:\/\/)|\.(com|in|co|io|net|org|ai)\b/i
const FREE_MAIL = /^(gmail|yahoo|outlook|hotmail|icloud|rediffmail|live|proton(mail)?)\./i

const titleCase = (s: string) => s.toLowerCase().replace(/\b\p{L}/gu, c => c.toUpperCase())

export function parseCard(text: string): CardInfo {
  const lines = text.split(/\n/).map(l => l.replace(/[|•·]/g, ' ').replace(/\s+/g, ' ').trim()).filter(l => l.length > 1)
  const out: CardInfo = {}

  const email = text.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/)
  if (email) out.email = email[0].toLowerCase()

  // Phone: 10-13 digits; prefer an Indian mobile (starts 6-9) over landlines.
  const phones = [...text.matchAll(/\+?\d[\d\s().-]{8,}\d/g)]
    .map(m => m[0].replace(/[^\d+]/g, ''))
    .filter(p => { const n = p.replace('+', '').length; return n >= 10 && n <= 13 })
  const mobile = phones.find(p => /^(\+?91)?[6-9]\d{9}$/.test(p))
  if (mobile ?? phones[0]) out.phone = mobile ?? phones[0]

  const companyLine = lines.find(l => COMPANY.test(l) && !/@/.test(l) && !WEB.test(l))
  if (companyLine) out.company = /[a-z]/.test(companyLine) ? companyLine : titleCase(companyLine)
  else if (email && !FREE_MAIL.test(email[0].split('@')[1])) out.company = titleCase(email[0].split('@')[1].split('.')[0])

  // Name: a short line of only letters that isn't the company, a job title or contact info.
  const isName = (l: string) =>
    /^[\p{L} .'-]+$/u.test(l) && l.split(' ').length >= 1 && l.split(' ').length <= 4 && l.length <= 40 &&
    l.replace(/[^\p{L}]/gu, '').length >= 3 && l !== companyLine && !COMPANY.test(l) && !TITLE.test(l) && !WEB.test(l)
  const candidates = lines.filter(isName)
  const name = candidates.find(l => l.includes(' ')) ?? candidates[0]
  if (name) out.name = /[a-z]/.test(name) ? name : titleCase(name)

  return out
}
