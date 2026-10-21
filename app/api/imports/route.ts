import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireSession } from '@/lib/api-auth'
import type { CaughtError } from '@/lib/utils'

export async function GET() {
  const { error } = await requireSession('admin')
  if (error) return error

  try {
    const imports = await prisma.sentenceImport.findMany({
      orderBy: { uploadedAt: 'desc' },
      include: {
        _count: {
          select: { sentences: true }
        }
      }
    })

    return NextResponse.json({ 
      ok: true,
      imports: imports.map(imp => ({
        id: imp.id,
        fileName: imp.fileName,
        uploadedAt: imp.uploadedAt,
        totalRows: imp.totalRows,
        sentenceCount: imp._count.sentences
      }))
    })
  } catch (caught) {
    const e = caught as CaughtError
    console.error('Failed to fetch imports:', e)
    return NextResponse.json({ 
      ok: false, 
      error: e?.message || String(e) 
    }, { status: 500 })
  }
}

