// QI Dashboard - Main JavaScript
// Handles data loading, chart rendering, and user interactions

// Global state
let currentData = null;
let currentChart = null;
let selectedVariables = [];
let interventions = [];
let goalValue = null;
let dataFilePath = 'data/qi-data.csv';
let lastFileModified = null;

// Auto-refresh interval (check for file updates every 30 seconds)
const AUTO_REFRESH_INTERVAL = 30000;
let refreshTimer = null;

// Initialize dashboard on page load
document.addEventListener('DOMContentLoaded', function() {
    console.log('QI Dashboard initialized');
    initializeAutoRefresh();
    loadFromLocalStorage();
    attemptAutoLoad();
});

// Attempt to automatically load data file
async function attemptAutoLoad() {
    try {
        await loadDataFromPath(dataFilePath);
    } catch (error) {
        console.log('No auto-load data file found. Please upload a file.');
        updateStatus('error', 'No data loaded - please upload a file');
    }
}

// Initialize auto-refresh timer
function initializeAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);

    refreshTimer = setInterval(async () => {
        if (currentData) {
            await checkForUpdates();
        }
    }, AUTO_REFRESH_INTERVAL);
}

// Check if data file has been updated
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
        // File might not exist yet, ignore
    }
}

// Manual refresh button
async function refreshData() {
    if (!currentData) {
        alert('No data loaded yet. Please upload a data file first.');
        return;
    }

    updateStatus('warning', 'Refreshing...');
    await loadDataFromPath(dataFilePath);
}

// File upload handling
function handleFileUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const content = e.target.result;
        parseDataFile(content, file.name);
    };
    reader.readAsText(file);
}

// Drag and drop handling
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

// Load data from path (for auto-refresh)
async function loadDataFromPath(path) {
    try {
        const response = await fetch(path + '?t=' + Date.now(), {
            cache: 'no-cache'
        });

        if (!response.ok) throw new Error('File not found');

        const content = await response.text();
        parseDataFile(content, path);

    } catch (error) {
        throw error;
    }
}

// Parse CSV or JSON data
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
        updateStatus('error', 'Error loading file: ' + error.message);
        alert('Error loading file: ' + error.message);
    }
}

// Parse CSV content
function parseCSV(content) {
    const lines = content.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.trim());
    const data = [];

    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        const row = {};

        headers.forEach((header, index) => {
            let value = values[index]?.trim() || '';

            // Try to parse as number
            const numValue = parseFloat(value);
            if (!isNaN(numValue)) {
                value = numValue;
            }

            row[header] = value;
        });

        data.push(row);
    }

    return data;
}

// Initialize variable checkboxes
function initializeVariableSelection() {
    if (!currentData || currentData.length === 0) return;

    const container = document.getElementById('variableCheckboxes');
    container.innerHTML = '';

    // Get all numeric columns (potential variables)
    const firstRow = currentData[0];
    const variables = Object.keys(firstRow).filter(key => {
        // Include if numeric or looks like it could be a metric
        const value = firstRow[key];
        return typeof value === 'number' || !isNaN(parseFloat(value));
    });

    // Create checkboxes
    variables.forEach(variable => {
        const div = document.createElement('div');
        div.className = 'checkbox-item';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `var_${variable}`;
        checkbox.value = variable;
        checkbox.checked = selectedVariables.includes(variable) || selectedVariables.length === 0;
        checkbox.onchange = handleVariableChange;

        const label = document.createElement('label');
        label.htmlFor = `var_${variable}`;
        label.textContent = variable;
        label.style.cursor = 'pointer';

        div.appendChild(checkbox);
        div.appendChild(label);
        container.appendChild(div);

        // Auto-select if first time
        if (selectedVariables.length === 0) {
            selectedVariables.push(variable);
        }
    });
}

// Handle variable checkbox changes
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
    saveToLocalStorage();
}

// Render the chart
function renderChart() {
    if (!currentData || currentData.length === 0) {
        console.log('No data to render');
        return;
    }

    if (selectedVariables.length === 0) {
        console.log('No variables selected');
        return;
    }

    // Destroy existing chart
    if (currentChart) {
        currentChart.destroy();
    }

    // Get date column (first column or column named 'date', 'DATE', etc.)
    const dateColumn = Object.keys(currentData[0]).find(key =>
        key.toLowerCase().includes('date')
    ) || Object.keys(currentData[0])[0];

    // Prepare datasets
    const datasets = selectedVariables.map((variable, index) => {
        const colors = [
            '#567159', // Sage green
            '#81b0c4', // Sky blue
            '#e07a5f', // Coral
            '#d4a574', // Gold
            '#9d8cb8', // Lavender
            '#748c76'  // Muted sage
        ];

        return {
            label: variable,
            data: currentData.map(row => ({
                x: row[dateColumn],
                y: row[variable]
            })),
            borderColor: colors[index % colors.length],
            backgroundColor: colors[index % colors.length] + '20',
            borderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
            tension: 0.1
        };
    });

    // Add goal line if set
    if (goalValue !== null) {
        datasets.push({
            label: 'Goal',
            data: currentData.map(row => ({
                x: row[dateColumn],
                y: goalValue
            })),
            borderColor: '#f44336',
            borderDash: [10, 5],
            borderWidth: 2,
            pointRadius: 0,
            fill: false
        });
    }

    // Create chart
    const ctx = document.getElementById('runChart').getContext('2d');
    currentChart = new Chart(ctx, {
        type: 'line',
        data: { datasets },
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
                        font: {
                            size: 14,
                            family: "'Outfit', sans-serif"
                        },
                        padding: 15,
                        usePointStyle: true
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(0, 0, 0, 0.8)',
                    padding: 12,
                    bodyFont: {
                        size: 13
                    },
                    titleFont: {
                        size: 14,
                        weight: 'bold'
                    }
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
                            enabled: true,
                            position: 'top',
                            backgroundColor: '#e07a5f',
                            color: 'white',
                            font: {
                                size: 11
                            }
                        }
                    }))
                }
            },
            scales: {
                x: {
                    type: 'category',
                    title: {
                        display: true,
                        text: dateColumn,
                        font: {
                            size: 14,
                            weight: 'bold'
                        }
                    },
                    grid: {
                        display: false
                    }
                },
                y: {
                    beginAtZero: false,
                    title: {
                        display: true,
                        text: 'Value',
                        font: {
                            size: 14,
                            weight: 'bold'
                        }
                    },
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)'
                    }
                }
            }
        }
    });

    // Add intervention arrows manually (Chart.js annotations plugin needed for full support)
    addInterventionArrows();
}

// Add intervention arrows to chart
function addInterventionArrows() {
    // Note: Full annotation support requires chartjs-plugin-annotation
    // For now, interventions are shown in the list
    updateInterventionList();
}

// Update status indicator
function updateStatus(type, message) {
    const dot = document.getElementById('dataStatus');
    const text = document.getElementById('dataStatusText');

    dot.className = 'status-dot';
    if (type === 'warning') dot.classList.add('warning');
    if (type === 'error') dot.classList.add('error');

    text.textContent = message;
}

// Update last update time
function updateLastUpdate() {
    const now = new Date();
    document.getElementById('lastUpdate').textContent =
        `Last updated: ${now.toLocaleTimeString()}`;
}

// Goal line functions
function updateGoalLine() {
    const input = document.getElementById('goalValue');
    const value = parseFloat(input.value);

    if (isNaN(value)) {
        alert('Please enter a valid number for the goal');
        return;
    }

    goalValue = value;
    renderChart();
    saveToLocalStorage();
}

function clearGoalLine() {
    goalValue = null;
    document.getElementById('goalValue').value = '';
    renderChart();
    saveToLocalStorage();
}

// Intervention modal functions
function openInterventionModal() {
    document.getElementById('interventionModal').classList.add('active');

    // Set default date to today
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('interventionDate').value = today;
}

function closeInterventionModal() {
    document.getElementById('interventionModal').classList.remove('active');

    // Clear form
    document.getElementById('interventionDate').value = '';
    document.getElementById('interventionLabel').value = '';
    document.getElementById('interventionDescription').value = '';
}

function addIntervention() {
    const date = document.getElementById('interventionDate').value;
    const label = document.getElementById('interventionLabel').value;
    const description = document.getElementById('interventionDescription').value;

    if (!date || !label) {
        alert('Please enter both date and label');
        return;
    }

    interventions.push({
        date: date,
        label: label,
        description: description
    });

    closeInterventionModal();
    renderChart();
    saveToLocalStorage();
}

function removeIntervention(index) {
    if (confirm('Remove this intervention?')) {
        interventions.splice(index, 1);
        renderChart();
        saveToLocalStorage();
    }
}

function updateInterventionList() {
    const container = document.getElementById('interventionList');

    if (interventions.length === 0) {
        container.innerHTML = '<p style="opacity: 0.6; font-size: 0.9rem;">No interventions added</p>';
        return;
    }

    container.innerHTML = interventions.map((intervention, index) => `
        <div class="intervention-item">
            <div>
                <strong>${intervention.label}</strong>
                <div style="font-size: 0.9rem; opacity: 0.7;">
                    ${intervention.date}
                    ${intervention.description ? ' - ' + intervention.description : ''}
                </div>
            </div>
            <button class="remove-btn" onclick="removeIntervention(${index})">Remove</button>
        </div>
    `).join('');
}

// Export functions
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

    // Convert to CSV
    const headers = Object.keys(currentData[0]);
    const csv = [
        headers.join(','),
        ...currentData.map(row => headers.map(h => row[h]).join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const link = document.createElement('a');
    link.download = 'qi-data-export-' + new Date().toISOString().split('T')[0] + '.csv';
    link.href = URL.createObjectURL(blob);
    link.click();
}

// Reset dashboard
function resetDashboard() {
    if (!confirm('Reset dashboard? This will clear all settings but keep your data.')) {
        return;
    }

    selectedVariables = [];
    interventions = [];
    goalValue = null;
    document.getElementById('goalValue').value = '';

    if (currentData) {
        initializeVariableSelection();
        renderChart();
    }

    localStorage.removeItem('qi-dashboard-state');
}

// Local storage functions
function saveToLocalStorage() {
    const state = {
        selectedVariables,
        interventions,
        goalValue
    };

    localStorage.setItem('qi-dashboard-state', JSON.stringify(state));
}

function loadFromLocalStorage() {
    const saved = localStorage.getItem('qi-dashboard-state');
    if (!saved) return;

    try {
        const state = JSON.parse(saved);
        selectedVariables = state.selectedVariables || [];
        interventions = state.interventions || [];
        goalValue = state.goalValue;

        if (goalValue !== null) {
            document.getElementById('goalValue').value = goalValue;
        }

        updateInterventionList();
    } catch (error) {
        console.error('Error loading saved state:', error);
    }
}
