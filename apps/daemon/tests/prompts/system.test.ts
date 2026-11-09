import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { INTEGRATIONS_MCP_PATH } from '@open-design/contracts';

import {
  composeSystemPrompt,
  renderConnectedExternalMcpDirective,
  resolveExclusiveSurface,
} from '../../src/prompts/system.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../..');
// Bundled examples are distributed through the official plugin registry.
const liveArtifactRoot = path.join(repoRoot, 'plugins/_official/examples/live-artifact');
const liveArtifactSkillPath = path.join(
  repoRoot,
  'plugins/_official/examples/live-artifact/SKILL.md',
);
const liveArtifactSkillMarkdown = readFileSync(liveArtifactSkillPath, 'utf8');
const liveArtifactSkillBody = [
  `> **Skill root (absolute):** \`${liveArtifactRoot}\``,
  '>',
  '> This skill ships side files alongside `SKILL.md`. When the workflow',
  '> below references side files such as `references/artifact-schema.md`, resolve',
  '> them against the skill root above and open them via their full absolute path.',
  '>',
  '> Known side files in this skill: `references/artifact-schema.md`, `references/connector-policy.md`, `references/refresh-contract.md`.',
  '',
  '',
  liveArtifactSkillMarkdown.replace(/^---[\s\S]*?---\n\n/, '').trim(),
].join('\n');

// HyperFrames uses the same official example registry.
const hyperframesRoot = path.join(repoRoot, 'plugins/_official/examples/hyperframes');
const hyperframesSkillPath = path.join(
  repoRoot,
  'plugins/_official/examples/hyperframes/SKILL.md',
);
const hyperframesSkillMarkdown = readFileSync(hyperframesSkillPath, 'utf8');
const hyperframesSkillBody = [
  `> **Skill root (absolute):** \`${hyperframesRoot}\``,
  '>',
  '> This skill ships side files alongside `SKILL.md`. Resolve references',
  '> like `references/html-in-canvas.md` against the skill root above.',
  '',
  '',
  hyperframesSkillMarkdown.replace(/^---[\s\S]*?---\n\n/, '').trim(),
].join('\n');

describe('composeSystemPrompt — activeStageBlocks splice (spec §23.4)', () => {
  it('inserts every active stage block after the plugin block when supplied', () => {
    const stage1 = '\n\n## Active stage: discovery\n\n### discovery-question-form\n\nAsk audience.';
    const stage2 = '\n\n## Active stage: plan\n\n### todo-write\n\nCommit a plan.';
    const prompt = composeSystemPrompt({
      pluginBlock: '\n\n## Active plugin\n\nThe user applied test-plugin.',
      activeStageBlocks: [stage1, stage2],
    });
    expect(prompt).toContain('## Active plugin');
    expect(prompt.indexOf('## Active stage: discovery')).toBeGreaterThan(prompt.indexOf('## Active plugin'));
    expect(prompt.indexOf('## Active stage: plan')).toBeGreaterThan(prompt.indexOf('## Active stage: discovery'));
  });

  it('skips empty / whitespace-only blocks', () => {
    const prompt = composeSystemPrompt({
      activeStageBlocks: ['', '   ', '\n\n## Active stage: critique\n\n### critique-theater\n\nScore.'],
    });
    expect(prompt).toContain('## Active stage: critique');
    // Only one stage block means just one heading.
    expect((prompt.match(/## Active stage:/g) ?? []).length).toBe(1);
  });

  it('is a no-op when activeStageBlocks is undefined or empty', () => {
    const baseline = composeSystemPrompt({});
    const withUndefined = composeSystemPrompt({ activeStageBlocks: undefined });
    const withEmpty = composeSystemPrompt({ activeStageBlocks: [] });
    expect(withUndefined).toBe(baseline);
    expect(withEmpty).toBe(baseline);
  });
});

describe('composeSystemPrompt', () => {
  it('injects Chinese quick brief guidance when the UI locale is zh-CN', () => {
    const prompt = composeSystemPrompt({ locale: 'zh-CN' });

    expect(prompt).toContain('# UI locale override');
    expect(prompt).toContain('`zh-CN` (Simplified Chinese)');
    expect(prompt).toContain('快速简报 — 30 秒');
    expect(prompt).toContain('目标用户');
    expect(prompt).toContain('视觉调性');
    expect(prompt).toContain('Keep machine-readable ids and object option `value` fields exact and unlocalized');
  });

  it('ignores legacy Ask and Plan mode values', () => {
    const baseline = composeSystemPrompt({});

    expect(composeSystemPrompt({ sessionMode: 'chat' })).toBe(baseline);
    expect(composeSystemPrompt({ sessionMode: 'plan' })).toBe(baseline);
    expect(baseline).not.toContain('# Ask mode');
    expect(baseline).not.toContain('# Plan mode');
  });

  it('injects the converged verification policy (no mid-build screenshot looping)', () => {
    const prompt = composeSystemPrompt({});

    // Verification must read as an end-of-turn, single-pass step.
    expect(prompt).toContain('## Verification — converge at the end, in one pass');
    // The hard cap on rendered visual checks — the lever against codex's
    // self-initiated 6-12x screenshot retry chains that balloon input tokens.
    expect(prompt).toContain('One render check is the budget');
    expect(prompt).toContain('Do not loop');
    // Safety valve: visual verification is converged, NOT removed.
    expect(prompt).toContain('these justify ONE rendered look');
    // Route to the official wrapper, not a self-launched browser.
    expect(prompt).toContain('Do NOT launch your own browser to do this');
  });

  it('does not inject a default task-type form under locale overrides', () => {
    const prompt = composeSystemPrompt({ locale: 'zh-CN' });

    expect(prompt).not.toContain('<question-form id="task-type"');
    expect(prompt).not.toContain('keep the `taskType` option labels');
  });

  it('keeps zh-TW locale guidance without injecting the router form', () => {
    const prompt = composeSystemPrompt({ locale: 'zh-TW' });

    expect(prompt).toContain('# UI locale override');
    expect(prompt).toContain('`zh-TW` (Traditional Chinese)');
    expect(prompt).not.toContain('<question-form id="task-type"');
    expect(prompt).not.toContain('keep the `taskType` option labels');
    expect(prompt).not.toContain('快速简报 — 30 秒');
  });

  it('uses stable brand option values for discovery-form branching', () => {
    const prompt = composeSystemPrompt({});
    expect(prompt).toContain('{ "label": "Pick a direction for me", "value": "pick_direction" }');
    expect(prompt).toContain('{ "label": "I have a brand spec — I\'ll share it", "value": "brand_spec" }');
    expect(prompt).toContain('{ "label": "Match a reference site / screenshot — I\'ll attach it", "value": "reference_match" }');
    expect(prompt).toContain('When the answer line includes `[value: ...]`, use that stable value instead of the visible label.');
    expect(prompt).toContain('If you keep the `brand` question, its `id` must stay `"brand"`.');
    expect(prompt).toContain('you may drop the `brand` question as already answered, but you must still treat that provided source as Branch A below');
    expect(prompt).toContain('When skipping the form, do not skip brand-source handling');
    expect(prompt).toContain('If the current message, attachments, prior brief, or URL already contains an actual brand spec / brand guide / reference site / screenshot source, use Branch A.');
    expect(prompt).toContain('### Branch A — user provided a brand/reference source, or `brand` value is `"brand_spec"` / `"reference_match"`');
    expect(prompt).toContain('ask them to paste/upload the brand spec or reference and stop');
    expect(prompt).toContain('Do not guess a brand domain or invent tokens');
    expect(prompt).toContain('An user-supplied brand reference does not suppress Branch A when the user provides a brand/reference source');
    expect(prompt).toContain('### Branch B — no user-provided brand/reference source and no Branch A brand value');
    expect(prompt).toContain('user-supplied-reference cases where the user did not provide a new brand/reference source');
    expect(prompt).toContain('Provided brand/reference source → run brand-spec extraction');
    expect(prompt).toContain('`brand_spec` / `reference_match` without a provided source → ask for the source and stop; do not guess brand tokens.');
  });

  it('injects live-artifact skill guidance and metadata intent', () => {
    const prompt = composeSystemPrompt({
      skillName: 'live-artifact',
      skillMode: 'prototype',
      skillBody: liveArtifactSkillBody,
      metadata: {
        kind: 'prototype',
        intent: 'live-artifact',
      } as any,
    });

    expect(prompt).toContain('## Active skill — live-artifact');
    expect(prompt).toContain(`> **Skill root (absolute):** \`${liveArtifactRoot}\``);
    expect(prompt).not.toContain('**Pre-flight (do this before any other tool):** Read `assets/template.html`');
    expect(prompt).not.toContain('live-artifact/references/layouts.md');
    expect(prompt).not.toContain('live-artifact/assets/template.html');
    expect(prompt).toContain('`references/artifact-schema.md`');
    expect(prompt).toContain('`references/connector-policy.md`');
    expect(prompt).toContain('`references/refresh-contract.md`');
    expect(prompt).toContain('The wrapper reads injected `OD_NODE_BIN`, `OD_BIN`, `OD_DAEMON_URL`, and `OD_TOOL_TOKEN`');
    expect(prompt).toContain('Do not include or invent `projectId`; the daemon derives project/run scope from the token.');
    expect(prompt).toContain('"$OD_NODE_BIN" "$OD_BIN" tools live-artifacts create --input artifact.json');
    expect(prompt).toContain('if the user names a connector/source (for example Notion)');
    expect(prompt).toContain('list connectors before asking where the data comes from');
    expect(prompt).toContain('a connected `notion` connector plus a user brief that names Notion is enough to start with `notion.notion_search`');
    expect(prompt).toContain('Prefer the `live-artifact` skill workflow when available');
    expect(prompt).toContain('The first output should be a live artifact/dashboard/report');
  });

  // The daemon composer (this file) is what apps/daemon/src/server.ts wires
  // into live chat runs. The contracts copy at packages/contracts/src/prompts
  // /system.ts exists for non-daemon contexts and was updated in the
  // hyperframes PR; without this test the two copies drift silently and the
  // main HyperFrames flow misses its preflight directive in production.
  it('keeps the slim design charter out of media-surface prompts', () => {
    // Reviewer finding (#5603): with slim as the server default, the charter
    // head was composed before the media surface was known, so image/video/
    // audio runs carried the turn-1 discovery mandate and HTML handoff rules
    // alongside the media contract — two mutually exclusive workflow
    // authorities. The media contract must stay the only one.
    for (const surface of ['image', 'video', 'audio'] as const) {
      const prompt = composeSystemPrompt({
        promptCoreVariant: 'slim',
        skillMode: surface,
        metadata: { kind: surface } as any,
      });
      expect(prompt).not.toContain('# HiDesign Charter');
      expect(prompt).not.toContain('## Requirements Clarification Phase');
      expect(prompt).not.toContain('## Delivery');
      // Nor the Ask-mode charter (fourth-round finding): CHAT_MODE_OVERRIDE
      // forbids creating media, contradicting the media contract below.
      expect(prompt).not.toContain('# Ask mode');
      expect(prompt).toContain('media generate');
    }
    // Non-media slim runs keep the charter head.
    const design = composeSystemPrompt({ promptCoreVariant: 'slim' });
    expect(design).toContain('# HiDesign Charter');
    expect(design).toContain('## Requirements Clarification Phase');
  });

  it('pins Cloud nano-banana shorthand and forbids reading generated media bytes back into context', () => {
    const prompt = composeSystemPrompt({
      skillMode: 'image',
      metadata: { kind: 'image', imageModel: 'vela/nano-banana-2' } as any,
    });

    expect(prompt).toContain('`nano-banana` and `nano-banana-2` mean');
    expect(prompt).toContain('Do not call `Read` on the generated image');
  });

  it('injects the html-in-canvas preflight for the hyperframes skill', () => {
    const prompt = composeSystemPrompt({
      skillName: 'hyperframes',
      skillMode: 'video',
      skillBody: hyperframesSkillBody,
      metadata: {
        kind: 'video',
        videoModel: 'hyperframes-html',
      } as any,
    });

    expect(prompt).toContain('## Active skill — hyperframes');
    expect(prompt).toContain('**Pre-flight (do this before any other tool):**');
    expect(prompt).toContain('`references/html-in-canvas.md`');
    expect(prompt).toContain('`"$OD_NODE_BIN" "$OD_BIN" media scaffold`');
    expect(prompt).toContain('media generate --surface video --model hyperframes-html --composition-dir <rel>');
    expect(prompt).toContain('Do not run HyperFrames `render` yourself');
    expect(prompt).not.toContain('npx hyperframes');
    expect(prompt).not.toContain('intentionally rejected for this model');
    expect(prompt).not.toContain('AGENT_RENDERED');
    expect(prompt).not.toContain('rendered by you directly via npx');
  });

  it('keeps the official hyperframes skill aligned with the daemon render handoff', () => {
    expect(hyperframesSkillMarkdown).toContain('"$OD_NODE_BIN" "$OD_BIN" media scaffold');
    expect(hyperframesSkillMarkdown).toContain('media generate --surface video --model hyperframes-html --composition-dir <rel>');
    expect(hyperframesSkillMarkdown).toContain('Do not run HyperFrames `render`');
    expect(hyperframesSkillMarkdown).not.toContain('npx hyperframes');
    expect(hyperframesSkillMarkdown).not.toContain('AGENT_RENDERED');
    expect(hyperframesSkillMarkdown).not.toContain('rendered by you directly via npx');
    expect(hyperframesSkillMarkdown).not.toContain('dispatcher path returns a 400');
  });

  it('does not add the responsive web contract to deck metadata without platform fields', () => {
    const prompt = composeSystemPrompt({
      metadata: {
        kind: 'deck',
        speakerNotes: true,
        slideCount: '10-15 pages',
      } as any,
    });

    expect(prompt).toContain('- **kind**: deck');
    expect(prompt).toContain('- **slideCount**: 10-15 pages');
    expect(prompt).not.toContain('**responsive web contract**');
    expect(prompt).not.toContain('**platformTargets**');
  });

  it('tells artifact generation to summarize instead of dumping raw HTML source into chat', () => {
    const prompt = composeSystemPrompt({
      metadata: { kind: 'prototype', fidelity: 'production' } as any,
    });

    expect(prompt).toContain('Do not dump the full raw HTML source back into chat');
    expect(prompt).toContain('the assistant message should only summarize the result');
  });

  it('uses the primary skill surface when composed skill modes conflict', () => {
    const prompt = composeSystemPrompt({
      skillMode: 'image',
      skillModes: ['deck', 'image'],
    });

    expect(prompt).toContain('## Media generation contract');
    expect(prompt).not.toContain('# Slide deck — fixed framework');
  });

  it('lets metadata.kind win over conflicting composed skill modes', () => {
    const prompt = composeSystemPrompt({
      skillMode: 'image',
      skillModes: ['deck', 'image'],
      metadata: { kind: 'deck' } as any,
    });

    expect(prompt).toContain('# Slide deck — fixed framework');
    expect(prompt).not.toContain('## Media generation contract');
  });

  it('pins the data chart discipline inside the deck framework (#907)', () => {
    const prompt = composeSystemPrompt({ skillMode: 'deck' });

    expect(prompt).toContain('## Data chart discipline');
    expect(prompt).toContain('calc(var(--v) / var(--max)');
    expect(prompt).toContain('visible category label AND value label');
    expect(prompt).toContain('Mentally spot-check two bars');
  });

  it('pins the mermaid theme discipline inside the deck framework (dark decks)', () => {
    const prompt = composeSystemPrompt({ skillMode: 'deck' });

    expect(prompt).toContain('## Mermaid diagram theme discipline');
    expect(prompt).toContain("theme: 'dark'");
    expect(prompt).toContain('themeVariables');
    expect(prompt).toContain('no dark-on-dark labels');
  });

  it('injects nested-diagram discipline only through deck surfaces', () => {
    const heading = '## Nested / concentric diagram discipline';

    expect(composeSystemPrompt({ skillMode: 'deck' })).toContain(heading);
    expect(composeSystemPrompt({ metadata: { kind: 'deck' } as any })).toContain(heading);
    expect(composeSystemPrompt({ metadata: { kind: 'prototype' } as any })).not.toContain(heading);
  });

  it('resolves a non-media primary surface ahead of composed media mentions', () => {
    expect(resolveExclusiveSurface({
      skillMode: 'deck',
      skillModes: ['deck', 'image'],
    })).toBe('deck');
  });

  describe('artifact handoff no-emit clauses (#1143)', () => {
    it('drops the absolute "non-negotiable" framing in favor of conditional language', () => {
      const prompt = composeSystemPrompt({});
      expect(prompt).not.toContain('non-negotiable output rule');
    });

    it('includes the "When NOT to emit <artifact>" sub-section', () => {
      const prompt = composeSystemPrompt({});
      expect(prompt).toContain('When NOT to emit `<artifact>`');
    });

    it('pins filesystem artifact handoff for AMR runs', () => {
      const prompt = composeSystemPrompt({ agentId: 'amr' });
      expect(prompt).toContain('## Filesystem handoff');
      expect(prompt).toContain('filesystem execution profile');
      expect(prompt).toContain("runtime's native tool-call interface");
      expect(prompt).toContain('Never type a tool invocation into assistant text');
      expect(prompt).toContain('This tool-call rule does not apply to HiDesign UI markup');
      expect(prompt).toContain('emit the complete `<question-form>...</question-form>` block directly');
      expect(prompt).toContain('Do not output generated source code in a `<artifact type="text/html">...</artifact>` block.');
    });

    it('uses Vela media defaults only for AMR and forbids direct Vela calls', () => {
      const amrPrompt = composeSystemPrompt({
        agentId: 'amr',
        metadata: { kind: 'image', imageModel: 'vela/gpt-image-2' } as any,
      });
      expect(amrPrompt).toContain('Image model: `vela/gpt-image-2`');
      expect(amrPrompt).toContain(
        'Video model: `vela/doubao-seedance-2-0-260128`',
      );
      expect(amrPrompt).toContain('### HiDesign Cloud media defaults');
      expect(amrPrompt).not.toContain('### Run-scoped BYOK media defaults');
      expect(amrPrompt).toContain('Never invoke the `vela` CLI directly');
      expect(amrPrompt).toContain('trusted Workspace attribution');

      const claudePrompt = composeSystemPrompt({ agentId: 'claude' });
      expect(claudePrompt).not.toContain('Image model: `vela/gpt-image-2`');
      expect(claudePrompt).toContain('`--model flux-pro-ultra`');
    });

    it('keeps image completion copy concrete while retaining internal diagnostics', () => {
      const imagePrompt = composeSystemPrompt({
        agentId: 'amr',
        locale: 'zh-CN',
        metadata: { kind: 'image', imageModel: 'vela/gpt-image-2' } as any,
      });
      expect(imagePrompt).toContain('reply exactly `图片已生成`');
      expect(imagePrompt).toContain('MEDIA_DISPATCH_FAILED');
      expect(imagePrompt).toContain('图片未生成：媒体生成调度失败，原因未分类');
      expect(imagePrompt).toContain('tool output and daemon logs');
      expect(imagePrompt).not.toContain('the filename, the model used');
      expect(imagePrompt).not.toContain('surface them verbatim to the user');
      expect(imagePrompt).not.toContain('quote the real stderr / exit code');

      const prototypePrompt = composeSystemPrompt({
        agentId: 'amr',
        locale: 'zh-CN',
        metadata: { kind: 'prototype' } as any,
      });
      expect(prototypePrompt).toContain('reply exactly `图片已生成`');
      expect(prototypePrompt).toContain('MEDIA_DISPATCH_FAILED');
      expect(prototypePrompt).toContain('图片未生成：媒体生成调度失败，原因未分类');
      expect(prototypePrompt).toContain('IMAGE_MODEL="vela/gpt-image-2"');
      expect(prototypePrompt).not.toContain(
        'For the best fal image model use `--model flux-pro-ultra`',
      );
    });

    // The provider-error branch has to reach the prompt the DAEMON composes,
    // not just the copy in packages/contracts. Reclassifying a provider verdict
    // as an outage hides the actionable code and message from the user.
    it('preserves structured provider errors in both prompts', () => {
      for (const metadata of [
        { kind: 'image', imageModel: 'vela/gpt-image-2' },
        { kind: 'prototype' },
      ]) {
        const prompt = composeSystemPrompt({
          agentId: 'amr',
          locale: 'zh-CN',
          metadata: metadata as any,
        });
        expect(prompt).toContain('错误代码：`{code}`');
        expect(prompt).toContain(
          'public code and message without reclassifying either one from wording or HTTP',
        );
      }
    });

    it('prioritizes question forms over native tool calls when clarifying', () => {
      const prompt = composeSystemPrompt({ agentId: 'amr' });
      expect(prompt).toContain('## Structured clarification on any turn');
      expect(prompt).toContain('`<question-form>` is assistant text for the HiDesign UI, not a native tool call');
      expect(prompt).toContain(
        'emit the complete `<question-form>...</question-form>` block directly in the assistant message before any TodoWrite, file write/edit, Bash, or other native tool call',
      );
      expect(prompt).toContain('Do not stop after an introductory sentence such as "先确认一下方向："');
    });

    it('pins filesystem artifact handoff for other CLI agents too', () => {
      const prompt = composeSystemPrompt({ agentId: 'gemini' });
      expect(prompt).toContain('## Filesystem handoff');
      expect(prompt).toContain("runtime's native tool-call interface");
    });

    it('does not pin filesystem artifact handoff in plain API mode', () => {
      const prompt = composeSystemPrompt({ agentId: 'deepseek', streamFormat: 'plain' });
      expect(prompt).not.toContain('## Filesystem handoff');
    });

    it('forbids wrapping in-place-edit-only turns in an artifact block', () => {
      const prompt = composeSystemPrompt({});
      expect(prompt).toMatch(/filesystem runs/i);
      expect(prompt).toMatch(/Do not emit a source-code `<artifact>` block/i);
    });

    it('forbids putting prose / summaries / paths inside an artifact block', () => {
      const prompt = composeSystemPrompt({});
      expect(prompt).toMatch(/summar(y|ies)|prose|file path/i);
      expect(prompt).toContain('Never wrap a summary, prose, file path reference, bash output, explanation, or full source file inside `<artifact>`.');
    });

    it('does not carry unconditional "Emit single <artifact>" / "emit a single <artifact>" lines anywhere in the composed prompt', () => {
      const prompt = composeSystemPrompt({});
      // Discovery layer used to carry hard-rule unconditional emit instructions
      // (plan template step 9, default arc Turn 3+ recap, deck workflow step 7).
      // Those must be conditional now — otherwise the no-emit exception in the
      // base prompt is overridden by the higher-priority discovery layer.
      expect(prompt).not.toMatch(/^- 9\.\s+Emit single <artifact>\s*$/m);
      expect(prompt).not.toMatch(/emit a single `?<artifact>`?\.\s*$/m);
      expect(prompt).not.toMatch(/^7\.\s+Emit single <artifact>\s*$/m);
    });

    it('declares filesystem file handoff at the dominant discovery layer', () => {
      const prompt = composeSystemPrompt({});
      // The base prompt is lower precedence than DISCOVERY_AND_PHILOSOPHY, so
      // filesystem handoff must be stated at the dominant layer too.
      expect(prompt).toMatch(/Filesystem handoff is canonical/i);
      expect(prompt).toMatch(/Do not emit a source-code `<artifact>` block/i);
    });

    it('defaults new deliverable filenames to semantic names instead of index.html', () => {
      const prompt = composeSystemPrompt({
        skillName: 'simple-deck',
        skillBody: 'Copy assets/template.html to index.html, then fill the deck.',
      });

      expect(prompt).toContain('## Semantic output file names');
      expect(prompt).toContain('Do not call every new artifact `index.html`');
      expect(prompt).toContain('adapt the destination to a semantic filename');
      expect(prompt.indexOf('## Semantic output file names')).toBeGreaterThan(
        prompt.indexOf('## Active skill — simple-deck'),
      );
    });

    it('also keeps deck-mode prompts free of the unconditional emit line (DECK_FRAMEWORK_DIRECTIVE only stacks for deck projects)', () => {
      // The plain composeSystemPrompt({}) call does NOT include
      // DECK_FRAMEWORK_DIRECTIVE; that directive only stacks when
      // `skillMode === 'deck'` or `metadata.kind === 'deck'`. So if
      // deck-framework.ts:327 ever regresses back to "Emit single <artifact>",
      // a no-args negative assertion is a false negative — exercise the deck
      // path explicitly here.
      const deckPrompt = composeSystemPrompt({ skillMode: 'deck' });
      expect(deckPrompt).not.toMatch(/^7\.\s+Emit single <artifact>\s*$/m);
      expect(deckPrompt).not.toContain('Copy the canonical skeleton below as index.html');
      expect(deckPrompt).toContain('semantically named deck HTML file');
      expect(deckPrompt).toMatch(/Summarize the written or changed deck file/i);
    });
  });

  // The connected-external-MCP directive reflects live OAuth token state, which
  // flips mid-conversation as Bearers expire/refresh. It now rides in the
  // per-turn instruction slice (server.ts), NOT the cached system prompt, so it
  // no longer churns the cacheable prefix across resumes. composeSystemPrompt
  // must therefore never emit it; the exported renderer is tested directly.
  describe('connectedExternalMcp directive is no longer in the system prompt', () => {
    it('never emits the MCP directive from composeSystemPrompt', () => {
      const prompt = composeSystemPrompt({});
      expect(prompt).not.toContain('External MCP servers — already authenticated');
      expect(prompt).not.toContain('mcp__<server>__authenticate');
    });

    it('keeps the media-execution-disabled block, still with no MCP directive', () => {
      const prompt = composeSystemPrompt({
        metadata: { kind: 'image' },
        mediaExecution: { mode: 'disabled' },
      });
      expect(prompt).toContain('HiDesign-owned media execution is **disabled for this run**');
      expect(prompt).toContain('MEDIA_EXECUTION_DISABLED');
      expect(prompt).toContain('本次任务未启用图片生成');
      expect(prompt).not.toContain('describe the intended creative brief');
      expect(prompt).not.toContain('## Media generation contract');
      expect(prompt).not.toContain('External MCP servers — already authenticated');
    });
  });

  describe('renderConnectedExternalMcpDirective', () => {
    it('returns an empty string for no / empty servers', () => {
      expect(renderConnectedExternalMcpDirective(undefined)).toBe('');
      expect(renderConnectedExternalMcpDirective([])).toBe('');
    });

    it('lists each connected server and forbids the synthetic auth tools', () => {
      const directive = renderConnectedExternalMcpDirective([
        { id: 'higgsfield-openclaw', label: 'Higgsfield (OpenClaw)' },
        { id: 'github' },
      ]);
      expect(directive).toContain('## External MCP servers — already authenticated');
      expect(directive).toContain('`higgsfield-openclaw`');
      expect(directive).toContain('Higgsfield (OpenClaw)');
      expect(directive).toContain('`github`');
      expect(directive).toContain(
        '**Do NOT call any tool whose name matches `mcp__<server>__authenticate` or `mcp__<server>__complete_authentication`',
      );
      expect(directive).toContain('localhost:<random>/callback');
      // Reconnect lives in the top-level Integrations view, NOT in Settings:
      // `mcpClient` kept its Settings render block but lost its sidebar nav
      // item, so "Settings → External MCP" named a place users cannot navigate
      // to. Asserted through the contract so this cannot drift again.
      expect(directive).toContain(INTEGRATIONS_MCP_PATH);
      expect(directive).not.toContain('Settings → External MCP');
    });

    it('skips entries with blank ids and emits nothing when none remain', () => {
      expect(
        renderConnectedExternalMcpDirective([
          { id: '   ', label: 'blank' },
          { id: '', label: 'empty' },
        ] as any),
      ).toBe('');
    });

    it('does not duplicate the label when it equals the id', () => {
      const directive = renderConnectedExternalMcpDirective([{ id: 'github', label: 'github' }]);
      expect(directive).toContain('- `github`\n');
      expect(directive).not.toContain('- `github` (github)');
    });

    it('has no leading separator so it composes cleanly in a `---`-joined slice', () => {
      const directive = renderConnectedExternalMcpDirective([{ id: 'github' }]);
      expect(directive.startsWith('## External MCP servers')).toBe(true);
    });
  });

  // The daemon experiment for compiling a brand's design system from prose
  // (DESIGN.md) into a machine-readable contract (tokens.css) plus a worked
  // fixture (components.html) lives in PR-C. The composer exposes two new
  // optional inputs (`designSystemTokensCss`, `designSystemFixtureHtml`)
  // that the daemon populates by default for every brand that ships
  // those files (PR-D flipped the env gate to default-on, with
  // `OD_DESIGN_TOKEN_CHANNEL=0` as the kill switch). These tests pin
  // the injection shape so the prompt structure cannot drift silently.
});

it('ignores retired design-system prompt inputs', () => {
  const prompt = composeSystemPrompt({ designSystemBody: 'RETIRED_BRAND_MARKER', designSystemTokensCss: '--retired: red', designSystemPullIndex: 'RETIRED_PULL_MARKER' });
  expect(prompt).not.toContain('RETIRED_BRAND_MARKER');
  expect(prompt).not.toContain('--retired: red');
  expect(prompt).not.toContain('RETIRED_PULL_MARKER');
});
