# 🧪 Test Instructions - QI Dashboard

Quick tests to verify everything works correctly.

---

## ✅ Pre-Test Checklist

- [ ] Files are in: `f:\Coding\sage-qi-dashboard\`
- [ ] Browser is installed (Chrome, Edge, Firefox, Safari)
- [ ] Ready to test!

---

## Test 1: Basic Loading (1 minute)

### Steps:
1. Navigate to `f:\Coding\sage-qi-dashboard\`
2. Double-click `index.html`
3. Dashboard should open in your browser

### Expected Result:
✅ Dashboard loads with sage green header
✅ "QI Dashboard" title visible
✅ Status shows "Loaded X rows from qi-data.csv"
✅ Chart displays with antibiotic data
✅ Variables checkboxes visible

### If It Fails:
- Try different browser
- Check console (F12) for errors
- Verify all files are present

---

## Test 2: Variable Selection (30 seconds)

### Steps:
1. Find "Select Variables to Display" section
2. **Uncheck** `ANTIBIOTICS_PRESCRIBED`
3. Chart should update immediately

### Expected Result:
✅ Chart removes that line
✅ Chart legend updates
✅ Other variables still visible

### Now:
4. **Check** it again
5. Line should reappear

---

## Test 3: Goal Line (30 seconds)

### Steps:
1. Find "Goal Target Line" section
2. Enter `20` in the input box
3. Click "Set Goal"

### Expected Result:
✅ Red dotted line appears at y=20
✅ Line spans entire chart width
✅ Legend shows "Goal"

### Now:
4. Click "Clear"
5. Goal line should disappear

---

## Test 4: Add Intervention (1 minute)

### Steps:
1. Click "+ Add Intervention" button
2. Modal popup should appear
3. Enter:
   - **Date:** `2025-02-15`
   - **Label:** `Test Intervention`
   - **Description:** `This is a test`
4. Click "Add"

### Expected Result:
✅ Modal closes
✅ Intervention appears in list below
✅ Vertical line appears on chart at Feb 15
✅ Label shows on chart

### Now:
5. Click "Remove" button
6. Intervention should disappear from chart and list

---

## Test 5: File Upload (1 minute)

### Steps:
1. Find data upload box at top
2. Click it
3. Browse to `data/test-data-2.csv`
4. Select and open

### Expected Result:
✅ New data loads (CLABSI data)
✅ Variables update (CLABSI_RATE, LINE_DAYS, INFECTIONS)
✅ Chart displays new data
✅ Previous interventions cleared

### Now:
6. Upload original `data/qi-data.csv` again
7. Should return to antibiotic data

---

## Test 6: Export Chart (30 seconds)

### Steps:
1. Make sure chart is displayed
2. Click "📊 Export Chart" button

### Expected Result:
✅ PNG file downloads
✅ File named like: `qi-chart-2026-02-01.png`
✅ Open file - should show your chart

---

## Test 7: Export Data (30 seconds)

### Steps:
1. Click "📥 Export Data" button

### Expected Result:
✅ CSV file downloads
✅ File named like: `qi-data-export-2026-02-01.csv`
✅ Open in Excel/Notepad - should show data

---

## Test 8: Persistent Settings (1 minute)

### Steps:
1. Select specific variables (e.g., only `ANTIBIOTIC_RATE`)
2. Set goal to `20`
3. Add an intervention
4. **Close the browser tab**
5. **Re-open** `index.html`

### Expected Result:
✅ Your variable selections are preserved
✅ Goal value still set
✅ Interventions still present
✅ Settings survived page reload!

---

## Test 9: Mobile View (30 seconds)

### Steps:
1. With dashboard open, press F12 (developer tools)
2. Click device toolbar icon (or Ctrl+Shift+M)
3. Select mobile device (e.g., iPhone)

### Expected Result:
✅ Dashboard adapts to narrow screen
✅ Controls stack vertically
✅ Chart remains visible
✅ All buttons accessible

---

## Test 10: Auto-Refresh (Optional - requires local server)

This test only works with a web server, not file:// protocol.

### Setup:
```bash
cd f:\Coding\sage-qi-dashboard
python -m http.server 8000
```

Then visit: http://localhost:8000

### Steps:
1. Dashboard loads
2. Open `data/qi-data.csv` in Notepad
3. Change a value (e.g., first ANTIBIOTIC_RATE)
4. Save file
5. Wait 30 seconds

### Expected Result:
✅ Dashboard automatically refreshes
✅ Chart updates with new value
✅ Status shows new timestamp

---

## 🎯 All Tests Passed?

If all 9-10 tests pass: **Dashboard is working perfectly!** ✅

Ready to:
1. Replace sample data with your real QI data
2. Deploy to sageproject.xyz
3. Start tracking your QI projects!

---

## ❌ Test Failed?

### Common Issues:

**Dashboard won't open:**
- Right-click index.html → Open With → Choose browser
- Or drag index.html into browser window

**Chart not showing:**
- Check browser console (F12) for errors
- Verify `qi-dashboard.js` is in same folder
- Check internet connection (loads Chart.js from CDN)

**Variables not working:**
- Verify data has numeric columns
- Check CSV format is correct
- Try with sample data first

**Upload not working:**
- Try different browser
- Check file is valid CSV
- Verify file size isn't huge

**Export not working:**
- Check browser allows downloads
- Check disk space
- Try different browser

---

## 📞 Still Having Issues?

1. Check browser console (F12) → Console tab
2. Copy error messages
3. Check README.md troubleshooting section
4. Contact: mark.murphy86@gmail.com

---

## 🏆 Test Results Template

Copy and save your results:

```
QI Dashboard Test Results
Date: ___________
Browser: ___________

Test 1 - Basic Loading: ✅ / ❌
Test 2 - Variable Selection: ✅ / ❌
Test 3 - Goal Line: ✅ / ❌
Test 4 - Add Intervention: ✅ / ❌
Test 5 - File Upload: ✅ / ❌
Test 6 - Export Chart: ✅ / ❌
Test 7 - Export Data: ✅ / ❌
Test 8 - Persistent Settings: ✅ / ❌
Test 9 - Mobile View: ✅ / ❌
Test 10 - Auto-Refresh: ✅ / ❌ / SKIPPED

Overall: PASS / FAIL

Notes:
_________________________________
_________________________________
```

---

🌿 **Happy Testing!**
