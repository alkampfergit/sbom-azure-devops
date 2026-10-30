---
name: remediating-github-pr-feedback
description: Address validated GitHub pull-request feedback when the user asks to apply review fixes, verify them, commit, or push. Use for bounded remediation of known comments. Do not use for audit-only requests, autonomous PR babysitting, or unrelated cleanup.
---

# Remediate GitHub PR feedback

Fix only the feedback the user accepted or asked to address. Do not resolve threads, post replies, merge the PR, or broaden the change without separate authorization.

## Requirements

- Use authenticated `gh` and `git` for GitHub and repository operations when requested.
- Follow repository instructions for code discovery, formatting, testing, and build commands.
- Treat the repository toolchain and hooks as part of the deliverable; do not assume optional checkers are installed.

## Establish safe state

1. Resolve the PR explicitly across fork and upstream remotes; do not rely solely on `gh pr view`'s implicit repository choice.
2. Confirm the checked-out branch corresponds to the PR head.
3. Record the initial worktree status and preserve all pre-existing changes. Never stage unrelated files under an "everything" request unless the user clearly includes them.
4. Retrieve the current inline comments and confirm later commits have not already addressed them.
5. Use the repository's indexed-code tools before direct source inspection when required by its instructions.

## Implement the smallest complete fix

- Correct the underlying behavior, not merely the example in the review comment.
- Preserve documented compatibility. For validation fixes, reject unsafe input before it reaches filesystem or process APIs and return an actionable error.
- Add or update focused tests when the defect can be covered without disproportionate scaffolding.
- Avoid generated outputs unless the repository tracks them or its build process requires them.

## Verify before committing

Run the narrowest checks that establish confidence, then the repository's required gate:

- Formatter or format check for changed files.
- Relevant tests and affected build/type-check.
- A focused reproduction for the original review example and important edge cases.
- `git diff --check`, while accounting for an existing repository-wide line-ending convention rather than rewriting unrelated lines.
- Final staged-diff inspection to ensure only intended files are included.

Do not claim a check passed if it was skipped, unavailable, or filtered by a wrapper.

## Commit and push safely

- Commit and push only when the user has authorized those mutations.
- Honor requested signing behavior exactly, including `--no-gpg-sign`.
- If a commit hook fails, diagnose the actual failing command. Do not silently bypass hooks.
- A generic request to commit and push does not by itself authorize bypassing a quality gate. Ask before bypassing unless the user already explicitly allowed it.
- If bypass is authorized because a checker is unavailable, run the closest repository-supported equivalent, disclose what did not run, and bypass only for that single commit without changing persistent hook configuration.
- Push the explicit remote and branch associated with the PR. Do not force-push unless explicitly requested.
- After pushing, verify the commit hash, upstream synchronization, and worktree status.

## Report

Summarize the fixes, checks run, commit hash, remote branch, and push result. Prominently disclose any skipped check or authorized hook bypass.
