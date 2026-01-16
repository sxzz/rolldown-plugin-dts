import foo from './foo.json'
import * as fooNs from './foo.json'

import bar from './bar.json'
import * as barNs from './bar.json'

import baz from './baz.json'
import * as bazNs from './baz.json'

export { name, age } from './foo.json'
export { foo, bar, baz, fooNs, barNs, bazNs }

import * as invalidNs from './invalid.json'
export { invalidNs }

import nested from './nested.json'
export { nested }
