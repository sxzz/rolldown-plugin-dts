import type { Client, Widget } from './value-a'
import type { Client as OtherClient, Widget as OtherWidget } from './value-b'

export declare const clients: [typeof Client, typeof OtherClient]
export declare const widgets: [typeof Widget, typeof OtherWidget]
export declare class Sub extends OtherClient {}
