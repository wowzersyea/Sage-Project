# QI Dashboard - Sage Project

An interactive quality improvement run chart dashboard with auto-updating data, customizable variables, intervention markers, and goal tracking.

## 🌟 Features

✅ **Auto-Updating Data** - Place data file in `data/` folder, dashboard auto-refreshes every 30 seconds
✅ **Customizable Variables** - Select which metrics to display on the run chart
✅ **Intervention Markers** - Add arrows/markers for interventions on the timeline
✅ **Goal Line** - Display target goal as dotted line across chart
✅ **Multiple File Formats** - Supports CSV and JSON
✅ **Export Capabilities** - Export chart as PNG, data as CSV
✅ **Responsive Design** - Works on desktop and mobile
✅ **Persistent Settings** - Saves your selections in browser

---

## 🚀 Quick Start

### Option 1: Local Testing

1. **Open `index.html` in a browser**
   ```bash
   # From f:\Coding\sage-qi-dashboard
   # Just double-click index.html
   ```

2. **Upload a data file** or place it in `data/qi-data.csv`

3. **Configure your dashboard:**
   - Select variables to display
   - Set goal target
   - Add intervention markers

### Option 2: Deploy to sageproject.xyz

1. **Copy files to your GitHub repo:**
   ```bash
   # Copy the qi-dashboard folder to your Sage-Project repo
   # Structure should be:
   # Sage-Project/
   #   ├── qi-dashboard/
   #   │   ├── index.html
   #   │   ├── qi-dashboard.js
   #   │   └── data/
   #   │       └── qi-data.csv
   ```

2. **Push to GitHub:**
   ```bash
   cd /path/to/Sage-Project
   git add qi-dashboard/
   git commit -m "Add QI Dashboard"
   git push
   ```

3. **Access at:**
   ```
   https://sageproject.xyz/qi-dashboard/
   ```

---

## 📊 Data Format

### CSV Format (Recommended)

Your CSV should have:
- **First column**: Date (any format)
- **Other columns**: Numeric metrics you want to track

**NEW! Auto-Calculation Feature** ✨

The dashboard now automatically calculates percentage rates from raw counts!

### Option 1: Raw Counts (Recommended for Epic Exports)

Upload just the numerator and denominator:
```csv
DATE,TOTAL_ENCOUNTERS,ABX_PRESCRIBED
2025-01-01,45,34
2025-01-02,38,29
2025-01-03,52,41
```

**Dashboard automatically calculates:** `ABX_RATE = (ABX_PRESCRIBED / TOTAL_ENCOUNTERS) × 100`

Supported patterns:
- `ABX_PRESCRIBED` / `TOTAL_ENCOUNTERS` → `ABX_RATE`
- `INFECTIONS` / `LINE_DAYS` → `INFECTION_RATE`
- `READMISSIONS` / `DISCHARGES` → `READMISSION_RATE`

### Option 2: Pre-Calculated Rates

Or include the rate yourself:
```csv
DATE,TOTAL_ENCOUNTERS,ABX_PRESCRIBED,ABX_RATE
2025-01-01,45,34,75.6
2025-01-02,38,29,76.3
2025-01-03,52,41,78.8
```

Both formats work! Use whichever is easier for your workflow.

### JSON Format

```json
[
  {
    "DATE": "2025-01-01",
    "TOTAL_ENCOUNTERS": 45,
    "ANTIBIOTICS_PRESCRIBED": 34,
    "ANTIBIOTIC_RATE": 75.6
  },
  {
    "DATE": "2025-01-02",
    "TOTAL_ENCOUNTERS": 38,
    "ANTIBIOTICS_PRESCRIBED": 29,
    "ANTIBIOTIC_RATE": 76.3
  }
]
```

---

## 🔄 Auto-Updating Data

### How It Works

1. **Place your data file** at `data/qi-data.csv`
2. **Dashboard checks for updates** every 30 seconds
3. **Automatically refreshes chart** when file changes
4. **No page reload needed!**

### Updating Data

**Method 1: Manual Update**
- Edit `data/qi-data.csv` directly
- Dashboard will detect changes automatically

**Method 2: Automated Script**
```bash
# Export from Epic SQL → save as qi-data.csv
# Dashboard will pick up changes within 30 seconds
```

**Method 3: GitHub Actions (for web deployment)**
```yaml
# .github/workflows/update-qi-data.yml
name: Update QI Data
on:
  schedule:
    - cron: '0 8 * * *'  # Daily at 8am
  workflow_dispatch:

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Fetch and update data
        run: |
          # Your script to fetch data from Epic/database
          # Save to qi-dashboard/data/qi-data.csv
      - name: Commit changes
        run: |
          git config user.name "QI Bot"
          git config user.email "bot@sageproject.xyz"
          git add qi-dashboard/data/qi-data.csv
          git commit -m "Update QI data"
          git push
```

---

## 🎯 Using the Dashboard

### 1. Select Variables to Display

- Check boxes for metrics you want on the chart
- Can display multiple variables simultaneously
- Each variable gets a different color
- Settings are saved automatically

### 2. Set Goal Target

1. Enter goal value (e.g., `20` for 20% target)
2. Click "Set Goal"
3. Goal appears as red dotted line on chart
4. Click "Clear" to remove

### 3. Add Interventions

1. Click "+ Add Intervention"
2. Select date of intervention
3. Enter label (e.g., "Provider Education")
4. Add optional description
5. Intervention appears as vertical line on chart

**Examples:**
- "Provider Education Session" - Feb 15, 2025
- "New Clinical Guidelines" - March 1, 2025
- "EHR Alert Implementation" - March 15, 2025

### 4. Export

**Export Chart:**
- Click "📊 Export Chart"
- Downloads PNG image of current chart
- Perfect for presentations/reports

**Export Data:**
- Click "📥 Export Data"
- Downloads current data as CSV
- Includes all calculations

---

## 🎨 Customization

### Colors

Edit the color array in `qi-dashboard.js`:

```javascript
const colors = [
    '#567159', // Sage green (primary)
    '#81b0c4', // Sky blue
    '#e07a5f', // Coral
    '#d4a574', // Gold
    '#9d8cb8', // Lavender
    '#748c76'  // Muted sage
];
```

### Auto-Refresh Interval

Change refresh frequency (default: 30 seconds):

```javascript
const AUTO_REFRESH_INTERVAL = 30000; // milliseconds
```

### Data File Path

Change default data location:

```javascript
let dataFilePath = 'data/qi-data.csv';
```

---

## 📱 Mobile Support

Dashboard is fully responsive:
- Touch-friendly controls
- Pinch to zoom on charts
- Optimized layout for small screens
- All features work on mobile

---

## 🔧 Technical Details

### Dependencies

- **Chart.js 4.4.1** - Charting library
- **chartjs-adapter-date-fns 3.0.0** - Date handling

Loaded from CDN, no installation needed!

### Browser Support

- Chrome/Edge (recommended)
- Firefox
- Safari
- Mobile browsers

### Data Storage

- Dashboard settings saved to browser localStorage
- Persists between sessions
- No server required

### Security

- All processing happens in browser
- No data sent to external servers
- Data files stay local or in your GitHub repo

---

## 🏥 Example Use Cases

### 1. Antibiotic Stewardship
Track antibiotic prescribing rates with goal of <20%:
- Variables: `ANTIBIOTIC_RATE`, `PROVIDER_ADHERENCE`
- Goal: `20` (20%)
- Interventions: Education sessions, guideline updates

### 2. CLABSI Prevention
Monitor central line infections:
- Variables: `CLABSI_RATE`, `LINE_DAYS`
- Goal: `1.0` (per 1000 line-days)
- Interventions: Bundle implementation, audits

### 3. Door-to-Antibiotic Time
Track sepsis treatment times:
- Variables: `MEDIAN_TIME`, `PERCENT_UNDER_60MIN`
- Goal: `60` (minutes)
- Interventions: Workflow changes, alerts

### 4. Length of Stay
Monitor patient discharge efficiency:
- Variables: `AVERAGE_LOS`, `READMISSION_RATE`
- Goal: `3.5` (days)
- Interventions: Care pathways, discharge planning

---

## 🎓 QI Science Features (Coming Soon)

Future enhancements:
- [ ] Statistical Process Control (SPC) rules
- [ ] Automatic special cause detection
- [ ] Control charts (UCL/LCL calculation)
- [ ] Run chart shift/trend detection
- [ ] SQUIRE 2.0 report generation
- [ ] Annotation tools for analysis
- [ ] Multiple chart types (control, Pareto, histogram)

---

## 🐛 Troubleshooting

### Data not loading
- Check file format (CSV or JSON)
- Verify file is in `data/` folder
- Check browser console for errors
- Try manual file upload

### Chart not updating
- Verify file timestamp changes
- Check auto-refresh is enabled
- Manually click "Refresh Data"
- Clear browser cache

### Interventions not showing
- Ensure date format matches data dates
- Check browser console for errors
- Try removing and re-adding

### Variables not appearing
- Only numeric columns shown
- Check your data has number values
- Try uploading file again

---

## 📞 Support

For questions or issues:
1. Check this README
2. Review browser console for errors
3. Check sample data format
4. Contact: mark.murphy86@gmail.com

---

## 🌿 About Sage Project

Part of the Sage Project clinical toolkit for pediatric infectious disease and antimicrobial stewardship.

**Website:** https://sageproject.xyz
**GitHub:** https://github.com/wowzersyea/Sage-Project

---

*Last updated: February 1, 2026*
