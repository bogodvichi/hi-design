# hidesign-web



## QuickStart

<!-- add docs here for user -->

see [egg docs][egg] for more detail.

### Development

```bash
$ npm i
$ npm run dev
$ open http://localhost:7002/
```

### Deploy

```bash
$ npm start
$ npm stop
```

### npm scripts

- Use `npm run lint` to check code style.
- Use `npm test` to run unit test.
- Use `npm run autod` to auto detect dependencies upgrade, see [autod](https://www.npmjs.com/package/autod) for more detail.


[egg]: https://eggjs.org

## Identity and ownership repair rollout

The identity repair changes are a coordinated client/server upgrade. They are
not an automatic production migration. Keep existing IDs and content; a share
adds grants and never changes the original owner. Only the transfer operation
may change a project's home workspace.

1. Back up the affected database and validate restoration in a staging database.
2. Apply the additive `scripts/018_identity_ownership.sql` migration. It adds a
   nullable folder-owner column and index; it does not reassign existing rows.
3. With Node 24 and a **read-only** `DATABASE_URL`, run
   `node scripts/identity-repair.ts --plan /path/to/private-plan.json` against a
   restored snapshot first. Review every proposed change and every unresolved
   record. Do not enable strict authorization while affected active users still
   have unresolved bindings. The plan is not proof that all historical owner
   overwrites can be reconstructed: valid-but-wrong owners require additional
   creation/history evidence and human review.
   For an owner explicitly confirmed by the operator, an optional private JSON
   array of account names can be supplied with
   `--confirmed-personal-owners /path/to/confirmed-owners.json` in plan mode.
   This only repairs a `system` placeholder at that account's exact canonical
   personal-member ID when historical share, project and resource owners all
   agree. It never creates memberships or renames another real account. Review
   the membership change together with ownership changes; apply and rollback
   perform them in the same transaction and preserve the existing member ID.
4. Release the matching daemon/client first. Check that the gateway forwards
   `x-hdw-username` and `x-hdw-oa-session` to the service without logging them.
   The latter carries the existing OA session for server-side verification;
   merely supplying a member ID or username does not authorize a request.
   The service also accepts its existing signed login JWT. Old clients whose
   gateway strips cookies must be upgraded before enforcing private-resource
   reads or mutations; those operations have no unauthenticated fallback.
   Public Skill/MCP catalogs remain readable without a session when the query
   explicitly selects both a supported kind and `scope=public`. Exact resource
   reads verify persisted visibility and workspace; materialization and blob
   downloads are limited to the current published version of active public
   Skill/MCP resources. Private resources, drafts, and mutations still require
   a verified session. Test retained sessions and account switching.
   The audited 0.21.3 package sends project, Skill, and MCP shared-with-me
   list requests with username hints but no session credentials. Forwarding
   Cookie alone cannot make those requests compatible; upgrade that client
   before enforcement. Replay captured request shapes against the new guard
   without production writes, then validate the upgraded package with real
   owner and recipient sessions through its actual configured API prefix.
5. Generate a fresh production plan. Use a controlled write credential with
   `node scripts/identity-repair.ts --apply /path/to/private-plan.json` only
   after review. The tool revalidates the plan, rejects concurrent binding
   changes, applies it transactionally, and saves a private receipt. Keep plan
   and receipt out of Git. A receipt is prepared before SQL commit so loss of
   the process/connection requires checking the database before assuming success.
   It locks only repaired rows, with a five-second lock timeout; a serialization
   conflict aborts the whole operation. Re-preview after a conflict. Exercise
   this on a production-sized restore to measure contention before rollout.
6. Deploy the matching service after the binding checks pass. Validate two
   different accounts, personal/team spaces, owner/member/guest roles, sharing
   and revocation, same-name Skill/MCP resources, cross-space moves, failed
   folder association and retry, public preview assets, and existing clients.
   Source tests do not replace gateway or packaged-client acceptance.

Before the comment acceptance test, have the database administrator verify that
the application role has `USAGE` on `public.project_comments_seq_seq`. A table
grant does not grant access to its sequence, and `seq = DEFAULT` still requires
the connecting role's sequence privilege. Grant only that sequence to the
actual application role in the confirmed target database; do not change table
ownership or grant superuser. Verify that a recipient's comment reaches the
owner and that the owner can resolve/delete it without changing its author.
For an empty legacy comment table, the table owner can instead run
`scripts/019_comment_sequence_access.sql`. It creates an application-owned
sequence only when the current default is inaccessible and the table is empty.
It preserves the old sequence and refuses populated relays; those still need
the administrator grant. Re-running it after migration preserves the cursor.

The production start script defaults to four Egg workers. Each worker keeps a
singleton pool with zero idle minimum and two maximum connections: eight per
service, sixteen for two instances. Include other applications and PostgreSQL's
reserved connections in the deployment budget. Custom process managers must
also set the worker count; changing source defaults does not resize running
workers. SQLSTATE `53300` means too many connections, not a capacity of 53300.
Roll out pool/worker changes separately from strict authentication when older
clients are still active, then check aggregate sessions under representative load.

For a reviewed rollback, use
`node scripts/identity-repair.ts --rollback /path/to/private-plan.json.receipt.json`.
Rollback also compares current values before changing them and refuses to
replace subsequent ownership changes. It only reverses the listed bindings;
it does not delete projects, versions, files, or memberships. If enforcement
must be rolled back, coordinate that service decision separately from database
restoration; returning to the old service also returns its known auth defects.

Offline identity regression tests (no OA or production database access):

```bash
node --test test/app/controller/api/identity-audit-regressions.test.ts test/app/controller/api/workspace-access.test.ts test/app/controller/api/identity-repair-transaction.test.ts
```

`app/utils/workspace-access.js` remains CommonJS because the existing Egg 2
service has no TypeScript runtime loader. The recovery tool and new tests use
TypeScript on Node 24. Repository-wide TypeScript/guard checks do not cover this
legacy service; run its regression tests separately.
