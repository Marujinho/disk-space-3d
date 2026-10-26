---
name: create-prd
description: Turn a task — file, URL, tracker item, or pasted text — into a complete, implementation-ready PRD (Product Requirements Document)
argument-hint: "<task: path | url | tracker id | text> [--auto] [--standard <name | url | path>]..."
---

# PRD

**Input**: $ARGUMENTS (the task — a path, a URL, a tracker item, pasted text, or a document already in the conversation; resolve it per CLAUDE.md § Inputs. `--auto` skips the human approval of the PRD and goes straight to planning. `--standard` adds a security or compliance standard to the default, repeatable — CLAUDE.md § Standards)

Produce the Product Requirements Document an implementing agent builds against. It answers *what*, *why*, *for whom*, *how we know it worked*, and *under which rules* — not *how to build it*. That's `/create-plan`'s job.

Runs before `/create-plan`.

## Process

1. **Resolve and read the task.** Mark the stage first: `printf create-prd > .claude/.stage` (CLAUDE.md § Hooks). Then follow CLAUDE.md § Inputs; if you can't open it, say so and stop. Separate what it states from what it assumes. Identify the problem, the user, and the outcome the requester actually wants — not just the feature they named.

2. **Look at the codebase.** `ls`, `git log --oneline -10`, `CLAUDE.md` / `README.md`, plus the closest existing feature to the one being asked for. Pull out: stack and versions, where this kind of code lives, naming conventions, error handling, test patterns — each with a `file:line` source.

   Empty repo? Then propose those conventions instead. One concrete choice per decision, not a menu.

   **Subagents**: if the recon splits into independent threads — conventions, data layer, tests, external dependencies — dispatch them in parallel and have each return findings with `file:line` refs. Skip this on a small or familiar codebase; one agent reading four files directly beats four agents reporting back.

   **No git repo?** `git init` and commit the current state as a baseline before anything gets written — otherwise there's no diff later showing what the implementation touched. Add a `.gitignore` first if there isn't one, so the baseline commit doesn't swallow `node_modules`, `vendor`, build output, or `.env`. Note in the PRD that the repo was initialized.

3. **Define the product.** Goals and how they're measured, user stories, and numbered functional requirements (`FR-1`, `FR-2`, …), each with a priority (Must / Should / Could) and acceptance criteria someone else can verify. Non-functional requirements get the same treatment (`NFR-1`, …). Every requirement traces to a goal or user story; one that doesn't is scope creep — cut it or justify it.

4. **Find the gaps.** Go through the PRD template below and mark each item known, inferred, or missing. Never ask about something the codebase already answers.

5. **Run the security and compliance pass.** Resolve every standard in scope — `standards` from CLAUDE.md § Pipeline settings plus each `--standard`, per § Standards. OWASP Top 10:2025 is in the template below; any other becomes a table of the same shape. Then walk every row of every standard against what's being built — one at a time, no skipping. For each: does this feature touch it? If yes, what's the requirement? The output is a requirement the implementer must satisfy and a test that proves it, not a note saying "be careful with auth". Rows the feature genuinely doesn't touch get N/A with a reason.

   Privacy and sector standards (LGPD, GDPR, HIPAA, PCI) ask different questions than OWASP: what personal, health, or payment data this touches; the basis for processing it; where it's stored and for how long; who can read it; how a subject gets it deleted; what gets logged. Translate each control into something the implementer can build and a test can prove.

   Check the code around it too, not just the new code — a feature can be written correctly and still break an existing control by widening a query, reusing a permissive handler, or logging a field that wasn't logged before.

6. **Ask, once.** Batch every question whose wrong answer means rework. Give 2–3 options with a recommendation. Everything else becomes a listed assumption — never a silent one. `--auto` doesn't change this: a blocking question still means BLOCKED and the run stops. Only the PRD approval is skipped, never the questions.

7. **Write the PRD** in the `artifacts` directory (CLAUDE.md § Pipeline settings), named for the feature itself in kebab-case — `user-invite-flow-prd.md`, not `task-prd.md` or `notes-final-v2-prd.md`. The name should tell someone what's inside without opening it.

8. **Hand off.** Clear the stage marker first: `rm -f .claude/.stage`. What happens next depends on the status and the gate in CLAUDE.md § Execution boundaries:
   - **BLOCKED** — stop. List the open questions. Nothing else runs.
   - **READY, default (`assist`)** — present the PRD for approval: the goals, the Must requirements, the assumptions, the risks, and the file path. Then wait. Requested edits go into the file and it's presented again. On an explicit yes, set `Approval` in the header to the date and invoke `/create-plan` with the PRD.
   - **READY, `--auto` flag or `autonomy: auto`** — set `Approval` to `skipped (--auto)` and invoke `/create-plan --auto` immediately. The plan has its own gate.
   - **`suggest`** — write the PRD and stop.

## Output

```markdown
# PRD: {Name}

**Source**: `{the reference as given — path, URL, tracker id, or "conversation"}` · **Type**: {feature/bugfix/refactor} · **Status**: {READY / BLOCKED} · **Approval**: {pending / YYYY-MM-DD / skipped (--auto)} · **Standards**: {owasp-top10-2025, …} · **Date**: {YYYY-MM-DD}

## 1. Overview
{One paragraph: what this is and why it matters now.}

## 2. Problem
{What's broken or missing today, who feels it, and what it costs. Evidence if any exists.}

## 3. Goals & Success Metrics
| Goal | Metric | Target | How it's measured |
|---|---|---|---|

**Non-goals**: {things this deliberately does not try to achieve}

## 4. Users & Personas
{Who they are, their context, and what they can do after this ships that they can't now.}

## 5. User Stories
- **US-1**: As a {user}, I want {capability}, so that {outcome}.

## 6. User Flows
{Main flow step by step, plus alternate and error flows. States the user sees: empty, loading, error, success.}

## 7. Functional Requirements
| ID | Requirement | Priority | Story | Acceptance criteria |
|---|---|---|---|---|
| FR-1 | {The system must…} | Must | US-1 | {Given / When / Then} |

## 8. Non-Functional Requirements
| ID | Category | Requirement | Acceptance criteria |
|---|---|---|---|
| NFR-1 | {Performance / Scale / Accessibility / Reliability / i18n} | | |

## 9. Out of Scope
- {Thing} — {why not / where it belongs}

## 10. Definition of Done
- [ ] Every Must requirement meets its acceptance criteria
- [ ] {Other observable outcome someone else can verify}

## 11. Technical Context
**Stack & areas affected**: {Tech + versions. Which parts of the codebase this touches, directly and indirectly.}

**Conventions**: {Naming, structure, error handling, tests — each with `file:line`, or marked PROPOSED for greenfield. Include a real snippet where it's clearer than prose.}

**Data & contracts**: {Entities, schema changes, API/event shapes, migrations, backwards-compat. Or "None".}

**Constraints**: {Architecture rules that must hold.}

**Dependencies**: {External services, other teams, other features this waits on — or "None".}

## 12. Security & Compliance

### OWASP Top 10:2025

| # | Category | Applies? | Requirement | How it's tested |
|---|---|---|---|---|
| A01 | Broken Access Control | | | |
| A02 | Security Misconfiguration | | | |
| A03 | Software Supply Chain Failures | | | |
| A04 | Cryptographic Failures | | | |
| A05 | Injection | | | |
| A06 | Insecure Design | | | |
| A07 | Authentication Failures | | | |
| A08 | Software or Data Integrity Failures | | | |
| A09 | Security Logging and Alerting Failures | | | |
| A10 | Mishandling of Exceptional Conditions | | | |

### {Additional standard — name, version, source}
| # | Control | Applies? | Requirement | How it's tested |
|---|---|---|---|---|
{One table per standard beyond the default. Rows are its controls as resolved per CLAUDE.md § Standards. Omit this block when there are none.}

**Existing controls at risk**: {controls this change could weaken, or "None identified"}
**Secrets / PII touched**: {what data, where it flows, how it's stored — or "None"}

## 13. Do / Don't
- Do: {instruction}
- Don't: {instruction} — {consequence}

## 14. Risks & Caveats
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|

{Sharp edges in the affected code, external dependencies, failure modes.}

## 15. Assumptions
| Assumption | Basis | If wrong |
|---|---|---|

## 16. Open Questions
{Blocking, unanswered — or "None".}

## 17. Tests
{What must be covered: every FR/NFR acceptance criterion, happy path, error cases, boundaries, and every "How it's tested" cell from the security table. Note anything that needs a fixture, seed, or mock that doesn't exist yet.}

## 18. Verification
{Build, lint, test commands. Plus end-to-end checks precise enough to execute.}

## 19. Release Plan
- **Branch**: {new branch + name, or existing branch + which}
- **Milestones**: {what ships first if the work is phased — or "single release"}
- **Migrations / ordering**: {anything that must run before or after deploy}
- **Config / secrets**: {new env vars, where they're set, who sets them}
- **Feature flag**: {name and default, or "none"}
- **Rollout**: {all at once, staged, behind a flag}
- **Rollback**: {how to undo, and whether data changes make it one-way}
- **Post-launch**: {how and when the success metrics in §3 get checked}
```

## Rules

- Explaining *how* to build it means you've drifted into `/create-plan`.
- Every functional requirement has an ID, a priority, and acceptance criteria. A requirement nobody can verify isn't a requirement.
- Every requirement traces to a user story or goal; every goal has a metric.
- A convention without a `file:line` is either unsourced or PROPOSED. Say which.
- Anything from your head, not the source, goes in the assumptions table.
- Every row of every standard in scope gets an answer. "Applies: no" is an answer; a blank cell is not. A standard you couldn't resolve goes in Open Questions.
- A security requirement with no test in the same row is incomplete.
- Open questions remaining means Status is BLOCKED. Don't plan against it.
- A READY PRD waits for a person before planning. `--auto` skips the wait, never the BLOCKED check.
- If the task is really several products or features, or the codebase contradicts it, say so before writing.
