# OpenCode Development Workflow

- Use only agents defined in the repository's OpenCode configuration. Do not
  delegate work to agents from another runtime.
- OpenCode `build` leads planning, task design, coordination, integration, and final review.
- OpenCode `code` with DeepSeek high implements tasks; run at most 3 OpenCode workers at once.
- Use the OpenCode `advisor` with GLM 5.3 high only for blocked architecture decisions. Other named OpenCode agents are read-only.

## `.ai` organization

- Utilize the folders in `.ai`: keep OpenCode-specific instructions in `.ai/agents/`, project plans in `.ai/plans/`, task prompts in `.ai/tasks/`, and reports in `.ai/reports/`.
- Store worker output logs under `.ai/reports/logs/`. Put worker and integration reports, progress updates, and archived reports under `.ai/reports/`; keep `.ai` root free of files.
- Keep `AGENTS.md` and `opencode.jsonc` at the repository root as regular files; keep OpenCode-only presets in `.ai/agents/`.

## Agents and roles

| Agent          | Model                                    | Purpose                                        |
| -------------- | ---------------------------------------- | ---------------------------------------------- |
| `build`        | `opencode-go/glm-5.3-flash`              | Read-only lead, orchestrator, and verifier     |
| `code`         | `opencode-go/deepseek-v4.1-flash#high`   | Implementation, file changes, fixes, and tests |
| `advisor`      | `opencode-go/glm-5.3#high`               | Architecture advice when blocked               |
| `evaluate`     | `opencode-go/gpt-6-luna#max`             | Complex tradeoffs                              |
| `explore`      | `opencode-go/mimo-v2.6-flash`            | Find relevant code                             |
| `research`     | `opencode-go/deepseek-v4.1-flash#medium` | External documentation                         |
| `review`       | `opencode-go/gpt-6-luna#high`            | Review substantial changes                     |
| `sanity_check` | `opencode-go/mimo-v2.6-flash`            | Quick checks                                   |
| `vision`       | `opencode-go/gpt-6-luna#medium`          | Visual inspection                              |

`build` and specialists other than `code` are read-only. Only `code` may
implement. Launch at most 3 OpenCode child subagents at once; the primary
`build` agent does not count toward that limit. Keep `--model` on OpenCode run
commands to pin the intended model.

## Starting work

For coordinated work, start with the OpenCode `build` agent:

```sh
opencode run --agent build --model opencode-go/glm-5.3-flash \
  "Coordinate the requested work using the code subagent."
```

`build` inspects and plans but cannot write task/report files or implementation.
It gives the user a short task summary before implementation and delegates
complete prompts to the OpenCode `code` agent. For standalone implementation,
run the OpenCode `code` agent directly:

```sh
opencode run --agent code --model opencode-go/deepseek-v4.1-flash#high \
  "Read .ai/tasks/TASK-N.md and execute all instructions. Run validation and write results to .ai/reports/REPORT-N.md."
```

Capture output at `.ai/reports/logs/WORKER-N.log`. Archive completed prompts, reports, and logs in their matching category folders.

## Task summaries and prompts

Every `.ai/tasks/` task file or delegated task prompt starts with a `## Summary` containing
**2–4 plain-language bullets**. Tell the user what kind of work is being done,
the main files or area, and the intended result. In coordinated runs, `build`
shows these bullets before launching workers; each `code` worker repeats them at
the top of its report. In standalone runs, `code` shows the bullets before
editing and repeats them in its final report.

Every delegated prompt also specifies:

- Objective and relevant files.
- Allowed files to modify.
- Implementation requirements and dependencies.
- Constraints and edge cases.
- Acceptance criteria and validation commands.

## Coordination and safeguards

- Inspect only relevant code. Split work when scopes are independent and assign
  exclusive file ownership. Use one worker for dependent or overlapping tasks.
- Run up to three independent OpenCode `code` workers concurrently; never
  launch a fourth worker or allow overlapping writes. Avoid concurrent edits
  to shared generated files, dependencies, or build artifacts.
- Wait for all workers, check exit statuses, and collect concise reports covering
  changed files, validation, and unresolved issues before integration review.
- Delegate all edits and corrections to the OpenCode `code` agent; OpenCode
  `build` verifies read-only.
  Limit automatic correction attempts to two per task.
- Preserve unrelated changes. Never commit or push without user authorization.
  Stop and report unresolved blockers.
- Keep prompts concise but complete, reuse reports, and avoid trivial delegation
  or repeated exploration.

## Plans and progress

Use 🟢 complete, 🟡 partial/in progress, 🔴 open/blocked, and ⚪ not applicable
for progress reports. Every implementation plan has one top-level
`## Implementation Progress` section near the beginning and one compact table
with columns for phase/item, deliverable, acceptance condition, and status.
Update it as work changes; mark complete only after acceptance is verified. Keep
open work specific, and do not repeat progress checklists elsewhere. Reports may
include per-run validation output.

## Source organization and API docs

- Keep TypeScript source modular by responsibility. Split long files containing
  unrelated logic or large lookup families into focused modules, using a
  directory and small facade/barrel when useful. Compiled output may be bundled;
  source should remain navigable.
- Preserve public imports, keys, runtime behavior, and type inference during
  refactors.
- Add brief, user-oriented JSDoc to public Tally chain access and configuration
  members so editor hover/completion explains utilities, indexed scales,
  variants, colors, `MEDIA`, and `configure`. Put docs on emitted public types;
  prefer concise mapped-type docs over thousands of repetitive declarations.
