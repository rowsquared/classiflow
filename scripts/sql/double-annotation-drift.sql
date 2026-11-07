-- Double annotation drift check (docs/plans/double-annotation-v2.md phase A).
-- Lists taxonomies of completed rounds whose record labels were written after
-- the confirmation (by an ordinary save, before v2 made participants' saves
-- their own revisions) or differ from DoubleOutcome.resultCodes. Run it after
-- migration 20261107120000 and let a reviewer decide the listed records again.
-- Read-only; run as the schema owner (row security hides other workspaces).
SELECT s."workspaceId", s."recordKey", t.key AS taxonomy, o.state, o."resultCodes",
       array_agg(a."nodeCode" ORDER BY a.level) AS current_codes
FROM "DoubleOutcome" o
JOIN "DoubleRound" r ON r.id = o."roundId" AND r.status = 'completed'
JOIN "Sentence" s ON s.id = o."sentenceId"
JOIN "Taxonomy" t ON t.id = o."taxonomyId"
LEFT JOIN "SentenceAnnotation" a ON a."sentenceId" = o."sentenceId" AND a."taxonomyId" = o."taxonomyId" AND a.source = 'user'
WHERE cardinality(o."resultCodes") > 0
  AND NOT EXISTS (SELECT 1 FROM "DoubleRound" newer WHERE newer."sentenceId" = r."sentenceId" AND newer.status <> 'cancelled' AND newer."createdAt" > r."createdAt")
GROUP BY s."workspaceId", s."recordKey", t.key, o.state, o."resultCodes", o."reviewedById"
HAVING array_agg(a."nodeCode" ORDER BY a.level) IS DISTINCT FROM o."resultCodes"
    OR bool_or(a."createdAt" > COALESCE(o."reviewedAt", o."comparedAt", r."closedAt") + interval '5 seconds');
