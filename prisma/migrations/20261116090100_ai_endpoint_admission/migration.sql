-- Keep the four-argument function for instances running the previous release.
CREATE FUNCTION app_admit_ai_jobs(per_workspace integer, deployment integer, per_endpoint integer, owner text, lease_until timestamp)
  RETURNS TABLE (kind text, id text, "workspaceId" text)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
#variable_conflict use_column
DECLARE
  chosen record;
  admitted integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('classiflow:ai-job-admission'));
  WHILE admitted < deployment LOOP
    WITH jobs AS (
      SELECT 'labeling'::text AS kind, j.id, j."workspaceId", j.status, j."startedAt", j."connectionVersionId"
      FROM "AILabelingJob" j WHERE j.status IN ('pending', 'processing')
      UNION ALL
      SELECT 'learning', j.id, j."workspaceId", j.status, j."startedAt", j."connectionVersionId"
      FROM "AILearningJob" j WHERE j.status IN ('pending', 'processing')
      UNION ALL
      SELECT 'sync', j.id, j."workspaceId", j.status, j."startedAt", j."connectionVersionId"
      FROM "AITaxonomySyncJob" j WHERE j.status IN ('pending', 'processing')
    ), endpoints AS (
      SELECT jobs.*, v."endpointId" FROM jobs JOIN "AIConnectionVersion" v
        ON v.id = jobs."connectionVersionId" AND v."workspaceId" = jobs."workspaceId"
    ), running_workspace AS (
      SELECT e."workspaceId", count(*) AS n FROM endpoints e WHERE e.status = 'processing' GROUP BY e."workspaceId"
    ), running_endpoint AS (
      SELECT e."endpointId", count(*) AS n FROM endpoints e WHERE e.status = 'processing' GROUP BY e."endpointId"
    )
    SELECT q.kind, q.id, q."workspaceId" INTO chosen
    FROM endpoints q
    LEFT JOIN running_workspace w ON w."workspaceId" = q."workspaceId"
    LEFT JOIN running_endpoint e ON e."endpointId" = q."endpointId"
    WHERE q.status = 'pending'
      AND COALESCE(w.n, 0) < per_workspace
      AND COALESCE(e.n, 0) < per_endpoint
      AND (SELECT count(*) FROM jobs WHERE jobs.status = 'processing') < deployment
    ORDER BY COALESCE(w.n, 0), q."startedAt", q.id
    LIMIT 1;
    EXIT WHEN NOT FOUND;

    IF chosen.kind = 'labeling' THEN
      UPDATE "AILabelingJob" SET status = 'processing', "leaseOwner" = owner, "leaseExpiresAt" = lease_until
        WHERE "AILabelingJob".id = chosen.id AND "AILabelingJob".status = 'pending';
    ELSIF chosen.kind = 'learning' THEN
      UPDATE "AILearningJob" SET status = 'processing', "leaseOwner" = owner, "leaseExpiresAt" = lease_until
        WHERE "AILearningJob".id = chosen.id AND "AILearningJob".status = 'pending';
    ELSE
      UPDATE "AITaxonomySyncJob" SET status = 'processing', "leaseOwner" = owner, "leaseExpiresAt" = lease_until
        WHERE "AITaxonomySyncJob".id = chosen.id AND "AITaxonomySyncJob".status = 'pending';
    END IF;
    IF FOUND THEN
      admitted := admitted + 1;
      kind := chosen.kind;
      id := chosen.id;
      "workspaceId" := chosen."workspaceId";
      RETURN NEXT;
    END IF;
  END LOOP;
END
$$;
REVOKE ALL ON FUNCTION app_admit_ai_jobs(integer, integer, integer, text, timestamp) FROM PUBLIC;
