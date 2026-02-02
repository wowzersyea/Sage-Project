# 🗂️ QI Dashboard - Project Tracker

Track ongoing development and enhancements for Sage QI Dashboard.

**Last Updated:** February 1, 2026
**Status:** ✅ MVP Complete, Deployed to GitHub

---

## 📊 Current Status

### ✅ Completed (MVP)

- [x] Basic dashboard with run chart
- [x] Auto-updating data from CSV file (30-second refresh)
- [x] Customizable variable selection
- [x] Intervention markers with labels
- [x] Goal target line (dotted red line)
- [x] Export chart as PNG
- [x] Export data as CSV
- [x] Drag & drop file upload
- [x] Mobile responsive design
- [x] Persistent settings (localStorage)
- [x] Sample data (antibiotic stewardship)
- [x] Complete documentation
- [x] Deployed to GitHub: `Sage-Project/qi-dashboard/`

**Live at:** https://sageproject.xyz/qi-dashboard/

---

## 🔨 In Progress

None currently!

## ✅ Recently Completed

### Priority 1: Data Format Enhancement ✓ COMPLETE (Feb 2, 2026)

**Issue:** Need to support raw counts with auto-calculated percentages

**Requirements:**
- ✅ Accept CSV with: DATE, TOTAL_ENCOUNTERS, ABX_PRESCRIBED
- ✅ Auto-calculate: ABX_RATE = (ABX_PRESCRIBED / TOTAL_ENCOUNTERS) × 100
- ✅ Display percentage on chart
- ✅ Goal line at 30% (for inappropriate prescribing)
- ✅ UI indicator showing what was calculated
- ✅ Support multiple calculation patterns

**Files modified:**
- ✅ `qi-dashboard.js` - Added `calculateMetrics()` function
- ✅ `index.html` - Added calculated metrics info section
- ✅ `README.md` - Updated data format documentation
- ✅ Created `AUTO_CALC_GUIDE.md` - Comprehensive usage guide

**Supported patterns:**
1. ABX rate: `ABX_PRESCRIBED` / `TOTAL_ENCOUNTERS` → `ABX_RATE`
2. Infection rate: `INFECTIONS` / `LINE_DAYS` → `INFECTION_RATE`
3. Readmission rate: `READMISSIONS` / `DISCHARGES` → `READMISSION_RATE`

**Test data:** `data/test-raw-counts.csv`

**Status:** ✅ Complete and tested

---

### Priority 2: Layout/Design Improvements

**Issue:** Current layout is functional but basic

**Requested enhancements:**
- More sophisticated design elements
- Better visual polish
- Professional clinical aesthetic
- Improved color schemes
- Animated transitions

**Status:** 🟡 Deferred to later session
**Assigned to:** TBD - after core features complete

---

## 📋 Backlog

### Enhancement Ideas

#### Statistical Process Control (SPC) Features
- [ ] Automatic special cause detection
- [ ] Control charts with UCL/LCL
- [ ] Run chart rules (shifts, trends)
- [ ] Statistical annotations
- [ ] Rule violation alerts

**Priority:** High (for clinical QI work)
**Complexity:** Medium
**Estimated time:** 2-3 hours

#### Multiple Chart Types
- [ ] Control charts (X̄ and R charts)
- [ ] Pareto charts
- [ ] Histogram
- [ ] P-chart for proportions
- [ ] U-chart for rates

**Priority:** Medium
**Complexity:** Medium
**Estimated time:** 3-4 hours

#### SQUIRE 2.0 Report Generator
- [ ] Auto-generate QI reports from dashboard data
- [ ] Include all SQUIRE reporting elements
- [ ] Export as formatted document
- [ ] Charts and statistical analysis included

**Priority:** Medium (useful for publications)
**Complexity:** High
**Estimated time:** 4-5 hours

#### WhatsApp Voice Integration
- [ ] Voice data entry via WhatsApp
- [ ] "Hey Sage, log today's stats: 15 encounters, 2 antibiotics"
- [ ] Voice confirmations
- [ ] Automated daily summaries

**Priority:** Low (nice to have)
**Complexity:** Medium
**Estimated time:** 2-3 hours (already have WhatsApp bot built)

#### Epic Integration
- [ ] Direct SQL Server connection
- [ ] Automated data pulls
- [ ] Scheduled updates via GitHub Actions
- [ ] No manual CSV uploads needed

**Priority:** High (saves time)
**Complexity:** High
**Estimated time:** 3-4 hours
**Requires:** Database credentials, SQL queries

#### Email/Slack Reports
- [ ] Weekly automated summaries
- [ ] Alert on goal violations
- [ ] Trend notifications
- [ ] Formatted charts attached

**Priority:** Medium
**Complexity:** Low
**Estimated time:** 1-2 hours

---

## 🐛 Known Issues

### None Currently

---

## 📝 Notes from Mark

### Session 1 (Feb 1, 2026)

**Feedback:**
1. ✅ Need percentage-based metrics (ABX_PRESCRIBED / TOTAL_ENCOUNTERS)
2. ✅ Goal should be <30% for non-indicated diagnoses
3. ✅ Layout is basic - spruce up later
4. ✅ Dashboard should auto-calculate percentages from raw counts

**Use Case:**
- Pediatric outpatient stewardship program (high priority)
- Track antibiotic prescribing for viral diagnoses
- Goal: <30% inappropriate prescribing rate
- Data from Epic SQL exports

**Data Source:**
- Epic SQL Server exports
- Diagnosis codes: J06.9 (acute URI), J00 (nasopharyngitis), B34.9 (viral infection)
- Need: Daily or weekly aggregated data

---

## 🎯 Next Session Priority

### 1. Auto-Calculate Percentage Feature (30 min)

**Task:** Add calculated metrics functionality

**Steps:**
1. Modify `qi-dashboard.js` to detect raw count columns
2. Add calculation: `ABX_RATE = (ABX_PRESCRIBED / TOTAL_ENCOUNTERS) × 100`
3. Add UI toggle: "Raw Data" vs "Calculated Rate"
4. Test with Mark's data format
5. Update documentation

**Files to edit:**
- `qi-dashboard.js` - lines ~150-200 (data parsing section)
- `index.html` - add calculated metrics UI section
- `README.md` - update data format section

### 2. Test with Real Data (15 min)

**Task:** Verify dashboard works with Mark's Epic exports

**Steps:**
1. Mark provides sample Epic CSV
2. Load into dashboard
3. Verify percentage calculation
4. Set goal at 30%
5. Add intervention markers for program launch

### 3. Quick Layout Polish (15 min - if time)

**Task:** Minor visual improvements

**Quick wins:**
- Better spacing
- Improved button styles
- Chart annotations
- Loading states
- Error messages

---

## 📂 Project Files

```
f:\Coding\sage-qi-dashboard/
├── index.html                    # Main dashboard
├── qi-dashboard.js               # Core logic
├── data/
│   ├── qi-data.csv              # Sample antibiotic data
│   └── test-data-2.csv          # CLABSI sample
├── README.md                     # Full documentation
├── QUICKSTART.md                 # 5-min getting started
├── DEPLOYMENT.md                 # Deploy instructions
├── TEST_INSTRUCTIONS.md          # Testing guide
├── SUMMARY_FOR_MARK.md          # Build summary
├── PROJECT_TRACKER.md           # This file
└── example-interventions.json   # Sample interventions
```

**GitHub Location:**
- Repo: `wowzersyea/Sage-Project`
- Path: `/qi-dashboard/`
- Branch: `main`

---

## 🔗 Related Projects

### Sage WhatsApp Voice Bot
- Location: `f:\Coding\sage_voice\`
- Status: ✅ Complete
- Could integrate with QI Dashboard for voice data entry

### Sage Project Website
- URL: https://sageproject.xyz
- Features: Literature Monitor, Bug-Drug Reference (coming), etc.
- QI Dashboard is part of this suite

---

## 📞 Contact

**User:** Mark Murphy, MD
- Pediatric Infectious Diseases
- Antimicrobial Stewardship Director, UTMB
- Email: mark.murphy86@gmail.com
- GitHub: @wowzersyea

---

## 🎓 Learning Points

### From This Build

1. **Auto-refresh implementation** - File timestamp checking every 30 seconds
2. **Chart.js with annotations** - Using chartjs-plugin-annotation for intervention markers
3. **localStorage persistence** - Saving user settings between sessions
4. **GitHub Pages deployment** - Static site with auto-updating data
5. **CSV parsing in browser** - No server needed, all client-side

### For Future Reference

- LF/CRLF warnings on Windows are normal (git handles it)
- Chart.js 4.x requires explicit registration of plugins
- GitHub Pages has ~2 minute deployment lag
- localStorage persists per-domain (useful for settings)

---

## 📊 Usage Metrics

**Build Time:** ~4 hours (overnight build)
**Files Created:** 10
**Lines of Code:** ~800 (HTML + JS)
**Documentation:** 5 markdown files

**Token Usage This Session:**
- Start: 200,000 available
- Used: ~102,000
- Remaining: ~98,000

---

## ✅ Session Checklist

**Before ending session:**
- [x] Create PROJECT_TRACKER.md
- [x] Document current status
- [x] List next priorities
- [x] Save all work to files
- [x] Commit to git (Mark will push)

**For next session:**
- [ ] Read PROJECT_TRACKER.md first
- [ ] Check "Next Session Priority" section
- [ ] Review Mark's latest feedback
- [ ] Continue from current status

---

**🌿 End of Session 1**
*Ready to resume development in next session!*
