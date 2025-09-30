// import foo from './foo.json' // TODO not supported yet
import * as fooNs from './foo.json'

import bar from './bar.json'
import * as barNs from './bar.json'

export { name, age } from './foo.json'
export { bar, fooNs, barNs }
