---
name: implement-work
description: Execute an approved plan task by task — mirror the named patterns, test each task, never leave the tree broken
argument-hint: "<plan: path | url | text>"
---

# Implement

**Input**: $ARGUMENTS (the plan — a path, a URL, or already in the conversation, resolved per CLAUDE.md § Inputs)

Runs after `/create-plan`. Executes the accepted plan — nothing it didn't say. A change the plan didn't cover is a conversation, not a commit.

## Process

1. **Resolve the plan.** Mark the stage first: `printf implement-work > .claude/.stage` (CLAUDE.md § Hooks). Then per CLAUDE.md § Inputs. `Approval: pending` → stop; nobody accepted it. Approval happens in `/create-plan`, not here. Read the plan and the PRD it points to. Find the real commands — lint, types, tests — in `package.json` scripts, `Makefile`, CI config. Don't assume a toolchain.

2. **Baseline.** Run the test suite once before touching anything and record what's already red. An inherited failure isn't yours to fix here, but you need to know it exists — otherwise every later red looks like yours.

   Branch per PRD §19. If it names none: branch from `base_branch` (CLAUDE.md § Pipeline settings) as `{type}/{feature}`, and say so.

3. **One task at a time**, in plan order. Per task:
   1. Read the files the task names and the code it mirrors. Now, not from memory of step 1.
   2. Make the change. Follow the mirrored pattern even where you'd do it differently — the codebase wins.
   3. Write the tests the task lists. Every new function, its error cases, its boundaries.
   4. Run the task's check command, then lint, types, and tests. All green, or back to 3.2. Never start the next task on a red tree.
   5. Commit — one task, one commit, message naming the task: `T3: add invite token model`.
   6. Mark the task done in the plan file with the commit hash.

4. **When the plan meets reality.** A task that can't be done as written — the function isn't there, the pattern doesn't fit, the migration order is wrong:
   - Small and local → do the obvious thing and note the deviation under the task in the plan file.
   - Changes the approach, touches files the plan didn't name, or drops a requirement → stop. Say what you found, propose the change, wait. This holds in an unattended run too: that's exactly the run that shouldn't decide this alone.

5. **Finish.** Every task done → run the plan's Verification section end to end. Then the PRD's Definition of Done, item by item. Anything unmet is reported unmet, not rounded up.

6. **Hand off.** Append the Implementation section below to the plan file. Clear the stage marker first: `rm -f .claude/.stage`. Then invoke `/review-work` with the PRD. Under `autonomy: suggest`, `/implement-work` doesn't run at all — say the plan is ready and stop.

## Output

```markdown
## Implementation

**Branch**: `{name}` · **Base**: `{base_branch}` · **Date**: {YYYY-MM-DD}

| Task | Commit | Check | Lint / Types / Tests |
|---|---|---|---|
| T1 | `abc1234` | ✅ | ✅ ✅ ✅ ({n} passed) |

### Deviations
- **T3** — {what the plan said, what you did instead, why}

### Definition of Done
- [x] {item} — {evidence}
- [ ] {item} — {why not}

### Verification
{the end-to-end check and its output}

### Inherited failures
{tests red before you started, or "none"}
```

## Rules

- The plan is the scope. Not in the plan → not in the diff. Raise it instead.
- Never start a task on a red tree. Never leave one that way.
- One task, one commit. A commit that mixes tasks can't be reviewed or reverted on its own.
- Mirror the named `file:line`, even where you'd write it differently.
- Don't fix inherited failures silently. Don't skip, disable, or `any` your way past a check.
- A DoD item you can't demonstrate is unmet. Say so.
- A non-local deviation from the plan stops the run, attended or not. Unattended isn't unaccountable.
