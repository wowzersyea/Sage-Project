/**
 * ASP Advisor - Antimicrobial Stewardship Empiric Therapy Calculator
 * Sage Project
 */

// ============================================
// GLOBAL STATE
// ============================================

let antibiogramData = null;
let protocols = null;
let currentCellulitisType = 'non-purulent';

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', async () => {
    // Load protocols
    await loadProtocols();

    // Load saved antibiogram from localStorage
    const saved = localStorage.getItem('asp-advisor-antibiogram');
    if (saved) {
        try {
            antibiogramData = JSON.parse(saved);
            updateAntibiogramStatus();
            renderUTIResults();
            renderCellulitisResults();
        } catch (e) {
            console.error('Error loading saved antibiogram:', e);
        }
    }

    // Setup upload handlers
    setupUploadHandlers();

    // Load literature
    loadLiterature();
});

async function loadProtocols() {
    try {
        const response = await fetch('data/protocols.json');
        protocols = await response.json();
        console.log('Protocols loaded');
    } catch (e) {
        console.error('Error loading protocols:', e);
        // Use embedded defaults
        protocols = getDefaultProtocols();
    }
}

function getDefaultProtocols() {
    return {
        UTI: {
            uncomplicated: {
                organism_weights: {
                    "Escherichia coli": 0.80,
                    "Klebsiella pneumoniae": 0.10,
                    "Proteus mirabilis": 0.05,
                    "Enterobacter cloacae": 0.03,
                    "Other": 0.02
                }
            }
        }
    };
}

// ============================================
// TAB NAVIGATION
// ============================================

function switchTab(tabName) {
    // Update buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Update content
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    document.getElementById(tabName + 'Tab').classList.add('active');
}

// ============================================
// ANTIBIOGRAM PARSING
// ============================================

function setupUploadHandlers() {
    const uploadZone = document.getElementById('uploadZone');
    const fileInput = document.getElementById('fileInput');

    uploadZone.addEventListener('click', () => fileInput.click());

    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.classList.add('dragover');
    });

    uploadZone.addEventListener('dragleave', () => {
        uploadZone.classList.remove('dragover');
    });

    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    });

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) handleFile(file);
    });
}

function handleFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const content = e.target.result;
        parseCSV(content);
    };
    reader.readAsText(file);
}

function parseCSV(content) {
    const lines = content.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim());

    // Find the organism and N columns
    const organismCol = headers.findIndex(h =>
        h.toLowerCase().includes('organism') || h.toLowerCase() === 'bug'
    ) || 0;

    const nCol = headers.findIndex(h =>
        h.toLowerCase() === 'n' || h.toLowerCase().includes('isolate')
    );

    // Remaining columns are antibiotics
    const antibioticCols = headers.map((h, i) => {
        if (i === organismCol || i === nCol) return null;
        return { index: i, name: h };
    }).filter(x => x !== null);

    const organisms = {};

    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        const organism = values[organismCol];
        if (!organism) continue;

        const isolates = nCol >= 0 ? parseInt(values[nCol]) || 0 : 0;
        const susceptibility = {};

        antibioticCols.forEach(({ index, name }) => {
            const val = values[index];
            if (val && val !== '-' && val !== '') {
                // Handle footnotes like "71 3" or "57 2"
                const numMatch = val.match(/^(\d+)/);
                if (numMatch) {
                    susceptibility[name] = parseInt(numMatch[1]);
                }
            }
        });

        organisms[organism] = {
            isolates,
            susceptibility
        };
    }

    // Create antibiogram data structure
    const parsed = {
        metadata: {
            institution: 'Uploaded Antibiogram',
            period: new Date().getFullYear().toString(),
            source: 'CSV Import',
            uploadedAt: new Date().toISOString()
        },
        organisms
    };

    // Show preview
    showDataPreview(parsed);
}

function showDataPreview(data) {
    const container = document.getElementById('previewTable');
    const preview = document.getElementById('dataPreview');

    // Get all antibiotics across all organisms
    const allAntibiotics = new Set();
    Object.values(data.organisms).forEach(org => {
        Object.keys(org.susceptibility).forEach(abx => allAntibiotics.add(abx));
    });

    const antibiotics = Array.from(allAntibiotics).slice(0, 8); // Limit for display

    let html = '<table><thead><tr>';
    html += '<th>Organism</th><th>N</th>';
    antibiotics.forEach(abx => {
        html += `<th>${abx}</th>`;
    });
    html += '</tr></thead><tbody>';

    Object.entries(data.organisms).forEach(([name, org]) => {
        html += `<tr><td>${name}</td><td>${org.isolates}</td>`;
        antibiotics.forEach(abx => {
            const val = org.susceptibility[abx];
            html += `<td>${val !== undefined ? val + '%' : '-'}</td>`;
        });
        html += '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
    preview.style.display = 'block';

    // Store temporarily
    window.pendingAntibiogram = data;
}

function confirmData() {
    if (window.pendingAntibiogram) {
        antibiogramData = window.pendingAntibiogram;
        localStorage.setItem('asp-advisor-antibiogram', JSON.stringify(antibiogramData));
        updateAntibiogramStatus();
        renderUTIResults();
        renderCellulitisResults();
        switchTab('uti');
        document.getElementById('dataPreview').style.display = 'none';
        window.pendingAntibiogram = null;
    }
}

function clearData() {
    document.getElementById('dataPreview').style.display = 'none';
    window.pendingAntibiogram = null;
}

async function loadSampleData() {
    try {
        const response = await fetch('data/sample-antibiogram.csv');
        const content = await response.text();
        parseCSV(content);
    } catch (e) {
        console.error('Error loading sample data:', e);
        alert('Could not load sample data');
    }
}

// ============================================
// ANTIBIOGRAM STATUS
// ============================================

function updateAntibiogramStatus() {
    const status = document.getElementById('antibiogramStatus');
    const title = document.getElementById('antibiogramTitle');
    const meta = document.getElementById('antibiogramMeta');

    if (!antibiogramData) {
        status.classList.add('empty');
        title.textContent = 'No Antibiogram Loaded';
        meta.innerHTML = '<span>Upload your institution\'s antibiogram to get started</span>';
        return;
    }

    status.classList.remove('empty');
    title.innerHTML = `
        ${antibiogramData.metadata.institution || 'Local Antibiogram'}
        <button type="button" onclick="clearAllData()" style="
            margin-left: 1rem;
            padding: 0.25rem 0.5rem;
            font-size: 0.75rem;
            background: var(--sage-100);
            border: none;
            border-radius: 4px;
            color: var(--text-muted);
            cursor: pointer;
        ">Clear Data</button>
    `;

    const totalIsolates = Object.values(antibiogramData.organisms)
        .reduce((sum, org) => sum + (org.isolates || 0), 0);

    const orgCount = Object.keys(antibiogramData.organisms).length;

    meta.innerHTML = `
        <span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                <line x1="16" y1="2" x2="16" y2="6"/>
                <line x1="8" y1="2" x2="8" y2="6"/>
                <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            Period: ${antibiogramData.metadata.period || 'Unknown'}
        </span>
        <span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            ${orgCount} organisms | ${totalIsolates.toLocaleString()} total isolates
        </span>
        <span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <polyline points="12 6 12 12 16 14"/>
            </svg>
            Uploaded: ${new Date(antibiogramData.metadata.uploadedAt).toLocaleDateString()}
        </span>
    `;
}

// ============================================
// UTI CALCULATIONS
// ============================================

function calculateUTISuccess(antibiotic) {
    if (!antibiogramData || !protocols) return null;

    const weights = protocols.UTI?.uncomplicated?.organism_weights || {
        "Escherichia coli": 0.80,
        "Klebsiella pneumoniae": 0.10,
        "Proteus mirabilis": 0.05,
        "Enterobacter cloacae": 0.03,
        "Other": 0.02
    };

    let weightedSuccess = 0;
    let totalWeight = 0;

    for (const [organism, weight] of Object.entries(weights)) {
        // Try to find the organism (fuzzy match)
        const orgKey = Object.keys(antibiogramData.organisms).find(k =>
            k.toLowerCase().includes(organism.toLowerCase().split(' ')[0])
        );

        if (orgKey) {
            const org = antibiogramData.organisms[orgKey];
            const susceptibility = org.susceptibility[antibiotic];

            if (susceptibility !== undefined) {
                weightedSuccess += susceptibility * weight;
                totalWeight += weight;
            }
        }
    }

    if (totalWeight === 0) return null;

    // Normalize by actual weight used
    return Math.round(weightedSuccess / totalWeight * (totalWeight < 0.5 ? 0.8 : 1));
}

function getSuccessCategory(percent) {
    if (percent >= 85) return 'excellent';
    if (percent >= 75) return 'good';
    if (percent >= 60) return 'marginal';
    return 'avoid';
}

function renderUTIResults() {
    const container = document.getElementById('utiResults');
    const recBox = document.getElementById('utiRecommendation');
    const recContent = document.getElementById('utiRecContent');

    if (!antibiogramData) {
        container.innerHTML = `
            <p style="color: var(--text-muted); text-align: center; padding: 2rem;">
                Load antibiogram data to see recommendations
            </p>
        `;
        recBox.style.display = 'none';
        return;
    }

    // UTI-relevant antibiotics with stewardship tier (lower = preferred)
    const utiAntibiotics = [
        { name: 'Nitrofurantoin', tier: 1, caveat: 'Not for Proteus or pyelonephritis' },
        { name: 'TMP-SMX', tier: 1, alias: 'Trimethoprim/Sulfamethoxazole' },
        { name: 'Cephalexin', tier: 2, alias: 'Cefazolin' },
        { name: 'Amox-Clav', tier: 2, alias: 'Amoxicillin/Clavulanate' },
        { name: 'Ampicillin', tier: 2 },
        { name: 'Cefazolin', tier: 3, displayAs: 'Cefdinir*', note: '*Predicted from Cefazolin susceptibility' },
        { name: 'Ciprofloxacin', tier: 4, caveat: 'Reserve for resistant cases' },
        { name: 'Levofloxacin', tier: 4, caveat: 'Reserve for resistant cases' }
    ];

    const results = [];

    utiAntibiotics.forEach(abx => {
        // Try to find the antibiotic in the data
        let success = null;
        let usedName = abx.name;

        // Try main name
        success = calculateUTISuccess(abx.name);

        // Try alias if main not found
        if (success === null && abx.alias) {
            success = calculateUTISuccess(abx.alias);
            if (success !== null) usedName = abx.alias;
        }

        if (success !== null) {
            results.push({
                name: abx.displayAs || abx.name,
                percent: success,
                category: getSuccessCategory(success),
                caveat: abx.caveat,
                note: abx.note,
                tier: abx.tier
            });
        }
    });

    // Sort by effective tier (accounting for poor coverage), then by percent
    // If a first-line agent has <75% coverage, demote it below agents with good coverage
    results.sort((a, b) => {
        // Calculate effective tier: demote agents with poor coverage (<75%)
        const aEffectiveTier = a.percent < 75 ? Math.max(a.tier, 3) : a.tier;
        const bEffectiveTier = b.percent < 75 ? Math.max(b.tier, 3) : b.tier;

        if (aEffectiveTier !== bEffectiveTier) return aEffectiveTier - bEffectiveTier;
        return b.percent - a.percent;
    });

    if (results.length === 0) {
        container.innerHTML = `
            <p style="color: var(--text-muted); text-align: center; padding: 2rem;">
                No matching antibiotics found in antibiogram data
            </p>
        `;
        recBox.style.display = 'none';
        return;
    }

    // Render results
    container.innerHTML = results.map(r => `
        <div class="antibiotic-row ${r.category}">
            <div class="abx-indicator ${r.category}">
                ${r.category === 'excellent' ? '✓' : r.category === 'good' ? '●' : r.category === 'marginal' ? '!' : '✗'}
            </div>
            <div class="abx-name">
                ${r.name}
                ${r.caveat ? `<span class="caveat">${r.caveat}</span>` : ''}
            </div>
            <div class="abx-percent ${r.category}">${r.percent}%</div>
            <div class="abx-bar">
                <div class="abx-bar-fill ${r.category}" style="width: ${r.percent}%"></div>
            </div>
        </div>
    `).join('');

    // Add note about Cefdinir
    const cefdinirResult = results.find(r => r.name.includes('Cefdinir'));
    if (cefdinirResult && cefdinirResult.note) {
        container.innerHTML += `<p style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.5rem; margin-left: 0.5rem;">${cefdinirResult.note}</p>`;
    }

    // Generate recommendation
    const excellent = results.filter(r => r.category === 'excellent');
    const good = results.filter(r => r.category === 'good');

    if (excellent.length > 0 || good.length > 0) {
        recBox.style.display = 'block';

        const firstLine = excellent[0] || good[0];
        const alternative = excellent[1] || good[0] || good[1];

        let recHTML = `
            <div class="rec-item">
                <div class="rec-label">First Line</div>
                <div class="rec-value">${firstLine.name} (${firstLine.percent}% coverage)</div>
        `;

        // Add dosing if available
        const dosing = protocols?.UTI?.uncomplicated?.antibiotics?.[firstLine.name.replace('*', '')]?.dosing;
        if (dosing) {
            recHTML += `<div class="rec-dosing">Pediatric: ${dosing.pediatric}</div>`;
        }

        recHTML += '</div>';

        if (alternative && alternative.name !== firstLine.name) {
            recHTML += `
                <div class="rec-item">
                    <div class="rec-label">Alternative</div>
                    <div class="rec-value">${alternative.name} (${alternative.percent}% coverage)</div>
                </div>
            `;
        }

        recHTML += `
            <div class="rec-item">
                <div class="rec-label">Duration</div>
                <div class="rec-value">5-7 days (uncomplicated cystitis)</div>
            </div>
        `;

        recContent.innerHTML = recHTML;
    } else {
        recBox.style.display = 'none';
    }
}

// ============================================
// CELLULITIS CALCULATIONS
// ============================================

function selectCellulitisType(type) {
    currentCellulitisType = type;

    document.querySelectorAll('.type-btn').forEach(btn => {
        const btnType = btn.dataset.type;
        btn.classList.toggle('active', btnType === type);
    });

    renderCellulitisResults();
}

function calculateMRSARate() {
    if (!antibiogramData) return null;

    // Find S. aureus
    const staph = Object.entries(antibiogramData.organisms).find(([name]) =>
        name.toLowerCase().includes('staphylococcus aureus') ||
        name.toLowerCase() === 's. aureus'
    );

    if (!staph) return null;

    const [, org] = staph;

    // MRSA rate = 100 - Oxacillin susceptibility
    const oxaSusc = org.susceptibility['Oxacillin'];
    if (oxaSusc !== undefined) {
        return 100 - oxaSusc;
    }

    return null;
}

function calculateCellulitisSuccess(antibiotic, type) {
    if (!antibiogramData) return null;

    if (type === 'non-purulent') {
        // Non-purulent: Target Strep - virtually 100% susceptible to beta-lactams
        return { strep: calculateStrepCoverage(antibiotic), staph: null };
    } else if (type === 'purulent') {
        // Purulent: Target S. aureus including MRSA
        return { strep: null, staph: calculateStaphCoverage(antibiotic) };
    } else {
        // Unknown: Need to cover BOTH Strep and Staph - return both coverages
        return {
            strep: calculateStrepCoverage(antibiotic),
            staph: calculateStaphCoverage(antibiotic)
        };
    }
}

function calculateStrepCoverage(antibiotic) {
    // Check for actual strep data if available
    const strep = Object.entries(antibiogramData.organisms).find(([name]) =>
        name.toLowerCase().includes('streptococcus')
    );

    if (strep) {
        const [, org] = strep;
        const susc = org.susceptibility[antibiotic];
        if (susc !== undefined) return susc;
    }

    // Default assumptions for strep
    const betaLactams = ['Cephalexin', 'Amoxicillin', 'Penicillin', 'Ampicillin', 'Ceftriaxone'];
    if (betaLactams.some(bl => antibiotic.includes(bl))) {
        return 99; // Strep essentially always susceptible to beta-lactams
    }

    if (antibiotic === 'Clindamycin') {
        // Check actual clindamycin data for strep
        if (strep) {
            const [, org] = strep;
            return org.susceptibility['Clindamycin'] || 75;
        }
        return 75; // Variable
    }

    // TMP-SMX and Doxycycline have poor strep coverage
    if (antibiotic === 'TMP-SMX' || antibiotic === 'Doxycycline') {
        // Check actual data if available
        if (strep) {
            const [, org] = strep;
            const susc = org.susceptibility[antibiotic];
            if (susc !== undefined) return susc;
        }
        // TMP-SMX: Strep is intrinsically resistant (~0% coverage)
        // Doxycycline: Variable but generally poor for strep (~15-30%)
        return antibiotic === 'TMP-SMX' ? 0 : 20;
    }

    return null;
}

function calculateStaphCoverage(antibiotic) {
    const staph = Object.entries(antibiogramData.organisms).find(([name]) =>
        name.toLowerCase().includes('staphylococcus aureus')
    );

    if (!staph) return null;

    const [, org] = staph;

    // Check if we have direct susceptibility data for this antibiotic
    let susc = org.susceptibility[antibiotic];

    // For beta-lactams, the antibiogram % already reflects MSSA-only coverage
    // (labs report MRSA as resistant to beta-lactams, so the % IS the MSSA susceptibility)
    // Don't reduce further - just use the value directly

    if (susc !== undefined) {
        return susc;
    }

    // Beta-lactams that don't cover MRSA - use Oxacillin (MSSA rate) as proxy
    const betaLactams = ['Cephalexin', 'Cefazolin', 'Ceftriaxone', 'Amoxicillin', 'Ampicillin', 'Penicillin', 'Amox-Clav'];
    const isBetaLactam = betaLactams.some(bl =>
        antibiotic.toLowerCase() === bl.toLowerCase() ||
        antibiotic.toLowerCase().includes(bl.toLowerCase())
    );

    if (isBetaLactam) {
        // Beta-lactams effective against MSSA only
        // Oxacillin susceptibility = MSSA rate = beta-lactam coverage for S. aureus

        // Try to find Oxacillin in the susceptibility data (case-insensitive)
        const oxaKey = Object.keys(org.susceptibility).find(k =>
            k.toLowerCase() === 'oxacillin'
        );
        if (oxaKey && org.susceptibility[oxaKey] !== undefined) {
            return org.susceptibility[oxaKey];
        }

        // Fallback: check if we have any cephalosporin data
        const cefaKey = Object.keys(org.susceptibility).find(k =>
            k.toLowerCase() === 'cefazolin'
        );
        const ceftKey = Object.keys(org.susceptibility).find(k =>
            k.toLowerCase() === 'ceftriaxone'
        );

        if (cefaKey && org.susceptibility[cefaKey] !== undefined) {
            return org.susceptibility[cefaKey];
        }
        if (ceftKey && org.susceptibility[ceftKey] !== undefined) {
            return org.susceptibility[ceftKey];
        }
    }

    return null;
}

function renderCellulitisResults() {
    const container = document.getElementById('cellulitisResults');
    const recBox = document.getElementById('cellulitisRecommendation');
    const recContent = document.getElementById('cellulitisRecContent');
    const mrsaAlert = document.getElementById('mrsaAlert');
    const mrsaRateEl = document.getElementById('mrsaRate');

    if (!antibiogramData) {
        container.innerHTML = `
            <p style="color: var(--text-muted); text-align: center; padding: 2rem;">
                Load antibiogram data to see recommendations
            </p>
        `;
        recBox.style.display = 'none';
        mrsaAlert.style.display = 'none';
        return;
    }

    // Show MRSA alert for purulent and unknown
    const mrsaRate = calculateMRSARate();
    if ((currentCellulitisType === 'purulent' || currentCellulitisType === 'unknown') && mrsaRate !== null) {
        mrsaAlert.style.display = 'block';
        if (currentCellulitisType === 'unknown') {
            mrsaAlert.innerHTML = `
                <strong>⚠️ No Single Agent Covers Both Strep + MRSA Well</strong>
                <br>Local MRSA Rate: ${mrsaRate}%
                <br><br>
                <strong>Options:</strong>
                <br>• <strong>Combination therapy:</strong> Cephalexin (Strep) + TMP-SMX (MRSA)
                <br>• <strong>Clindamycin monotherapy:</strong> Covers both but check local resistance
                <br>• <strong>Re-assess:</strong> Is it more likely Strep (non-purulent) or Staph (purulent)?
            `;
        } else {
            mrsaAlert.innerHTML = `
                <strong>Local MRSA Rate: ${mrsaRate}%</strong>
                <br>Empiric MRSA coverage recommended for purulent infections.
            `;
        }
    } else {
        mrsaAlert.style.display = 'none';
    }

    // Antibiotics based on type
    let antibiotics;
    if (currentCellulitisType === 'non-purulent') {
        antibiotics = [
            { name: 'Cephalexin', tier: 1 },
            { name: 'Amoxicillin', tier: 1 },
            { name: 'Penicillin', tier: 1 },
            { name: 'Clindamycin', tier: 2, caveat: 'For penicillin allergy - check local strep resistance' }
        ];
    } else if (currentCellulitisType === 'purulent') {
        antibiotics = [
            { name: 'TMP-SMX', tier: 1, caveat: 'First-line for MRSA' },
            { name: 'Doxycycline', tier: 1, caveat: 'Avoid in children <8 years' },
            { name: 'Clindamycin', tier: 2, caveat: 'Check D-test for inducible resistance' },
            { name: 'Cephalexin', tier: 3, caveat: 'Does NOT cover MRSA' }
        ];
    } else {
        // Unknown - need coverage for both Strep AND Staph
        // Show all options with BOTH coverages so clinician can decide
        antibiotics = [
            { name: 'Clindamycin', tier: 1, showBothCoverages: true },
            { name: 'Cephalexin', tier: 2, staphGap: true },
            { name: 'Amoxicillin', tier: 2, staphGap: true },
            { name: 'TMP-SMX', tier: 2, strepGap: true },
            { name: 'Doxycycline', tier: 2, strepGap: true }
        ];
    }

    const results = [];

    antibiotics.forEach(abx => {
        const coverage = calculateCellulitisSuccess(abx.name, currentCellulitisType);
        if (!coverage) return;

        let percent, strepPercent, staphPercent;

        if (currentCellulitisType === 'non-purulent') {
            percent = coverage.strep;
            strepPercent = coverage.strep;
            staphPercent = null;
        } else if (currentCellulitisType === 'purulent') {
            percent = coverage.staph;
            strepPercent = null;
            staphPercent = coverage.staph;
        } else {
            // Unknown: calculate combined score (50/50 odds of Strep vs Staph)
            strepPercent = coverage.strep;
            staphPercent = coverage.staph;
            // Average of both coverages assuming equal probability of either organism
            percent = Math.round(((strepPercent || 0) + (staphPercent || 0)) / 2);
        }

        if (percent !== null) {
            results.push({
                name: abx.name,
                percent: percent,
                strepPercent: strepPercent,
                staphPercent: staphPercent,
                category: getSuccessCategory(percent),
                caveat: abx.caveat,
                tier: abx.tier || 2,
                strepGap: abx.strepGap || false,
                staphGap: abx.staphGap || false,
                showBothCoverages: abx.showBothCoverages || false
            });
        }
    });

    // Sort by tier first, then by percent descending within tier
    results.sort((a, b) => {
        if (a.tier !== b.tier) return a.tier - b.tier;
        return b.percent - a.percent;
    });

    if (results.length === 0) {
        container.innerHTML = `
            <p style="color: var(--text-muted); text-align: center; padding: 2rem;">
                No matching antibiotics found in antibiogram data
            </p>
        `;
        recBox.style.display = 'none';
        return;
    }

    // Render results
    container.innerHTML = results.map(r => {
        let coverageDisplay = '';
        let gapWarning = '';

        if (currentCellulitisType === 'unknown') {
            // Show both coverages for unknown type
            const strepCat = getSuccessCategory(r.strepPercent || 0);
            const staphCat = getSuccessCategory(r.staphPercent || 0);
            coverageDisplay = `
                <div style="display: flex; gap: 8px; font-size: 0.8rem; margin-top: 2px;">
                    <span style="color: ${strepCat === 'excellent' || strepCat === 'good' ? 'var(--success)' : 'var(--danger)'};">
                        Strep: ${r.strepPercent || 0}%
                    </span>
                    <span style="color: ${staphCat === 'excellent' || staphCat === 'good' ? 'var(--success)' : 'var(--danger)'};">
                        Staph: ${r.staphPercent || 0}%
                    </span>
                </div>
            `;

            if (r.strepGap) {
                gapWarning = '<span style="background: #fff3cd; color: #856404; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; margin-left: 6px;">NO STREP</span>';
            } else if (r.staphGap) {
                gapWarning = '<span style="background: #f8d7da; color: #721c24; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; margin-left: 6px;">NO MRSA</span>';
            }
        }

        return `
            <div class="antibiotic-row ${r.category}">
                <div class="abx-indicator ${r.category}">
                    ${r.category === 'excellent' ? '✓' : r.category === 'good' ? '●' : r.category === 'marginal' ? '!' : '✗'}
                </div>
                <div class="abx-name">
                    ${r.name}${gapWarning}
                    ${currentCellulitisType === 'unknown' ? coverageDisplay : ''}
                    ${r.caveat ? `<span class="caveat">${r.caveat}</span>` : ''}
                </div>
                <div class="abx-percent ${r.category}">${r.percent}%</div>
                <div class="abx-bar">
                    <div class="abx-bar-fill ${r.category}" style="width: ${r.percent}%"></div>
                </div>
            </div>
        `;
    }).join('');

    // Generate recommendation
    const excellent = results.filter(r => r.category === 'excellent');
    const good = results.filter(r => r.category === 'good');

    if (excellent.length > 0 || good.length > 0) {
        recBox.style.display = 'block';

        // For unknown type, prefer drugs that cover both Strep and Staph
        let firstLine;
        let recHTML = '';

        if (currentCellulitisType === 'unknown') {
            // Find drugs that cover both reasonably (no gaps)
            const coversBoth = results.filter(r => !r.strepGap && !r.staphGap);
            firstLine = coversBoth.find(r => r.category === 'excellent' || r.category === 'good') ||
                       coversBoth[0] ||
                       results[0];

            // Show monotherapy option with both coverages
            recHTML = `
                <div class="rec-item">
                    <div class="rec-label">Monotherapy Option</div>
                    <div class="rec-value">
                        ${firstLine.name}
                        <span style="font-size: 0.85rem; color: var(--text-muted);">
                            (Strep: ${firstLine.strepPercent || 0}% | Staph: ${firstLine.staphPercent || 0}%)
                        </span>
                    </div>
                    ${getCellulitisDosingHTML(firstLine.name)}
                </div>
            `;
        } else {
            firstLine = excellent[0] || good[0];
            const coverageLabel = currentCellulitisType === 'non-purulent' ? 'Strep' : 'Staph';
            recHTML = `
                <div class="rec-item">
                    <div class="rec-label">First Line</div>
                    <div class="rec-value">${firstLine.name} (${firstLine.percent}% ${coverageLabel} coverage)</div>
                    ${getCellulitisDosingHTML(firstLine.name)}
                </div>
            `;
        }

        if (currentCellulitisType === 'purulent') {
            recHTML += `
                <div class="rec-item">
                    <div class="rec-label">Important</div>
                    <div class="rec-value" style="color: var(--accent-coral);">I&D is PRIMARY treatment for abscesses</div>
                </div>
            `;
        }

        if (currentCellulitisType === 'unknown') {
            // Find best Strep and Staph options for combination therapy
            const bestStrep = results.find(r => r.staphGap && r.strepPercent >= 85);
            const bestStaph = results.find(r => r.strepGap && r.staphPercent >= 85);

            recHTML += `
                <div class="rec-item">
                    <div class="rec-label">Combination Option</div>
                    <div class="rec-value">
                        ${bestStrep ? bestStrep.name : 'Cephalexin'} (Strep) + ${bestStaph ? bestStaph.name : 'TMP-SMX'} (MRSA)
                    </div>
                </div>
                <div class="rec-item">
                    <div class="rec-label">⚠️ Clinical Note</div>
                    <div class="rec-value" style="color: var(--text-secondary); font-size: 0.9rem;">
                        % shown = average of Strep & Staph (assumes 50/50 odds).<br>
                        Consider re-assessing: Is it purulent or non-purulent?
                    </div>
                </div>
            `;
        }

        recHTML += `
            <div class="rec-item">
                <div class="rec-label">Duration</div>
                <div class="rec-value">${currentCellulitisType === 'purulent' ? '5-10 days' : '5-7 days'}</div>
            </div>
        `;

        recContent.innerHTML = recHTML;
    } else {
        recBox.style.display = 'none';
    }
}

function getCellulitisDosingHTML(antibioticName) {
    // Get dosing from protocols if available
    const cellulitisType = currentCellulitisType === 'non-purulent' ? 'non_purulent' : 'purulent';
    const dosing = protocols?.Cellulitis?.[cellulitisType]?.antibiotics?.[antibioticName]?.dosing;

    if (dosing) {
        return `<div class="rec-dosing">Pediatric: ${dosing.pediatric}</div>`;
    }

    // Fallback dosing for common antibiotics
    const fallbackDosing = {
        'Cephalexin': '25-50 mg/kg/day divided TID-QID (max 4g/day)',
        'Amoxicillin': '25-50 mg/kg/day divided TID (max 3g/day)',
        'TMP-SMX': '8-12 mg TMP/kg/day divided BID',
        'Doxycycline': '2-4 mg/kg/day divided BID (>8 years only, max 200mg/day)',
        'Clindamycin': '20-30 mg/kg/day divided TID-QID (max 1.8g/day)',
        'Penicillin': '25-50 mg/kg/day divided QID'
    };

    if (fallbackDosing[antibioticName]) {
        return `<div class="rec-dosing">Pediatric: ${fallbackDosing[antibioticName]}</div>`;
    }

    return '';
}

// ============================================
// LITERATURE INTEGRATION
// ============================================

async function loadLiterature() {
    try {
        const response = await fetch('../literature-monitor/digests/latest.json');
        const digest = await response.json();

        // Extract UTI-relevant content
        const utiKeywords = ['UTI', 'urinary tract', 'cystitis', 'pyelonephritis', 'nitrofurantoin', 'TMP-SMX'];
        const utiContent = extractRelevantContent(digest.content, utiKeywords);
        renderLiteratureSection('utiLiterature', utiContent, 'UTI');

        // Extract cellulitis-relevant content
        const cellulitisKeywords = ['cellulitis', 'skin infection', 'SSTI', 'MRSA', 'abscess'];
        const cellulitisContent = extractRelevantContent(digest.content, cellulitisKeywords);
        renderLiteratureSection('cellulitisLiterature', cellulitisContent, 'cellulitis');

    } catch (e) {
        console.log('Could not load literature digest:', e);
        document.getElementById('utiLiterature').innerHTML = `
            <p style="color: var(--text-muted); font-size: 0.9rem;">
                Literature digest unavailable. <a href="../literature-monitor/index.html">View manually</a>
            </p>
        `;
        document.getElementById('cellulitisLiterature').innerHTML = `
            <p style="color: var(--text-muted); font-size: 0.9rem;">
                Literature digest unavailable. <a href="../literature-monitor/index.html">View manually</a>
            </p>
        `;
    }
}

function extractRelevantContent(content, keywords) {
    const sections = [];

    // Split by headers
    const parts = content.split(/#{2,3}\s+/);

    parts.forEach(part => {
        const lowerPart = part.toLowerCase();
        if (keywords.some(kw => lowerPart.includes(kw.toLowerCase()))) {
            // Extract first few sentences
            const sentences = part.split(/[.!?]+/).slice(0, 2).join('. ').trim();
            if (sentences.length > 20) {
                sections.push(sentences);
            }
        }
    });

    return sections.slice(0, 2); // Max 2 sections
}

function renderLiteratureSection(elementId, content, type) {
    const container = document.getElementById(elementId);

    if (content.length === 0) {
        container.innerHTML = `
            <p style="color: var(--text-muted); font-size: 0.9rem;">
                No specific ${type} articles in this week's digest.
            </p>
        `;
        return;
    }

    container.innerHTML = content.map(item => `
        <div class="literature-item">
            <p>${item.substring(0, 200)}${item.length > 200 ? '...' : ''}</p>
        </div>
    `).join('');
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

function clearAllData() {
    localStorage.removeItem('asp-advisor-antibiogram');
    antibiogramData = null;
    updateAntibiogramStatus();
    renderUTIResults();
    renderCellulitisResults();
}
