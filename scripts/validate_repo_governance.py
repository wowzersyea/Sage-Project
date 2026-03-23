from __future__ import annotations

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]

REQUIRED_FILES = [
    ROOT / ".github" / "CODEOWNERS",
    ROOT / "docs" / "governance" / "contribution-guide.md",
    ROOT / "docs" / "governance" / "rfc-process.md",
    ROOT / "docs" / "governance" / "release-procedures.md",
    ROOT / "docs" / "architecture" / "topology-decision-matrix.md",
    ROOT / "docs" / "tool-integration" / "tool-matrix.md",
]

REQUIRED_SUBPROJECTS = [
    "asp-advisor",
    "literature-monitor",
    "mission-control",
    "operations",
    "qi-dashboard",
]


def validate_codeowners(content: str) -> list[str]:
    issues: list[str] = []
    for sub in REQUIRED_SUBPROJECTS:
        pattern = f"/{sub}/"
        if pattern not in content:
            issues.append(f"CODEOWNERS missing pattern: {pattern}")
    return issues


def main() -> int:
    issues: list[str] = []

    for path in REQUIRED_FILES:
        if not path.exists():
            issues.append(f"Missing required file: {path.relative_to(ROOT)}")

    for sub in REQUIRED_SUBPROJECTS:
        if not (ROOT / sub).exists():
            issues.append(f"Missing required subproject directory: {sub}")

    codeowners_path = ROOT / ".github" / "CODEOWNERS"
    if codeowners_path.exists():
        issues.extend(validate_codeowners(codeowners_path.read_text(encoding="utf-8")))

    if issues:
        print("Governance validation failed:")
        for issue in issues:
            print(f"- {issue}")
        return 1

    print("Governance validation passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
