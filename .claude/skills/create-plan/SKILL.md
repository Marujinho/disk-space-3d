---
name: create-plan
description: Turn an approved PRD into an ordered implementation plan — explore, design with perspectives, verify against the code, then hand off for approval
argument-hint: "<prd: path | url | text> [--auto]"
---

# Plan

**Input**: $ARGUMENTS (the PRD — a path, a URL, or already in the conversation, resolved per CLAUDE.md § Inputs. `--auto` skips the human approval of the plan and goes straight to `/implement-work`)

Runs after `/create-prd`, before `/implement-work`. Answers *how*: which files change, in what order, mirroring which existing code. The PRD already settled *what* and *why* — don't re-litigate it. If it's wrong, say so and stop.

Mirrors Claude Code's own plan mode — explore, design, verify, write — but the plan is a pipeline artifact and the approval gate is ours, so it works with `--auto` and in CI, where plan mode can't be approved.

Read-only until the plan is approved. The plan file is the only thing you write — no edits, no commits, no config changes, no "quick fix while I'm here". Scratch notes go in the plan file, not in the repo.

## Process

1. **Resolve the PRD.** Mark the stage first: `printf create-plan > .claude/.stage` (CLAUDE.md § Hooks). Then per CLAUDE.md § Inputs. Status BLOCKED, or `Approval: pending` without `--auto` → stop; the PRD isn't ready. Read all of it — §7, §8, §11, §12, §17 and §19 are this plan's inputs.

2. **Understand.** Read the code PRD §11 names, what it imports, what imports it, and the closest existing feature. Trace the path a request will take through the new code. Know the test setup — runner, fixtures, how the closest feature is tested.

   **Subagents**: when the scope is uncertain or spans several areas, dispatch Explore agents in parallel, each with one focus — existing implementations, the data layer, test patterns, external dependencies. One agent, or none, when the PRD already names the files. Minimum necessary; findings come back with `file:line`.

   Questions whose wrong answer means rework get asked now, in one batch, with 2–3 options and a recommendation. Under `--auto` there's nobody to ask: pick the option the codebase supports best and record it in the Decisions table as assumed.

3. **Design.** Pick the approach on purpose. For anything non-trivial weigh at least two, using the perspectives plan mode uses:
   - New feature: simplicity vs performance vs maintainability
   - Bug fix: root cause vs workaround vs prevention
   - Refactor: minimal change vs clean architecture

   **Subagents**: when the work touches several parts of the codebase, is a large refactor, or has many edge cases, dispatch Plan agents — one per perspective — with the step-2 findings (filenames, code-path traces), the PRD's requirements and constraints, and a request for a step-by-step plan that ends with its critical files. Skip them for small, well-defined changes.

   Then choose. One approach, the reason, and what lost and why. A plan that offers a menu isn't a plan.

4. **Verify against the code.** Open the critical files the design relies on and check the plan survives contact: the function exists with that signature, the pattern you're mirroring does what you think, the migration is possible in the order given. Check that every Must FR, every NFR, and every applicable security row has a task. Fix the plan; don't hand off a guess.

5. **Write the plan** in the `artifacts` directory (CLAUDE.md § Artifacts), same stem as the PRD: `user-invite-flow-prd.md` → `user-invite-flow-plan.md`. Ordered tasks, each small enough to validate on its own and leave the tree green. Each names its files, the code it mirrors with `file:line`, its tests, and how to check it. Order: contracts and migrations first, then data layer → logic → interface → wiring, and whatever needs a flag last.

6. **Hand off.** Clear the stage marker first: `rm -f .claude/.stage`. Then per CLAUDE.md § Execution boundaries:
   - **Default (`assist`)** — present the plan: approach, task list, decisions, risks, and the file path. Then wait. Requested changes go into the plan file and it's presented again. On an explicit yes, set `Approval` to the date and invoke `/implement-work` with the plan.
   - **`--auto` flag or `autonomy: auto`** — set `Approval` to `skipped (--auto)` and invoke `/implement-work` immediately.
   - **`suggest`** — write the plan and stop.

## Output

```markdown
# Plan: {Name}

**PRD**: `{the reference as given}` · **Approval**: {pending / YYYY-MM-DD / skipped (--auto)} · **Date**: {YYYY-MM-DD}

## Approach
{The chosen approach in a paragraph. Then the alternatives considered and why they lost.}

## Decisions
| Decision | Chosen | Alternatives | Why | Asked / assumed |
|---|---|---|---|---|

## Critical files
| File | Role in this change |
|---|---|
{3–7 files that decide whether the plan works. Read them before the first task.}

## Tasks
### T1 — {imperative title}
- **Covers**: FR-1, NFR-2, A01
- **Files**: `path/one.ts` (edit), `path/one.test.ts` (new)
- **Mirror**: `path/similar.ts:40-88` — {what to copy from it}
- **Do**: {the change, specific enough that two engineers would write roughly the same code}
- **Tests**: {cases — happy path, error cases, boundaries}
- **Check**: `{command}` → {expected}
- **Depends on**: — / T0

### T2 — …

## Coverage
| PRD item | Task |
|---|---|
| FR-1 | T1 |
| A01 | T1, T3 |
{Every Must FR, every NFR, every applicable OWASP row, every §17 test. A row without a task is a gap in the plan.}

## Risks
| Risk | Where it bites | What to do if it does |
|---|---|---|

## Verification
{The end-to-end check once every task is done — PRD §18, made concrete for this plan.}
```

## Rules

- Read-only until approved. The plan file is the only thing you write.
- The PRD is the input, not a suggestion. A plan that drops a Must or a security row is incomplete, not scoped.
- Every task names files, the pattern it mirrors with `file:line`, its tests, and a check command. "Implement the service" is a title, not a task.
- One approach. Alternatives live in the Decisions table, not in the task list.
- Verify before writing: a function you didn't open is an assumption.
- Under `--auto`, every question you'd have asked is a Decisions row marked assumed.
- A plan a person rejected gets revised, not defended. Never re-present the same plan.
