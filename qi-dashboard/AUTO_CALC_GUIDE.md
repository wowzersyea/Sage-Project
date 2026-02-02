# 🔢 Auto-Calculation Feature Guide

The QI Dashboard now automatically calculates percentage rates from raw count data!

---

## ✨ What's New?

**Before:** You had to pre-calculate percentages in Excel or SQL
**Now:** Just upload raw counts, dashboard calculates automatically!

---

## 📊 How It Works

### Your Epic SQL Export

```sql
SELECT
    CAST(CONTACT_DATE AS DATE) as DATE,
    COUNT(*) as TOTAL_ENCOUNTERS,
    SUM(CASE WHEN ANTIBIOTIC_ORDERED = 1 THEN 1 ELSE 0 END) as ABX_PRESCRIBED
FROM ENCOUNTERS
WHERE DIAGNOSIS_CODE IN ('J06.9', 'J00', 'B34.9')
GROUP BY CAST(CONTACT_DATE AS DATE)
ORDER BY DATE
```

Export this to CSV → Upload to dashboard → **Done!**

---

## 🎯 Supported Calculations

The dashboard automatically detects and calculates:

### 1. Antibiotic Prescribing Rate

**Detects:**
- Numerator: `ABX_PRESCRIBED`, `ANTIBIOTICS_PRESCRIBED`, `ANTIBIOTICS`, `ABX`
- Denominator: `TOTAL_ENCOUNTERS`, `ENCOUNTERS`, `TOTAL`

**Calculates:** `ABX_RATE = (ABX_PRESCRIBED / TOTAL_ENCOUNTERS) × 100`

**Example:**
```csv
DATE,TOTAL_ENCOUNTERS,ABX_PRESCRIBED
2025-01-01,45,34
```
→ Dashboard creates: `ABX_RATE = 75.56%`

---

### 2. Infection Rate (CLABSI, CAUTI, etc.)

**Detects:**
- Numerator: `INFECTIONS`, `CLABSI_COUNT`, `INFECTION_COUNT`
- Denominator: `LINE_DAYS`, `DEVICE_DAYS`, `PATIENT_DAYS`

**Calculates:** `INFECTION_RATE = (INFECTIONS / LINE_DAYS) × 100`

**Example:**
```csv
DATE,LINE_DAYS,INFECTIONS
2025-01-01,500,8
```
→ Dashboard creates: `INFECTION_RATE = 1.6 per 1000 days`

---

### 3. Readmission Rate

**Detects:**
- Numerator: `READMISSIONS`, `READMISSION_COUNT`
- Denominator: `DISCHARGES`, `TOTAL_DISCHARGES`

**Calculates:** `READMISSION_RATE = (READMISSIONS / DISCHARGES) × 100`

---

## 💡 Usage Examples

### Example 1: Pediatric URI Antibiotic Stewardship

**Your CSV:**
```csv
DATE,TOTAL_ENCOUNTERS,ABX_PRESCRIBED
2025-01-01,45,34
2025-01-02,38,29
2025-02-15,50,8
2025-02-16,47,7
```

**Dashboard automatically:**
1. Calculates `ABX_RATE` for each day
2. Creates new column with percentages
3. Shows: "✓ Auto-calculated: ABX_RATE (ABX_PRESCRIBED / TOTAL_ENCOUNTERS)"

**You then:**
1. Select `ABX_RATE` to display
2. Set goal to `30` (for 30% target)
3. Add intervention at `2025-02-15`
4. Done!

---

### Example 2: CLABSI Prevention

**Your CSV:**
```csv
DATE,LINE_DAYS,INFECTIONS
2025-01-01,450,8
2025-01-08,480,8
2025-02-05,520,6
2025-02-12,550,5
```

**Dashboard automatically:**
1. Calculates `INFECTION_RATE`
2. Shows per 1000 line-days
3. Ready to chart!

---

## 🔍 How to Verify It's Working

When you upload your CSV:

1. **Look for green info box:**
   ```
   ✓ Auto-calculated: ABX_RATE (ABX_PRESCRIBED / TOTAL_ENCOUNTERS)
   Dashboard automatically calculated percentage rates from your raw count data.
   ```

2. **Check variable list:**
   - Should see `ABX_RATE` (or `INFECTION_RATE`, etc.)
   - Even though it wasn't in your original CSV!

3. **Select the calculated variable:**
   - Check the box next to `ABX_RATE`
   - Chart displays the percentage

---

## 📋 Data Format Requirements

### Minimum Required

```csv
DATE,DENOMINATOR_COLUMN,NUMERATOR_COLUMN
2025-01-01,value,value
```

**Rules:**
- ✅ First column should be dates
- ✅ Column names must match patterns (see above)
- ✅ All values numeric (except dates)
- ✅ No missing values

### Optional Columns

You can include additional columns - they'll show up as variables:

```csv
DATE,TOTAL_ENCOUNTERS,ABX_PRESCRIBED,PROVIDER_ID,DEPARTMENT
2025-01-01,45,34,101,Pediatrics
```

Dashboard calculates `ABX_RATE` and also lets you chart `PROVIDER_ID` or `DEPARTMENT` if needed.

---

## ❓ FAQ

### Q: What if my column names are different?

**A:** The dashboard looks for keywords. These all work:
- `ABX_PRESCRIBED` ✓
- `ANTIBIOTICS_PRESCRIBED` ✓
- `ANTIBIOTICS` ✓
- `ABX` ✓

If your columns don't match, you can:
1. Rename them in Excel/SQL
2. Or pre-calculate the rate yourself

### Q: Can I still include pre-calculated rates?

**A:** Yes! If your CSV already has `ABX_RATE`, dashboard uses that instead of calculating.

### Q: What if I have both raw counts AND the rate?

**A:** Dashboard detects the rate column and won't recalculate. Your original rate is used.

### Q: Does this work with JSON files?

**A:** Yes! Same logic applies to JSON format.

### Q: Can I calculate custom rates?

**A:** Currently supports the 3 patterns above. For custom calculations:
1. Pre-calculate in Excel/SQL
2. Include the rate column in your CSV

(Future feature: Custom calculation formulas)

---

## 🎯 Best Practices

### For Epic SQL Exports

1. **Keep column names simple:**
   ```sql
   COUNT(*) as TOTAL_ENCOUNTERS,
   SUM(...) as ABX_PRESCRIBED
   ```

2. **Export as CSV directly:**
   - Saves a step
   - No Excel formatting issues

3. **Include date column:**
   - Use `CAST(date AS DATE)` for clean format

### For Manual Entry

1. **Use Excel template:**
   ```
   DATE | TOTAL_ENCOUNTERS | ABX_PRESCRIBED
   ```

2. **Save as CSV:**
   - Not XLSX
   - UTF-8 encoding

3. **Verify in dashboard:**
   - Upload and check for green info box

---

## 🔧 Troubleshooting

### "No variables showing"

→ Check column names match patterns
→ Verify all values are numeric (except dates)

### "Wrong percentage calculated"

→ Verify numerator/denominator are correct
→ Check for zeros in denominator (handled automatically)

### "Auto-calculation not working"

→ Column names must include keywords
→ Try renaming: `PRESCRIBED` → `ABX_PRESCRIBED`

---

## 💡 Pro Tips

1. **Goal setting:** For inappropriate prescribing, set goal to `30` (30%)

2. **Multiple metrics:** Upload file with multiple numerator/denominators - dashboard calculates all

3. **Intervention markers:** Add intervention date when you started your QI project

4. **Export for reports:** Once calculated, export as CSV to save the rates

---

## 🎉 That's It!

**No more manual percentage calculations!**

Just export from Epic → Upload → Dashboard does the math → Start improving quality!

---

🌿 **Sage QI Dashboard** - Making QI analysis easier, one calculation at a time.
