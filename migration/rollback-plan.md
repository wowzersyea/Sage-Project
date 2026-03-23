# Rollback Plan

## Trigger Conditions
- CI instability blocks merges
- CODEOWNERS mapping causes incorrect approval deadlocks
- Security scan false positives block all PRs

## Rollback Steps
1. Revert governance and workflow commits.
2. Restore last known-good branch protection rules.
3. Re-enable only essential checks.
4. Re-run migration in smaller stages.
