---
name: review-work
description: Validate implemented work — performance, lint, types, tests, OWASP — then open a PR
argument-hint: "[prd: path | url | text] [--standard <name | url | path>]..."
---

# Review

**Input**: $ARGUMENTS (the PRD this work was built against, if available — a path, a URL, or already in the conversation; resolve it per CLAUDE.md § Inputs. `--standard` adds a security or compliance standard to the default, repeatable — CLAUDE.md § Standards)

Runs after `/implement-work`. Checks what was actually written, fixes what's wrong, then opens the PR.

Nothing here is advisory. If you find a problem, fix it and re-run the checks.

## Process

1. **Find what changed.** Mark the stage first: `printf review-work > .claude/.stage` (CLAUDE.md § Hooks). The agent may have committed, or left everything in the working tree, or both. Check all of it:

   ```bash
   git status --porcelain          # uncommitted edits + untracked files
   git branch --show-current
   git diff $(git merge-base HEAD {base_branch})...HEAD --stat   # committed on this branch
   git diff --stat                 # unstaged
   git diff --cached --stat        # staged
   ```

   Untracked files are the ones that get missed — `git diff` doesn't show them, so a new file the agent wrote goes unreviewed. Take the union of all of the above.

   Read the changed code, not the whole repo — pre-existing issues are out of scope unless they're Critical or the change made them reachable.

   Read the PRD if given. Its Definition of Done and security tables are the checklist; anything listed there and missing is a finding. Standards named in its header are in scope here too, whether or not they were passed again. If the implementation left a report or plan listing files it touched, diff that list against what git actually shows — files claimed but unchanged, or changed but unclaimed, are both worth knowing about.

2. **Static checks.** Find the real commands (`package.json` scripts, `Makefile`, CI config) — don't assume a toolchain. Run lint, type check, and tests, capturing each.

3. **Performance pass.** Read the changed logic for work that doesn't need doing:
   - Queries inside loops, or a loop that could be one query — N+1 is the most common one and the most expensive
   - Repeated computation that could be hoisted, memoized, or done once
   - Nested iteration over the same data where a map or set gives you a lookup
   - Loading whole collections to count, filter, or take the first item
   - Sync I/O, or sequential awaits over independent work
   - Unbounded growth: no pagination, no limit, no cleanup

   Judge against expected data size, not aesthetics. A nested loop over 5 config entries is fine; the same shape over user records is not.

4. **Standards pass.** Resolve every standard in scope — `standards` from CLAUDE.md § Pipeline settings, each `--standard`, and whatever the PRD header names — per § Standards. OWASP Top 10:2025 is below; any other becomes a checklist of the same shape before you start. Then walk every row of every standard against the diff — one at a time, no skipping.

   | # | Category |
   |---|---|
   | A01 | Broken Access Control |
   | A02 | Security Misconfiguration |
   | A03 | Software Supply Chain Failures |
   | A04 | Cryptographic Failures |
   | A05 | Injection |
   | A06 | Insecure Design |
   | A07 | Authentication Failures |
   | A08 | Software or Data Integrity Failures |
   | A09 | Security Logging and Alerting Failures |
   | A10 | Mishandling of Exceptional Conditions |

   Two questions per category: did this code introduce a weakness, and did it weaken an existing control — by widening a query, reusing a permissive handler, loosening validation, or logging a field that wasn't logged before. Logic flaws count: an auth check that runs after the mutation, a limit enforced client-side only, an ownership check on the wrong ID.

   For a privacy or sector standard the two questions become: does this diff collect, store, log, or transmit data the standard covers, and does it do so the way the standard requires — basis, minimization, retention, access, deletion, audit. A control that has no code-level reading in this diff is N/A with a reason, not skipped.

   New dependencies get checked for known CVEs and for whether they were needed at all.

5. **Fix and re-run.** Fix everything Critical and High, plus anything that fails a static check. After *any* code change, re-run lint, types, and tests — a performance rewrite is exactly the kind of change that breaks an edge case silently.

   Loop until clean. Leave Medium and Low as findings if the fix is a design decision rather than a correction.

6. **Open the PR** — only if everything above passes. See below. Clear the stage marker first: `rm -f .claude/.stage`. Under `autonomy: suggest` (CLAUDE.md § Execution boundaries) stop here and hand back the diff and the review instead.

## PR

Target `base_branch` from CLAUDE.md § Pipeline settings. Not set: `development` if it exists, else `develop`, else the repo's default branch.

If none of those exist, or there's no remote, or the repo was just initialized: stop and set it up with the user. Confirm the target branch name, whether a remote exists and where, and whether they want the branch created now. Don't invent a branching model or push to a remote they didn't name.

```bash
gh pr create --base {base_branch} --title "{what changed}" --body "{summary}"
```

Body: what changed and why, the validation results table, any Medium/Low findings left open, anything the reviewer should look at closely.

## Output

```markdown
## Review

| Check | Result | Details |
|---|---|---|
| Lint | ✅/❌ | {n errors or "passed"} |
| Types | ✅/❌ | {n errors or "passed"} |
| Tests | ✅/❌ | {n passed, m failed} |
| Performance | ✅/⚠️ | {n issues, k fixed} |
| {standard} | ✅/⚠️/❌ | {critical/high/medium/low counts — one row per standard in scope} |
| PRD DoD | ✅/❌ | {n of m met} |

### Fixed
- `{file:line}` — {what was wrong, what changed}

### Findings
**[SEVERITY] {title}** · `{file:line}` · {standard and row, e.g. OWASP A01 / LGPD art. 46}
{What's wrong, what it risks, and the fix.}

### Verdict
{PASS / PASS WITH NOTES / FAIL}

### PR
{link, or why one wasn't opened}
```

Severity: **Critical** exploitable now · **High** real weakness · **Medium** defense-in-depth · **Low** best practice.

## Rules

- Every row of every standard in scope gets answered. "No" is an answer; silence isn't. An unresolved standard is a FAIL, not an omission.
- Any code change means re-running lint, types, and tests. No exceptions.
- Critical or High open means FAIL and no PR.
- Don't flag style. Flag correctness, security, and work that measurably doesn't need doing.
- Don't create branches or remotes on your own — that's a conversation with the user.