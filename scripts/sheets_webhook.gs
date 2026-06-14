// ─── Sage Project — Assessment Results Collector ─────────────────────────────
// Deploy as Google Apps Script Web App:
//   Extensions → Apps Script → paste this → Deploy → New deployment
//   Type: Web App | Execute as: Me | Who has access: Anyone
//   Copy the Web App URL → paste into SHEETS_ENDPOINT in med-student-assessment/index.html

const SHEET_NAME = 'Responses';

function doPost(e) {
    try {
        const data = JSON.parse(e.postData.contents);
        const ss = SpreadsheetApp.getActiveSpreadsheet();
        let sheet = ss.getSheetByName(SHEET_NAME);

        // Create sheet with headers on first run
        if (!sheet) {
            sheet = ss.insertSheet(SHEET_NAME);
            const headers = [
                'Timestamp', 'Name', 'Year', 'School', 'Email',
                'Overall %', 'Correct', 'Total Questions',
                // One column per domain
                'Domain 1 Score', 'Domain 1 Max Tier',
                'Domain 2 Score', 'Domain 2 Max Tier',
                'Domain 3 Score', 'Domain 3 Max Tier',
                'Domain 4 Score', 'Domain 4 Max Tier',
                'Domain 5 Score', 'Domain 5 Max Tier',
                'Domain 6 Score', 'Domain 6 Max Tier',
                'Domain 7 Score', 'Domain 7 Max Tier',
                'Domain 8 Score', 'Domain 8 Max Tier',
                'Domain 9 Score', 'Domain 9 Max Tier',
                'Domain 10 Score', 'Domain 10 Max Tier',
                'Full JSON' // complete raw payload for AI grading later
            ];
            sheet.appendRow(headers);
            sheet.setFrozenRows(1);

            // Style header row
            const headerRange = sheet.getRange(1, 1, 1, headers.length);
            headerRange.setBackground('#2d5a3d');
            headerRange.setFontColor('#ffffff');
            headerRange.setFontWeight('bold');
        }

        // Build row
        const row = [
            data.timestamp,
            data.name,
            data.year,
            data.school,
            data.email,
            data.overallScore,
            data.correct,
            data.total
        ];

        // Domain columns (up to 10 domains)
        for (let i = 0; i < 10; i++) {
            const d = data.domains[i];
            if (d && d.asked > 0) {
                row.push(Math.round((d.correct / d.asked) * 100) + '%');
                row.push('Tier ' + d.maxTier);
            } else {
                row.push('—');
                row.push('—');
            }
        }

        // Full JSON for AI grader
        row.push(JSON.stringify(data));

        sheet.appendRow(row);

        // Send faculty notification email
        sendFacultyNotification(data);

        return ContentService
            .createTextOutput(JSON.stringify({ status: 'ok' }))
            .setMimeType(ContentService.MimeType.JSON);

    } catch (err) {
        return ContentService
            .createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
            .setMimeType(ContentService.MimeType.JSON);
    }
}

function sendFacultyNotification(data) {
    const FACULTY_EMAIL = 'faculty@sageproject.xyz'; // update to real email

    const date = new Date(data.timestamp).toLocaleDateString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    // ── Domain breakdown with missed questions ────────────────────────────────
    let domainSections = '';
    let totalMissed = 0;

    data.domains.forEach(d => {
        if (d.asked === 0) {
            domainSections += `\n${d.domain.toUpperCase()}\n  Not reached\n`;
            return;
        }

        const pct = Math.round((d.correct / d.asked) * 100);
        const status = pct === 100 ? '✓ All correct' : `${d.correct}/${d.asked} correct (${pct}%)`;
        domainSections += `\n${d.domain.toUpperCase()} — ${status} | Max: Tier ${d.maxTier}\n`;

        // List every answered question with result
        d.answers.forEach(a => {
            const icon = a.correct ? '  ✓' : '  ✗';
            domainSections += `${icon} [Tier ${a.tier}] ${a.question}\n`;
            if (!a.correct) {
                totalMissed++;
                domainSections += `      Their answer:   ${a.selected}\n`;
                domainSections += `      Correct answer: ${a.correctAnswer}\n`;
                if (a.rationale) {
                    domainSections += `      Rationale: ${a.rationale}\n`;
                }
            }
        });
    });

    // ── Missed questions summary at top ───────────────────────────────────────
    let missedSummary = '';
    if (totalMissed === 0) {
        missedSummary = 'Perfect score — no missed questions.';
    } else {
        missedSummary = `${totalMissed} question${totalMissed > 1 ? 's' : ''} missed (see breakdown below).`;
    }

    const subject = `[Sage] ${data.name} — ${data.overallScore}% — ${totalMissed} missed`;
    const body =
`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SAGE PROJECT — ASSESSMENT REPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Student: ${data.name}
Year:    ${data.year}
School:  ${data.school}
Email:   ${data.email}
Date:    ${date}

OVERALL SCORE: ${data.correct}/${data.total} (${data.overallScore}%)
${missedSummary}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DOMAIN-BY-DOMAIN BREAKDOWN
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${domainSections}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Full results and raw data saved in the Sage Project Google Sheet.
Reply to this email or contact ${data.email} to follow up with the student.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

    try {
        MailApp.sendEmail({
            to: FACULTY_EMAIL,
            cc: data.email,  // student gets a copy too
            subject: subject,
            body: body
        });
    } catch (e) {
        // Email sending failed — data is still saved to sheet
        console.warn('Email notification failed:', e);
    }
}

// Test function — run manually in Apps Script editor to verify sheet setup
function testSetup() {
    const testData = {
        timestamp: new Date().toISOString(),
        name: 'Test Student',
        year: 'MS3',
        school: 'Test Medical School',
        email: 'test@test.com',
        overallScore: 75,
        correct: 9,
        total: 12,
        domains: [
            { domain: 'Fever & Host Defense', correct: 1, asked: 2, maxTier: 2, answers: [] },
            { domain: 'Common Bacterial Infections', correct: 2, asked: 2, maxTier: 3, answers: [] }
        ]
    };
    const fakeEvent = { postData: { contents: JSON.stringify(testData) } };
    const result = doPost(fakeEvent);
    Logger.log(result.getContent());
}
