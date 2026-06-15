// ─── Resident → Google Sheets (server-side) ─────────────────────────────────
// Drop this in your Next.js app at: lib/saveToSheets.ts
//
// Call it from your /api/submit route AFTER scoring + free-text grading, so the
// answer key (correctAnswer / explanation / scoringNotes) and the LLM grades are
// all available. This runs server-side, so the key never reaches the browser.
//
// It builds the SAME payload shape the unified faculty admin dashboard renders
// for the other assessments: domains[].answers[] with full options, the
// resident's pick, the correct answer, and rationale — so resident submissions
// get full per-question review alongside med-student / antimicrobial.
//
// Set SHEETS_ENDPOINT in .env.local (same Apps Script Web App URL as the others):
//   SHEETS_ENDPOINT=https://script.google.com/macros/s/AKfyc.../exec

import "server-only";
import { QUESTIONS, DOMAIN_LABELS, Domain } from "./questions";
import type { AnswerRecord, ScoreSummary } from "./scoring";
import type { LearningGoals } from "./llm";

const SHEETS_ENDPOINT =
  process.env.SHEETS_ENDPOINT ||
  "https://script.google.com/macros/s/AKfycbzVGqv0Ot-L9BtUzcWhq8XTpmOEZSGqVFwD0kPLSRfKBFVvTlRLMdzmtWXZuaPf6adz/exec";

interface SaveArgs {
  residentName: string;
  residentEmail: string;
  goals: LearningGoals;
  answers: AnswerRecord[];   // free-text records should already carry freeTextScore / freeTextRationale
  summary: ScoreSummary;
  submittedAt?: Date;
}

// Group the answered questions by clinical domain and shape each one for the
// admin's per-question renderer.
function buildDomains(answers: AnswerRecord[]) {
  // domain label -> answer rows
  const byDomain: Record<string, any[]> = {};

  for (const q of QUESTIONS) {
    const a = answers.find((x) => x.questionId === q.id);
    if (!a) continue; // question not part of this attempt

    const domainLabel = DOMAIN_LABELS[q.domain];
    if (!byDomain[domainLabel]) byDomain[domainLabel] = [];

    const questionText = q.prompt ? `${q.stem}\n\n${q.prompt}` : q.stem;

    if (q.type === "MCQ" && q.options) {
      const options = q.options.map((o) => o.text);
      const selectedIndex = q.options.findIndex(
        (o) => o.id === (a.answer || "").trim().toUpperCase()
      );
      const correctIndex = q.options.findIndex((o) => o.id === q.correctAnswer);
      byDomain[domainLabel].push({
        questionId: q.id,
        question: questionText,
        options,
        selected: selectedIndex >= 0 ? options[selectedIndex] : "(no answer)",
        selectedIndex,
        correct: selectedIndex >= 0 && q.options[selectedIndex]?.id === q.correctAnswer,
        correctAnswer: correctIndex >= 0 ? options[correctIndex] : "",
        correctIndex,
        rationale: q.explanation || "",
      });
    } else {
      // FREE_TEXT — show their response, the LLM grade, and the teaching explanation
      const score = a.freeTextScore ?? 0;
      let rationale = "";
      if (a.freeTextRationale) rationale += `Grader: ${a.freeTextRationale}`;
      if (q.explanation) rationale += (rationale ? "\n\n" : "") + `Model answer: ${q.explanation}`;
      byDomain[domainLabel].push({
        questionId: q.id,
        question: questionText,
        correct: score === 1,
        score,
        detail: { text: a.answer || "(blank)" },
        rationale,
      });
    }
  }

  // Convert to the domains[] array the admin expects, pulling totals from summary.
  return byDomain;
}

export async function saveResidentToSheets(args: SaveArgs): Promise<void> {
  const { residentName, residentEmail, goals, answers, summary, submittedAt } = args;
  if (!SHEETS_ENDPOINT) return;

  const byDomain = buildDomains(answers);

  const domains = summary.domainScores
    .filter((d) => d.total > 0)
    .map((d) => ({
      domain: d.label,
      correct: d.correct,
      asked: d.total,
      maxTier: 0,
      answers: byDomain[d.label] || [],
    }));

  const totalEarned = summary.mcqCorrect + summary.freeTextEarned;
  const totalPossible = summary.mcqTotal + summary.freeTextTotal;

  const payload = {
    assessmentType: "Resident",
    timestamp: (submittedAt || new Date()).toISOString(),
    name: residentName,
    email: residentEmail,
    year: "Resident",
    school: "Resident",
    overallScore: Math.round(summary.overallPercent),
    correct: Math.round(totalEarned * 10) / 10,
    total: totalPossible,
    goals,
    domains,
  };

  try {
    await fetch(SHEETS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.warn("Could not save resident results to Sheets:", e);
  }
}
