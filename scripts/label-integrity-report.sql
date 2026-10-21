-- Read-only report: human labels that break the rules enforced since October
-- 2026 (lib/label-path.ts, lib/annotation-status.ts). Changes nothing.
--
--   docker compose exec -T postgres psql -U classiflow -d classiflow < scripts/label-integrity-report.sql
--
-- Each query lists offending rows; an empty result means none. Decide on any
-- repair separately and review it before running it.

\echo '1. Codes that do not exist in their taxonomy (unknown codes excluded)'
SELECT t.key AS taxonomy, a."sentenceId", a.level, a."nodeCode"
FROM "SentenceAnnotation" a
JOIN "Taxonomy" t ON t.id = a."taxonomyId"
LEFT JOIN "TaxonomyNode" n ON n."taxonomyId" = a."taxonomyId" AND n.code = a."nodeCode"
WHERE a.source = 'user'
  AND a."nodeCode" NOT IN ('-9', '-99', '-999', '-9999', '-99999')
  AND n.id IS NULL
ORDER BY 1, 2, 3;

\echo '2. Paths with gaps (levels are not exactly 1..N)'
SELECT t.key AS taxonomy, a."sentenceId", array_agg(a.level ORDER BY a.level) AS levels
FROM "SentenceAnnotation" a
JOIN "Taxonomy" t ON t.id = a."taxonomyId"
WHERE a.source = 'user'
GROUP BY 1, 2
HAVING max(a.level) <> count(*)
ORDER BY 1, 2;

\echo '3. Broken parent links (code at level L is not a child of the code at L-1)'
SELECT t.key AS taxonomy, child."sentenceId", child.level, parent."nodeCode" AS parent_label, child."nodeCode" AS child_label, n."parentCode" AS actual_parent
FROM "SentenceAnnotation" child
JOIN "SentenceAnnotation" parent
  ON parent."sentenceId" = child."sentenceId" AND parent."taxonomyId" = child."taxonomyId"
 AND parent.level = child.level - 1 AND parent.source = 'user'
JOIN "TaxonomyNode" n ON n."taxonomyId" = child."taxonomyId" AND n.code = child."nodeCode"
JOIN "Taxonomy" t ON t.id = child."taxonomyId"
WHERE child.source = 'user'
  AND n."parentCode" IS DISTINCT FROM parent."nodeCode"
ORDER BY 1, 2, 3;

\echo '4. Paths ending in a non-leaf code'
WITH last AS (
  SELECT DISTINCT ON ("sentenceId", "taxonomyId") "sentenceId", "taxonomyId", level, "nodeCode"
  FROM "SentenceAnnotation"
  WHERE source = 'user'
  ORDER BY "sentenceId", "taxonomyId", level DESC
)
SELECT t.key AS taxonomy, l."sentenceId", l.level, l."nodeCode"
FROM last l
JOIN "Taxonomy" t ON t.id = l."taxonomyId"
WHERE l."nodeCode" NOT IN ('-9', '-99', '-999', '-9999', '-99999')
  AND EXISTS (
    SELECT 1 FROM "TaxonomyNode" c
    WHERE c."taxonomyId" = l."taxonomyId" AND c."parentCode" = l."nodeCode"
  )
ORDER BY 1, 2;

\echo '5. Submitted records missing human labels for an active taxonomy'
SELECT s.id AS "sentenceId", t.key AS missing_taxonomy
FROM "Sentence" s
CROSS JOIN "Taxonomy" t
WHERE s.status = 'submitted'
  AND t."isActive"
  AND NOT EXISTS (
    SELECT 1 FROM "SentenceAnnotation" a
    WHERE a."sentenceId" = s.id AND a."taxonomyId" = t.id AND a.source = 'user'
  )
ORDER BY 2, 1;

\echo '6. Duplicates moved aside by the 20261021100000 migration (review, then DROP SCHEMA classiflow_backup CASCADE)'
SELECT table_name AS backup_table,
       (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM classiflow_backup.%I', table_name), false, true, '')))[1]::text::int AS rows
FROM information_schema.tables
WHERE table_schema = 'classiflow_backup';
