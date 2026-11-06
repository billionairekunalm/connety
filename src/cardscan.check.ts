// Run: npm run check
import assert from 'node:assert/strict'
import { parseCard } from './cardscan.ts'

assert.deepEqual(parseCard(`RAVI KUMAR
Founder & CEO
SolarCo Technologies Pvt Ltd
+91 98765 43210
ravi@solarco.in
www.solarco.in`), { name: 'Ravi Kumar', phone: '+919876543210', email: 'ravi@solarco.in', company: 'SolarCo Technologies Pvt Ltd' })

// Landline listed first, mobile second; company from email domain; lowercase name kept as typed.
assert.deepEqual(parseCard(`Priya Shah
Senior Designer
Tel: 022-2345 6789
Mob: 9988776655
priya.shah@brightpixel.com`), { name: 'Priya Shah', phone: '9988776655', email: 'priya.shah@brightpixel.com', company: 'Brightpixel' })

// Free email domain is not a company.
assert.equal(parseCard('Anil Mehta\nanil.m@gmail.com\n+91 91234 56789').company, undefined)
assert.equal(parseCard('').name, undefined)
console.log('cardscan ok')
