/** A `Response` whose `json()` is typed */
interface TypedResponse<T> extends Response {
  json(): Promise<T>
}

// declared under another name because it extends the global `Response`,
// exported as a drop-in for it
export type { TypedResponse as Response }
