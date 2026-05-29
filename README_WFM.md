# WFM Rostering Engine (Python)

This directory contains a professional-grade Workforce Management (WFM) monthly rostering engine designed for call center operations.

## 📁 Files
- `roster_engine.py`: The core scheduling engine.
- `WFM_Monthly_Roster.xlsx`: Sample output (generated after running).

## 🚀 How to Run

### 1. Prerequisites
Ensure you have Python 3.8+ and the required libraries installed:
```bash
pip install pandas openpyxl numpy
```

### 2. Execution
Run the script to generate a balanced 30-day roster:
```bash
python roster_engine.py
```

## 🧠 Logic Overview

### Constraints
- **Hard**: No more than 6 consecutive working days.
- **Hard**: 100% fulfillment of daily shift requirements.
- **Soft**: Balanced workload (total working days) and OFF days (~8 per month).

### Optimization Strategy
The engine uses a **Scoring System** to assign shifts:
1. **Disqualification**: Agents with a 6-day streak are barred from working.
2. **Prioritization**: Agents with the lowest total work days get priority for new shifts.
3. **Randomization**: A small random noise is added to scores to prevent predictable patterns.

## 📊 Output Explanation
The engine produces an Excel file with two sheets:
1. **Roster**: A 30-day grid showing `Shift Codes` (P1, S1, etc.) or `OFF` for each agent.
2. **Summary**: Performance metrics per agent, including total days worked and shift distribution.
