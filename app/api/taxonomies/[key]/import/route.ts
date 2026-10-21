import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { z } from 'zod'
import { parse } from 'csv-parse/sync'
import { isUnknownNodeCode } from '@/lib/constants'

const searchParamsSchema = z.object({ dryRun: z.coerce.boolean().default(true) })

const emptyToNull = (v: unknown) => {
  const s = String(v ?? '').trim()
  return s === '' ? null : s
}

const rowSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  definition: z.string().optional().nullable(),
  examples: z.string().optional().nullable(),
  synonyms: z.string().optional().nullable(),
  parent_id: z.preprocess(emptyToNull, z.string().min(1).nullable()).optional().nullable(),
  level: z.preprocess(emptyToNull, z.coerce.number().int().min(1).max(5).nullable()).optional().nullable(),
})

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params
  const taxonomy = await prisma.taxonomy.findUnique({ where: { key } })
  if (!taxonomy) {
    return NextResponse.json({ error: 'taxonomy not found' }, { status: 404 })
  }

  const { searchParams } = new URL(req.url)
  const rawDry = (searchParams.get('dryRun') ?? 'true').toString().toLowerCase()
  const sp = { dryRun: ['1','true','yes'].includes(rawDry) }

  const contentType = req.headers.get('content-type') || ''
  if (!contentType.includes('text/csv')) {
    return NextResponse.json({ error: 'Content-Type must be text/csv' }, { status: 400 })
  }
  const csv = await req.text()
  // Use cast: false to preserve leading zeros in id and parent_id columns
  const records = parse(csv, { columns: true, skip_empty_lines: true, bom: true, cast: false }) as any[]

  const errors: { row: number; message: string }[] = []
  
  // Validate CSV headers
  if (!records || records.length === 0) {
    return NextResponse.json({ 
      ok: false, 
      error: 'CSV file is empty or contains no data rows',
      errors: [{ row: 0, message: 'CSV file is empty or contains no data rows' }]
    }, { status: 400 })
  }

  const headers = Object.keys(records[0] || {})
  const requiredHeaders = ['id', 'label', 'parent_id', 'level']
  const allowedOptionalHeaders = ['definition', 'examples', 'synonyms']
  const allAllowedHeaders = [...requiredHeaders, ...allowedOptionalHeaders]
  
  // Check for missing required columns
  const missingHeaders = requiredHeaders.filter(h => !headers.includes(h))
  if (missingHeaders.length > 0) {
    return NextResponse.json({ 
      ok: false, 
      error: `Missing required columns: ${missingHeaders.join(', ')}. The CSV must contain: id, label, parent_id, and level.`,
      errors: [{ row: 0, message: `Missing required columns: ${missingHeaders.join(', ')}` }]
    }, { status: 400 })
  }
  
  // Check for disallowed columns
  const disallowedHeaders = headers.filter(h => !allAllowedHeaders.includes(h))
  if (disallowedHeaders.length > 0) {
    return NextResponse.json({ 
      ok: false, 
      error: `Disallowed columns found: ${disallowedHeaders.join(', ')}. Only the following columns are allowed: ${allAllowedHeaders.join(', ')}.`,
      errors: [{ row: 0, message: `Disallowed columns: ${disallowedHeaders.join(', ')}` }]
    }, { status: 400 })
  }

  const seenIds = new Map<string, number[]>() // Track all row numbers for each id (preserve leading zeros)
  const allIds = new Set<string>() // All id values for parent_id validation
  const seenLabelsPerLevel = new Map<number, Set<string>>()
  const nodes: Array<z.infer<typeof rowSchema>> = []

  records.forEach((raw, idx) => {
    const parentRaw = String(raw?.parent_id ?? '').trim()
    const parentProvided = parentRaw.length > 0
    const parsed = rowSchema.safeParse(raw)
    if (!parsed.success) {
      errors.push({ row: idx + 2, message: parsed.error.message })
      return
    }
    const row = parsed.data
    
    // Validate that code is not -99 (reserved for UNKNOWN)
    if (isUnknownNodeCode(row.id)) {
      errors.push({ row: idx + 2, message: 'Code -99 is reserved for UNKNOWN labels and cannot be used' })
      return
    }
    
    // Validate that parent_id is not -99
    if (isUnknownNodeCode(row.parent_id)) {
      errors.push({ row: idx + 2, message: 'Code -99 is reserved for UNKNOWN labels and cannot be used as parent_id' })
      return
    }
    
    // Track id occurrences for duplicate detection (preserve leading zeros with string comparison)
    const rowNum = idx + 2 // +2 because CSV has header and 0-indexed
    if (seenIds.has(row.id)) {
      seenIds.get(row.id)!.push(rowNum)
    } else {
      seenIds.set(row.id, [rowNum])
      allIds.add(row.id) // Add to set for parent_id validation
    }
    
    const lvl = (row.level as any) ?? inferLevel(row, records)
    if (!seenLabelsPerLevel.has(lvl)) seenLabelsPerLevel.set(lvl, new Set<string>())
    const set = seenLabelsPerLevel.get(lvl)!
    if (set.has(row.label)) errors.push({ row: idx + 2, message: 'duplicate label in file (same level)' })
    set.add(row.label)
    // Attach raw parent presence info for validation stage
    nodes.push({ ...row, _parentProvided: parentProvided } as any)
  })

  // Check for duplicate ids and report all violating rows
  for (const [id, rowNumbers] of seenIds.entries()) {
    if (rowNumbers.length > 1) {
      const rowsList = rowNumbers.join(', ')
      errors.push({
        row: rowNumbers[0], // Report on first occurrence
        message: `Duplicate id "${id}" found in rows: ${rowsList}`
      })
      // Also add errors for subsequent occurrences
      for (let i = 1; i < rowNumbers.length; i++) {
        errors.push({
          row: rowNumbers[i],
          message: `Duplicate id "${id}" (also appears in row ${rowNumbers[0]})`
        })
      }
    }
  }

  // Validate parent_id values exist in id column
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i]
    const rowNum = i + 2 // +2 because CSV has header and 0-indexed
    
    if (n.parent_id != null && n.parent_id.trim() !== '') {
      const parentId = String(n.parent_id).trim()
      if (!allIds.has(parentId)) {
        errors.push({ 
          row: rowNum, 
          message: `parent_id "${parentId}" does not match any id value in the file` 
        })
      }
    }
  }

  // parent existence & top-level checks
  const levelProvided = nodes.some(n => n.level != null)
  if (levelProvided) {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i] as any
      const rowNum = i + 2
      if ((n.level as any) === 1 && n._parentProvided) {
        errors.push({ row: rowNum, message: 'level 1 must have missing parent_id' })
      }
      if ((n.level as any)! > (taxonomy.maxDepth ?? 5)) {
        errors.push({ row: rowNum, message: `level exceeds taxonomy.maxDepth` })
      }
    }
  }

  if (errors.length > 0) {
    return NextResponse.json({ ok: false, errors }, { status: 400 })
  }

  if (sp.dryRun) {
    return NextResponse.json({ ok: true, dryRun: true, count: nodes.length })
  }

  // Commit import
  try {
    // Pre-check conflicts
    const existingCodes = await prisma.taxonomyNode.findMany({
      where: { taxonomyId: taxonomy.id, code: { in: Array.from(allIds) } },
      select: { code: true },
    })
    if (existingCodes.length > 0) {
      throw new Error('Some ids already exist in this taxonomy')
    }
    const existingLabels = await prisma.taxonomyNode.findMany({
      where: { taxonomyId: taxonomy.id, label: { in: nodes.map(n => n.label) } },
      select: { label: true, level: true },
    })
    if (existingLabels.length > 0) {
      const set = new Set(existingLabels.map(e => `${e.level}::${e.label}`))
      for (const n of nodes) {
        if (set.has(`${n.level ?? inferLevel(n, nodes)}::${n.label}`)) {
          throw new Error('Some same-level labels already exist in this taxonomy')
        }
      }
    }

    // Insert one by one (1088 rows is fine), clearer error surfacing
    // Set isLeaf to null initially - will be recalculated after all nodes are inserted
    for (const n of nodes) {
      const level = n.level ?? inferLevel(n, nodes)
      await prisma.taxonomyNode.create({
        data: {
          taxonomyId: taxonomy.id,
          code: n.id,
          label: n.label,
          definition: (n.definition && String(n.definition).trim()) || null,
          examples: (n.examples && String(n.examples).trim()) || null,
          parentCode: n.parent_id ?? undefined,
          level,
          path: buildPath(n, nodes),
          isLeaf: null, // Will be recalculated after import
        },
      })
    }

    // Recalculate isLeaf for all nodes in this taxonomy based on actual database state
    const allTaxonomyNodes = await prisma.taxonomyNode.findMany({
      where: { taxonomyId: taxonomy.id },
      select: { id: true, code: true, level: true },
    })
    
    // Get all nodes that have children (parent codes) - use groupBy for reliable distinct
    const nodesWithChildren = await prisma.taxonomyNode.groupBy({
      by: ['parentCode'],
      where: { 
        taxonomyId: taxonomy.id,
        parentCode: { not: null }
      },
    })
    const parentCodeSet = new Set(
      nodesWithChildren
        .map(n => n.parentCode)
        .filter((code): code is string => code !== null)
    )
    
    // Batch update isLeaf for all nodes
    const updatePromises = allTaxonomyNodes.map(async (node) => {
      let isLeaf: boolean
      
      // Check if at maxDepth
      if (node.level >= taxonomy.maxDepth) {
        isLeaf = true
      } else {
        // Check if this node has children (is a parent)
        // Use exact string comparison to handle alphanumeric codes correctly
        isLeaf = !parentCodeSet.has(node.code)
      }
      
      return prisma.taxonomyNode.update({
        where: { id: node.id },
        data: { isLeaf },
      })
    })
    
    await Promise.all(updatePromises)

    // Insert synonyms (best-effort)
    const nodesByCode = await prisma.taxonomyNode.findMany({
      where: { taxonomyId: taxonomy.id, code: { in: Array.from(allIds) } },
      select: { id: true, code: true },
    })
    const idByCode = new Map(nodesByCode.map(n => [n.code, n.id]))
    const synonymRows: { taxonomyId: string; nodeId: string; synonym: string }[] = []
    for (const n of nodes) {
      if (!n.synonyms) continue
      const nodeId = idByCode.get(n.id)
      if (!nodeId) continue
      const syns = n.synonyms.split(/[;|,]/).map(s => s.trim()).filter(Boolean)
      for (const s of syns) synonymRows.push({ taxonomyId: taxonomy.id, nodeId, synonym: s })
    }
    if (synonymRows.length) {
      await prisma.taxonomySynonym.createMany({ data: synonymRows, skipDuplicates: true })
    }
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 })
  }

  return NextResponse.json({ ok: true, dryRun: false, count: nodes.length })
}

function inferLevel(n: any, all: any[]) {
  let level = 1
  let cur = n
  while (cur.parent_id != null) {
    level += 1
    cur = all.find(x => x.id === cur.parent_id)
    if (!cur) break
  }
  return level
}

function buildPath(n: any, all: any[]) {
  const parts: string[] = []
  let cur = n
  while (cur) {
    parts.push(cur.id)
    if (cur.parent_id == null) break
    cur = all.find(x => x.id === cur.parent_id)
  }
  return parts.reverse().join('.')
}


