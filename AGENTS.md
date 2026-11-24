# maket: project instructions

These instructions apply to the entire repository. User requirements take precedence over the bundled skills. Read the relevant skill before work and mention its use when first applying it in a session.

## Installed frontend skills

Skills are vendored in `.agents/skills/`, the project-wide Codex skill directory. Keep their companion references, scripts, assets, licenses and attribution with `SKILL.md`.

- **unslop** — [SKILL.md](.agents/skills/unslop/SKILL.md). Apply when reviewing or polishing existing screens, visual consistency, spacing, typography, colors and UI copy. Use the existing product identity; do not redesign unrelated screens.
- **Taste Skill / design-taste-frontend** — [SKILL.md](.agents/skills/design-taste-frontend/SKILL.md). Apply to new screens, UI design and substantial visual changes. Adapt its recommendations to a diagram editor and the existing Next.js application; its marketing-page examples are not requirements to introduce landing-page sections or effects into the workspace.
- **Modern Web Guidance** — [SKILL.md](.agents/skills/modern-web-guidance/SKILL.md). Consult before frontend HTML/CSS/client JavaScript changes, interactions, accessibility or performance work. Search for the specific capability, read the relevant guides, check browser support and provide fallbacks where needed. The upstream skill documents its search/retrieve CLI; the bundled `guides/` are also available locally when the CLI or network is unavailable.

Load only the applicable skills and referenced documents; do not read every guide or run a whole-repository design audit for a small change. Installation alone does not authorize a redesign, new runtime dependencies, external publication or deployment. Skill scripts and optional hooks are run only when relevant to the task, never automatically on application startup.

## Product constraints

- Preserve the Apple-inspired interface already requested by the user, existing design tokens, light/dark themes and Lucide icons. Prefer quiet chrome and readable, compact diagram tooling; preserve the established brand when skill examples differ.
- Maintain accessibility, keyboard operation, visible focus and reduced-motion support. Do not apply animation or decoration at the expense of editor responsiveness.
- Check compatibility for both browser use and the bundled Electron runtime; do not assume every web user runs Chromium.
- Preserve the separation between the server edition and standalone/portable desktop. Agent skills are development resources, not application dependencies or shipped product assets.
- Do not silently alter third-party skill files. Upstream repositories, revisions and file hashes are recorded in `.agents/skills/sources.json`; preserve licenses and attribution on updates. See [installation notes](docs/agent-skills.md).

## Deferred editor tasks

When asked to recall the remaining plan, read [docs/editor-improvements.md](docs/editor-improvements.md). The deferred items are multiline representation labels in properties and standalone/portable save hangs after delete/undo. The draw.io coordinate fix is recorded as completed in that plan. Do not implement these merely because a skill recommends a broader cleanup.
