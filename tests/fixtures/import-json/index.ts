import foo from './foo.json'
import * as fooNs from './foo.json'

import bar from './bar.json'
import * as barNs from './bar.json'

export { name, age } from './foo.json'
export { foo, bar, fooNs, barNs }

import * as invalidNs from './invalid.json'
export { invalidNs }

import nested from './nested.json'
export { nested }

import arrayOfObjects from './array-of-object.json'
export { arrayOfObjects }
