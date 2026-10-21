# Integration tests

Route handlers are imported and called directly against a real PostgreSQL
database. `auth()` is mocked; `signInAs(user)` in `helpers.ts` chooses the caller,
the way the JWT would carry it. Everything else (Prisma, transactions, access
rules) is the production code.

```bash
docker exec classiflow-dev-postgres createdb -U classiflow classiflow_test   # once
TEST_DATABASE_URL=postgresql://classiflow:classiflow_password@localhost:5434/classiflow_test npm run test:integration
```

The database name must end in `_test`: migrations are applied to it and every
test file truncates all tables. CI runs the same command against a service
container (`integration` job in `.github/workflows/ci.yml`).

Add a test here for every access rule or data invariant you change, and check
that it fails without the fix.
