# Retired design-system catalog

Standalone design systems are retired. The app no longer ships their plugins,
registers their API or CLI commands, or injects a selected system into prompts.
Ordinary templates retain their own HTML/CSS and may use a user-supplied brand
reference. Migration and extraction workflows preserve source styles by default.

`_schema/` retains generic token contracts and historical manifest validation
used by existing tooling. The canonical token schema lives in
`packages/contracts/src/design-systems/token-schema.ts`. This directory is not a
runtime catalog and is excluded from packaged resource trees.

Upgrade clears the legacy project binding without deleting projects, files,
messages, snapshots, or user-authored `DESIGN.md` documents. The legacy database
column and historical contract fields remain readable for compatibility.
