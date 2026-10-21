import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isUnknownNodeCode } from '@/lib/constants'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sentenceId: string }> }
) {
  try {
    // Get authenticated session
    const session = await auth()
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { sentenceId } = await params
    const sentence = await prisma.sentence.findUnique({
      where: { id: sentenceId },
      include: {
        annotations: {
          include: {
            taxonomy: {
              select: { key: true }
            }
          }
        },
        assignments: {
          select: {
            userId: true
          }
        },
        _count: {
          select: { comments: true }
        }
      }
    })

    if (!sentence) {
      return NextResponse.json({ error: 'Sentence not found' }, { status: 404 })
    }

    // Fetch labels for annotations (including handling unknown/-99)
    // Optimize: fetch all nodes in one query instead of N queries
    const annotationsToLookup = sentence.annotations.filter(ann => !isUnknownNodeCode(ann.nodeCode))
    
    const annotationTaxonomyIds = new Set<string>()
    const annotationCodes = new Set<string>()
    annotationsToLookup.forEach(ann => {
      annotationTaxonomyIds.add(ann.taxonomyId)
      annotationCodes.add(ann.nodeCode)
    })
    
    const annotationNodesPromise = annotationTaxonomyIds.size > 0 && annotationCodes.size > 0
      ? prisma.taxonomyNode.findMany({
          where: {
            taxonomyId: { in: Array.from(annotationTaxonomyIds) },
            code: { in: Array.from(annotationCodes) }
          },
          select: {
            taxonomyId: true,
            code: true,
            label: true,
            definition: true,
            isLeaf: true
          }
        })
      : Promise.resolve([])
    
    const aiSuggestionsPromise = prisma.sentenceAISuggestion.findMany({
      where: {
        sentenceId: sentenceId
      },
      include: {
        taxonomy: {
          select: { key: true }
        }
      },
      orderBy: [
        { taxonomyId: 'asc' },
        { level: 'asc' }
      ]
    })
    
    const [annotationNodes, aiSuggestions] = await Promise.all([annotationNodesPromise, aiSuggestionsPromise])
    
    const nodeLookup = new Map<string, { label: string; definition: string | null; isLeaf: boolean | null }>()
    annotationNodes.forEach(node => {
      nodeLookup.set(`${node.taxonomyId}:${node.code}`, {
        label: node.label,
        definition: node.definition,
        isLeaf: node.isLeaf
      })
    })
    
    // Map annotations with labels
    const annotationsWithLabels = sentence.annotations.map((ann) => {
      if (isUnknownNodeCode(ann.nodeCode)) {
        return {
          ...ann,
          nodeLabel: 'Unknown'
        }
      }
      
      const key = `${ann.taxonomyId}:${ann.nodeCode}`
      const node = nodeLookup.get(key)
      
      return {
        ...ann,
        nodeLabel: node?.label || '',
        nodeDefinition: node?.definition || null,
        isLeaf: node?.isLeaf || false
      }
    })

    // Fetch AI suggestions for this sentence (always fetch, will be filtered by taxonomy in frontend)
    // Combine user annotations with AI suggestions
    // For each taxonomy, show user annotations if they exist, otherwise show AI suggestions
    // Response objects only: user annotations and AI suggestions have different shapes
    const taxonomyAnnotations = new Map<string, Array<Record<string, unknown>>>()
    
    // Group user annotations by taxonomy
    annotationsWithLabels.forEach(ann => {
      const key = ann.taxonomy.key
      if (!taxonomyAnnotations.has(key)) {
        taxonomyAnnotations.set(key, [])
      }
      taxonomyAnnotations.get(key)!.push({
        ...ann,
        source: 'user' as const
      })
    })
    
    // Add AI suggestions for taxonomies that don't have user annotations
    if (aiSuggestions.length > 0) {
      // Fetch node labels for AI suggestions
      const aiTaxonomyIds = new Set(aiSuggestions.map(s => s.taxonomyId))
      const aiCodes = new Set(aiSuggestions.map(s => s.nodeCode))
      
      const aiNodes = await prisma.taxonomyNode.findMany({
        where: {
          taxonomyId: { in: Array.from(aiTaxonomyIds) },
          code: { in: Array.from(aiCodes) }
        },
        select: {
          taxonomyId: true,
          code: true,
          label: true,
          definition: true,
          isLeaf: true
        }
      })
      
      const aiNodeMap = new Map(
        aiNodes.map(n => [`${n.taxonomyId}-${n.code}`, n])
      )
      
      // Group AI suggestions by taxonomy
      const aiSuggestionsByTaxonomy = new Map<string, typeof aiSuggestions>()
      aiSuggestions.forEach(suggestion => {
        const key = suggestion.taxonomy.key
        if (!aiSuggestionsByTaxonomy.has(key)) {
          aiSuggestionsByTaxonomy.set(key, [])
        }
        aiSuggestionsByTaxonomy.get(key)!.push(suggestion)
      })
      
      // Add all AI suggestions for taxonomies that don't have user annotations
      aiSuggestionsByTaxonomy.forEach((suggestions, key) => {
        // Only add AI suggestions if there are no user annotations for this taxonomy
        if (!taxonomyAnnotations.has(key)) {
          taxonomyAnnotations.set(key, [])
          // Add all AI suggestions for this taxonomy
          suggestions.forEach(suggestion => {
            const node = aiNodeMap.get(`${suggestion.taxonomyId}-${suggestion.nodeCode}`)
            taxonomyAnnotations.get(key)!.push({
              id: suggestion.id,
              level: suggestion.level,
              nodeCode: suggestion.nodeCode,
              nodeLabel: node?.label || null,
              nodeDefinition: node?.definition || null,
              isLeaf: node?.isLeaf || false,
              source: 'ai' as const,
              confidenceScore: suggestion.confidenceScore,
              taxonomy: {
                key: suggestion.taxonomy.key,
              }
            })
          })
        }
      })
    }
    
    // Flatten back to array
    const finalAnnotations = Array.from(taxonomyAnnotations.values()).flat()

    // Replace annotations with enriched version
    const enrichedSentence = {
      ...sentence,
      annotations: finalAnnotations
    }

    // Check visibility permissions
    if (session.user.role === 'labeller') {
      // Labellers can only see their assigned sentences
      const isAssigned = enrichedSentence.assignments.some(a => a.userId === session.user.id)
      if (!isAssigned) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    } else if (session.user.role === 'supervisor') {
      const visibleUserIds = new Set<string>([session.user.id])
      let frontier = [session.user.id]
      
      while (frontier.length > 0) {
        const labellers = await prisma.user.findMany({
          where: { supervisorId: { in: frontier } },
          select: { id: true }
        })
        const newIds = labellers
          .map(l => l.id)
          .filter(id => !visibleUserIds.has(id))
        newIds.forEach(id => visibleUserIds.add(id))
        frontier = newIds
      }
      
      const isVisible = enrichedSentence.assignments.some(a => visibleUserIds.has(a.userId))
      
      if (!isVisible) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }
    // Admins can see all sentences

    return NextResponse.json(enrichedSentence)
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
