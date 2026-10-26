---
name: monitor-work
description: Check a deployed change against its baseline and the PRD's success metrics — then decide keep, fix forward, or roll back
argument-hint: "<deploy record: path | url | text>"
---

# Monitor

**Input**: $ARGUMENTS (the deploy record written by `/deploy-work` — a path, a URL, or already in the conversation, resolved per CLAUDE.md § Inputs. It carries the PRD reference, the tag, the flag, the rollback command, and the baseline window)

Runs after `/deploy-work`. Closes the loop: PRD §3 said what success looks like and how it's measured; this checks whether it happened. The output is a decision with evidence, not a dashboard screenshot.

## Process

1. **Find the observability stack.** Mark the stage first: `printf monitor-work > .claude/.stage` (CLAUDE.md § Hooks). Read the repo for it — `sentry.*`, `datadog.*`, `newrelic.*`, OpenTelemetry setup, the flag SDK init, the analytics client, whatever logs go to. Don't assume a vendor.

   If there isn't one — no error tracking, no metrics, no structured logs — stop and say so. Health can't be judged from vibes. Tell the user what's missing, propose the smallest thing that would give a signal (an error tracker and request latency on the touched endpoints is usually enough), and open it as a task. The decision for this run is UNKNOWN, not KEEP.

2. **Pull the baseline first.** Same metrics, the window the deploy record names, ending at the deploy tag — same duration and same time-of-day where traffic is cyclical. Only then read the post-deploy window. A number without a baseline is noise.

3. **Health pass** — what breaks first.

   | Signal | Compare | Default threshold |
   |---|---|---|
   | Error rate on touched endpoints | post vs baseline | > 2× baseline, or any new error class |
   | p50 / p95 latency on touched endpoints | post vs baseline | p95 > 1.5× baseline |
   | Job failures / queue depth for touched workers | post vs baseline | sustained growth |
   | Slow-query log on touched tables | post vs baseline | new entries |
   | Flag cohorts | flag-on vs flag-off | errors concentrated in flag-on |

   Defaults. If PRD §8 sets a stricter NFR, the NFR wins.

4. **Security signals.** PRD §12 "How it's tested" named what should be logged — failed auth, access-control denials, validation rejections on the new inputs. Confirm those events are arriving. Silence where the PRD said there'd be a signal is a finding: either the logging didn't ship or the control isn't firing.

   Then the reverse: anything from PRD §12 "Secrets / PII touched" showing up in logs. That's Critical and the first thing to fix, before any other result.

5. **Success metrics.** PRD §3, row by row — metric, target, how it's measured — on the schedule §19 "Post-launch" set. A row that isn't due yet is "not yet checkable", with the date it becomes checkable. Never "met".

6. **Decide.** One of:
   - **KEEP** — health within thresholds, no security findings, metrics met or not yet due.
   - **FIX FORWARD** — something's off, the cause is understood, the fix is small. Write the task file; it goes through `/create-prd` like anything else, not a hotfix around the pipeline.
   - **ROLL BACK** — error or latency over threshold with no understood cause, any Critical security finding, or a Must requirement from §7 observably not working in production. Run the exact rollback command in the deploy record — don't improvise a different one under pressure. Under `autonomy: assist` that's a gate: state the command and wait; under `auto` run it and report. Then write the task file.

   A decision that isn't KEEP gets reported the moment it's reached, not at the end of the window.

7. **Write the record** — Clear the stage marker first: `rm -f .claude/.stage`. Then write it in the `artifacts` directory (CLAUDE.md § Artifacts), same stem as the deploy record: `user-invite-flow-deploy.md` → `user-invite-flow-monitor.md`. If §3 rows are still pending, note the next check date; re-run this skill then and append to the same file.

## Output

```markdown
# Monitor: {Name}

**Deploy**: `{the reference as given}` · **Tag**: `{tag}` · **Window**: {post-deploy range} · **Baseline**: {range} · **Flag**: `{name}` = {state, cohort} · **Date**: {YYYY-MM-DD}

## Health
| Signal | Baseline | Now | Threshold | Result |
|---|---|---|---|---|

## Security signals (PRD §12)
| Control | Expected signal | Observed | Result |
|---|---|---|---|

## Success metrics (PRD §3)
| Goal | Metric | Target | Observed | Result | Checkable from |
|---|---|---|---|---|---|

## Findings
**[SEVERITY] {title}**
{What's off, the evidence, the likely cause or "unknown".}

## Decision
{KEEP / FIX FORWARD / ROLL BACK / UNKNOWN} — {one line why}

## Next check
{date and which rows — or "none, all rows closed"}
```

Severity: **Critical** exploitable or leaking now · **High** real regression · **Medium** worth a task · **Low** worth a note.

## Rules

- No baseline, no conclusion. Pull the pre-deploy window first.
- No observability means UNKNOWN, not KEEP. Say what's missing.
- A metric not yet due is "not yet checkable", never "met".
- An expected security signal that's absent is a finding, not a relief.
- PII in logs is Critical and overrides every other result.
- Rollback uses the command `/deploy-work` recorded. Nothing else.
- Anything that isn't KEEP is reported immediately, and becomes a task file — not a hotfix outside the pipeline.
