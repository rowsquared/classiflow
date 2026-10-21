type FieldMapping = Record<string, string>

export type FieldSource = {
  field1?: string | null
  field2?: string | null
  field3?: string | null
  field4?: string | null
  field5?: string | null
  // Prisma Json column: may hold any JSON value, only a plain object is a valid mapping
  fieldMapping?: unknown
}

function toFieldMapping(value: unknown): FieldMapping {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as FieldMapping
}

export function buildFieldMap(source: FieldSource) {
  const mapping = toFieldMapping(source.fieldMapping)
  const result: Record<string, string> = {}

  for (let i = 1; i <= 5; i++) {
    const value = source[`field${i}` as keyof FieldSource] as string | null | undefined
    if (!value) continue
    const key = mapping[String(i)] || `field${i}`
    result[key] = value
  }

  return result
}

