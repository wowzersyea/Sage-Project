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
    title.textContent = antibiogramData.metadata.institution || 'Local Antibiogram';

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

    // UTI-relevant antibiotics
    const utiAntibiotics = [
        { name: 'Nitrofurantoin', caveat: 'Not for Proteus or pyelonephritis' },
        { name: 'TMP-SMX', alias: 'Trimethoprim/Sulfamethoxazole' },
        { name: 'Cefazolin', displayAs: 'Cefdinir*', note: '*Predicted from Cefazolin' },
        { name: 'Cephalexin', alias: 'Cefazolin' },
        { name: 'Amox-Clav', alias: 'Amoxicillin/Clavulanate' },
        { name: 'Ciprofloxacin', caveat: 'Reserve for resistant cases' },
        { name: 'Levofloxacin', caveat: 'Reserve for resistant cases' },
        { name: 'Ampicillin' }
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
                note: abx.note
            });
        }
    });

    // Sort by percent descending
    results.sort((a, b) => b.percent - a.percent);

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
        btn.classList.toggle('active', btn.textContent.toLowerCase().includes(type.replace('-', ' ')));
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
            return 99; // Strep essentially always susceptible
        }

        if (antibiotic === 'Clindamycin') {
            // Check actual clindamycin data for strep
            if (strep) {
                const [, org] = strep;
                return org.susceptibility['Clindamycin'] || 75;
            }
            return 75; // Variable
        }

        return null;
    } else {
        // Purulent: Target S. aureus including MRSA
        const staph = Object.entries(antibiogramData.organisms).find(([name]) =>
            name.toLowerCase().includes('staphylococcus aureus')
        );

        if (!staph) return null;

        const [, org] = staph;
        const mrsaRate = calculateMRSARate() || 20;

        // MRSA-active antibiotics
        const mrsaActive = ['TMP-SMX', 'Trimethoprim/Sulfamethoxazole', 'Doxycycline', 'Clindamycin', 'Vancomycin', 'Linezolid'];

        let susc = org.susceptibility[antibiotic];
        if (susc === undefined) return null;

        // If not MRSA-active, reduce by MRSA rate
        if (!mrsaActive.some(ma => antibiotic.includes(ma))) {
            susc = Math.round(susc * (1 - mrsaRate / 100));
        }

        return susc;
    }
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

    // Show MRSA alert for purulent
    const mrsaRate = calculateMRSARate();
    if (currentCellulitisType === 'purulent' && mrsaRate !== null) {
        mrsaAlert.style.display = 'block';
        mrsaRateEl.textContent = mrsaRate;
    } else {
        mrsaAlert.style.display = 'none';
    }

    // Antibiotics based on type
    let antibiotics;
    if (currentCellulitisType === 'non-purulent') {
        antibiotics = [
            { name: 'Cephalexin' },
            { name: 'Amoxicillin' },
            { name: 'Penicillin' },
            { name: 'Clindamycin', caveat: 'For penicillin allergy - check local strep resistance' }
        ];
    } else {
        antibiotics = [
            { name: 'TMP-SMX', caveat: 'First-line for MRSA' },
            { name: 'Doxycycline', caveat: 'Avoid in children <8 years' },
            { name: 'Clindamycin', caveat: 'Check D-test for inducible resistance' },
            { name: 'Cephalexin', caveat: 'Does NOT cover MRSA' },
            { name: 'Vancomycin', caveat: 'IV only - severe cases' }
        ];
    }

    const results = [];

    antibiotics.forEach(abx => {
        const success = calculateCellulitisSuccess(abx.name, currentCellulitisType);

        if (success !== null) {
            results.push({
                name: abx.name,
                percent: success,
                category: getSuccessCategory(success),
                caveat: abx.caveat
            });
        }
    });

    // Sort by percent descending
    results.sort((a, b) => b.percent - a.percent);

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

    // Generate recommendation
    const excellent = results.filter(r => r.category === 'excellent');
    const good = results.filter(r => r.category === 'good');

    if (excellent.length > 0 || good.length > 0) {
        recBox.style.display = 'block';

        const firstLine = excellent[0] || good[0];

        let recHTML = `
            <div class="rec-item">
                <div class="rec-label">First Line</div>
                <div class="rec-value">${firstLine.name} (${firstLine.percent}% coverage)</div>
            </div>
        `;

        if (currentCellulitisType === 'purulent') {
            recHTML += `
                <div class="rec-item">
                    <div class="rec-label">Important</div>
                    <div class="rec-value" style="color: var(--accent-coral);">I&D is PRIMARY treatment for abscesses</div>
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
