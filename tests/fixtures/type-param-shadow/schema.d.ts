export interface Struct<Fields> {
  readonly fields: Fields
}

export interface Str {
  readonly kind: 'string'
}
