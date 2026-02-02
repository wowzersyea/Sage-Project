// QI Dashboard - Enhanced with Multi-Project, Median Line, and Aggregation
// Version 2.0 - Full QI Management System

// ============================================
// GLOBAL STATE
// ============================================

let projects = [];                    // All saved projects
let currentProjectId = null;          // Active project ID
let currentData = null;               // Current project's data
let currentChart = null;              // Chart.js instance
let displayCharts = {};               // Charts on display tab
let selectedVariables = [];
let interventions = [];
let goalValue = null;
let showMedian = true;
let aggregation = 'daily';
let xAxisTitle = 'Date';
let yAxisTitle = 'Rate (%)';
let dataFilePath = 'data/qi-data.csv';
let lastFileModified = null;

const AUTO_REFRESH_INTERVAL = 30000;
let refreshTimer = null;
let displayRefreshTimer = null;

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', function() {
    console.log('QI Dashboard v2.0 initialized');
    migrateFromLegacy();
    loadProjects();
    loadAppState();
    populateProjectSelector();
    initializeAutoRefresh();

    // Load last active project or attempt auto-load
    if (currentProjectId) {
        loadProject(currentProjectId);
    } else {
        attemptAutoLoad();
    }
});

// Migrate from old single-project localStorage format
function migrateFromLegacy() {
    const legacy = localStorage.getItem('qi-dashboard-state');
    const hasNewFormat = localStorage.getItem('qi-dashboard-projects');

    if (legacy && !hasNewFormat) {
        console.log('Migrating from legacy format...');
        try {
            const oldState = JSON.parse(legacy);
            const defaultProject = {
                id: generateUUID(),
                name: 'Imported Project',
                description: 'Migrated from previous version',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                data: null,
                settings: {
                    selectedVariables: oldState.selectedVariables || [],
                    goalValue: oldState.goalValue || null,
                    interventions: oldState.interventions || [],
                    showMedian: true,
                    aggregation: 'daily'
                }
            };
            localStorage.setItem('qi-dashboard-projects', JSON.stringify([defaultProject]));
            localStorage.setItem('qi-dashboard-active', defaultProject.id);
            console.log('Migration complete');
        } catch (e) {
            console.error('Migration failed:', e);
        }
    }
}

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// ============================================
// PROJECT MANAGEMENT
// ============================================

function loadProjects() {
    const saved = localStorage.getItem('qi-dashboard-projects');
    if (saved) {
        try {
            projects = JSON.parse(saved);
        } catch (e) {
            console.error('Error loading projects:', e);
            projects = [];
        }
    }
}

function saveProjects() {
    localStorage.setItem('qi-dashboard-projects', JSON.stringify(projects));
}

function loadAppState() {
    currentProjectId = localStorage.getItem('qi-dashboard-active') || null;
    const savedTab = localStorage.getItem('qi-dashboard-tab') || 'display';
    switchTab(savedTab, false);
}

function saveAppState() {
    if (currentProjectId) {
        localStorage.setItem('qi-dashboard-active', currentProjectId);
    }
}

function populateProjectSelector() {
    const select = document.getElementById('projectSelect');
    select.innerHTML = '<option value="">-- Select or Create Project --</option>';

    projects.forEach(project => {
        const option = document.createElement('option');
        option.value = project.id;
        option.textContent = project.name;
        if (project.id === currentProjectId) {
            option.selected = true;
        }
        select.appendChild(option);
    });
}

function openNewProjectModal() {
    document.getElementById('newProjectModal').classList.add('active');
    document.getElementById('newProjectName').value = '';
    document.getElementById('newProjectDescription').value = '';
    document.getElementById('newProjectName').focus();
}

function closeNewProjectModal() {
    document.getElementById('newProjectModal').classList.remove('active');
}

function createNewProject() {
    const name = document.getElementById('newProjectName').value.trim();
    const description = document.getElementById('newProjectDescription').value.trim();

    if (!name) {
        alert('Please enter a project name');
        return;
    }

    const project = {
        id: generateUUID(),
        name: name,
        description: description,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        data: null,
        settings: {
            selectedVariables: [],
            goalValue: null,
            interventions: [],
            showMedian: true,
            aggregation: 'daily'
        }
    };

    projects.push(project);
    saveProjects();
    populateProjectSelector();
    loadProject(project.id);
    closeNewProjectModal();

    updateStatus('success', 'Project created: ' + name);
}

function loadProject(projectId) {
    if (!projectId) {
        clearCurrentProject();
        return;
    }

    const project = projects.find(p => p.id === projectId);
    if (!project) {
        console.error('Project not found:', projectId);
        return;
    }

    currentProjectId = projectId;
    currentData = project.data;
    selectedVariables = project.settings.selectedVariables || [];
    goalValue = project.settings.goalValue;
    interventions = project.settings.interventions || [];
    showMedian = project.settings.showMedian !== false;
    aggregation = project.settings.aggregation || 'daily';
    xAxisTitle = project.settings.xAxisTitle || 'Date';
    yAxisTitle = project.settings.yAxisTitle || 'Rate (%)';

    // Update UI
    document.getElementById('projectName').value = project.name;
    document.getElementById('projectDescription').value = project.description || '';
    document.getElementById('projectSelect').value = projectId;
    document.getElementById('showMedian').checked = showMedian;
    document.getElementById('aggregationSelect').value = aggregation;
    document.getElementById('xAxisTitle').value = xAxisTitle;
    document.getElementById('yAxisTitle').value = yAxisTitle;

    if (goalValue !== null) {
        document.getElementById('goalValue').value = goalValue;
    } else {
        document.getElementById('goalValue').value = '';
    }

    saveAppState();

    if (currentData && currentData.length > 0) {
        initializeVariableSelection();
        renderChart();
        updateStatus('success', `Loaded ${currentData.length} rows`);
    } else {
        updateStatus('warning', 'No data - upload a file');
        attemptAutoLoad();
    }

    updateInterventionList();
    updateChartTitle();
}

function clearCurrentProject() {
    currentProjectId = null;
    currentData = null;
    selectedVariables = [];
    goalValue = null;
    interventions = [];
    showMedian = true;
    aggregation = 'daily';
    xAxisTitle = 'Date';
    yAxisTitle = 'Rate (%)';

    document.getElementById('projectName').value = '';
    document.getElementById('projectDescription').value = '';
    document.getElementById('goalValue').value = '';
    document.getElementById('variableCheckboxes').innerHTML = '';
    document.getElementById('showMedian').checked = true;
    document.getElementById('aggregationSelect').value = 'daily';
    document.getElementById('xAxisTitle').value = 'Date';
    document.getElementById('yAxisTitle').value = 'Rate (%)';

    if (currentChart) {
        currentChart.destroy();
        currentChart = null;
    }

    updateInterventionList();
    updateStatus('warning', 'No project selected');
}

function saveCurrentProject() {
    if (!currentProjectId) {
        alert('No project selected. Create a new project first.');
        return;
    }

    const project = projects.find(p => p.id === currentProjectId);
    if (!project) return;

    project.name = document.getElementById('projectName').value.trim() || 'Untitled Project';
    project.description = document.getElementById('projectDescription').value.trim();
    project.updatedAt = new Date().toISOString();
    project.data = currentData;
    project.settings = {
        selectedVariables: selectedVariables,
        goalValue: goalValue,
        interventions: interventions,
        showMedian: showMedian,
        aggregation: aggregation,
        xAxisTitle: xAxisTitle,
        yAxisTitle: yAxisTitle
    };

    saveProjects();
    populateProjectSelector();
    updateStatus('success', 'Project saved');
}

function deleteCurrentProject() {
    if (!currentProjectId) {
        alert('No project selected');
        return;
    }

    const project = projects.find(p => p.id === currentProjectId);
    if (!project) return;

    if (!confirm(`Delete project "${project.name}"? This cannot be undone.`)) {
        return;
    }

    projects = projects.filter(p => p.id !== currentProjectId);
    saveProjects();
    populateProjectSelector();
    clearCurrentProject();

    updateStatus('success', 'Project deleted');
}

// ============================================
// TAB MANAGEMENT
// ============================================

function switchTab(tabId, save = true) {
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === tabId + 'Tab');
    });

    // Save preference
    if (save) {
        localStorage.setItem('qi-dashboard-tab', tabId);
    }

    // Render display tab if switching to it
    if (tabId === 'display') {
        renderDisplayTab();
    }
}

// ============================================
// DATA LOADING
// ============================================

async function attemptAutoLoad() {
    try {
        await loadDataFromPath(dataFilePath);
    } catch (error) {
        console.log('No auto-load data file found');
        updateStatus('warning', 'No data loaded - upload a file');
    }
}

function initializeAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);

    refreshTimer = setInterval(async () => {
        if (currentData) {
            await checkForUpdates();
        }
    }, AUTO_REFRESH_INTERVAL);
}

async function checkForUpdates() {
    try {
        const response = await fetch(dataFilePath, {
            method: 'HEAD',
            cache: 'no-cache'
        });

        const lastModified = response.headers.get('Last-Modified');

        if (lastModified && lastModified !== lastFileModified) {
            console.log('Data file updated, refreshing...');
            await loadDataFromPath(dataFilePath);
            lastFileModified = lastModified;
        }
    } catch (error) {
        // File might not exist
    }
}

async function refreshData() {
    updateStatus('warning', 'Refreshing...');
    await loadDataFromPath(dataFilePath);
}

function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        parseDataFile(e.target.result, file.name);
    };
    reader.readAsText(file);
}

function handleDragOver(event) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.classList.add('dragover');
}

function handleDragLeave(event) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.classList.remove('dragover');
}

function handleDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.classList.remove('dragover');

    const files = event.dataTransfer.files;
    if (files.length > 0) {
        const file = files[0];
        const reader = new FileReader();
        reader.onload = function(e) {
            parseDataFile(e.target.result, file.name);
        };
        reader.readAsText(file);
    }
}

async function loadDataFromPath(path) {
    const response = await fetch(path + '?t=' + Date.now(), {
        cache: 'no-cache'
    });

    if (!response.ok) throw new Error('File not found');

    const content = await response.text();
    parseDataFile(content, path);
}

function parseDataFile(content, filename) {
    try {
        let data;

        if (filename.endsWith('.json')) {
            data = JSON.parse(content);
        } else if (filename.endsWith('.csv')) {
            data = parseCSV(content);
        } else {
            throw new Error('Unsupported file format. Please use CSV or JSON.');
        }

        if (!data || data.length === 0) {
            throw new Error('No data found in file');
        }

        currentData = data;
        updateStatus('success', `Loaded ${data.length} rows from ${filename}`);
        updateLastUpdate();
        initializeVariableSelection();
        renderChart();

    } catch (error) {
        updateStatus('error', 'Error: ' + error.message);
        alert('Error loading file: ' + error.message);
    }
}

function parseCSV(content) {
    const lines = content.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim());
    let data = [];

    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        const row = {};

        headers.forEach((header, index) => {
            let value = values[index]?.trim() || '';
            const numValue = parseFloat(value);
            if (!isNaN(numValue)) {
                value = numValue;
            }
            row[header] = value;
        });

        data.push(row);
    }

    // Auto-calculate rates
    data = calculateMetrics(data, headers);

    return data;
}

function calculateMetrics(data, headers) {
    if (data.length === 0) return data;

    const patterns = [
        {
            numerator: ['ABX_PRESCRIBED', 'ANTIBIOTICS_PRESCRIBED', 'ANTIBIOTICS', 'ABX'],
            denominator: ['TOTAL_ENCOUNTERS', 'ENCOUNTERS', 'TOTAL', 'DENOMINATOR'],
            rateName: 'ABX_RATE',
            displayName: 'Antibiotic Rate (%)'
        },
        {
            numerator: ['INFECTIONS', 'CLABSI_COUNT', 'INFECTION_COUNT'],
            denominator: ['LINE_DAYS', 'DEVICE_DAYS', 'PATIENT_DAYS'],
            rateName: 'INFECTION_RATE',
            displayName: 'Infection Rate'
        },
        {
            numerator: ['READMISSIONS', 'READMISSION_COUNT'],
            denominator: ['DISCHARGES', 'TOTAL_DISCHARGES'],
            rateName: 'READMISSION_RATE',
            displayName: 'Readmission Rate (%)'
        }
    ];

    const calculatedMetrics = [];

    patterns.forEach(pattern => {
        const numeratorCol = headers.find(h =>
            pattern.numerator.some(n => h.toUpperCase().includes(n))
        );

        const denominatorCol = headers.find(h =>
            pattern.denominator.some(d => h.toUpperCase().includes(d))
        );

        if (numeratorCol && denominatorCol && !headers.includes(pattern.rateName)) {
            console.log(`Auto-calculating ${pattern.rateName}`);

            data.forEach(row => {
                const numerator = parseFloat(row[numeratorCol]) || 0;
                const denominator = parseFloat(row[denominatorCol]) || 1;

                if (denominator > 0) {
                    row[pattern.rateName] = parseFloat(((numerator / denominator) * 100).toFixed(2));
                } else {
                    row[pattern.rateName] = 0;
                }
            });

            calculatedMetrics.push({
                name: pattern.rateName,
                display: pattern.displayName,
                from: `${numeratorCol} / ${denominatorCol}`
            });
        }
    });

    if (calculatedMetrics.length > 0) {
        showCalculatedMetricsInfo(calculatedMetrics);
    } else {
        hideCalculatedMetricsInfo();
    }

    return data;
}

function showCalculatedMetricsInfo(metrics) {
    const infoDiv = document.getElementById('calculatedMetricsInfo');
    const listSpan = document.getElementById('calculatedMetricsList');

    if (infoDiv && listSpan) {
        listSpan.innerHTML = metrics.map(m => `<strong>${m.name}</strong> (${m.from})`).join(', ');
        infoDiv.style.display = 'block';
    }
}

function hideCalculatedMetricsInfo() {
    const infoDiv = document.getElementById('calculatedMetricsInfo');
    if (infoDiv) {
        infoDiv.style.display = 'none';
    }
}

// ============================================
// VARIABLE SELECTION
// ============================================

function initializeVariableSelection() {
    if (!currentData || currentData.length === 0) return;

    const container = document.getElementById('variableCheckboxes');
    container.innerHTML = '';

    const excludePatterns = [
        'date', 'time', 'timestamp', 'period',
        'total_encounters', 'encounters', 'total', 'denominator',
        'abx_prescribed', 'antibiotics_prescribed', 'antibiotics',
        'infections', 'clabsi_count', 'infection_count',
        'readmissions', 'readmission_count',
        'line_days', 'device_days', 'patient_days', 'discharges'
    ];

    const firstRow = currentData[0];
    const variables = Object.keys(firstRow).filter(key => {
        const keyLower = key.toLowerCase();
        if (excludePatterns.some(pattern => keyLower.includes(pattern))) {
            return false;
        }
        const value = firstRow[key];
        return typeof value === 'number' || !isNaN(parseFloat(value));
    });

    const rateVariables = variables.filter(v =>
        v.toLowerCase().includes('rate') ||
        v.toLowerCase().includes('percent') ||
        v.toLowerCase().includes('pct')
    );

    variables.forEach(variable => {
        const div = document.createElement('div');
        div.className = 'checkbox-item';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `var_${variable}`;
        checkbox.value = variable;

        const isRateVar = rateVariables.includes(variable);
        checkbox.checked = selectedVariables.includes(variable) ||
                          (selectedVariables.length === 0 && isRateVar);
        checkbox.onchange = handleVariableChange;

        const label = document.createElement('label');
        label.htmlFor = `var_${variable}`;
        label.textContent = variable;
        label.style.cursor = 'pointer';

        div.appendChild(checkbox);
        div.appendChild(label);
        container.appendChild(div);

        if (selectedVariables.length === 0 && isRateVar) {
            selectedVariables.push(variable);
        }
    });

    if (selectedVariables.length === 0 && variables.length > 0) {
        selectedVariables.push(variables[0]);
        const firstCheckbox = document.getElementById(`var_${variables[0]}`);
        if (firstCheckbox) firstCheckbox.checked = true;
    }
}

function handleVariableChange(event) {
    const variable = event.target.value;

    if (event.target.checked) {
        if (!selectedVariables.includes(variable)) {
            selectedVariables.push(variable);
        }
    } else {
        selectedVariables = selectedVariables.filter(v => v !== variable);
    }

    renderChart();
}

// ============================================
// MEDIAN CALCULATION (QI Methodology)
// ============================================

function calculateMedian(values) {
    const filtered = values.filter(v => v !== null && v !== undefined && !isNaN(v));
    if (filtered.length === 0) return null;

    const sorted = [...filtered].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function detectShift(values, median) {
    // Returns index where shift detected (6+ consecutive above/below)
    let consecutiveAbove = 0;
    let consecutiveBelow = 0;
    let shiftStartIndex = null;
    let tempStartIndex = null;

    for (let i = 0; i < values.length; i++) {
        const value = values[i];
        if (value === null || value === undefined || isNaN(value)) continue;
        if (value === median) continue; // Skip points on median

        if (value > median) {
            if (consecutiveAbove === 0) tempStartIndex = i;
            consecutiveAbove++;
            consecutiveBelow = 0;
            if (consecutiveAbove >= 6) {
                return tempStartIndex;
            }
        } else {
            if (consecutiveBelow === 0) tempStartIndex = i;
            consecutiveBelow++;
            consecutiveAbove = 0;
            if (consecutiveBelow >= 6) {
                return tempStartIndex;
            }
        }
    }
    return null;
}

function calculateDynamicMedian(data, variable) {
    const values = data.map(row => row[variable]);
    const segments = [];
    let startIndex = 0;

    while (startIndex < data.length) {
        // Need minimum 10 points for reliable baseline
        const baselineEnd = Math.min(startIndex + 10, data.length);
        const baselineValues = values.slice(startIndex, baselineEnd);
        const median = calculateMedian(baselineValues);

        if (median === null) {
            break;
        }

        // Look for shift in remaining data
        const remainingValues = values.slice(baselineEnd);
        const shiftIndex = detectShift(remainingValues, median);

        if (shiftIndex !== null) {
            // Shift detected
            segments.push({
                startIndex: startIndex,
                endIndex: baselineEnd + shiftIndex - 1,
                median: median
            });
            startIndex = baselineEnd + shiftIndex;
        } else {
            // No shift - median continues to end
            segments.push({
                startIndex: startIndex,
                endIndex: data.length - 1,
                median: median
            });
            break;
        }
    }

    return segments;
}

function onMedianToggle() {
    showMedian = document.getElementById('showMedian').checked;
    renderChart();
}

function updateAxisTitles() {
    xAxisTitle = document.getElementById('xAxisTitle').value || 'Date';
    yAxisTitle = document.getElementById('yAxisTitle').value || 'Rate (%)';
    renderChart();
}

// ============================================
// DATE AGGREGATION
// ============================================

function onAggregationChange() {
    aggregation = document.getElementById('aggregationSelect').value;
    renderChart();
}

function aggregateData(data, period) {
    if (period === 'daily' || !data || data.length === 0) {
        return data;
    }

    const dateColumn = Object.keys(data[0]).find(key =>
        key.toLowerCase().includes('date')
    ) || Object.keys(data[0])[0];

    const groups = {};

    data.forEach(row => {
        const dateStr = row[dateColumn];
        const date = new Date(dateStr);

        let key;
        if (period === 'weekly') {
            key = getWeekKey(date);
        } else if (period === 'monthly') {
            key = getMonthKey(date);
        }

        if (!groups[key]) {
            groups[key] = [];
        }
        groups[key].push(row);
    });

    // Aggregate each group
    const aggregated = [];
    const numericColumns = Object.keys(data[0]).filter(key => {
        const value = data[0][key];
        return typeof value === 'number' || (!isNaN(parseFloat(value)) && !key.toLowerCase().includes('date'));
    });

    Object.keys(groups).sort().forEach(key => {
        const rows = groups[key];
        const result = { [dateColumn]: key };

        numericColumns.forEach(col => {
            const values = rows.map(r => parseFloat(r[col])).filter(v => !isNaN(v));
            if (values.length > 0) {
                result[col] = parseFloat((values.reduce((a, b) => a + b, 0) / values.length).toFixed(2));
            }
        });

        aggregated.push(result);
    });

    return aggregated;
}

function getWeekKey(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getFullYear()}-W${weekNum.toString().padStart(2, '0')}`;
}

function getMonthKey(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}`;
}

// ============================================
// CHART RENDERING
// ============================================

function isRateChart() {
    return selectedVariables.some(v =>
        v.toLowerCase().includes('rate') ||
        v.toLowerCase().includes('percent') ||
        v.toLowerCase().includes('pct')
    );
}

function renderChart() {
    if (!currentData || currentData.length === 0) {
        console.log('No data to render');
        return;
    }

    if (selectedVariables.length === 0) {
        console.log('No variables selected');
        return;
    }

    if (currentChart) {
        currentChart.destroy();
    }

    // Apply aggregation
    const displayData = aggregateData(currentData, aggregation);

    const dateColumn = Object.keys(displayData[0]).find(key =>
        key.toLowerCase().includes('date')
    ) || Object.keys(displayData[0])[0];

    const labels = displayData.map(row => row[dateColumn]);

    // Build datasets
    const datasets = [];
    const colors = ['#567159', '#81b0c4', '#e07a5f', '#d4a574', '#9d8cb8', '#748c76'];

    selectedVariables.forEach((variable, index) => {
        datasets.push({
            label: variable,
            data: displayData.map(row => row[variable]),
            borderColor: colors[index % colors.length],
            backgroundColor: colors[index % colors.length] + '20',
            borderWidth: 2,
            pointRadius: 5,
            pointHoverRadius: 7,
            tension: 0,
            fill: false
        });

        // Add median line if enabled
        if (showMedian) {
            const medianSegments = calculateDynamicMedian(displayData, variable);

            medianSegments.forEach((segment, segIndex) => {
                const medianData = displayData.map((_, i) => {
                    if (i >= segment.startIndex && i <= segment.endIndex) {
                        return segment.median;
                    }
                    return null;
                });

                datasets.push({
                    label: segIndex === 0 ? `${variable} Median` : null,
                    data: medianData,
                    borderColor: '#c0392b',
                    borderWidth: 2,
                    pointRadius: 0,
                    tension: 0,
                    fill: false,
                    spanGaps: false
                });
            });

            // Show shift info
            if (medianSegments.length > 1) {
                showShiftInfo(medianSegments);
            } else {
                hideShiftInfo();
            }
        } else {
            hideShiftInfo();
        }
    });

    // Add goal line
    if (goalValue !== null) {
        datasets.push({
            label: `Goal (${goalValue}%)`,
            data: displayData.map(() => goalValue),
            borderColor: '#27ae60',
            borderDash: [8, 4],
            borderWidth: 2,
            pointRadius: 0,
            fill: false
        });
    }

    // Create chart
    const ctx = document.getElementById('runChart').getContext('2d');
    currentChart = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        filter: function(item) {
                            return item.text !== null;
                        },
                        font: { size: 12 },
                        padding: 15,
                        usePointStyle: true
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    padding: 12
                },
                annotation: {
                    annotations: interventions.map(intervention => ({
                        type: 'line',
                        xMin: intervention.date,
                        xMax: intervention.date,
                        borderColor: '#e07a5f',
                        borderWidth: 2,
                        borderDash: [5, 5],
                        label: {
                            content: intervention.label,
                            display: true,
                            position: 'start',
                            backgroundColor: '#e07a5f',
                            color: 'white',
                            font: { size: 10 }
                        }
                    }))
                }
            },
            scales: {
                x: {
                    type: 'category',
                    title: {
                        display: true,
                        text: xAxisTitle || 'Date',
                        font: { size: 14, weight: 'bold' }
                    },
                    grid: { display: false },
                    ticks: { maxRotation: 45, minRotation: 45 }
                },
                y: {
                    beginAtZero: true,
                    suggestedMax: isRateChart() ? 100 : undefined,
                    title: {
                        display: true,
                        text: yAxisTitle || (isRateChart() ? 'Rate (%)' : 'Value'),
                        font: { size: 14, weight: 'bold' }
                    },
                    grid: { color: 'rgba(0, 0, 0, 0.1)' },
                    ticks: {
                        callback: value => isRateChart() ? value + '%' : value
                    }
                }
            }
        }
    });

    updateChartTitle();
}

function showShiftInfo(segments) {
    const infoDiv = document.getElementById('shiftInfo');
    const textSpan = document.getElementById('shiftInfoText');

    if (infoDiv && textSpan) {
        textSpan.textContent = `${segments.length} median segments detected (shift after 6+ consecutive points above/below)`;
        infoDiv.style.display = 'block';
    }
}

function hideShiftInfo() {
    const infoDiv = document.getElementById('shiftInfo');
    if (infoDiv) {
        infoDiv.style.display = 'none';
    }
}

function updateChartTitle() {
    const titleEl = document.getElementById('chartTitle');
    if (!titleEl) return;

    const project = projects.find(p => p.id === currentProjectId);
    if (project) {
        titleEl.textContent = project.name + ' - Run Chart';
    } else {
        titleEl.textContent = 'Run Chart';
    }
}

// ============================================
// DISPLAY TAB
// ============================================

function renderDisplayTab() {
    const grid = document.getElementById('chartGrid');
    const noProjectsMsg = document.getElementById('noProjectsMessage');

    // Clean up existing charts
    Object.values(displayCharts).forEach(chart => chart.destroy());
    displayCharts = {};

    if (projects.length === 0) {
        grid.style.display = 'none';
        noProjectsMsg.style.display = 'block';
        return;
    }

    grid.style.display = 'grid';
    noProjectsMsg.style.display = 'none';
    grid.innerHTML = '';

    projects.forEach(project => {
        if (!project.data || project.data.length === 0) return;

        const card = createProjectCard(project);
        grid.appendChild(card);

        // Render mini chart
        setTimeout(() => {
            renderMiniChart(project);
        }, 100);
    });
}

function createProjectCard(project) {
    const card = document.createElement('div');
    card.className = 'chart-card';
    card.id = `card-${project.id}`;

    // Get current value and trend
    const variable = project.settings.selectedVariables[0];
    let currentValue = '--';
    let trend = 'stable';

    if (project.data && project.data.length > 0 && variable) {
        const lastValue = project.data[project.data.length - 1][variable];
        currentValue = typeof lastValue === 'number' ? lastValue.toFixed(1) + '%' : lastValue;

        // Calculate trend (compare last 5 to previous 5)
        if (project.data.length >= 10) {
            const recent = project.data.slice(-5).map(r => r[variable]).filter(v => !isNaN(v));
            const previous = project.data.slice(-10, -5).map(r => r[variable]).filter(v => !isNaN(v));

            const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
            const prevAvg = previous.reduce((a, b) => a + b, 0) / previous.length;

            const diff = recentAvg - prevAvg;
            if (diff > 2) trend = 'up';
            else if (diff < -2) trend = 'down';
        }
    }

    const trendIcon = trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→';
    const trendClass = trend === 'up' ? 'trend-up' : trend === 'down' ? 'trend-down' : 'trend-stable';

    card.innerHTML = `
        <div class="chart-card-header">
            <div>
                <div class="chart-card-title">${project.name}</div>
                <div class="chart-card-value">${currentValue}</div>
            </div>
            <span class="trend-indicator ${trendClass}">${trendIcon} ${trend}</span>
        </div>
        <div class="chart-wrapper">
            <canvas id="mini-chart-${project.id}"></canvas>
        </div>
    `;

    return card;
}

function renderMiniChart(project) {
    const canvas = document.getElementById(`mini-chart-${project.id}`);
    if (!canvas || !project.data || project.data.length === 0) return;

    const variable = project.settings.selectedVariables[0];
    if (!variable) return;

    const dateColumn = Object.keys(project.data[0]).find(key =>
        key.toLowerCase().includes('date')
    ) || Object.keys(project.data[0])[0];

    const labels = project.data.map(row => row[dateColumn]);
    const data = project.data.map(row => row[variable]);

    const datasets = [{
        data: data,
        borderColor: '#567159',
        borderWidth: 2,
        pointRadius: 0,
        tension: 0,
        fill: false
    }];

    // Add goal line
    if (project.settings.goalValue !== null) {
        datasets.push({
            data: project.data.map(() => project.settings.goalValue),
            borderColor: '#27ae60',
            borderDash: [4, 2],
            borderWidth: 1,
            pointRadius: 0,
            fill: false
        });
    }

    displayCharts[project.id] = new Chart(canvas, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { enabled: false }
            },
            scales: {
                x: { display: false },
                y: {
                    display: false,
                    beginAtZero: true,
                    suggestedMax: 100
                }
            }
        }
    });
}

function updateDisplayGrid() {
    const columns = document.getElementById('columnsSelect').value;
    document.getElementById('chartGrid').style.setProperty('--columns', columns);
}

function toggleDisplayRefresh() {
    const enabled = document.getElementById('autoRefreshDisplay').checked;

    if (displayRefreshTimer) {
        clearInterval(displayRefreshTimer);
        displayRefreshTimer = null;
    }

    if (enabled) {
        displayRefreshTimer = setInterval(() => {
            refreshAllDisplayCharts();
        }, AUTO_REFRESH_INTERVAL);
    }
}

function refreshAllDisplayCharts() {
    renderDisplayTab();
}

// ============================================
// GOAL & INTERVENTIONS
// ============================================

function updateGoalLine() {
    const input = document.getElementById('goalValue');
    const value = parseFloat(input.value);

    if (isNaN(value)) {
        alert('Please enter a valid number for the goal');
        return;
    }

    goalValue = value;
    renderChart();
}

function clearGoalLine() {
    goalValue = null;
    document.getElementById('goalValue').value = '';
    renderChart();
}

function openInterventionModal() {
    document.getElementById('interventionModal').classList.add('active');
    document.getElementById('interventionDate').value = new Date().toISOString().split('T')[0];
    document.getElementById('interventionLabel').value = '';
    document.getElementById('interventionDescription').value = '';
}

function closeInterventionModal() {
    document.getElementById('interventionModal').classList.remove('active');
}

function addIntervention() {
    const date = document.getElementById('interventionDate').value;
    const label = document.getElementById('interventionLabel').value.trim();
    const description = document.getElementById('interventionDescription').value.trim();

    if (!date || !label) {
        alert('Please enter date and label');
        return;
    }

    interventions.push({
        id: generateUUID(),
        date: date,
        label: label,
        description: description
    });

    closeInterventionModal();
    updateInterventionList();
    renderChart();
}

function removeIntervention(id) {
    if (confirm('Remove this intervention?')) {
        interventions = interventions.filter(i => i.id !== id);
        updateInterventionList();
        renderChart();
    }
}

function updateInterventionList() {
    const container = document.getElementById('interventionList');

    if (interventions.length === 0) {
        container.innerHTML = '<p style="opacity: 0.6; font-size: 0.9rem;">No interventions added</p>';
        return;
    }

    container.innerHTML = interventions.map(i => `
        <div class="intervention-item">
            <div>
                <strong>${i.label}</strong>
                <div style="font-size: 0.85rem; opacity: 0.7;">
                    ${i.date}${i.description ? ' - ' + i.description : ''}
                </div>
            </div>
            <button class="remove-btn small" onclick="removeIntervention('${i.id}')">Remove</button>
        </div>
    `).join('');
}

// ============================================
// EXPORT & UTILITY
// ============================================

function exportChart() {
    if (!currentChart) {
        alert('No chart to export');
        return;
    }

    const link = document.createElement('a');
    link.download = 'qi-chart-' + new Date().toISOString().split('T')[0] + '.png';
    link.href = currentChart.toBase64Image();
    link.click();
}

function exportData() {
    if (!currentData) {
        alert('No data to export');
        return;
    }

    const headers = Object.keys(currentData[0]);
    const csv = [
        headers.join(','),
        ...currentData.map(row => headers.map(h => row[h]).join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const link = document.createElement('a');
    link.download = 'qi-data-' + new Date().toISOString().split('T')[0] + '.csv';
    link.href = URL.createObjectURL(blob);
    link.click();
}

function resetDashboard() {
    if (!confirm('Reset current project? This will clear selections but keep data.')) {
        return;
    }

    selectedVariables = [];
    interventions = [];
    goalValue = null;
    showMedian = true;
    aggregation = 'daily';

    document.getElementById('goalValue').value = '';
    document.getElementById('showMedian').checked = true;
    document.getElementById('aggregationSelect').value = 'daily';

    if (currentData) {
        initializeVariableSelection();
        renderChart();
    }

    updateInterventionList();
}

function updateStatus(type, message) {
    const dot = document.getElementById('dataStatus');
    const text = document.getElementById('dataStatusText');

    if (dot) {
        dot.className = 'status-dot';
        if (type === 'warning') dot.classList.add('warning');
        if (type === 'error') dot.classList.add('error');
    }

    if (text) {
        text.textContent = message;
    }
}

function updateLastUpdate() {
    const el = document.getElementById('lastUpdate');
    if (el) {
        el.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
    }
}
