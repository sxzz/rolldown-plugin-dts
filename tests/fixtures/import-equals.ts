import * as zodModule from 'external-zod'
import a = zodModule.foo.a
export { a }

export import b = zodModule.foo.b

export import vue = require('external-vue')
import simple = require('./simple')
export { simple }
export import simple2 = require('./simple')
