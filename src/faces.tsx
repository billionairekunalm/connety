// Original drawn faces (SVG) in the app's colours, shared by the intro and the sign-in screen.
// ---- little drawn people (original, in the app's colours) ----
export type Person = { bg: string; skin: string; hair: string; shirt: string; style: 0 | 1 | 2 }
export const PEOPLE: Person[] = [
  { bg: '#ffc145', skin: '#f2c9a0', hair: '#1d1a22', shirt: '#4f46e5', style: 0 },
  { bg: '#a9c8ff', skin: '#d9a273', hair: '#2b1f3a', shirt: '#ff7a6b', style: 1 },
  { bg: '#f7b3e4', skin: '#a8744f', hair: '#1d1a22', shirt: '#111111', style: 2 },
  { bg: '#c9e27f', skin: '#f2c9a0', hair: '#c98a3c', shirt: '#a99bff', style: 1 },
  { bg: '#ff7a6b', skin: '#7a4a30', hair: '#1d1a22', shirt: '#ffc145', style: 0 },
  { bg: '#a99bff', skin: '#d9a273', hair: '#5b3a29', shirt: '#c9e27f', style: 2 },
  { bg: '#7dd3c0', skin: '#f2c9a0', hair: '#5b3a29', shirt: '#ff7a6b', style: 0 },
  { bg: '#ffd9a0', skin: '#a8744f', hair: '#2b1f3a', shirt: '#4f46e5', style: 1 },
]

export function Face({ bg, skin, hair, shirt, style }: Person) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden>
      <circle cx="32" cy="32" r="32" fill={bg} />
      {style === 1 && <path d="M19 31c-2-17 8-23 13-23s15 6 13 23c-.4 6-2 10-4 12H23c-2-2-3.6-6-4-12z" fill={hair} />}
      <path d="M10 66c0-15 9-21 22-21s22 6 22 21z" fill={shirt} />
      <rect x="28" y="38" width="8" height="9" rx="3" fill={skin} />
      <circle cx="32" cy="29" r="11" fill={skin} />
      {style === 0 && <path d="M20.5 28c-1-10 6-14 11.5-14s12.5 4 11.5 14c-3-5-8-6.5-11.5-6.5S23.500 23 20.500 28z" fill={hair} />}
      {style === 2 && <><circle cx="32" cy="14" r="5" fill={hair} /><path d="M21 28c-1-9 5-13 11-13s12 4 11 13c-3-5-7-6-11-6s-8 1-11 6z" fill={hair} /></>}
      {style === 1 && <path d="M21 27c3-6 7-7 11-7s9 1 11 7c-4-2-7-3-11-3s-7 1-11 3z" fill={hair} />}
      <circle cx="28" cy="30" r="1.1" fill="#2b1f3a" /><circle cx="36" cy="30" r="1.1" fill="#2b1f3a" />
      <path d="M28.500 34c1.500 1.600 5.500 1.600 7 0" fill="none" stroke="#2b1f3a" strokeWidth="1.100" strokeLinecap="round" />
    </svg>
  )
}
export const Av = ({ i }: { i: number }) => <span className="av"><Face {...PEOPLE[i % PEOPLE.length]} /></span>
