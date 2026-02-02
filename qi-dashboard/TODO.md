# ✅ QI Dashboard - TODO List

Quick reference for pending tasks.

---

## 🔥 High Priority (Next Session)

### 1. Auto-Calculate Percentage Feature
**Time:** 30 minutes
**Status:** 🔴 Not started

- [ ] Detect raw count columns in CSV (TOTAL_ENCOUNTERS, ABX_PRESCRIBED)
- [ ] Add calculation: ABX_RATE = (ABX_PRESCRIBED / TOTAL_ENCOUNTERS) × 100
- [ ] Add UI toggle for "Use calculated rate"
- [ ] Update documentation with new format
- [ ] Test with Mark's Epic data

**Why important:** Mark's Epic exports have raw counts, needs auto-calculation

---

### 2. Test with Real Epic Data
**Time:** 15 minutes
**Status:** 🔴 Waiting for data

- [ ] Get sample CSV from Mark
- [ ] Load into dashboard
- [ ] Verify calculations work
- [ ] Confirm 30% goal line displays correctly
- [ ] Add intervention markers for program events

**Why important:** Validate dashboard works with real clinical data

---

## 🎨 Medium Priority

### 3. Layout Improvements
**Time:** 1-2 hours
**Status:** 🟡 Deferred

- [ ] Better spacing and visual hierarchy
- [ ] Improved button styles and hover states
- [ ] Professional color scheme refinement
- [ ] Loading states and animations
- [ ] Better error messages
- [ ] Chart legend positioning
- [ ] Mobile layout optimization

**Why important:** Current design is functional but basic

---

### 4. Statistical Process Control (SPC)
**Time:** 2-3 hours
**Status:** 🔴 Not started

- [ ] Add control limits (UCL/LCL) calculation
- [ ] Implement SPC rules detection
  - [ ] 8 points on one side of centerline
  - [ ] 6 points trending up/down
  - [ ] 2 out of 3 points in outer third
  - [ ] Single point outside control limits
- [ ] Visual indicators for special cause variation
- [ ] Alert notifications

**Why important:** Essential for proper QI analysis

---

### 5. Multiple Chart Types
**Time:** 3-4 hours
**Status:** 🔴 Not started

- [ ] Control chart (X̄ and R)
- [ ] P-chart for proportions
- [ ] U-chart for rates
- [ ] Pareto chart
- [ ] Histogram
- [ ] Chart type selector in UI

**Why important:** Different metrics need different chart types

---

## 💡 Nice to Have

### 6. SQUIRE 2.0 Report Generator
**Time:** 4-5 hours
**Status:** 🔴 Not started

- [ ] Auto-generate structured report
- [ ] Include all SQUIRE elements
- [ ] Embed charts and statistics
- [ ] Export as PDF/Word
- [ ] Template customization

---

### 7. Epic Integration
**Time:** 3-4 hours
**Status:** 🔴 Not started

- [ ] SQL Server connection setup
- [ ] Automated query execution
- [ ] Data transformation pipeline
- [ ] GitHub Actions workflow
- [ ] Error handling and logging

**Requires:** Database credentials, SQL queries from Mark

---

### 8. WhatsApp Voice Integration
**Time:** 2-3 hours
**Status:** 🔴 Not started

- [ ] Connect to existing Sage WhatsApp bot
- [ ] Voice command parsing for data entry
- [ ] Confirmation messages
- [ ] Daily automated summaries
- [ ] Alert notifications for goal violations

**Dependencies:** Sage WhatsApp bot (already built)

---

### 9. Email/Slack Reports
**Time:** 1-2 hours
**Status:** 🔴 Not started

- [ ] Weekly summary emails
- [ ] Automated report generation
- [ ] Chart attachments
- [ ] Slack webhook integration
- [ ] Customizable alert thresholds

---

## 🐛 Bug Fixes

**None currently reported**

---

## 📚 Documentation Updates

### 10. Update Main Site Navigation
**Time:** 5 minutes
**Status:** 🟡 Optional

- [ ] Edit `Sage-Project/index.html`
- [ ] Update QI Stats card to link to QI Dashboard
- [ ] Change status from "Coming Soon" to "Live"
- [ ] Test navigation works

---

### 11. Create Video Tutorial
**Time:** 30 minutes
**Status:** 🔴 Future

- [ ] Screen recording of dashboard usage
- [ ] Walkthrough of all features
- [ ] Data upload demo
- [ ] Export examples
- [ ] Upload to YouTube or embed on site

---

## 🔄 Maintenance Tasks

### Periodic Reviews

- [ ] **Weekly:** Check for GitHub issues/feedback
- [ ] **Monthly:** Review usage patterns, add features
- [ ] **Quarterly:** Update dependencies (Chart.js, etc.)
- [ ] **As needed:** Update documentation

---

## 📝 Notes

**Add your own tasks here:**

---

## ✅ Recently Completed

- [x] Basic dashboard with run chart (Feb 1)
- [x] Auto-updating data file system (Feb 1)
- [x] Customizable variable selection (Feb 1)
- [x] Intervention markers (Feb 1)
- [x] Goal target line (Feb 1)
- [x] Export capabilities (Feb 1)
- [x] Complete documentation (Feb 1)
- [x] Deploy to GitHub (Feb 1)

---

**Last Updated:** February 1, 2026
**Next Review:** When Mark resumes development

---

🌿 **Sage QI Dashboard** - Continuous Improvement!
