// Run: npm run check
import assert from 'node:assert/strict'
import { flag, fullNumber, guessCountry, splitNumber, waDigits } from './countries.ts'

assert.equal(fullNumber('IN', '98765 43210'), '+919876543210')
assert.equal(fullNumber('IN', '09876543210'), '+919876543210') // trunk 0 dropped
assert.equal(fullNumber('IN', '+1 415 555 0100'), '+14155550100') // own +code kept
assert.equal(fullNumber('GB', '0044 7911 123456'), '+447911123456')
assert.equal(fullNumber('IN', '   '), null)

assert.deepEqual(splitNumber('+919876543210', 'IN'), { country: 'IN', national: '9876543210' })
assert.deepEqual(splitNumber('+97150123456', 'IN'), { country: 'AE', national: '50123456' }) // 971 beats 97/9
assert.deepEqual(splitNumber('+14165550100', 'CA'), { country: 'CA', national: '4165550100' }) // shared +1 -> preferred
assert.equal(splitNumber('+14155550100', 'IN').national, '4155550100') // +1 with no preference: number still split right
assert.deepEqual(splitNumber('8999221747', 'IN'), { country: 'IN', national: '8999221747' }) // old numbers without code

assert.equal(waDigits('8999221747', 'IN'), '918999221747')
assert.equal(waDigits('+447911123456', 'IN'), '447911123456')
assert.equal(guessCountry('en-US', 'Asia/Kolkata'), 'IN') // time zone beats a US-English phone
assert.equal(guessCountry('en-AE', 'UTC'), 'AE')
assert.equal(guessCountry('hi', 'UTC'), 'IN')
assert.equal(guessCountry('en-GB', 'America/Toronto'), 'CA')
assert.equal(flag('IN'), '🇮🇳')
console.log('countries ok')
