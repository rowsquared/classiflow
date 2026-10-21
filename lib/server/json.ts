/** What JSON.stringify turns T into: Dates become strings, functions and undefined drop out. */
export type Jsonified<T> = T extends Date
  ? string
  : T extends Array<infer U>
    ? Jsonified<U>[]
    : T extends object
      ? { [K in keyof T]: Jsonified<T[K]> }
      : T

/**
 * The value exactly as an API route would send it. Server pages pass module
 * results through this before handing them to client components, which were
 * written against the JSON responses.
 */
export function asJson<T>(value: T): Jsonified<T> {
  return JSON.parse(JSON.stringify(value))
}
