# ⚡ Quick Start Guide - QI Dashboard

Get your QI Dashboard running in 5 minutes!

---

## 📦 What You Have

```
sage-qi-dashboard/
├── index.html              ← Main dashboard page
├── qi-dashboard.js         ← Dashboard logic
├── data/
│   └── qi-data.csv         ← Sample data (replace with yours)
├── README.md               ← Full documentation
├── DEPLOYMENT.md           ← Deploy to sageproject.xyz
└── QUICKSTART.md           ← This file
```

---

## 🚀 Option 1: Test Locally (2 minutes)

### Step 1: Open the Dashboard

**Windows:**
```bash
cd f:\Coding\sage-qi-dashboard
start index.html
```

**Mac/Linux:**
```bash
cd /path/to/sage-qi-dashboard
open index.html
```

Or just **double-click** `index.html`

### Step 2: See It in Action!

The dashboard will load with sample data showing:
- Antibiotic prescribing rates over time
- Goal line at 20%
- Sample intervention marker

### Step 3: Try Features

✅ **Select different variables** - Check/uncheck boxes
✅ **Add intervention** - Click "+ Add Intervention"
✅ **Set goal** - Enter value, click "Set Goal"
✅ **Export** - Download chart as PNG

---

## 🌐 Option 2: Deploy Live (10 minutes)

### Prerequisites
- GitHub account
- Your Sage-Project repository

### Steps

1. **Copy files to your repo:**
   ```bash
   xcopy /E /I "f:\Coding\sage-qi-dashboard" "f:\Coding\Sage-Project\qi-dashboard"
   ```

2. **Commit and push:**
   ```bash
   cd f:\Coding\Sage-Project
   git add qi-dashboard/
   git commit -m "Add QI Dashboard"
   git push
   ```

3. **Visit:** https://sageproject.xyz/qi-dashboard/

That's it! 🎉

---

## 📊 Use Your Own Data

### Format Your Data

Create a CSV file with this structure:

```csv
DATE,METRIC1,METRIC2,METRIC3
2025-01-01,75.6,24.4,100
2025-01-02,76.3,23.7,95
2025-01-03,78.8,21.2,102
```

**Requirements:**
- First column = dates
- Other columns = numeric values you want to track
- No missing values in date column

### Load Your Data

**Method A: Upload via Browser**
1. Open dashboard
2. Click the upload box
3. Select your CSV file
4. Done!

**Method B: Replace Sample Data**
1. Replace `data/qi-data.csv` with your file
2. Refresh dashboard (or wait 30 seconds for auto-refresh)

**Method C: Deploy to Website**
1. Copy your CSV to `qi-dashboard/data/qi-data.csv`
2. Push to GitHub
3. Dashboard auto-updates!

---

## 🎯 Common Use Cases

### Antibiotic Stewardship

**Your data:**
```csv
DATE,ANTIBIOTIC_RATE,TOTAL_ENCOUNTERS
2025-01-01,75.6,45
2025-01-02,76.3,38
```

**Setup:**
- Goal: `20` (target 20% or less)
- Intervention: Date of education session
- Variables: Select `ANTIBIOTIC_RATE`

### CLABSI Tracking

**Your data:**
```csv
DATE,CLABSI_RATE,LINE_DAYS
2025-01-01,1.2,500
2025-01-02,0.8,520
```

**Setup:**
- Goal: `1.0` (per 1000 line-days)
- Intervention: Bundle implementation date
- Variables: Select `CLABSI_RATE`

### Readmission Rates

**Your data:**
```csv
DATE,READMISSION_RATE,TOTAL_DISCHARGES
2025-01-01,12.3,100
2025-01-02,11.8,95
```

**Setup:**
- Goal: `10` (target 10%)
- Intervention: Discharge protocol change
- Variables: Select `READMISSION_RATE`

---

## 🔧 Customization

### Change Colors

Edit `qi-dashboard.js`, line ~320:
```javascript
const colors = [
    '#567159',  // Change to your color
    '#81b0c4',
    // Add more...
];
```

### Change Auto-Refresh Frequency

Edit `qi-dashboard.js`, line ~15:
```javascript
const AUTO_REFRESH_INTERVAL = 30000;  // milliseconds (30 sec)
// Change to 60000 for 1 minute, etc.
```

### Set Default Goal

Edit `qi-dashboard.js`, line ~25:
```javascript
let goalValue = 20;  // Your default
```

---

## 📱 Mobile Usage

Dashboard works on phones/tablets:
- Tap to select variables
- Pinch to zoom chart
- All features available
- Auto-saves settings

---

## ❓ Troubleshooting

### "No data loaded"
→ Upload a CSV file or check `data/qi-data.csv` exists

### Variables not showing
→ Make sure your data has numeric columns

### Chart not rendering
→ Check browser console (F12) for errors

### Changes not saving
→ Check browser allows localStorage

### Auto-refresh not working
→ Only works when data file is on a web server

---

## 🎓 Tips

1. **Start simple** - Upload data, select one variable, add goal
2. **Add interventions** - Mark important dates on timeline
3. **Export frequently** - Save charts for reports/presentations
4. **Multiple variables** - Compare related metrics side-by-side
5. **Share link** - Once deployed, anyone can view (but not edit)

---

## 📚 Learn More

- **Full docs:** See [README.md](README.md)
- **Deployment:** See [DEPLOYMENT.md](DEPLOYMENT.md)
- **Support:** mark.murphy86@gmail.com

---

## ✅ Next Steps

1. ✅ Test with sample data
2. ✅ Upload your own data
3. ✅ Add interventions
4. ✅ Set goal line
5. ✅ Export first chart
6. 🎯 Deploy to sageproject.xyz
7. 🎯 Share with team!

---

🌿 **Sage Project** - Quality Improvement Made Easy

*Built for Mark Murphy, MD - Pediatric ID & Antimicrobial Stewardship*
