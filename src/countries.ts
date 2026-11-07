// Countries with calling codes, and helpers to build/split full (E.164-style) numbers like +919876543210.
// ponytail: the ~120 most common countries; add more rows here if someone can't find theirs.
export type Country = { code: string; name: string; dial: string }

const RAW = `IN India 91|US United States 1|GB United Kingdom 44|AE United Arab Emirates 971|CA Canada 1|AU Australia 61|SG Singapore 65|
SA Saudi Arabia 966|QA Qatar 974|KW Kuwait 965|OM Oman 968|BH Bahrain 973|NP Nepal 977|BD Bangladesh 880|LK Sri Lanka 94|PK Pakistan 92|
AF Afghanistan 93|BT Bhutan 975|MV Maldives 960|MM Myanmar 95|TH Thailand 66|MY Malaysia 60|ID Indonesia 62|PH Philippines 63|VN Vietnam 84|
KH Cambodia 855|LA Laos 856|CN China 86|HK Hong Kong 852|TW Taiwan 886|JP Japan 81|KR South Korea 82|MN Mongolia 976|KZ Kazakhstan 7|
UZ Uzbekistan 998|RU Russia 7|UA Ukraine 380|TR Turkey 90|IL Israel 972|JO Jordan 962|LB Lebanon 961|IQ Iraq 964|IR Iran 98|EG Egypt 20|
MA Morocco 212|DZ Algeria 213|TN Tunisia 216|NG Nigeria 234|GH Ghana 233|KE Kenya 254|TZ Tanzania 255|UG Uganda 256|RW Rwanda 250|ET Ethiopia 251|
ZA South Africa 27|ZW Zimbabwe 263|ZM Zambia 260|MZ Mozambique 258|BW Botswana 267|NA Namibia 264|MU Mauritius 230|SN Senegal 221|CI Ivory Coast 225|
CM Cameroon 237|DE Germany 49|FR France 33|IT Italy 39|ES Spain 34|PT Portugal 351|NL Netherlands 31|BE Belgium 32|CH Switzerland 41|AT Austria 43|
IE Ireland 353|SE Sweden 46|NO Norway 47|DK Denmark 45|FI Finland 358|IS Iceland 354|PL Poland 48|CZ Czechia 420|SK Slovakia 421|HU Hungary 36|
RO Romania 40|BG Bulgaria 359|GR Greece 30|HR Croatia 385|RS Serbia 381|SI Slovenia 386|LT Lithuania 370|LV Latvia 371|EE Estonia 372|CY Cyprus 357|
MT Malta 356|LU Luxembourg 352|NZ New Zealand 64|FJ Fiji 679|PG Papua New Guinea 675|MX Mexico 52|BR Brazil 55|AR Argentina 54|CL Chile 56|
CO Colombia 57|PE Peru 51|VE Venezuela 58|EC Ecuador 593|UY Uruguay 598|PY Paraguay 595|BO Bolivia 591|CR Costa Rica 506|PA Panama 507|
GT Guatemala 502|DO Dominican Republic 1|JM Jamaica 1|TT Trinidad and Tobago 1|CU Cuba 53|PR Puerto Rico 1`

export const COUNTRIES: Country[] = RAW.split('|').map(s => s.trim()).filter(Boolean).map(s => {
  const parts = s.split(' ')
  return { code: parts[0], dial: parts[parts.length - 1], name: parts.slice(1, -1).join(' ') }
}).sort((a, b) => a.name.localeCompare(b.name))

export const flag = (code: string) => String.fromCodePoint(...[...code.toUpperCase()].map(c => 0x1f1a5 + c.charCodeAt(0)))
export const byCode = (code?: string | null) => COUNTRIES.find(c => c.code === code)

// Best guess: the time zone first (many Indian phones are set to "en-US", but the zone is still
// Asia/Kolkata), then the language region ("en-AE" -> AE), else India.
const ZONES: [RegExp, string][] = [
  [/^Asia\/(Kolkata|Calcutta)$/, 'IN'], [/^Asia\/Dubai$/, 'AE'], [/^Asia\/Singapore$/, 'SG'], [/^Asia\/Karachi$/, 'PK'],
  [/^Asia\/Dhaka$/, 'BD'], [/^Asia\/Kathmandu$/, 'NP'], [/^Asia\/Colombo$/, 'LK'], [/^Asia\/Riyadh$/, 'SA'], [/^Asia\/Qatar$/, 'QA'],
  [/^Europe\/London$/, 'GB'], [/^Australia\//, 'AU'], [/^America\/(Toronto|Vancouver|Edmonton|Winnipeg|Halifax)$/, 'CA'], [/^America\//, 'US'],
]
export const guessCountry = (
  lang = typeof navigator !== 'undefined' ? navigator.language : '',
  zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '',
) => ZONES.find(([re]) => re.test(zone))?.[1] ?? byCode(lang.split('-')[1]?.toUpperCase())?.code ?? 'IN'

const digits = (s: string) => s.replace(/\D/g, '')

// Country code + what was typed -> "+<dial><number>". Drops a leading trunk 0; keeps a number typed with its own +code.
export function fullNumber(country: string, typed: string): string | null {
  const t = typed.trim()
  if (!digits(t)) return null
  if (t.startsWith('+')) return '+' + digits(t)
  if (t.startsWith('00')) return '+' + digits(t).slice(2)
  return `+${byCode(country)?.dial ?? ''}${digits(t).replace(/^0+/, '')}`
}

// "+919876543210" -> { country: "IN", national: "9876543210" }. Longest matching code wins; among shared
// codes (+1 = US, Canada…) the preferred country wins. Numbers without "+" are taken as national.
export function splitNumber(phone: string | null | undefined, preferred: string) {
  const p = (phone ?? '').trim()
  if (!p.startsWith('+') && !p.startsWith('00')) return { country: preferred, national: digits(p).replace(/^0+/, '') }
  const d = p.startsWith('00') ? digits(p).slice(2) : digits(p)
  const matches = COUNTRIES.filter(c => d.startsWith(c.dial)).sort((a, b) => b.dial.length - a.dial.length)
  const best = matches.find(c => c.code === preferred && c.dial === matches[0]?.dial) ?? matches[0]
  return best ? { country: best.code, national: d.slice(best.dial.length) } : { country: preferred, national: d }
}

// Digits for wa.me links: numbers saved without a code get the user's own country code.
export const waDigits = (phone: string, myCountry: string) => digits(fullNumber(myCountry, phone) ?? '')
