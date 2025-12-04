type Mapped<T> = T extends Record<string, infer U> ? U : never

export type Fn1<U = unknown> = () => Mapped<U>
export type Fn2<V = unknown> = () => Mapped<V>
