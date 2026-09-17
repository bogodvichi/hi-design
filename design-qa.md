# Design QA — Personal project split layout

## Reference

- Source: `/Users/zhangjiawen/Downloads/组合 2.png`
- Reference viewport: 965 × 805
- Target state: project created by the current viewer, conversation pane expanded, return control hovered so the `收起对话栏` menu is visible.

## Implemented structure

- The left conversation card and right preview card share the same split container and top/bottom bounds.
- The left header owns the frameless return icon, short divider, parent-path/project-name breadcrumb, and conversation-history icon.
- The parent path uses 50% black, truncates after eight characters, and the project name remains black and semibold.
- Hovering or focusing the return control reveals the icon-and-text `收起对话栏` action.
- When the conversation pane is collapsed, the right header keeps the return action and exposes `展开对话栏` from its hover menu.
- The open-state right preview header retains its existing design-file tab layout; personal-project path text is not injected into file tabs.

## Verification

- Web TypeScript typecheck: passed.
- Targeted ChatPane personal-project navigation test: passed.
- Targeted FileWorkspace/ownership/prefix truncation tests: passed.
- `git diff --check`: passed.
- `http://127.0.0.1:9530/home`: 200.
- Target project route: 200.
- Daemon `/api/health`: 200.

## Visual comparison

Implementation screenshot and pixel comparison could not be captured because the Codex in-app browser automation timed out twice while the live page remained available. Manual visual review is still required on the open 9530 page.

final result: blocked
