// Run: npm run check
import assert from 'node:assert/strict'
import { nameFrom } from './voice.ts'

assert.equal(nameFrom('Met Ravi, does solar panels, wants investors'), 'Ravi')
assert.equal(nameFrom('met Ravi does solar panels'), 'Ravi')
assert.equal(nameFrom('I met Ravi Kumar at the summit'), 'Ravi Kumar')
assert.equal(nameFrom('met with Priya Shah from Infosys'), 'Priya Shah')
assert.equal(nameFrom('his name is anil he does real estate'), 'Anil')
assert.equal(nameFrom('does solar panels, wants investors'), undefined)
console.log('voice ok')
