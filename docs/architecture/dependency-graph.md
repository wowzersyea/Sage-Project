# Dependency Graph

## Boundaries
- Subprojects are independent deployable surfaces by default.
- Cross-subproject code imports are disallowed unless explicitly documented.
- Shared assets must live in `core/`, `modules/`, or `tools/`.

## Current High-Level Links
- `operations/` links to operational views for other subprojects.
- `mission-control/` should consume project metadata, not direct internal files.
- `qi-dashboard/` in this repo is an archived mirror; active development lives in `F:\Coding\sage-qi-dashboard`.
