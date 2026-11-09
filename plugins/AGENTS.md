# Plugin Directory Guide

This directory owns HiDesign plugin content and plugin authoring material.

## Boundaries

- `plugins/_official/` contains bundled first-party plugins. The daemon discovers this subtree on catalog/reference reads and registers individual references as `source_kind='bundled'`; login does not wait for full registration.
- `plugins/spec/` is the portable plugin specification and authoring kit. It is documentation, starter material, and example source for contributors and external agents; it must not be treated as an installed first-party catalog.
- Keep runnable plugin examples portable: every example should have a `SKILL.md`; add `open-design.json` only as the OD sidecar.
- Keep `SKILL.md` bodies free of OD-only marketplace metadata. Put OD display, inputs, preview, pipeline, capabilities, and source information in `open-design.json`.
- Do not import app-private code from plugin content. A plugin may reference OD atoms, craft docs, assets, scripts, MCP servers, or connectors through the manifest.

## Authoring Rules

- New spec examples belong under `plugins/spec/examples/<plugin-id>/`.
- New first-party bundled plugins belong under `plugins/_official/<tier>/<plugin-id>/` only when the product should ship them in its default catalog.
- Use the v1 JSON schema at `docs/schemas/open-design.plugin.v1.json`.
- Contribution-facing spec docs are bilingual. When editing `README.md`, `SPEC.md`, `CONTRIBUTING.md`, `AGENT-DEVELOPMENT.md`, or example README files under `plugins/spec/`, update the matching `*.zh-CN.md` mirror in the same change.
- Prefer TypeScript for project-owned scripts. Avoid adding new `.js`, `.mjs`, or `.cjs` files unless they are generated, vendored, or explicitly allowlisted by `scripts/guard.ts`.
- Keep example plugins concise and agent-readable. Move long reference material to `references/` and tell the agent when to load it.

## Validation

For plugin content changes, run:

```bash
pnpm guard
pnpm --filter @open-design/plugin-runtime typecheck
```

When the daemon CLI is built and available, also validate runnable plugin folders with:

```bash
od plugin validate ./plugins/spec/examples/<plugin-id>
```

Standalone design-system plugins are retired. Do not add `od.context.designSystem` or `od.design_system` declarations; legacy declarations are ignored. Templates own their styles and may use an explicitly supplied brand reference.
