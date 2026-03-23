# Topology Decision Matrix

| Criterion | Monorepo (Current) | Polyrepo |
|---|---|---|
| Shared governance enforcement | Strong | Medium |
| Cross-project change coordination | Strong | Medium |
| Team autonomy | Medium | Strong |
| CI runtime efficiency | Medium | Strong |
| Onboarding speed | Strong | Medium |

## Decision
Keep monorepo for now, with explicit ownership and boundary checks.

## Revisit Trigger
- CI runtime exceeds 5 minutes consistently
- Teams require independent release cadences across most subprojects
