# Release Procedures

## Strategy
- Trunk-based default with semantic version tags for notable milestones.
- Deploy from protected `main` only.

## Release Steps
1. Confirm all required checks are green.
2. Confirm CODEOWNERS approvals are present.
3. Validate migration checklist for impacted subprojects.
4. Tag release (`vX.Y.Z`) and publish notes.
5. Monitor first 30 minutes for regressions.

## Hotfix
- Create `hotfix/*` branch from latest tag.
- Follow standard PR + approvals.
- Patch release tag and update changelog.
