CREATE INDEX "SentenceAnnotation_taxonomyId_idx" ON "SentenceAnnotation"("taxonomyId");

UPDATE "WorkspaceMembership" AS member
SET "supervisorMembershipId" = NULL
FROM "WorkspaceMembership" AS supervisor
WHERE member."workspaceId" = supervisor."workspaceId"
  AND member."supervisorMembershipId" = supervisor.id
  AND (supervisor.role = 'labeller' OR supervisor.status <> 'active');

-- Workspace deletion removes its audit rows with the parent, without giving
-- the runtime role general permission to edit or delete the audit trail.
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_workspaceId_fkey";
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION app_prune_audit_log(before timestamp)
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
DECLARE
  deleted integer;
BEGIN
  DELETE FROM "AuditLog"
  WHERE "createdAt" < LEAST(before, (now() AT TIME ZONE 'UTC') - interval '1 day');
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END
$$;
