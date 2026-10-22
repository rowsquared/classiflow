-- Audit log retention (lib/audit.ts pruneAuditLog, AUDIT_RETENTION_DAYS).
-- Row security keeps the runtime role inside one workspace's entries (or the
-- platform's), so pruning across workspaces runs as the schema owner. The
-- function deletes only entries older than the given time and returns how
-- many; it is granted to the runtime role alone (scripts/db-runtime-role.ts).
CREATE FUNCTION app_prune_audit_log(before timestamp)
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
DECLARE
  deleted integer;
BEGIN
  DELETE FROM "AuditLog" WHERE "createdAt" < before;
  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END
$$;
REVOKE ALL ON FUNCTION app_prune_audit_log(timestamp) FROM PUBLIC;
