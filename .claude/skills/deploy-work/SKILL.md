---
name: deploy-work
description: Ship a merged, reviewed change to an environment — preconditions, migrations, flag, smoke test, rollback proven first
argument-hint: "<prd: path | url | text> [environment]"
---

# Deploy

**Input**: $ARGUMENTS (the PRD this work was built against — a path, a URL, or already in the conversation, resolved per CLAUDE.md § Inputs — and the target environment; defaults to `default_env` from CLAUDE.md § Pipeline settings, `staging` if unset)

Runs after `/review-work` has opened a PR and that PR is merged. Executes the release plan in PRD §19 — nothing more, nothing it didn't say.

Nothing here is advisory. A precondition that fails stops the deploy; the output says which one.

## Process

1. **Confirm what ships.** Mark the stage first: `printf deploy-work > .claude/.stage` (CLAUDE.md § Hooks).

   ```bash
   git fetch --all --tags
   git tag --list '{env}-*' --sort=-creatordate | head -1    # last deploy to this env
   git log --oneline {last-tag}..{base_branch}                # exactly what ships
   gh pr list --state merged --base {base_branch} --limit 10
   ```

   No previous tag means this is the first deploy to that environment — the range is the whole branch. Say so.

   Every commit in the range should trace to a merged PR. One that doesn't is a finding — stop and ask before shipping it.

   Compare against PRD §19. Branch, milestones, ordering, flag name — if what's on the branch differs from the plan, say so before continuing.

2. **Find the deploy mechanism.** CI config, `Makefile`, `package.json` scripts, `Procfile`, Dockerfile, platform CLI, IaC — read what the project actually uses. Don't assume a platform.

   If there isn't one, or the target environment doesn't exist: stop and set it up with the user. Confirm the platform, the environment name, how config gets there, and whether they want it created now. Don't invent a deploy pipeline or pick a host they didn't name.

3. **Preconditions.** Each is pass/fail. One fail stops the deploy.

   | Check | How |
   |---|---|
   | `/review-work` verdict was PASS or PASS WITH NOTES | PR body |
   | Target env reachable | health endpoint, or the platform's status |
   | Every env var / secret from PRD §19 present in the target env | keys only — never print a value |
   | Migrations backwards-compatible with the code currently running | read each one; a drop or rename before the code stops using it fails |
   | Feature flag exists with the default PRD §19 names | flag provider or config file |
   | Rollback target available | previous tag / image still exists (verified in step 6) |

4. **Migrations.** In the order PRD §19 gives, one at a time. After each: the schema change took effect, and the currently deployed code still responds. Expand, then contract — a destructive migration never ships in the same deploy as the code that stops needing the old shape. Two deploys.

5. **Deploy and smoke test.** Check the gate first — CLAUDE.md § Execution boundaries. Production always waits for a person; other environments wait unless `autonomy` is `auto`. Then use the mechanism from step 2 and follow the rollout PRD §19 chose:
   - **Behind a flag** — deploy flag-off, smoke test, then enable for the cohort the PRD names.
   - **Staged** — one instance / region / percentage at a time, smoke test between each.
   - **All at once** — only if the PRD says so and there's no migration.

   Smoke test = the end-to-end checks in PRD §18 against the target env, plus: health endpoint, one authenticated request, one request through the new code path with the flag on. Capture the output.

6. **Prove the rollback — before the flag goes on.** Actually roll back once (previous image / tag, or flag off) and confirm the app responds. Then roll forward. A rollback that has never been run is a hypothesis.

7. **Tag and record.** Clear the stage marker first: `rm -f .claude/.stage`.

   ```bash
   git tag -a {env}-{YYYY-MM-DD}-{short-sha} -m "{what shipped}"
   git push origin {tag}
   ```

   Write the deploy record in the `artifacts` directory (CLAUDE.md § Artifacts), same stem as the PRD: `user-invite-flow-prd.md` → `user-invite-flow-deploy.md`. A PRD that came from a URL or the conversation has no stem — derive one from its name, kebab-case. It's the input to `/monitor-work`.

## Output

```markdown
# Deploy: {Name}

**PRD**: `{the reference as given}` · **Env**: {environment} · **Tag**: `{tag}` · **Range**: `{from}..{sha}` · **Date**: {YYYY-MM-DD}

| Precondition | Result | Details |
|---|---|---|
| Review verdict | ✅/❌ | {PASS / PASS WITH NOTES / FAIL} |
| Env reachable | ✅/❌ | |
| Config / secrets present | ✅/❌ | {keys only} |
| Migrations backwards-compatible | ✅/❌ | |
| Flag exists, default correct | ✅/❌ | `{flag}` = {default} |
| Rollback proven | ✅/❌ | |

## Migrations run
- `{file}` — {what changed, how it was verified}

## Smoke test
- {check} — ✅/❌

## Flag
`{name}` = {on/off} for {cohort}

## Rollback
- **Previous**: `{tag / image}`
- **Command**: `{exact command}`
- **Data changes one-way?**: {no / yes — which}

## Baseline for /monitor-work
- **Window**: {same length as the first monitoring window, ending at the deploy}
- **Metrics**: {from PRD §3}
```

## Rules

- No PRD, no deploy. The release plan is the input, not a nice-to-have.
- Never print a secret value. Keys only, and only to confirm presence.
- A destructive migration and the code that stops needing the old shape are two deploys. Always.
- Rollback is proven before the flag goes on, not after something breaks.
- Don't pick an environment, branch, platform, or rollout the PRD didn't name — that's a conversation with the user.
- The deploy, the migration, and the flag flip each pass through the gate in CLAUDE.md § Execution boundaries. Production is always a hard gate.
- A failed precondition means the deploy stops and the output says which one. No "deployed with caveats".
