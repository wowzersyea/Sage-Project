# Sage Project — Consolidation Handoff

**Purpose:** Hand off the "merge everything into one app" work from the remote
Claude Code session (which only had the `Sage-Project` static repo) to a local
Claude Code session running in VS Code inside the `peds-id-assessment` Next.js
app, where the full codebase is editable and runnable.

Last updated: 2026-06-15

---

## 1. The decision

Consolidate **all assessments + faculty admin** into the **Next.js app**
(`peds-id-assessment`), **self-hosted on Mark's computer.**

Why: real login (NextAuth, restrict to UTMB email), a real database, answer keys
stay server-side, and the Grok/xAI grading already lives here. Replaces the
current hybrid (static HTML quizzes + Google Sheets/Apps Script backend +
passcode admin), which is fragile and weak on auth/PII.

Database choice still open: **SQLite** (simplest for a self-hosted box — one
file, zero setup) vs **Postgres**. Recommend SQLite unless multi-machine access
is needed.

---

## 2. The two codebases

### A. `peds-id-assessment` (THE TARGET — Next.js, on Mark's computer)
- Path: `C:\Users\markm\peds-id-assessment\`
- The PRIMARY resident assessment. Live at `test.sageproject.xyz`.
- 46 questions (43 MCQ + 3 FREE_TEXT) in `lib/questions.ts` (server-only).
- `lib/scoring.ts` — pure scoring functions, domain + ABP-axis breakdowns.
- `lib/llm.ts` — Grok (xAI, OpenAI-compatible SDK) grades free-text + writes
  faculty report. Model env `XAI_MODEL` (default `grok-4`), key `XAI_API_KEY`.
- Has `/api/submit`, `/api/questions` (public questions strip the answer key).
- Components include `AssessmentForm.tsx`.
- NOT yet in GitHub — that's why direct editing wasn't possible remotely.

### B. `Sage-Project` (the static site — GitHub: wowzersyea/Sage-Project)
- Static GitHub Pages site. Working branch: `claude/fervent-wright-z09i3a` (PR #9).
- Hosts the OTHER assessments as standalone HTML:
  - `med-student-assessment/index.html` — 30 Q, domain-scored MCQ (Mark's questions).
  - `antimicrobial-selection/index.html` — REAL antimicrobial assessment, live at
    sageproject.xyz/antimicrobial-selection/. MCQ + select-all + FREE_TEXT, concept-scored.
  - `resident-post-assessment/index.html` — 30 Q generated post-test bank (review/optional).
  - `antimicrobial-assessment/index.html` — 30 Q generated antimicrobial bank (review/optional).
- `admin/index.html` — passcode-gated faculty dashboard (per-question review).
- `scripts/sheets_webhook.gs` — the Google Apps Script (current backend).
- `scripts/resident-AssessmentForm.tsx`, `scripts/resident-saveToSheets.ts` —
  files generated for the Next.js app (delivered for copy-paste).

---

## 3. Current backend (to be REPLACED by the DB)

Google Sheet "Sage Project - Assessment Results" + Apps Script Web App.
- Endpoint: `https://script.google.com/macros/s/AKfycbzVGqv0Ot-L9BtUzcWhq8XTpmOEZSGqVFwD0kPLSRfKBFVvTlRLMdzmtWXZuaPf6adz/exec`
- Spreadsheet ID: `1vtv38Ld3utmwq957a5volAgiz8W6ySkTo7YE7dPNNKw`
- `doPost` routes each submission to a per-assessment tab; writes a summary row +
  a per-question "<Tab> — Answers" detail tab; emails faculty (maemurph@utmb.edu)
  + CC's student.
- `doGet?key=sage-faculty-2026` returns all submissions as JSON (admin read).
- This works today. It's the thing we're migrating OFF of.

---

## 4. Canonical submission shape (the admin already renders this)

All assessments normalize to this shape. Reuse it as the DB record / API contract.

```jsonc
{
  "assessmentType": "Resident" | "Med Student" | "Antimicrobial Selection" | ...,
  "timestamp": "ISO8601",
  "name": "...", "email": "...", "year": "...", "school": "...",
  "overallScore": 0-100,            // percent
  "correct": 0, "total": 0,
  "goals": {                        // resident only (pre-rotation goals)
    "discomfort": "", "antibiotics": "", "pastCase": "", "rotationGoal": ""
  },
  "domains": [
    {
      "domain": "Label",
      "correct": 0, "asked": 0, "maxTier": 0,
      "answers": [
        {
          "question": "stem + prompt",
          "options": ["A text","B text", ...],   // MCQ: full choices
          "selected": "their option text", "selectedIndex": 0,
          "correct": true,
          "correctAnswer": "correct option text", "correctIndex": 1,
          "rationale": "explanation",
          // FREE_TEXT instead uses:
          "detail": { "text": "their written response" },
          "score": 0 | 0.5 | 1
        }
      ]
    }
  ]
}
```

Admin renderer logic (in `Sage-Project/admin/index.html`, port to a React page):
- If `answer.options[]` present → full MCQ review (highlight selected + correct).
- Else if `answer.detail` → free-text: show response, auto-score, rationale.
- `goals` shown at top when present.

---

## 5. Buildout plan (phases)

**Phase 0 — Version control (do first)**
- Push `peds-id-assessment` to a new GitHub repo (e.g. `sage-app`).
- (Optional) keep `Sage-Project` as the public landing page, or absorb it later.

**Phase 1 — Foundation**
- Add DB (SQLite via Prisma recommended). One `Submission` table matching §4,
  plus a child `Answer` table (or store the normalized JSON blob + key columns).
- Add NextAuth, restrict admin routes to allowed faculty emails.

**Phase 2 — Bring assessments in**
- Port the 3 static quizzes into the app as routes, reusing the resident
  submit→score→store pattern. Each writes to the same `Submission` table.
- Med-student/antimicrobial scoring can run client-or-server; keep answer keys
  server-side where possible (mirror the resident pattern).

**Phase 3 — One faculty dashboard**
- `/admin` (auth-gated) listing every submission across all assessments, with the
  per-question review from §4. Port `Sage-Project/admin/index.html`'s renderer.

**Phase 4 — Retire Google layer**
- Once DB is the source of truth, stop writing to Apps Script. Keep faculty email
  notifications (move to a server mailer, e.g. nodemailer/Resend).

---

## 6. Files already produced (reference when porting)

In `Sage-Project` repo:
- `scripts/resident-saveToSheets.ts` — server module that builds the §4 payload
  for the resident app from `QUESTIONS` + `scoring` + free-text grades. The DB
  write in Phase 1 should produce this same normalized shape.
- `scripts/resident-AssessmentForm.tsx` — earlier client component (superseded by
  server-side save; use as reference only).
- `admin/index.html` — the dashboard UI/renderer to port to React.
- `scripts/sheets_webhook.gs` — current backend behavior to replicate in the DB/API.

---

## 7. Known facts / gotchas
- Resident answer key is server-only (`getPublicQuestions()` strips it). Keep it
  that way — do scoring/grading server-side.
- Free-text scoring is 0 / 0.5 / 1 via Grok against `scoringNotes`.
- Faculty email: `maemurph@utmb.edu`.
- Flag threshold for weak domains: <65%.
