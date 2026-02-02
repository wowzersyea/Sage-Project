# Deployment Guide - QI Dashboard to sageproject.xyz

Step-by-step instructions to deploy the QI Dashboard to your live website.

---

## Prerequisites

- Git installed on your computer
- Access to Sage-Project GitHub repository
- Basic familiarity with command line

---

## Step 1: Clone Your Repository (if not already)

```bash
# Clone your repo
cd f:\Coding
git clone https://github.com/wowzersyea/Sage-Project.git

# Or navigate to existing clone
cd f:\Coding\Sage-Project
```

---

## Step 2: Copy QI Dashboard Files

```bash
# Copy the entire qi-dashboard folder to your repo
# From f:\Coding\sage-qi-dashboard to f:\Coding\Sage-Project\qi-dashboard

# On Windows:
xcopy /E /I "f:\Coding\sage-qi-dashboard" "f:\Coding\Sage-Project\qi-dashboard"

# Or manually:
# 1. Create folder: f:\Coding\Sage-Project\qi-dashboard
# 2. Copy all files from sage-qi-dashboard to that folder
```

Your repo structure should now look like:
```
Sage-Project/
├── .github/
├── literature-monitor/
├── scripts/
├── qi-dashboard/          ← NEW
│   ├── index.html
│   ├── qi-dashboard.js
│   ├── data/
│   │   └── qi-data.csv
│   ├── README.md
│   └── DEPLOYMENT.md
├── index.html
├── CNAME
└── README.md
```

---

## Step 3: Update Main Site Navigation

Edit `f:\Coding\Sage-Project\index.html` to add QI Dashboard link:

Find the QI Stats Assistant tool card (around line 150):

```html
<div class="tool-card" style="--accent-color: #81b0c4">
    <div class="tool-icon">📊</div>
    <h3>QI Stats Assistant</h3>
    <p>Get statistical guidance for your quality improvement data analysis</p>
    <span class="status">Coming Soon</span>
</div>
```

Change to:

```html
<div class="tool-card" style="--accent-color: #81b0c4" onclick="window.location.href='qi-dashboard/'">
    <div class="tool-icon">📊</div>
    <h3>QI Dashboard</h3>
    <p>Interactive run charts with auto-updating data and intervention tracking</p>
    <span class="status live">Live</span>
</div>
```

---

## Step 4: Test Locally

Before pushing, test the dashboard:

```bash
# Navigate to the qi-dashboard folder
cd f:\Coding\Sage-Project\qi-dashboard

# Open in browser
start index.html

# Or use a local server for better testing:
python -m http.server 8000
# Then visit: http://localhost:8000
```

**Test these features:**
- [ ] Page loads correctly
- [ ] Can upload CSV file
- [ ] Variables appear and can be selected
- [ ] Chart renders correctly
- [ ] Can add intervention
- [ ] Can set goal line
- [ ] Can export chart
- [ ] Responsive on mobile (resize browser)

---

## Step 5: Commit and Push to GitHub

```bash
cd f:\Coding\Sage-Project

# Add the new files
git add qi-dashboard/
git add index.html  # If you updated navigation

# Check what's being committed
git status

# Commit
git commit -m "Add QI Dashboard with auto-updating data and intervention tracking"

# Push to GitHub
git push origin main
```

---

## Step 6: Verify Deployment

GitHub Pages will automatically deploy your changes (usually takes 1-2 minutes).

**Visit:** https://sageproject.xyz/qi-dashboard/

**Check:**
- [ ] Page loads correctly
- [ ] All features work
- [ ] Sample data displays
- [ ] Mobile responsive
- [ ] No console errors

---

## Step 7: Update Your Data File

### Option A: Manual Updates via GitHub

1. Go to your repo: https://github.com/wowzersyea/Sage-Project
2. Navigate to `qi-dashboard/data/qi-data.csv`
3. Click "Edit" (pencil icon)
4. Update the data
5. Commit changes
6. Dashboard will auto-refresh within 30 seconds!

### Option B: Automated Updates via GitHub Actions

Create `.github/workflows/update-qi-data.yml`:

```yaml
name: Update QI Data

on:
  schedule:
    - cron: '0 8 * * *'  # Daily at 8am UTC
  workflow_dispatch:  # Manual trigger

jobs:
  update-data:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v3

      - name: Update data file
        run: |
          # Your script to fetch data from Epic/database
          # Example: curl your data source and save to csv
          # curl -o qi-dashboard/data/qi-data.csv "YOUR_DATA_URL"

          # Or run a Python script:
          # python scripts/fetch_qi_data.py

      - name: Commit and push
        run: |
          git config user.name "QI Data Bot"
          git config user.email "bot@sageproject.xyz"
          git add qi-dashboard/data/qi-data.csv
          git diff --quiet && git diff --staged --quiet || (git commit -m "Update QI data - $(date)" && git push)
```

### Option C: Local Updates, Push to GitHub

```bash
# Edit your data file locally
notepad f:\Coding\Sage-Project\qi-dashboard\data\qi-data.csv

# Save and commit
cd f:\Coding\Sage-Project
git add qi-dashboard/data/qi-data.csv
git commit -m "Update QI data for $(date)"
git push

# Dashboard will auto-refresh within 30 seconds
```

---

## Step 8: Configure for Your Project

### Update Sample Data

Replace `data/qi-data.csv` with your actual QI project data:

```csv
DATE,YOUR_METRIC_1,YOUR_METRIC_2,YOUR_METRIC_3
2025-01-01,value1,value2,value3
2025-01-02,value1,value2,value3
```

### Customize Colors (Optional)

Edit `qi-dashboard.js`, line ~320:

```javascript
const colors = [
    '#567159', // Your brand color
    '#81b0c4', // Secondary color
    // Add more colors as needed
];
```

### Set Default Goal (Optional)

Edit `qi-dashboard.js`, line ~25:

```javascript
let goalValue = 20;  // Set your default goal
```

---

## Troubleshooting Deployment

### Changes not appearing on live site

1. **Clear browser cache:**
   - Ctrl + Shift + R (hard refresh)
   - Or open in incognito mode

2. **Check GitHub Actions:**
   - Go to repo → Actions tab
   - Look for failed builds
   - Check error messages

3. **Verify files pushed:**
   ```bash
   git log --oneline -5  # Check recent commits
   git remote -v          # Verify remote URL
   ```

### 404 Error on /qi-dashboard/

- Verify folder name is exactly `qi-dashboard` (lowercase, with dash)
- Check files are in correct location
- Look at repo file structure on GitHub

### Data file not loading

- Check file path in `qi-dashboard.js` matches your structure
- Verify CSV is properly formatted
- Check browser console for specific errors

### CORS errors

If testing locally, use a local server:
```bash
# Python 3
python -m http.server 8000

# Python 2
python -m SimpleHTTPServer 8000

# Node.js (if installed)
npx http-server
```

---

## Advanced: Connecting to Epic Data

### Option 1: SQL Server → CSV Export

```sql
-- Example Epic query for antibiotic stewardship
SELECT
    CAST(CONTACT_DATE AS DATE) as DATE,
    COUNT(*) as TOTAL_ENCOUNTERS,
    SUM(CASE WHEN ANTIBIOTIC_ORDERED = 1 THEN 1 ELSE 0 END) as ANTIBIOTICS_PRESCRIBED,
    CAST(SUM(CASE WHEN ANTIBIOTIC_ORDERED = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*) AS DECIMAL(5,1)) as ANTIBIOTIC_RATE
FROM ENCOUNTER_TABLE
WHERE DIAGNOSIS_CODE IN ('J06.9', 'J00', 'B34.9')  -- Viral URI codes
    AND PATIENT_AGE < 18
    AND CONTACT_DATE >= DATEADD(day, -90, GETDATE())
GROUP BY CAST(CONTACT_DATE AS DATE)
ORDER BY DATE
```

Export as CSV, upload to GitHub.

### Option 2: Automated Pipeline

1. Schedule SQL query to run daily
2. Export results to network drive
3. Script copies to GitHub repo
4. GitHub Actions commits the file
5. Dashboard auto-updates

---

## Maintenance

### Regular Tasks

**Daily:**
- Monitor auto-refresh working
- Check for data anomalies

**Weekly:**
- Review intervention markers
- Export charts for reports
- Update goal if needed

**Monthly:**
- Review color coding
- Archive old data if needed
- Update documentation

### Updating Dashboard Code

If you need to update the dashboard itself:

```bash
# Make changes to files locally
code f:\Coding\Sage-Project\qi-dashboard\qi-dashboard.js

# Test locally
# Then commit and push
git add qi-dashboard/
git commit -m "Update: [describe change]"
git push
```

---

## Security Considerations

### Data Privacy

- **PHI Warning:** Do NOT include patient identifiers in data files
- Use aggregate/de-identified data only
- Follow your institution's data policies

### Access Control

- GitHub repo should be private if data is sensitive
- Use GitHub's access controls for team members
- Consider password-protecting the dashboard page

### GitHub Secrets

For automated data pulls, store credentials as GitHub Secrets:
1. Go to repo Settings → Secrets and variables → Actions
2. Add secrets (API keys, database credentials)
3. Reference in workflows: `${{ secrets.YOUR_SECRET_NAME }}`

---

## Next Steps

1. ✅ Deploy dashboard to sageproject.xyz
2. ✅ Test with sample data
3. ✅ Replace with real QI project data
4. ✅ Add your interventions
5. ✅ Set your goal target
6. ✅ Share with colleagues for feedback
7. 🎯 Use for real QI monitoring!

---

## Support

**Issues?** Contact: mark.murphy86@gmail.com

**GitHub Issues:** https://github.com/wowzersyea/Sage-Project/issues

---

🌿 **Happy QI tracking!**
