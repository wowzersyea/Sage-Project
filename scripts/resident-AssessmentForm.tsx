"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

// ─── Sage Project — Google Sheets save ───────────────────────────────────────
// Paste your Google Apps Script Web App URL here (same URL as the other
// assessments). Leave blank to disable saving.
const SHEETS_ENDPOINT = "https://script.google.com/macros/s/AKfycbzVGqv0Ot-L9BtUzcWhq8XTpmOEZSGqVFwD0kPLSRfKBFVvTlRLMdzmtWXZuaPf6adz/exec";

type Stage = "loading" | "intake" | "questions" | "submitting" | "error";

interface QuestionOption {
  id: string;
  text: string;
}

interface Question {
  id: string;
  type: "MCQ" | "FREE_TEXT";
  domain: string;
  difficulty: string;
  vignetteGroup?: string;
  vignettePart?: string;
  stem: string;
  prompt: string;
  options?: QuestionOption[];
}

interface AnswerMap {
  [questionId: string]: string;
}

export default function AssessmentForm() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("loading");
  const [questions, setQuestions] = useState<Question[]>([]);

  // Intake
  const [residentName, setResidentName] = useState("");
  const [residentEmail, setResidentEmail] = useState("");
  const [goalDiscomfort, setGoalDiscomfort] = useState("");
  const [goalAntibiotics, setGoalAntibiotics] = useState("");
  const [goalPastCase, setGoalPastCase] = useState("");
  const [goalRotationGoal, setGoalRotationGoal] = useState("");

  // Question state
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    async function loadQuestions() {
      try {
        const res = await fetch("/api/questions", { cache: "no-store" });
        if (!res.ok) throw new Error("Could not load questions.");
        const data = (await res.json()) as { questions?: Question[] };
        if (!data.questions?.length) throw new Error("No questions were returned.");
        setQuestions(data.questions);
        setStage("intake");
      } catch (e) {
        setErrorMsg(e instanceof Error ? e.message : "Could not load questions.");
        setStage("error");
      }
    }
    loadQuestions();
  }, []);

  const currentQ: Question | undefined = questions[currentIdx];
  const progressPct = useMemo(
    () => (questions.length ? Math.round(((currentIdx + 1) / questions.length) * 100) : 0),
    [currentIdx, questions.length]
  );

  function startQuestions() {
    if (
      !residentName.trim() ||
      !goalDiscomfort.trim() ||
      !goalAntibiotics.trim() ||
      !goalPastCase.trim() ||
      !goalRotationGoal.trim()
    ) {
      setErrorMsg("Please complete all fields before continuing.");
      return;
    }
    setErrorMsg("");
    setStage("questions");
  }

  function recordAnswer(qid: string, value: string) {
    setAnswers((prev) => ({ ...prev, [qid]: value }));
  }

  function goNext() {
    if (!currentQ) return;
    const ans = answers[currentQ.id];
    if (!ans || !ans.trim()) {
      setErrorMsg("Please answer before continuing.");
      return;
    }
    setErrorMsg("");
    if (currentIdx < questions.length - 1) {
      setCurrentIdx(currentIdx + 1);
    } else {
      submit();
    }
  }

  if (stage === "loading") {
    return (
      <div className="max-w-2xl mx-auto px-6 py-20 text-center">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-10">
          <div className="animate-pulse text-brand-600 text-lg font-medium mb-3">
            Loading assessment...
          </div>
        </div>
      </div>
    );
  }

  function goPrev() {
    setErrorMsg("");
    if (currentIdx > 0) setCurrentIdx(currentIdx - 1);
  }

  // Silently save a copy of the raw submission to Google Sheets, in parallel
  // with the existing /api/submit flow. Fire-and-forget: never blocks routing,
  // never surfaces an error to the resident.
  async function saveToSheets() {
    if (!SHEETS_ENDPOINT) return;
    try {
      await fetch(SHEETS_ENDPOINT, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assessmentType: "Resident",
          timestamp: new Date().toISOString(),
          name: residentName,
          email: residentEmail,
          goals: {
            discomfort: goalDiscomfort,
            antibiotics: goalAntibiotics,
            pastCase: goalPastCase,
            rotationGoal: goalRotationGoal,
          },
          answers: Object.entries(answers).map(([questionId, answer]) => ({
            questionId,
            answer,
          })),
          totalQuestions: questions.length,
        }),
      });
    } catch (e) {
      console.warn("Could not save to Sheets:", e);
    }
  }

  async function submit() {
    setStage("submitting");
    try {
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          residentName,
          residentEmail,
          goals: {
            discomfort: goalDiscomfort,
            antibiotics: goalAntibiotics,
            pastCase: goalPastCase,
            rotationGoal: goalRotationGoal,
          },
          answers: Object.entries(answers).map(([questionId, answer]) => ({
            questionId,
            answer,
          })),
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || "Submission failed");
      }

      saveToSheets(); // fire-and-forget Sheets backup
      router.push("/complete");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Submission failed");
      setStage("error");
    }
  }

  // -----  STAGE: INTAKE  -----
  if (stage === "intake") {
    return (
      <div className="max-w-3xl mx-auto px-6 py-12">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          <h1 className="text-2xl font-semibold text-gray-900 mb-2">
            Before You Begin
          </h1>
          <p className="text-gray-600 mb-8">
            Tell us a bit about yourself and what you want from this rotation.
          </p>

          <div className="space-y-5">
            <Field label="Your name" required>
              <input
                type="text"
                value={residentName}
                onChange={(e) => setResidentName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="e.g., Jane Smith"
              />
            </Field>

            <Field label="Your email (optional)">
              <input
                type="email"
                value={residentEmail}
                onChange={(e) => setResidentEmail(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="resident@example.com"
              />
            </Field>

            <Field
              label="1. What clinical infection scenarios make you most uncomfortable managing — and why?"
              required
            >
              <textarea
                value={goalDiscomfort}
                onChange={(e) => setGoalDiscomfort(e.target.value)}
                rows={3}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </Field>

            <Field
              label="2. Which antibiotic class do you feel least confident choosing or dosing correctly?"
              required
            >
              <textarea
                value={goalAntibiotics}
                onChange={(e) => setGoalAntibiotics(e.target.value)}
                rows={3}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </Field>

            <Field
              label="3. Is there a specific condition or pathogen you've encountered and felt unprepared for? Describe what happened."
              required
            >
              <textarea
                value={goalPastCase}
                onChange={(e) => setGoalPastCase(e.target.value)}
                rows={3}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </Field>

            <Field
              label="4. What do you want to be able to do independently and confidently by the end of this rotation?"
              required
            >
              <textarea
                value={goalRotationGoal}
                onChange={(e) => setGoalRotationGoal(e.target.value)}
                rows={3}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </Field>
          </div>

          {errorMsg && <p className="text-red-600 text-sm mt-4">{errorMsg}</p>}

          <div className="mt-8">
            <button
              onClick={startQuestions}
              className="bg-brand-600 hover:bg-brand-700 text-white font-medium px-6 py-3 rounded-lg transition"
            >
              Continue to Questions
            </button>
          </div>
        </div>
      </div>
    );
  }

  // -----  STAGE: SUBMITTING  -----
  if (stage === "submitting") {
    return (
      <div className="max-w-2xl mx-auto px-6 py-20 text-center">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-10">
          <div className="animate-pulse text-brand-600 text-lg font-medium mb-3">
            Scoring your assessment…
          </div>
          <p className="text-gray-600 text-sm">
            This takes about 30–60 seconds. Please do not close this window.
          </p>
        </div>
      </div>
    );
  }

  // -----  STAGE: ERROR  -----
  if (stage === "error") {
    return (
      <div className="max-w-2xl mx-auto px-6 py-20">
        <div className="bg-white rounded-2xl shadow-sm border border-red-200 p-10">
          <h2 className="text-xl font-semibold text-red-700 mb-2">
            Submission Failed
          </h2>
          <p className="text-gray-700 mb-4">{errorMsg}</p>
          <p className="text-sm text-gray-600 mb-6">
            Your answers are still in the form — try again, or take a screenshot
            of your responses and contact your attending.
          </p>
          <button
            onClick={() => {
              setStage("questions");
              setErrorMsg("");
            }}
            className="bg-brand-600 hover:bg-brand-700 text-white font-medium px-6 py-3 rounded-lg transition"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // -----  STAGE: QUESTIONS  -----
  if (!currentQ) return null;
  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <div className="mb-4">
        <div className="flex justify-between text-sm text-gray-600 mb-1">
          <span>
            Question {currentIdx + 1} of {questions.length}
          </span>
          <span>{progressPct}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-brand-600 h-2 rounded-full transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
        {currentQ.vignetteGroup && (
          <p className="text-xs uppercase tracking-wider text-brand-600 font-semibold mb-3">
            Vignette {currentQ.vignetteGroup} — Part {currentQ.vignettePart}
          </p>
        )}

        <p className="text-gray-800 mb-4 leading-relaxed">{currentQ.stem}</p>
        <p className="text-gray-900 font-medium mb-6">{currentQ.prompt}</p>

        {currentQ.type === "MCQ" && currentQ.options && (
          <div className="space-y-2">
            {currentQ.options.map((opt) => (
              <label
                key={opt.id}
                className={`flex gap-3 p-3 rounded-lg border cursor-pointer transition ${
                  answers[currentQ.id] === opt.id
                    ? "border-brand-600 bg-brand-50"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <input
                  type="radio"
                  name={currentQ.id}
                  value={opt.id}
                  checked={answers[currentQ.id] === opt.id}
                  onChange={(e) => recordAnswer(currentQ.id, e.target.value)}
                  className="mt-1"
                />
                <span>
                  <strong className="mr-2">{opt.id}.</strong>
                  {opt.text}
                </span>
              </label>
            ))}
          </div>
        )}

        {currentQ.type === "FREE_TEXT" && (
          <textarea
            value={answers[currentQ.id] || ""}
            onChange={(e) => recordAnswer(currentQ.id, e.target.value)}
            rows={6}
            placeholder="Type your response here…"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        )}

        {errorMsg && <p className="text-red-600 text-sm mt-4">{errorMsg}</p>}

        <div className="flex justify-between mt-8">
          <button
            onClick={goPrev}
            disabled={currentIdx === 0}
            className="px-5 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            Previous
          </button>
          <button
            onClick={goNext}
            className="px-6 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-medium transition"
          >
            {currentIdx === questions.length - 1 ? "Submit Assessment" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-900 mb-1">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {children}
    </div>
  );
}
