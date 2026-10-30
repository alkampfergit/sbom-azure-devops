---
name: auditing-github-pr-feedback
description: Audit GitHub pull-request feedback when the user asks to retrieve, summarize, validate, or assess PR comments without changing code. Use for review summaries, inline comments, and fork/upstream ambiguity. Do not apply fixes unless the user separately authorizes changes.
---

# Audit GitHub PR feedback

Keep this workflow read-only. Retrieving comments and running non-mutating diagnostics does not authorize edits, review replies, comment resolution, commits, or pushes.

## Requirements

- Use an authenticated GitHub CLI (`gh`) when the user requests it. If it is unavailable or unauthenticated, report that rather than silently substituting another service.
- Follow the repository's instructions for indexed code exploration before reading source files.

## Find the actual pull request

Do not assume `gh pr view` targets the same repository as the checked-out branch. In repositories with fork and upstream remotes, `gh` may select the upstream repository even when the branch tracks the fork.

1. Inspect the current branch, tracking branch, worktree status, and remotes.
2. Ask `gh` which repository it selected.
3. Try the current-branch PR lookup.
4. If no PR is found, search each plausible fork and upstream explicitly with `--repo`, the branch name, and `owner:branch` where applicable.
5. Report ambiguity instead of choosing between multiple matching PRs.

Do not conclude that no PR exists until the explicit fork/upstream searches are complete.

## Retrieve every feedback channel

Use the PR's explicit `owner/repository` and number. Collect all of the following, with pagination where supported:

- PR conversation comments (`issues/{number}/comments`).
- Review submissions and their summary bodies (`pulls/{number}/reviews`).
- Inline review comments (`pulls/{number}/comments`).
- PR metadata, current head commit, changed files, and review state.

Preserve author, URL, path, line, review commit, creation time, and whether GitHub marks a thread outdated. A review summary saying that comments exist is not a substitute for retrieving the inline comments.

## Validate each comment

Validate against the current PR head, not just the review's original diff hunk. Note when the local checkout differs from the remote head or when later commits already changed the cited code.

For each comment:

- Restate the claim precisely.
- Trace the relevant value or control flow far enough to confirm the observable result.
- Use a small, read-only reproduction when path handling, naming, parsing, or platform behavior is easier to prove experimentally.
- Classify it as valid, partially valid, invalid, already fixed, or unverifiable.
- Separate correctness from severity. A factual naming issue may be cosmetic, while untrusted path construction can be substantive.
- Call out unsafe or incomplete suggested remedies even when the underlying finding is valid.

## Report

Identify the PR and state how many conversation comments, reviews, and inline comments were found. For every actionable comment, provide its link, concise wording, verdict, severity, and code evidence. Explicitly state that no files were changed.
