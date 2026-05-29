import React, { useState, useEffect, useMemo } from 'react';
import { db, collection, onSnapshot, query, setDoc, doc, OperationType, handleFirestoreError, writeBatch } from '../lib/firebase';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { calculateRequiredAgents, calculateRequiredAgentsChat, calculateRequiredAgentsEmail, ErlangResult, getIntervalDuration, isIntervalInWindow, matchDayName, applyOperationalWindowsToVolume } from '../lib/erlang';
import * as XLSX from 'xlsx';
import { Calculator, FileText, TrendingUp, Clock, Users, Calendar, RefreshCw, AlertCircle, MessageSquare, Mail, Phone, ShieldCheck, Download, Zap, ArrowRight, ClipboardCheck, Brain, Sparkles, Loader2 } from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, BarChart, Bar } from 'recharts';
import { ShiftCode } from './ShiftCodeManager';

interface ForecastVolumeData {
  date: string;
  day: string;
  totalVolume: number;
  intervals: Record<string, number>;
}

interface Employee {
  id: string;
  nip: string;
  name: string;
  skill: string;
  extraWorkingDays?: number;
  extraHours?: number;
}

export default function ErlangForecaster({ 
  volumeData, 
  shiftCodes, 
  employees, 
  workingDaysRef,
  erlangResults = [],
  initialSettings,
  leaveRequests = [],
  roster = [],
  legacyRoster = {},
  selectedMonth = ''
}: { 
  volumeData: ForecastVolumeData[], 
  shiftCodes: ShiftCode[], 
  employees: Employee[],
  workingDaysRef?: any,
  erlangResults?: any[],
  initialSettings?: any,
  leaveRequests?: any[],
  roster?: any[],
  legacyRoster?: Record<string, Record<string, string>>,
  selectedMonth?: string
}) {
  const [channelType, setChannelType] = useState<'call' | 'chat' | 'email' | 'whatsapp' | 'multiskill_chat_wa'>('call');
  const [aht, setAht] = useState(300);
  const [targetSL, setTargetSL] = useState(80);
  const [targetTime, setTargetTime] = useState(20);
  const [frt, setFrt] = useState(60);
  const [concurrency, setConcurrency] = useState(2);
  const [tat, setTat] = useState(3600);
  const [shrinkage, setShrinkage] = useState(30);
  const [workingDays, setWorkingDays] = useState(18);
  const [operationalWindows, setOperationalWindows] = useState<any>(initialSettings?.operationalWindows || null);
  const [lastAppliedSettings, setLastAppliedSettings] = useState<any>(null);
  const [isAgreedToManpowerAdjustments, setIsAgreedToManpowerAdjustments] = useState(false);
  const [extraWorkingDays, setExtraWorkingDays] = useState(0);
  const [extraHours, setExtraHours] = useState(0);

  // Sync with initialSettings prop
  useEffect(() => {
    if (initialSettings) {
      if (initialSettings.extraWorkingDays !== undefined) setExtraWorkingDays(initialSettings.extraWorkingDays);
      if (initialSettings.extraHours !== undefined) setExtraHours(initialSettings.extraHours);
      if (initialSettings.isSimulationAgreed !== undefined) setIsAgreedToManpowerAdjustments(initialSettings.isSimulationAgreed);
      if (initialSettings.channelType) setChannelType(initialSettings.channelType);
      if (initialSettings.aht) setAht(initialSettings.aht);
      if (initialSettings.targetSL) setTargetSL(initialSettings.targetSL);
      if (initialSettings.targetTime) setTargetTime(initialSettings.targetTime);
      if (initialSettings.frt) setFrt(initialSettings.frt);
      if (initialSettings.concurrency) setConcurrency(initialSettings.concurrency);
      if (initialSettings.tat) setTat(initialSettings.tat);
      if (initialSettings.shrinkage) setShrinkage(initialSettings.shrinkage);
      if (initialSettings.workingDays) setWorkingDays(initialSettings.workingDays);
      if (initialSettings.operationalWindows) setOperationalWindows(initialSettings.operationalWindows);
      if (initialSettings.lastApplied) setLastAppliedSettings(initialSettings.lastApplied);
    }
  }, [initialSettings]);

  const results = useMemo(() => {
    return erlangResults.filter(r => volumeData.some(v => v.date === r.date))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [erlangResults, volumeData]);

  const [calculating, setCalculating] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [aiInsight, setAiInsight] = useState<string>('');
  const [loadingInsight, setLoadingInsight] = useState(false);

  const isStale = lastAppliedSettings && (
    channelType !== lastAppliedSettings.channelType ||
    aht !== lastAppliedSettings.aht ||
    targetSL !== lastAppliedSettings.targetSL ||
    (channelType === 'call' && targetTime !== lastAppliedSettings.targetTime) ||
    ((channelType === 'chat' || channelType === 'whatsapp' || channelType === 'multiskill_chat_wa') && frt !== lastAppliedSettings.frt) ||
    (channelType === 'email' && tat !== lastAppliedSettings.tat) ||
    concurrency !== lastAppliedSettings.concurrency ||
    shrinkage !== lastAppliedSettings.targetShrinkage ||
    JSON.stringify(operationalWindows) !== JSON.stringify(lastAppliedSettings.operationalWindows)
  );

  // Save settings when they change
  const saveSettings = async (newSettings: any) => {
    try {
      await setDoc(doc(db, 'erlangSettings', 'current'), newSettings, { merge: true });
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  };

  const handleAgreementToggle = async (agreed: boolean) => {
    setIsAgreedToManpowerAdjustments(agreed);
    await saveSettings({ isSimulationAgreed: agreed });
  };

  const handleWorkingDaysChange = async (days: number) => {
    const totalDays = volumeData.length;
    const clampedBase = Math.min(days, totalDays);
    setWorkingDays(clampedBase);
    
    // Also adjust extra working days if current total exceeds month limit
    if (clampedBase + extraWorkingDays > totalDays) {
      const allowedExtra = totalDays - clampedBase;
      setExtraWorkingDays(allowedExtra);
      await saveSettings({ workingDays: clampedBase, extraWorkingDays: allowedExtra });
    } else {
      await saveSettings({ workingDays: clampedBase });
    }
  };

  const handleExtraDaysChange = async (days: number) => {
    const totalDays = volumeData.length;
    // Standard working days + extra cannot exceed total calendar days
    const allowedExtra = Math.max(0, totalDays - workingDays);
    const clampedExtra = Math.min(days, allowedExtra);
    
    setExtraWorkingDays(clampedExtra);
    await saveSettings({ extraWorkingDays: clampedExtra });
  };

  const handleExtraHoursChange = async (hours: number) => {
    setExtraHours(hours);
    await saveSettings({ extraHours: hours });
  };

  const handleReset = async () => {
    const defaults = {
      channelType: 'call' as const,
      aht: 300,
      targetSL: 80,
      targetTime: 20,
      concurrency: 2,
      tat: 3600,
      shrinkage: 30,
      workingDays: 22,
      operationalWindows: {
        'Monday': { start: '00:00', end: '23:59', isOpen: true },
        'Tuesday': { start: '00:00', end: '23:59', isOpen: true },
        'Wednesday': { start: '00:00', end: '23:59', isOpen: true },
        'Thursday': { start: '00:00', end: '23:59', isOpen: true },
        'Friday': { start: '00:00', end: '23:59', isOpen: true },
        'Saturday': { start: '00:00', end: '23:59', isOpen: true },
        'Sunday': { start: '00:00', end: '23:59', isOpen: true },
      }
    };
    
    if (confirm('Reset all parameters to baseline defaults? This will revert AHT, SLA, Shrinkage, and Working Days.')) {
      setChannelType(defaults.channelType);
      setAht(defaults.aht);
      setTargetSL(defaults.targetSL);
      setTargetTime(defaults.targetTime);
      setFrt(60);
      setConcurrency(defaults.concurrency);
      setTat(defaults.tat);
      setShrinkage(defaults.shrinkage);
      setWorkingDays(defaults.workingDays);
      setOperationalWindows(defaults.operationalWindows);
      setLastAppliedSettings(null);
      await saveSettings({ ...defaults, frt: 60, lastApplied: null });
      toast.success('Parameters reset to baseline');
    }
  };

  const handleAISmartFill = async () => {
    setBootstrapping(true);
    toast.info("AI is bootstrapping workforce parameters and volumes...");
    try {
      const batch = writeBatch(db);

      // 1. Seed Shift Codes if empty
      const currShiftCodes = shiftCodes || [];
      const hasOFF = currShiftCodes.some(s => s.code === 'OFF');
      if (currShiftCodes.length === 0 || !hasOFF) {
        const defaultShiftCodes = [
          { code: "L1", name: "Pagi (L1)", startTime: "07:00", endTime: "15:00", color: "#6366f1" },
          { code: "L2", name: "Siang (L2)", startTime: "09:00", endTime: "17:00", color: "#3b82f6" },
          { code: "L3", name: "Sore (L3)", startTime: "14:00", endTime: "22:00", color: "#f59e0b" },
          { code: "OFF", name: "Libur (OFF)", startTime: "00:00", endTime: "00:00", color: "#ef4444" }
        ];
        defaultShiftCodes.forEach((sc) => {
          const docRef = doc(db, 'shiftCodes', sc.code);
          batch.set(docRef, sc);
        });
      }

      // 2. Seed Employees if empty
      const currEmployees = employees || [];
      if (currEmployees.length === 0) {
        const defaultEmployees = [
          { nip: "1001", name: "Gabriel Putra", skill: "Billing", channel: "call", site: "JKT", gender: "M", religion: "Islam", role: "Agent", department: "Customer Experience", skills: ["Billing", "Call"] },
          { nip: "1002", name: "Siti Rahma", skill: "Technical", channel: "chat", site: "SBY", gender: "F", religion: "Islam", role: "Agent", department: "Technical Support", skills: ["Technical", "Chat"] },
          { nip: "1003", name: "Chandra Wijaya", skill: "General", channel: "call", site: "JKT", gender: "M", religion: "Kristen", role: "Agent", department: "Customer Experience", skills: ["General", "Call"] },
          { nip: "1004", name: "Dewi Lestari", skill: "Billing", channel: "chat", site: "JKT", gender: "F", religion: "Hindu", role: "Agent", department: "Customer Experience", skills: ["Billing", "Chat"] },
          { nip: "1005", name: "Rian Hidayat", skill: "Technical", channel: "call", site: "SBY", gender: "M", religion: "Islam", role: "Agent", department: "Technical Support", skills: ["Technical", "Call"] },
          { nip: "1006", name: "Eka Saputra", skill: "General", channel: "chat", site: "JKT", gender: "M", religion: "Islam", role: "Agent", department: "Customer Experience", skills: ["General", "Chat"] },
          { nip: "1007", name: "Indah Permata", skill: "Billing", channel: "call", site: "SBY", gender: "F", religion: "Islam", role: "Agent", department: "Customer Experience", skills: ["Billing", "Call"] },
          { nip: "1008", name: "Faisal Rahman", skill: "Technical", channel: "chat", site: "JKT", gender: "M", religion: "Islam", role: "Agent", department: "Technical Support", skills: ["Technical", "Chat"] },
          { nip: "1009", name: "Kirei Kirana", skill: "General", channel: "call", site: "JKT", gender: "F", religion: "Budha", role: "Agent", department: "Customer Experience", skills: ["General", "Call"] },
          { nip: "1010", name: "Gilang Ramadhan", skill: "Billing", channel: "chat", site: "SBY", gender: "M", religion: "Islam", role: "Agent", department: "Customer Experience", skills: ["Billing", "Chat"] },
          { nip: "1011", name: "Mega Utami", skill: "Technical", channel: "call", site: "JKT", gender: "F", religion: "Islam", role: "Agent", department: "Technical Support", skills: ["Technical", "Call"] },
          { nip: "1012", name: "Donny Pangestu", skill: "General", channel: "chat", site: "JKT", gender: "M", religion: "Kristen", role: "Agent", department: "Customer Experience", skills: ["General", "Chat"] },
          { nip: "1013", name: "Linda Kartika", skill: "Billing", channel: "call", site: "SBY", gender: "F", religion: "Islam", role: "Agent", department: "Customer Experience", skills: ["Billing", "Call"] },
          { nip: "1014", name: "Farah Nabila", skill: "Technical", channel: "chat", site: "JKT", gender: "F", religion: "Islam", role: "Agent", department: "Technical Support", skills: ["Technical", "Chat"] },
          { nip: "1015", name: "Budi Santoso", skill: "General", channel: "call", site: "SBY", gender: "M", religion: "Islam", role: "Agent", department: "Customer Experience", skills: ["General", "Call"] }
        ];
        defaultEmployees.forEach((emp) => {
          const docRef = doc(db, 'employees', emp.nip);
          batch.set(docRef, emp);
        });
      }

      // 3. Seed Working Days Reference if not exists
      const targetMonthLabel = selectedMonth || "May-26";
      const docRefWorkingDays = doc(db, 'workingDaysRef', targetMonthLabel);
      batch.set(docRefWorkingDays, { month: targetMonthLabel, workingDays: 22 });

      // 4. Generate forecast volumes for the selected month (May 2026)
      const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const daysInMonth = 31;
      const monthPrefix = "2026-05";

      const hourlyRatios: Record<string, number> = {
        "00:00 - 01:00": 0.02, "01:00 - 02:00": 0.015, "02:00 - 03:00": 0.01, "03:00 - 04:00": 0.01,
        "04:00 - 05:00": 0.012, "05:00 - 06:00": 0.015, "06:00 - 07:00": 0.025, "07:00 - 08:00": 0.04,
        "08:00 - 09:00": 0.06, "09:00 - 10:00": 0.07, "10:00 - 11:00": 0.08, "11:00 - 12:00": 0.075,
        "12:00 - 13:00": 0.065, "13:00 - 14:00": 0.07, "14:00 - 15:00": 0.075, "15:00 - 16:00": 0.07,
        "16:00 - 17:00": 0.06, "17:00 - 18:00": 0.05, "18:00 - 19:00": 0.045, "19:00 - 20:00": 0.04,
        "20:00 - 21:00": 0.035, "21:00 - 22:00": 0.03, "22:00 - 23:00": 0.025, "23:00 - 00:00": 0.02
      };

      const generatedVolumes: any[] = [];

      for (let d = 1; d <= daysInMonth; d++) {
        const dd = d < 10 ? `0${d}` : `${d}`;
        const dateStr = `${monthPrefix}-${dd}`;
        
        // Friday index offset (1st is Fri)
        const dayIdx = (d + 4) % 7;
        const dayName = dayNames[dayIdx];
        const isWeekend = dayIdx === 0 || dayIdx === 6;

        let baseVol = isWeekend ? 650 + ((d * 7) % 150) - 75 : 1200 + ((d * 5) % 300) - 150;
        
        // Multipliers
        let mult = 1.0;
        if (d >= 25 && d <= 28) mult *= 1.35; // Payday surge
        if (d === 5) mult *= 1.5; // Twin-date (05/05) surge

        const totalVolume = Math.round(baseVol * mult);
        const intervals: Record<string, number> = {};

        Object.entries(hourlyRatios).forEach(([hour, ratio]) => {
          intervals[hour] = Math.round(totalVolume * ratio);
        });

        const forecastDoc = {
          date: dateStr,
          day: dayName,
          totalVolume,
          baselineVolume: baseVol,
          eventApplied: null,
          intervals,
          metadata: {
            methodUsed: "ai-gemini-3.5",
            modeUsed: "hybrid"
          }
        };

        generatedVolumes.push(forecastDoc);
        const docRef = doc(db, 'forecastVolume', dateStr);
        batch.set(docRef, forecastDoc);
      }

      await batch.commit();
      toast.success("AI Volume & Workforce data generated! Optimizing FTE demands...");

      // Call handleCalculate directly with generated volumes to complete calculation instantly!
      await handleCalculate(generatedVolumes);

    } catch (err: any) {
      console.error(err);
      toast.error("Bootstrapping failed: " + err.message);
    } finally {
      setBootstrapping(false);
    }
  };

  const generateAIInsight = async () => {
    if (!monthlyStats || results.length === 0) return;
    setLoadingInsight(true);
    setAiInsight('');
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        throw new Error('API Key Gemini tidak ditemukan.');
      }
      const ai = new GoogleGenAI({ apiKey });
      
      const statsSummary = {
        channelType: channelType.toUpperCase(),
        totalMonthlyVolume: monthlyStats.totalVolume,
        grossFTENeeded: monthlyStats.grossFTE,
        netFloorGoal: monthlyStats.netFTE,
        effectiveCapacityFTE: monthlyStats.effectiveAvailableFTE?.toFixed(1),
        headcountGap: monthlyStats.headcountGap?.toFixed(1),
        shrinkage: shrinkage,
        busiestDay: results.reduce((prev, curr) => (curr.dayTotalHours > prev.dayTotalHours) ? curr : prev)?.date || 'N/A'
      };

      const prompt = `
        You are an elite Workforce Management (WFM) strategist.
        Analyze the following staffing calculation outcomes for this month and write a brief, highly actionable strategic executive report.
        
        DATA:
        ${JSON.stringify(statsSummary)}
        
        Write an assessment with 3 short bullet points of exact recommendations covering:
        1. Capacity Risk (analyze the headcount gap and SLA risk).
        2. Optimization Options (recommend whether to utilize shift code changes, manage shrinkage, or adjust channels).
        3. Peak Hour Management (handling high demand periods).
        
        Be brief, professional, and omit all fluff. Keep response concise, readable, structured in Markdown. Use an encouraging, executive tone.
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt
      });

      setAiInsight(response.text || '');
    } catch (err: any) {
      console.error(err);
      setAiInsight("Unable to generate AI Insight Report. Please confirm your API key configuration in Settings.");
    } finally {
      setLoadingInsight(false);
    }
  };

  useEffect(() => {
    // Removed internal listener to use props from ForecastView
  }, []);

  const handleCalculate = async (customVolumeData?: any[] | React.MouseEvent) => {
    const activeVolume = Array.isArray(customVolumeData) ? customVolumeData : volumeData;
    if (!activeVolume || activeVolume.length === 0) {
      toast.error('No volume data found. Please upload volume data first.');
      return;
    }

    setCalculating(true);
    try {
      const dailyResults: any[] = [];
      const batch = writeBatch(db);

      // 1. Forecast volume per interval
      let processedVolume = applyOperationalWindowsToVolume(activeVolume, operationalWindows);

      // SAFETY: If any day has NO intervals but has totalVolume, apply default distribution
      const DEFAULT_DIST: Record<string, number> = {
        "00:00 - 01:00": 0.02, "01:00 - 02:00": 0.015, "02:00 - 03:00": 0.01, "03:00 - 04:00": 0.01,
        "04:00 - 05:00": 0.012, "05:00 - 06:00": 0.015, "06:00 - 07:00": 0.025, "07:00 - 08:00": 0.04,
        "08:00 - 09:00": 0.06, "09:00 - 10:00": 0.07, "10:00 - 11:00": 0.08, "11:00 - 12:00": 0.075,
        "12:00 - 13:00": 0.065, "13:00 - 14:00": 0.07, "14:00 - 15:00": 0.075, "15:00 - 16:00": 0.07,
        "16:00 - 17:00": 0.06, "17:00 - 18:00": 0.05, "18:00 - 19:00": 0.045, "19:00 - 20:00": 0.04,
        "20:00 - 21:00": 0.035, "21:00 - 22:00": 0.03, "22:00 - 23:00": 0.025, "23:00 - 00:00": 0.02
      };

      processedVolume = processedVolume.map(day => {
        if (day.totalVolume > 0 && (!day.intervals || Object.keys(day.intervals).length === 0)) {
          const newIntervals: Record<string, number> = {};
          Object.entries(DEFAULT_DIST).forEach(([int, ratio]) => {
            newIntervals[int] = Math.round(day.totalVolume * ratio);
          });
          return { ...day, intervals: newIntervals };
        }
        return day;
      });

      // 2. Aggregate monthly stats
      let totalMonthlyVolume = 0;
      processedVolume.forEach(day => {
        Object.values(day.intervals).forEach(vol => {
          totalMonthlyVolume += (Number(vol) || 0);
        });
      });

      // Track shifts that start today and cross midnight into tomorrow
      // Initialize with carry-over from legacyRoster for the first day
      let yesterdayShiftsSug: Record<string, number> = {};
      if (processedVolume.length > 0 && legacyRoster) {
        const firstDay = processedVolume[0].date;
        const prevDay = new Date(firstDay);
        prevDay.setDate(prevDay.getDate() - 1);
        const prevDayStr = prevDay.toISOString().split('T')[0];
        
        shiftCodes.forEach(sc => {
          let count = 0;
          Object.values(legacyRoster).forEach(empDays => {
            if (empDays[prevDayStr] === sc.code) count++;
          });
          if (count > 0) yesterdayShiftsSug[sc.code] = count;
        });
      }

      processedVolume.forEach((data) => {
        const intervalNeeds: Record<string, number> = {};
        const allIntervalKeys = Object.keys(data.intervals).sort();
        
        let dayPeak = 0;
        let dayTotalDemandHours = 0;

        Object.entries(data.intervals).forEach(([interval, effectiveVolume]) => {
          const v = Number(effectiveVolume) || 0;
          const duration = getIntervalDuration(interval, allIntervalKeys);
          
          let res: ErlangResult;
          if (channelType === 'chat' || channelType === 'whatsapp' || channelType === 'multiskill_chat_wa') {
            // Using FRT for Chat/Whatsapp
            res = calculateRequiredAgentsChat(v, aht, targetSL / 100, frt, concurrency, duration);
          } else if (channelType === 'email') {
            // Using TAT for Email
            res = calculateRequiredAgentsEmail(v, aht, targetSL / 100, tat, duration);
          } else {
            // Using Standard Service Time for Call
            res = calculateRequiredAgents(v, aht, targetSL / 100, targetTime, duration);
          }

          // Use standard WFM shrinkage formula: Gross = Net / (1 - Shrinkage)
          const shrinkageFactor = shrinkage / 100;
          const grossNeeded = shrinkageFactor >= 1 ? res.agents : Math.ceil(res.agents / (1 - shrinkageFactor));
          
          intervalNeeds[interval] = Math.max(0, grossNeeded);
          // Demand hours = Gross agents * Duration
          dayTotalDemandHours += grossNeeded * duration;
          if (grossNeeded > dayPeak) dayPeak = grossNeeded;
        });

        // 6. Map interval requirement into shift coverage
        const currentExtraHours = isAgreedToManpowerAdjustments ? extraHours : 0;
        const currentAssigned: Record<string, number> = {};
        Object.keys(intervalNeeds).forEach(interval => {
          let supplyFromYesterday = 0;
          Object.entries(yesterdayShiftsSug).forEach(([code, count]) => {
            const sc = shiftCodes.find(c => c.code === code);
            if (sc && isIntervalAffectedByShift(interval, sc.startTime, sc.endTime, currentExtraHours, 1)) {
              supplyFromYesterday += count;
            }
          });
          currentAssigned[interval] = supplyFromYesterday;
        });

        const dayConfig = matchDayName(data.day, operationalWindows, data.date);
        const isDayOpen = dayConfig ? dayConfig.isOpen : true;
        const shiftSuggestions: Record<string, number> = {};
        shiftCodes.forEach(c => shiftSuggestions[c.code] = 0);

        const shiftLength = 8 + currentExtraHours;

        if (shiftCodes.length > 0 && isDayOpen) {
          // Total shifts to start today to satisfy remaining demand
          const startsNeeded = Math.ceil(dayTotalDemandHours / shiftLength);
          
          let assignedCount = 0;
          while (assignedCount < startsNeeded) {
            let bestShift = null;
            let maxScore = -Infinity;

            for (const code of shiftCodes) {
              let score = 0;
              Object.keys(intervalNeeds).forEach(interval => {
                if (isIntervalAffectedByShift(interval, code.startTime, code.endTime, currentExtraHours, 0)) {
                  const gap = intervalNeeds[interval] - currentAssigned[interval];
                  let isOpWindow = true;
                  if (dayConfig) isOpWindow = isIntervalInWindow(interval, dayConfig.start, dayConfig.end);

                  if (!isOpWindow) score -= 10000;
                  else if (gap > 0) score += Math.min(gap, 1) * 2000 + Math.max(0, gap - 1) * 500;
                  else score -= (Math.abs(gap) + 1) * 10;
                }
              });

              score -= (shiftSuggestions[code.code] || 0) * 100;
              if (score > maxScore) { maxScore = score; bestShift = code; }
            }

            if (bestShift) {
              shiftSuggestions[bestShift.code]++;
              Object.keys(intervalNeeds).forEach(interval => {
                if (isIntervalAffectedByShift(interval, bestShift!.startTime, bestShift!.endTime, currentExtraHours, 0)) {
                   currentAssigned[interval]++;
                }
              });
              assignedCount++;
            } else break;
          }
        }

        const shiftCoverage: Record<string, number> = {};
        shiftCodes.forEach(code => {
          let count = shiftSuggestions[code.code] || 0;
          const [sH] = code.startTime.split(':').map(Number);
          const [eH] = code.endTime.split(':').map(Number);
          let duration = (eH - sH + 24) % 24;
          if (duration === 0 && code.startTime !== code.endTime) duration = 24;
          if (sH + duration + currentExtraHours > 24) {
             count += yesterdayShiftsSug[code.code] || 0;
          }
          shiftCoverage[code.code] = count;
        });

        // Save for tomorrow's carry-over
        const yesterdaySugCopy = { ...shiftSuggestions };

        const resultItem = {
          date: data.date,
          day: data.day,
          totalAgents: Math.ceil(Object.values(shiftSuggestions).reduce((a: number, b: number) => a + b, 0)),
          activeCoverage: Math.ceil(Object.values(shiftCoverage).reduce((a: number, b: number) => a + b, 0)),
          peakAgents: Math.ceil(dayPeak),
          dayTotalHours: dayTotalDemandHours,
          intervalNeeds,
          shiftSuggestions,
          shiftCoverage,
          intervalSupply: { ...currentAssigned }
        };

        dailyResults.push(resultItem);
        const docRef = doc(db, 'erlangResults', data.date);
        batch.set(docRef, resultItem);
        
        yesterdayShiftsSug = yesterdaySugCopy;
      });

      await batch.commit();
      
      const applied = { 
        channelType, aht, targetSL, targetTime, frt, concurrency, tat, 
        targetShrinkage: shrinkage, operationalWindows,
        calculatedAt: new Date().toISOString()
      };
      await setDoc(doc(db, 'erlangSettings', 'lastApplied'), applied);
      setLastAppliedSettings(applied);
      toast.success("Staffing calculated successfully using Erlang C approach!");
    } catch (error: any) {
      console.error("Calculation error:", error);
      toast.error("Failed to calculate staffing: " + error.message);
    } finally {
      setCalculating(false);
    }
  };

  // Helper to check if an interval falls within a shift
  function isIntervalInShift(interval: string, shiftStart: string, shiftEnd: string, extra: number = 0): boolean {
    try {
      const [intStartStr] = interval.split(' - ');
      const [intH] = intStartStr.split(':').map(Number);
      const [startH] = shiftStart.split(':').map(Number);
      const [endH] = shiftEnd.split(':').map(Number);

      let duration = (endH - startH + 24) % 24;
      if (duration === 0 && shiftStart !== shiftEnd) duration = 24;
      
      const effectiveDuration = duration + extra;
      const diff = (intH - startH + 24) % 24;
      
      return diff < effectiveDuration;
    } catch (e) {
      return false;
    }
  }

  // Enhanced helper for split day coverage tracking
  function isIntervalAffectedByShift(interval: string, shiftStart: string, shiftEnd: string, extraHours: number, dayOffset: number): boolean {
    try {
      const [intStartStr] = interval.split(' - ');
      const [h] = intStartStr.split(':').map(Number);
      const [sH] = shiftStart.split(':').map(Number);
      const [eH] = shiftEnd.split(':').map(Number);
      
      let duration = (eH - sH + 24) % 24;
      if (duration === 0 && shiftStart !== shiftEnd) duration = 24;
      const totalDuration = duration + extraHours;
      
      const diff = (h - sH + 24) % 24;
      if (dayOffset === 0) {
        // Shift starts today. It covers if current hour >= start hour
        return diff < totalDuration && h >= sH;
      } else if (dayOffset === 1) {
        // Shift started yesterday. It covers if current hour < start hour
        return diff < totalDuration && h < sH;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  const handleDownloadTemplate = () => {
    if (results.length === 0) {
      toast.error("No results to export. Please calculate first.");
      return;
    }

    const workbook = XLSX.utils.book_new();
    
    // 1. Summary Sheet
    const summaryData = [
      ["WFM STAFFING REPORT SUMMARY"],
      ["Calculated on:", new Date().toLocaleString()],
      ["Channel Type:", channelType.toUpperCase()],
      ["Parameters:", `AHT: ${aht}s | Target SL: ${targetSL}% | Shrinkage: ${shrinkage}%`],
      [""],
      ["METRIC", "VALUE", "DESCRIPTION"],
      ["Gross FTE Needed", monthlyStats?.grossFTE, "Total headcount required including shrinkage"],
      ["Net Production FTE", monthlyStats?.netFTE, "Required agents on floor (productive)"],
      ["Avg Daily Supply", monthlyStats?.avgDailyHeadcount, "Average agents needed per day to meet peaks"],
      ["Total Workload (Hours)", Math.round(monthlyStats?.totalWorkHours || 0), "Total labor hours for the month"],
      ["Monthly Volume", monthlyStats?.totalVolume, "Total interaction volume (forecasted)"],
      [""],
      ["Note:", "Gross FTE includes a calculation buffer for shrinkage. This file contains precise daily and interval-level needs."]
    ];
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
    wsSummary['!cols'] = [{ wch: 25 }, { wch: 15 }, { wch: 50 }];
    XLSX.utils.book_append_sheet(workbook, wsSummary, "Results Summary");

    // 2. Daily Detailed Stats
    const dailyHeaders = ["Date", "Day", "Forecast Volume", "Headcount Needed (Total)", "Peak Concurrency", "Total Staffing Hours"];
    const dailyRows = results.map(res => {
      const vol = volumeData.find(v => v.date === res.date)?.totalVolume || 0;
      return [
        res.date,
        res.day,
        vol,
        res.totalAgents,
        res.peakAgents,
        Math.round(res.dayTotalHours || 0)
      ];
    });
    const wsDaily = XLSX.utils.aoa_to_sheet([dailyHeaders, ...dailyRows]);
    wsDaily['!cols'] = [{ wch: 15 }, { wch: 12 }, { wch: 15 }, { wch: 20 }, { wch: 18 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(workbook, wsDaily, "Daily Detail");

    // 3. Shift Distribution
    const shiftHeaders = ["Shift Code", "Time Range", ...results.map(r => r.date)];
    const shiftRows = shiftCodes.map(code => {
      const row = [code.code, `${code.startTime} - ${code.endTime}`];
      results.forEach(res => {
        row.push(res.shiftSuggestions[code.code] || 0);
      });
      return row;
    });
    const totalRow = ["TOTAL AGENTS", "", ...results.map(r => r.totalAgents)];
    const wsShifts = XLSX.utils.aoa_to_sheet([shiftHeaders, ...shiftRows, totalRow]);
    XLSX.utils.book_append_sheet(workbook, wsShifts, "Shift Distribution");

    // 4. Interval Coverage Analysis
    // Get all unique intervals from the first day (assuming same for all)
    const allIntervals = Object.keys(results[0].intervalNeeds).sort((a,b) => {
      const hA = parseInt(a.split(':')[0]);
      const hB = parseInt(b.split(':')[0]);
      return hA - hB;
    });

    // Create a matrix: Interval, Date1 Demand, Date1 Supply, Date2 Demand, Date2 Supply...
    const coverageHeaderTop = ["Interval"];
    const coverageHeaderSub = [""];
    results.forEach(res => {
      coverageHeaderTop.push(res.date, "");
      coverageHeaderSub.push("Demand (Req)", "Supply (Allocated)");
    });

    const coverageRows = allIntervals.map(interval => {
      const row = [interval];
      results.forEach(res => {
        row.push(res.intervalNeeds[interval] || 0);
        row.push(res.intervalSupply[interval] || 0);
      });
      return row;
    });

    const wsCoverage = XLSX.utils.aoa_to_sheet([coverageHeaderTop, coverageHeaderSub, ...coverageRows]);
    XLSX.utils.book_append_sheet(workbook, wsCoverage, "Interval Analysis");

    XLSX.writeFile(workbook, `WFM_Full_Staffing_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
    toast.success("Full Staffing Report exported!");
  };

  const intervalNeedsChartData = useMemo(() => {
    if (results.length === 0) return [];
    
    // Get all unique intervals
    const allIntervals = Array.from(new Set(results.flatMap(r => Object.keys(r.intervalNeeds || {})))).sort((a: string, b: string) => {
      const timeA = a.split(' - ')[0] || a;
      const timeB = b.split(' - ')[0] || b;
      return timeA.localeCompare(timeB);
    }) as string[];

    return allIntervals.map(interval => {
      let totalNeeded = 0;
      let dayCount = 0;
      results.forEach(res => {
        if (res.intervalNeeds && res.intervalNeeds[interval] !== undefined) {
          totalNeeded += res.intervalNeeds[interval];
          dayCount++;
        }
      });
      return {
        interval,
        avgNeeded: dayCount > 0 ? Number((totalNeeded / dayCount).toFixed(1)) : 0,
        peakNeeded: Math.max(...results.map(r => r.intervalNeeds?.[interval] || 0))
      };
    });
  }, [results]);

  const dailyStaffingStats = useMemo(() => {
    if (results.length === 0) return [];
    
    // Simulation factors
    const totalDays = results.length;
    // We already use (8 + extraHours) when calculating requirement (startsNeeded).
    // So for physical headcount comparison, we use baseAvailable directly.
    const capacityMultiplier = 1; 
    const extraWorkingDaysPerPeriod = isAgreedToManpowerAdjustments ? extraWorkingDays : 0;
    const totalWorkingDaysPerAgent = (workingDays || 0) + extraWorkingDaysPerPeriod;

    return results.map(res => {
      // Count agents starting on this day from legacyRoster or roster array
      let agentsScheduledToStart = 0;
      if (legacyRoster) {
        Object.values(legacyRoster).forEach(empDays => {
          const shiftCode = empDays[res.date];
          if (shiftCode && shiftCode !== 'OFF' && !['L', 'AL', 'UL', 'SL', 'ML', 'PL'].includes(shiftCode)) {
            agentsScheduledToStart++;
          }
        });
      }
      
      if (roster && Array.isArray(roster)) {
        roster.forEach(empRoster => {
          const shiftCode = empRoster.schedule?.[res.date];
          if (shiftCode && shiftCode !== 'OFF' && !['L', 'AL', 'UL', 'SL', 'ML', 'PL'].includes(shiftCode)) {
            agentsScheduledToStart++;
          }
        });
      }

      // Base daily supply = (Total Agents * Total Working Days) / Period Days
      // This represents the average number of agents available per day
      const avgDailySupply = totalDays > 0 ? (employees.length * totalWorkingDaysPerAgent) / totalDays : 0;
      
      // If we have actual roster data, use it; otherwise fallback to the calculated average
      const baseAvailable = agentsScheduledToStart > 0 ? agentsScheduledToStart : avgDailySupply;
      
      // Effective available takes into account extra hours productivity (capacity multiplier)
      const effectiveAvailable = baseAvailable * capacityMultiplier;
      const required = res.totalAgents; 
      const gap = effectiveAvailable - required;

      return {
        date: res.date,
        day: res.day,
        required,
        available: Number(effectiveAvailable.toFixed(1)),
        gap: Number(gap.toFixed(1)),
        isShortage: gap < 0
      };
    });
  }, [results, roster, legacyRoster, employees.length, isAgreedToManpowerAdjustments, extraWorkingDays, extraHours, workingDays]);

  const monthlyStats = useMemo(() => {
    if (results.length === 0) return null;
    
    const totalVolume = volumeData.reduce((acc, d) => acc + d.totalVolume, 0);
    const totalStaffingHours = results.reduce((acc, r) => acc + (r.dayTotalHours || 0), 0);
    
    // Calculate FTE needed using reference data if available
    const totalDaysInPeriod = volumeData.length;
    const shiftLength = 8;
    // Use the state variables extraWorkingDays and extraHours directly
    
    // Roster Availability Factor Layer:
    // User can manually set workingDays, otherwise use prop or calculate based on 5/7 ratio
    const baseWorkingDays = workingDays || workingDaysRef?.workingDays || 22;
    const currentWorkingDaysPerAgent = baseWorkingDays; // Removed scaling to ensure alignment with user mental model
    const availabilityFactor = currentWorkingDaysPerAgent / totalDaysInPeriod;
    const rosterMultiplier = 1 / (availabilityFactor || 1);

    // Calculate Effective Available Capacity (FTE)
    const totalCapacityHours = employees.reduce((sum, emp) => {
      const adjustmentMultiplier = isAgreedToManpowerAdjustments ? 1 : 0;
      const empExtraDays = (emp.extraWorkingDays !== undefined ? emp.extraWorkingDays : extraWorkingDays) * adjustmentMultiplier;
      const empExtraHours = (emp.extraHours !== undefined ? emp.extraHours : extraHours) * adjustmentMultiplier;
      
      const empLeaveDays = leaveRequests.filter(req => 
        req.employeeId === emp.id && 
        req.status === 'approved' && 
        volumeData.some(d => d.date === req.date)
      ).length;

      return sum + ((currentWorkingDaysPerAgent + empExtraDays - empLeaveDays) * (shiftLength + empExtraHours));
    }, 0);

    const monthlyStandardHoursPerPerson = shiftLength * currentWorkingDaysPerAgent;
    const physicalHeadcount = employees.length;
    const effectiveAvailableFTE = (totalCapacityHours / monthlyStandardHoursPerPerson);
    
    // Step 1: Average Daily Net Requirements (Agents needed in seats)
    const avgDailyNetNeeded = results.reduce((acc, r) => {
      // We need to re-calculate net from intervalNeeds if totalAgents is gross
      // Or better, use a more direct way if possible.
      // In handleCalculate, intervalNeeds already includes shrinkage.
      // So let's sum up the raw net agents from interval data if available, 
      // but results only stores intervalNeeds (gross).
      // Let's assume totalAgents is Gross (as calculated in handleCalculate).
      return acc + (r.totalAgents || 0);
    }, 0) / (results.length || 1);
    
    // Actually, totalAgents in results is already GROSS (it used grossNeeded at line 281).
    // So avgDailyOnFloorNeeds (Gross Agents to Schedule) is this value.
    const avgDailyGrossScheduled = avgDailyNetNeeded;
    
    // Total Pool Needed = Gross Daily * (Period Days / Working Days)
    const grossFTEValue = avgDailyGrossScheduled * rosterMultiplier;
    
    // Net daily floor goal (Optional for display: Gross * (1-Shrinkage))
    const shrinkageFactor = shrinkage / 100;
    const avgDailyNetFloorGoal = avgDailyGrossScheduled * (1 - shrinkageFactor);

    // Average Daily Supply = Total Net Working Days / Total Period Days
    const totalWorkingDaysAll = employees.reduce((sum, emp) => {
      const adjustmentMultiplier = isAgreedToManpowerAdjustments ? 1 : 0;
      const empExtraDays = (emp.extraWorkingDays !== undefined ? emp.extraWorkingDays : extraWorkingDays) * adjustmentMultiplier;
      
      const empLeaveDays = leaveRequests.filter(req => 
        req.employeeId === emp.id && 
        req.status === 'approved' && 
        volumeData.some(d => d.date === req.date)
      ).length;

      return sum + (currentWorkingDaysPerAgent + empExtraDays - empLeaveDays);
    }, 0);
    const avgDailySupply = totalWorkingDaysAll / totalDaysInPeriod;

    return {
      totalVolume,
      totalWorkHours: totalStaffingHours,
      avgDailyOnFloorNeeds: avgDailyNetFloorGoal, // This is what's displayed as "Daily Floor Goal"
      netFTE: Math.ceil(avgDailyNetFloorGoal),
      grossFTE: Math.ceil(grossFTEValue),
      avgDailyHeadcount: Math.ceil(avgDailyGrossScheduled), // This is "Daily Scheduling Target"
      avgDailySupply,
      headcountGap: effectiveAvailableFTE - grossFTEValue,
      shrinkageOverhead: Math.ceil(grossFTEValue - (avgDailyGrossScheduled * rosterMultiplier * (1 - shrinkageFactor))), // approx
      rosterMultiplier: rosterMultiplier.toFixed(2),
      avgWorkingDaysPerAgent: currentWorkingDaysPerAgent,
      totalDaysInPeriod,
      effectiveAvailableFTE,
      physicalHeadcount
    };
  }, [results, volumeData, shrinkage, employees.length, workingDaysRef, initialSettings, extraWorkingDays, extraHours, isAgreedToManpowerAdjustments]);

  return (
    <div className="space-y-6">

      {/* AGREEMENT CONSOLE */}
      <Card className="border-2 border-slate-100 shadow-sm bg-white overflow-hidden rounded-2xl relative group">
         <CardContent className="p-3 relative z-10 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3">
               <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${isAgreedToManpowerAdjustments ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100' : 'bg-slate-100 text-slate-400'}`}>
                  <ClipboardCheck className="w-4 h-4" />
               </div>
               <div className="flex flex-col">
                  <h3 className="text-[10px] font-black text-slate-800 uppercase tracking-tight">Simulasi Adjustment</h3>
                  <p className="text-[7px] text-slate-500 font-bold uppercase tracking-widest leading-none">Berlakukan extra jam/hari kerja</p>
               </div>
            </div>

            <div className="flex items-center gap-4">
               <div className={`flex items-center gap-3 transition-all duration-300 ${!isAgreedToManpowerAdjustments ? 'opacity-30 blur-[0.5px] pointer-events-none' : 'opacity-100'}`}>
                  <div className="flex items-center gap-2">
                    <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">+D</span>
                    <Input 
                      type="number"
                      min="0"
                      max={Math.max(0, volumeData.length - workingDays)}
                      value={extraWorkingDays}
                      onChange={(e) => handleExtraDaysChange(Number(e.target.value))}
                      className="w-12 h-7 bg-white border border-slate-200 rounded-md text-center text-[10px] font-black text-slate-800 p-0"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest">+H</span>
                    <Input 
                      type="number"
                      min="0"
                      max="12"
                      value={extraHours}
                      onChange={(e) => handleExtraHoursChange(Number(e.target.value))}
                      className="w-12 h-7 bg-white border border-slate-200 rounded-md text-center text-[10px] font-black text-slate-800 p-0"
                    />
                  </div>
               </div>

               <div className="flex items-center bg-slate-50 p-0.5 rounded-lg border border-slate-200 shadow-sm gap-0.5">
                  <button 
                    onClick={() => handleAgreementToggle(false)}
                    className={`px-3 py-1 text-[8px] font-black rounded-md transition-all ${!isAgreedToManpowerAdjustments ? 'bg-rose-500 text-white shadow-md' : 'text-slate-400 hover:bg-slate-100'}`}
                  >
                    OFF
                  </button>
                  <button 
                    onClick={() => handleAgreementToggle(true)}
                    className={`px-3 py-1 text-[8px] font-black rounded-md transition-all ${isAgreedToManpowerAdjustments ? 'bg-emerald-500 text-white shadow-md' : 'text-slate-400 hover:bg-slate-100'}`}
                  >
                    ON
                  </button>
               </div>
            </div>
         </CardContent>
      </Card>

      {/* COMPACT PARAMETERS BAR */}
      <Card className="border-none shadow-sm bg-white overflow-hidden rounded-2xl border border-slate-100">
        <div className="flex flex-col lg:flex-row divide-y lg:divide-y-0 lg:divide-x divide-slate-100">
          {/* Header/Action Area */}
          <div className="p-4 flex items-center justify-between lg:w-48 bg-slate-50/50 shrink-0">
            <div className="flex flex-col">
              <span className="text-[10px] font-black uppercase text-indigo-600 tracking-tight flex items-center gap-1.5">
                <Calculator className="w-3.5 h-3.5" />
                Parameters
              </span>
              <span className="text-[8px] font-bold text-slate-400 uppercase tracking-widest">Erlang Configuration</span>
            </div>
            <div className="flex gap-1 lg:hidden">
              <Button size="sm" onClick={handleCalculate} disabled={volumeData.length === 0 || calculating} className="h-7 px-3 text-[9px] font-black uppercase bg-indigo-600 hover:bg-indigo-700">
                {calculating ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3 fill-white" />}
                <span className="ml-1">Analyze</span>
              </Button>
            </div>
          </div>

          {/* Inputs Scrollable Area */}
          <div className="flex-1 overflow-x-auto">
            <div className="flex items-center p-3 gap-6 min-w-max">
              <div className="space-y-1">
                <label className="text-[8px] font-black uppercase text-slate-400 tracking-wider block">Channel</label>
                <Select value={channelType} onValueChange={(val: any) => {
                  setChannelType(val);
                  saveSettings({ channelType: val });
                }}>
                  <SelectTrigger className="w-32 bg-white border-slate-200 h-7 text-[10px] py-0 px-2 rounded-lg">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="call" className="text-[10px] font-bold uppercase">Call</SelectItem>
                    <SelectItem value="chat" className="text-[10px] font-bold uppercase">Chat</SelectItem>
                    <SelectItem value="whatsapp" className="text-[10px] font-bold uppercase">WhatsApp</SelectItem>
                    <SelectItem value="multiskill_chat_wa" className="text-[10px] font-bold uppercase">Multi</SelectItem>
                    <SelectItem value="email" className="text-[10px] font-bold uppercase">Email</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <label className="text-[8px] font-black uppercase text-slate-400 tracking-wider block">AHT (S)</label>
                <Input type="number" className="w-16 bg-white border-slate-200 h-7 text-[10px] p-1 rounded-lg text-center" value={aht || 0} onChange={e => {
                  const val = Number(e.target.value);
                  setAht(val);
                  saveSettings({ aht: val });
                }} />
              </div>

              <div className="space-y-1">
                <label className="text-[8px] font-black uppercase text-slate-400 tracking-wider block">SL (%)</label>
                <Input type="number" className="w-14 bg-white border-slate-200 h-7 text-[10px] p-1 rounded-lg text-center" value={targetSL || 0} onChange={e => {
                  const val = Number(e.target.value);
                  setTargetSL(val);
                  saveSettings({ targetSL: val });
                }} />
              </div>

              {channelType === 'call' && (
                <div className="space-y-1">
                  <label className="text-[8px] font-black uppercase text-slate-400 tracking-wider block">Target (S)</label>
                  <Input type="number" className="w-14 bg-white border-slate-200 h-7 text-[10px] p-1 rounded-lg text-center" value={targetTime || 0} onChange={e => {
                    const val = Number(e.target.value);
                    setTargetTime(val);
                    saveSettings({ targetTime: val });
                  }} />
                </div>
              )}

              {(channelType === 'chat' || channelType === 'whatsapp' || channelType === 'multiskill_chat_wa') && (
                <div className="space-y-1">
                  <label className="text-[8px] font-black uppercase text-indigo-600 tracking-wider block">FRT (S)</label>
                  <Input type="number" className="w-14 bg-white border-indigo-100 h-7 text-[10px] p-1 rounded-lg text-center text-indigo-600 font-bold" value={frt || 0} onChange={e => {
                    const val = Number(e.target.value);
                    setFrt(val);
                    saveSettings({ frt: val });
                  }} />
                </div>
              )}

              {channelType === 'email' && (
                <div className="space-y-1">
                  <label className="text-[8px] font-black uppercase text-amber-600 tracking-wider block">TAT (S)</label>
                  <Input type="number" className="w-20 bg-white border-amber-100 h-7 text-[10px] p-1 rounded-lg text-center text-amber-600 font-bold" value={tat || 0} onChange={e => {
                    const val = Number(e.target.value);
                    setTat(val);
                    saveSettings({ tat: val });
                  }} />
                </div>
              )}

              {(channelType === 'chat' || channelType === 'whatsapp' || channelType === 'multiskill_chat_wa') && (
                <div className="space-y-1">
                  <label className="text-[8px] font-black uppercase text-slate-400 tracking-wider block">Conc</label>
                  <Input type="number" className="w-14 bg-white border-slate-200 h-7 text-[10px] p-1 rounded-lg text-center" value={concurrency || 0} onChange={e => {
                    const val = Number(e.target.value);
                    setConcurrency(val);
                    saveSettings({ concurrency: val });
                  }} />
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[8px] font-black uppercase text-slate-400 tracking-wider block">Shrink (%)</label>
                <Input type="number" className="w-14 bg-white border-slate-200 h-7 text-[10px] p-1 rounded-lg text-center" value={shrinkage || 0} onChange={e => {
                  const val = Number(e.target.value);
                  setShrinkage(val);
                  saveSettings({ shrinkage: val });
                }} />
              </div>

              <div className="space-y-1">
                <label className="text-[8px] font-black uppercase text-slate-400 tracking-wider block">Work Days</label>
                <Input type="number" className="w-14 bg-white border-slate-200 h-7 text-[10px] p-1 rounded-lg text-center" 
                  min="0"
                  max={volumeData.length}
                  value={workingDays || 0} 
                  onChange={e => handleWorkingDaysChange(Number(e.target.value))} 
                />
              </div>
            </div>
          </div>

          {/* Action Desktop */}
          <div className="hidden lg:flex items-center px-4 gap-2 bg-slate-50/30 shrink-0">
             <Button 
                className="bg-indigo-600 hover:bg-indigo-700 h-9 text-[10px] font-black uppercase tracking-widest rounded-xl shadow-lg shadow-indigo-100 px-6"
                onClick={handleCalculate}
                disabled={volumeData.length === 0 || calculating}
              >
                {calculating ? <RefreshCw className="w-3.5 h-3.5 animate-spin mr-2" /> : <Zap className="w-3.5 h-3.5 fill-white mr-2" />}
                Analyze
              </Button>
              <Button 
                variant="ghost" 
                className="h-9 w-9 p-0 hover:bg-slate-100 text-slate-400 rounded-xl"
                onClick={handleReset}
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        {monthlyStats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* TARGET OUTPUT COMPACT */}
            <Card className="border-none shadow-sm bg-indigo-600 text-white overflow-hidden relative min-h-[140px] flex flex-col justify-between">
              <div className="absolute top-0 right-0 p-2 opacity-5 translate-x-4 -translate-y-4">
                <Users className="w-24 h-24" />
              </div>
              <div className="p-4 relative z-10">
                <div className="flex items-center justify-between mb-2">
                  <Badge className="bg-white/10 text-white border-white/20 text-[8px] font-black uppercase px-2 py-0 border">Output</Badge>
                  <Button size="icon" variant="ghost" className="h-6 w-6 text-white/50 hover:text-white" onClick={handleDownloadTemplate}><Download className="w-3 h-3" /></Button>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] font-bold text-indigo-200/80 uppercase tracking-widest">Total Pool (Gross FTE)</span>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-4xl font-black tracking-tight">{monthlyStats.grossFTE}</span>
                    <span className="text-sm font-bold text-indigo-300/60 uppercase">Agents</span>
                  </div>
                </div>
              </div>
              <div className="bg-indigo-700/50 p-2 flex items-center justify-around">
                <div className="text-center">
                  <p className="text-[7px] font-bold uppercase text-indigo-200/60">Floor Goal (Net)</p>
                  <p className="text-[10px] font-black">{monthlyStats.netFTE}</p>
                </div>
                <div className="w-px h-4 bg-white/10" />
                <div className="text-center">
                  <p className="text-[7px] font-bold uppercase text-indigo-200/60">Shrinkage</p>
                  <p className="text-[10px] font-black">+{monthlyStats.shrinkageOverhead}</p>
                </div>
                <div className="w-px h-4 bg-white/10" />
                <div className="text-center">
                  <p className="text-[7px] font-bold uppercase text-indigo-200/60">Daily Supply</p>
                  <p className="text-[10px] font-black">{monthlyStats.avgDailySupply.toFixed(1)}</p>
                </div>
                <div className="w-px h-4 bg-white/10" />
                <div className="text-center">
                  <p className="text-[7px] font-bold uppercase text-indigo-200/60">Schedule Target</p>
                  <p className="text-[10px] font-black">{monthlyStats.avgDailyHeadcount}</p>
                </div>
              </div>
            </Card>

            {/* WORKLOAD COMPACT */}
            <Card className="border-none shadow-sm bg-white overflow-hidden border border-slate-100 min-h-[140px] flex flex-col justify-between">
              <div className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <Badge variant="outline" className="text-[8px] font-black uppercase text-slate-400 border-slate-200 px-2 py-0">Workload</Badge>
                  <TrendingUp className="w-3.5 h-3.5 text-blue-500" />
                </div>
                <div className="space-y-3">
                  <div>
                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest leading-none">Monthly Volume</p>
                    <p className="text-xl font-black text-slate-800 tracking-tight mt-1">{monthlyStats.totalVolume.toLocaleString()}</p>
                  </div>
                  <div className="h-px bg-slate-50 w-full" />
                  <div>
                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-widest leading-none">Total Work Hours</p>
                    <p className="text-xl font-black text-slate-800 tracking-tight mt-1">{Math.round(monthlyStats.totalWorkHours).toLocaleString()}h</p>
                  </div>
                </div>
              </div>
            </Card>

            {/* CAPACITY PLANNING COMPACT */}
            <Card className={`border-none shadow-sm md:col-span-2 overflow-hidden border flex flex-col justify-between min-h-[140px] ${monthlyStats.headcountGap < 0 ? 'bg-rose-50/30 border-rose-100' : 'bg-emerald-50/30 border-emerald-100'}`}>
              <div className="p-4 flex-1">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={`text-[8px] font-black uppercase px-2 py-0 ${monthlyStats.headcountGap < 0 ? 'border-amber-200 text-amber-600' : 'border-emerald-200 text-emerald-600'}`}>Capacity</Badge>
                    <span className={`text-[8px] font-black uppercase tracking-widest ${monthlyStats.headcountGap < 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                      {monthlyStats.headcountGap < 0 ? 'Optimization Needed' : 'Healthy Balance'}
                    </span>
                  </div>
                  <Users className={`w-4 h-4 ${monthlyStats.headcountGap < 0 ? 'text-amber-500' : 'text-emerald-500'}`} />
                </div>

                <div className="flex items-center justify-between gap-6 pb-2">
                   <div className="flex flex-col">
                      <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Recommendation</span>
                      <span className={`text-4xl font-black tracking-tighter ${monthlyStats.headcountGap < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                        {monthlyStats.headcountGap > 0 ? '+' : ''}{monthlyStats.headcountGap.toFixed(1)}
                      </span>
                   </div>
                   <div className="flex-1 space-y-1.5">
                      <div className="flex justify-between items-end">
                         <span className="text-[8px] font-black text-slate-500 uppercase">Effective Capacity</span>
                         <span className="text-[10px] font-black text-slate-800">{monthlyStats.effectiveAvailableFTE.toFixed(1)} / {monthlyStats.grossFTE} FTE</span>
                      </div>
                      <div className="h-2 w-full bg-slate-200 rounded-full overflow-hidden flex shadow-inner">
                        <div 
                          className={`h-full transition-all duration-1000 ${monthlyStats.headcountGap < 0 ? 'bg-rose-500' : 'bg-emerald-500'}`} 
                          style={{ width: `${Math.min(100, (monthlyStats.effectiveAvailableFTE / monthlyStats.grossFTE) * 100)}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                         <span className="text-[7px] font-bold text-slate-400 italic">Target based on {shrinkage}% Shrinkage</span>
                         <div className="flex items-center gap-1">
                            <span className="text-[7px] font-bold text-slate-400 uppercase">Staff vs Target:</span>
                            <span className={`text-[8px] font-black ${monthlyStats.headcountGap < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                               {monthlyStats.physicalHeadcount} vs {monthlyStats.grossFTE}
                            </span>
                         </div>
                      </div>
                   </div>
                </div>
              </div>
              
              {monthlyStats.headcountGap < 0 && (
                <div className="bg-rose-600 px-4 py-1.5 flex items-center justify-between text-white animate-pulse">
                  <span className="text-[9px] font-black uppercase tracking-tight">Requirement Gap Detected</span>
                  <div className="flex items-center gap-4">
                    <span className="text-[8px] font-bold opacity-80 uppercase tracking-widest">Action: Increase working hours/days in console above</span>
                    <AlertCircle className="w-3 h-3" />
                  </div>
                </div>
              )}
            </Card>
          </div>
        )}

        <div className="space-y-4">
          {results.length > 0 && (
            <Card className="border border-indigo-100 shadow-sm overflow-hidden bg-gradient-to-r from-indigo-50/20 to-blue-50/20 rounded-2xl relative">
              <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
                <Brain className="w-16 h-16 text-indigo-600" />
              </div>
              <CardContent className="p-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-md">
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-xs font-black text-slate-900 uppercase tracking-tight">AI Workforce Optimization Coaching</h3>
                      <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest leading-none mt-1">Instant Gemini Intelligent Strategic Assessment</p>
                    </div>
                  </div>
                  <Button 
                    size="sm" 
                    variant="outline" 
                    onClick={generateAIInsight}
                    disabled={loadingInsight}
                    className="border-indigo-200 text-indigo-600 bg-white hover:bg-indigo-50 text-[10px] uppercase font-black tracking-wider h-8"
                  >
                    {loadingInsight ? <RefreshCw className="w-3.5 h-3.5 animate-spin mr-1.5" /> : <Brain className="w-3.5 h-3.5 mr-1.5" />}
                    {aiInsight ? 'Refresh Insight' : 'Analyze with AI Coach'}
                  </Button>
                </div>

                {loadingInsight && (
                  <div className="mt-4 flex items-center gap-2 text-[10px] text-indigo-600 font-bold uppercase tracking-widest animate-pulse">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    AI has received FTE metrics. Running strategic scenarios...
                  </div>
                )}

                {aiInsight && !loadingInsight && (
                  <div className="mt-4 text-xs font-medium text-slate-700 bg-white border border-slate-100 p-4 rounded-xl leading-relaxed whitespace-pre-wrap">
                    <div className="markdown-body">
                      {aiInsight.split('\n').map((line, i) => {
                        if (line.startsWith('###') || line.startsWith('**')) {
                          return <p key={i} className="font-extrabold text-slate-900 mt-2 text-xs uppercase leading-snug">{line.replace(/###|\*\*/g, '').trim()}</p>;
                        }
                        if (line.startsWith('-') || line.startsWith('*')) {
                          return <div key={i} className="flex gap-2 items-start mt-1.5 pl-2"><span className="text-indigo-500 mt-1">•</span><span>{line.substring(2)}</span></div>;
                        }
                        return <p key={i} className="mt-1">{line}</p>;
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* CHARTS SECTION COMPACT */}
          {results.length > 0 ? (
            <>
              <Card className="border-none shadow-sm h-[320px]">
                <CardHeader className="py-4 px-6 flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-base font-black uppercase tracking-tight">
                      <TrendingUp className="w-5 h-5 text-indigo-600" />
                      Staffing Forecast Chart
                    </CardTitle>
                    <CardDescription className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">Daily headcount and peak concurrency needs.</CardDescription>
                  </div>
                  <div className="flex items-center gap-3">
                    {isStale && (
                      <Badge variant="destructive" className="animate-pulse gap-1 py-1 text-[9px] uppercase font-black">
                        <AlertCircle className="w-3 h-3" />
                        Settings Changed
                      </Badge>
                    )}
                    <div className="text-[10px] text-slate-400 font-bold uppercase tracking-tight hidden md:block">
                      {isStale ? 'Recalculate to update' : 'Ready?'}
                    </div>
                    <Button 
                      variant={isStale ? "default" : "outline"} 
                      size="sm" 
                      className={`h-8 px-4 gap-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${isStale ? 'bg-amber-500 hover:bg-amber-600 text-white border-none shadow-md' : 'text-indigo-600 border-indigo-100 hover:bg-indigo-50'}`} 
                      onClick={() => window.location.hash = '#roster'}
                    >
                      <ArrowRight className="w-3.5 h-3.5" />
                      Go to Roster
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="h-[300.094px] px-6 pb-6">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={results}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis 
                        dataKey="date" 
                        axisLine={false} 
                        tickLine={false} 
                        tick={{fontSize: 9, fill: '#94a3b8', fontWeight: 'bold'}} 
                        tickFormatter={(val) => val.split('-').slice(1).join('-')}
                      />
                      <YAxis axisLine={false} tickLine={false} tick={{fontSize: 12, fill: '#64748b'}} />
                      <Tooltip 
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                      />
                      <Legend iconType="circle" />
                      <Line type="monotone" dataKey="totalAgents" name="Total Headcount" stroke="#4f46e5" strokeWidth={3} dot={{ r: 4, fill: '#4f46e5' }} activeDot={{ r: 6 }} />
                      <Line type="monotone" dataKey="peakAgents" name="Peak Concurrency" stroke="#f59e0b" strokeWidth={3} dot={{ r: 4, fill: '#f59e0b' }} activeDot={{ r: 6 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card className="border-none shadow-sm overflow-hidden">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-primary" />
                    Forecast Volume per Interval
                  </CardTitle>
                  <CardDescription className="flex items-center justify-between">
                    <span>Input volume distribution per hour interval for planning.</span>
                    <div className="flex items-center gap-2 ml-4">
                      <span className="text-[10px] text-slate-400 font-bold uppercase">Trend:</span>
                      <div className="flex h-2 w-20 rounded-full overflow-hidden bg-slate-100">
                        <div className="w-1/4 bg-indigo-100" />
                        <div className="w-1/4 bg-indigo-200" />
                        <div className="w-1/4 bg-indigo-300" />
                        <div className="w-1/4 bg-indigo-500" />
                      </div>
                    </div>
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    {(() => {
                      const maxVolumeValue = Math.max(...volumeData.flatMap(d => Object.values(d.intervals)), 1);
                      
                      return (
                        <Table>
                          <TableHeader className="bg-slate-50">
                            <TableRow>
                              <TableHead className="min-w-[150px] sticky left-0 bg-slate-50 z-20 border-r">Interval</TableHead>
                              {volumeData.map(day => (
                                <TableHead key={day.date} className="min-w-[100px] text-center">
                                  <div className="flex flex-col items-center">
                                    <span className="text-xs font-bold">{day.date}</span>
                                    <span className="text-[10px] text-slate-500 uppercase">{day.day.substring(0, 3)}</span>
                                  </div>
                                </TableHead>
                              ))}
                            </TableRow>
                            <TableRow className="bg-indigo-50/30 border-b border-indigo-100">
                              <TableHead className="font-black text-indigo-900 sticky left-0 bg-indigo-50/30 z-20 border-r text-[10px] uppercase tracking-widest">
                                Daily Total
                              </TableHead>
                              {volumeData.map(day => (
                                <TableCell key={day.date} className="text-center bg-indigo-50/10">
                                  <span className="text-sm font-black text-indigo-600">{day.totalVolume.toLocaleString()}</span>
                                </TableCell>
                              ))}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {volumeData.length > 0 && Object.keys(volumeData[0].intervals)
                              .sort((a, b) => {
                                const hourA = parseInt(a.split(':')[0]);
                                const hourB = parseInt(b.split(':')[0]);
                                return hourA - hourB;
                              })
                              .map(interval => (
                                <TableRow key={interval} className="hover:bg-slate-50/50 transition-colors">
                                  <TableHead className="font-medium text-slate-700 sticky left-0 bg-white z-10 border-r text-xs">
                                    {interval}
                                  </TableHead>
                                  {volumeData.map(day => {
                                    const value = day.intervals[interval] || 0;
                                    const intensity = value / maxVolumeValue;
                                    
                                    return (
                                      <TableCell key={day.date} className="text-center p-0">
                                        <div 
                                          className="flex flex-col items-center justify-center h-[50px] transition-all group"
                                          style={{ 
                                            backgroundColor: value > 0 ? `rgba(79, 70, 229, ${0.05 + intensity * 0.4})` : 'transparent',
                                          }}
                                        >
                                          <span className={`text-sm font-black ${intensity > 0.6 ? 'text-indigo-900' : 'text-slate-900'}`}>
                                            {value}
                                          </span>
                                          <p className={`text-[8px] font-black uppercase tracking-widest mt-0.5 opacity-0 group-hover:opacity-60 transition-opacity ${intensity > 0.6 ? 'text-indigo-900' : 'text-slate-400'}`}>
                                            Volume
                                          </p>
                                        </div>
                                      </TableCell>
                                    );
                                  })}
                                </TableRow>
                              ))}
                          </TableBody>
                        </Table>
                      );
                    })()}
                  </div>
                </CardContent>
              </Card>

              <Card className="border-none shadow-sm overflow-hidden bg-slate-50/50">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-indigo-700">
                        <Users className="w-5 h-5" />
                        Forecast Staffing Requirement per Interval
                      </CardTitle>
                      <CardDescription>
                        Jumlah agen yang dibutuhkan per jam berdasarkan perhitungan Erlang C.
                      </CardDescription>
                    </div>
                    <div className="p-2 bg-indigo-100/50 rounded-xl">
                       <Calculator className="w-5 h-5 text-indigo-600" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-6 pt-0">
                  {/* Trend Chart */}
                  <div className="h-[300px] w-full mb-8 bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={intervalNeedsChartData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis 
                          dataKey="interval" 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{fontSize: 9, fill: '#94a3b8', fontWeight: 'bold'}}
                          tickFormatter={(val) => val.split(' - ')[0]}
                        />
                        <YAxis 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{fontSize: 10, fill: '#64748b'}}
                          label={{ value: 'Agents', angle: -90, position: 'insideLeft', style: { fontSize: 10, fontWeight: 'bold', fill: '#94a3b8' } }}
                        />
                        <Tooltip 
                          cursor={{fill: '#f8fafc'}}
                          contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                        />
                        <Legend iconType="circle" wrapperStyle={{ paddingTop: '10px' }} />
                        <Bar dataKey="avgNeeded" name="Avg Needed (Agents)" fill="#6366f1" radius={[4, 4, 0, 0]} barSize={30} />
                        <Bar dataKey="peakNeeded" name="Peak Expected" fill="#e0e7ff" radius={[4, 4, 0, 0]} barSize={30} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden shadow-sm">
                    <div className="overflow-x-auto">
                      {(() => {
                        const maxStaffValue = Math.max(...results.flatMap(r => Object.values(r.intervalNeeds || {})), 1);
                        
                        return (
                          <Table>
                            <TableHeader className="bg-slate-50">
                              <TableRow>
                                <TableHead className="min-w-[150px] sticky left-0 bg-slate-50 z-20 border-r">Interval</TableHead>
                                {results.map(res => (
                                  <TableHead key={res.date} className="min-w-[100px] text-center">
                                    <div className="flex flex-col items-center">
                                      <span className="text-xs font-bold">{res.date}</span>
                                      <span className="text-[10px] text-slate-500 uppercase">{res.day.substring(0, 3)}</span>
                                    </div>
                                  </TableHead>
                                ))}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {intervalNeedsChartData.map(({ interval }) => (
                                <TableRow key={interval} className="hover:bg-slate-50/50 transition-colors">
                                  <TableHead className="font-medium text-slate-700 sticky left-0 bg-white z-10 border-r text-xs">
                                    {interval}
                                  </TableHead>
                                  {results.map(res => {
                                    const value = res.intervalNeeds?.[interval] || 0;
                                    const intensity = value / maxStaffValue;
                                    
                                    return (
                                      <TableCell key={res.date} className="text-center p-0">
                                        <div 
                                          className="flex flex-col items-center justify-center h-[50px] transition-all group"
                                          style={{ 
                                            backgroundColor: value > 0 ? `rgba(99, 102, 241, ${0.05 + intensity * 0.4})` : 'transparent',
                                          }}
                                        >
                                          <span className={`text-sm font-black ${intensity > 0.6 ? 'text-indigo-900' : 'text-slate-900'}`}>
                                            {value}
                                          </span>
                                          <p className={`text-[8px] font-black uppercase tracking-widest mt-0.5 opacity-0 group-hover:opacity-60 transition-opacity ${intensity > 0.6 ? 'text-indigo-900' : 'text-slate-400'}`}>
                                            Agents
                                          </p>
                                        </div>
                                      </TableCell>
                                    );
                                  })}
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        );
                      })()}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-none shadow-sm overflow-hidden bg-white">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2 text-indigo-700">
                        <Users className="w-5 h-5" />
                        Daily Staffing Requirement vs Availability
                      </CardTitle>
                      <CardDescription>
                        Analisis perbandingan antara kebutuhan agen hasil Erlang C dengan jumlah agen yang tersedia di roster (Starts Analysis).
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-6">
                  {/* Daily Trend Chart */}
                  <div className="h-[300px] w-full mb-8">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={dailyStaffingStats}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis 
                          dataKey="date" 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{fontSize: 10, fill: '#64748b'}}
                          tickFormatter={(val) => {
                            const parts = val.split('-');
                            return parts.length >= 3 ? `${parts[2]}/${parts[1]}` : val;
                          }}
                        />
                        <YAxis 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{fontSize: 10, fill: '#64748b'}}
                        />
                        <Tooltip 
                          contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                        />
                        <Legend iconType="circle" />
                        <Line type="monotone" dataKey="required" name="Required (Erlang)" stroke="#6366f1" strokeWidth={3} dot={{ r: 4, fill: '#6366f1' }} activeDot={{ r: 6 }} />
                        <Line 
                          type="monotone" 
                          dataKey="available" 
                          name={`Available (${isAgreedToManpowerAdjustments ? 'Simulation' : 'Roster'})`} 
                          stroke="#10b981" 
                          strokeWidth={3} 
                          dot={{ r: 4, fill: '#10b981' }} 
                          activeDot={{ r: 6 }} 
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Summary Table */}
                  <div className="rounded-xl border border-slate-100 overflow-hidden shadow-sm">
                    <Table>
                      <TableHeader className="bg-slate-50">
                        <TableRow>
                          <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-400">Date</TableHead>
                          <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-400 text-center">Required</TableHead>
                          <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-400 text-center">
                            {isAgreedToManpowerAdjustments ? 'Eff. Available' : 'Available'}
                          </TableHead>
                          <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-400 text-center">Gap</TableHead>
                          <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-400 text-right">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {dailyStaffingStats.map((stat) => (
                          <TableRow key={stat.date}>
                            <TableCell className="py-2">
                              <div className="flex flex-col">
                                <span className="text-xs font-black text-slate-800">{stat.date}</span>
                                <span className="text-[9px] text-slate-400 font-bold uppercase">{stat.day}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-center py-2">
                              <span className="text-xs font-black text-slate-700">{stat.required}</span>
                            </TableCell>
                            <TableCell className="text-center py-2">
                              <span className="text-xs font-black text-indigo-600">{stat.available}</span>
                            </TableCell>
                            <TableCell className="text-center py-2">
                              <span className={`text-xs font-black ${stat.gap < 0 ? 'text-rose-600 font-black' : 'text-emerald-600 font-black'}`}>
                                {stat.gap > 0 ? '+' : ''}{stat.gap}
                              </span>
                            </TableCell>
                            <TableCell className="text-right py-2">
                              {stat.isShortage ? (
                                <Badge className="bg-rose-50 text-rose-600 hover:bg-rose-100 border-rose-100 text-[8px] font-black tracking-widest px-2 py-0.5">SHORTAGE</Badge>
                              ) : (
                                <Badge className="bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border-emerald-100 text-[8px] font-black tracking-widest px-2 py-0.5">OK</Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            <Card className="border-2 border-dashed border-indigo-100 shadow-sm bg-indigo-50/10 min-h-[420px] flex flex-col items-center justify-center p-8 rounded-3xl relative overflow-hidden group">
              <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-50/50 rounded-full blur-3xl -mr-32 -mt-32 transition-transform group-hover:scale-110 duration-700" />
              <div className="absolute bottom-0 left-0 w-48 h-48 bg-blue-50/50 rounded-full blur-3xl -ml-24 -mb-24 transition-transform group-hover:scale-110 duration-700" />

              <div className="relative z-10 max-w-md text-center space-y-6">
                <div className="w-20 h-20 bg-indigo-600 rounded-3xl flex items-center justify-center mx-auto shadow-lg shadow-indigo-100 relative">
                  <div className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-emerald-500 rounded-full border-2 border-white flex items-center justify-center shadow">
                     <span className="text-[8px] font-black text-white">AI</span>
                  </div>
                  <TrendingUp className="w-9 h-9 text-white" />
                </div>

                <div className="space-y-2">
                  <Badge variant="outline" className="border-indigo-200 text-indigo-600 bg-indigo-50 text-[8px] font-black uppercase tracking-widest px-2.5 py-1">
                     No Forecasts Loaded
                  </Badge>
                  <h2 className="text-xl sm:text-2xl font-black text-slate-900 uppercase tracking-tight">
                    FTE Requirements Forecast Empty
                  </h2>
                  <p className="text-sm text-slate-500 font-medium leading-relaxed">
                    There are no daily inbound interaction forecasts or staffing calculations populated for this period. Use the <strong className="text-indigo-600">AI Forecasting Engine</strong> to instantly setup realistic mock parameters, employee records and analyze staffing demands automatically.
                  </p>
                </div>

                <div className="p-4 bg-white/80 border border-slate-100 rounded-2xl shadow-sm text-left text-xs space-y-2.5 max-w-sm mx-auto">
                   <p className="font-extrabold text-[#960000] uppercase tracking-wide text-[9px]">Autopilot configuration payload:</p>
                   <ul className="space-y-1 text-slate-600 font-medium">
                      <li className="flex items-center gap-2">
                         <span className="h-1.5 w-1.5 bg-indigo-500 rounded-full" />
                         Populate 31-day forecast volumes & hourly peak intervals
                      </li>
                      <li className="flex items-center gap-2">
                         <span className="h-1.5 w-1.5 bg-indigo-500 rounded-full" />
                         Configure standard WFM shift codes (Morning, Mid, Late)
                      </li>
                      <li className="flex items-center gap-2">
                         <span className="h-1.5 w-1.5 bg-indigo-500 rounded-full" />
                         Initialize pool of 15 customer experience agents
                      </li>
                      <li className="flex items-center gap-2">
                         <span className="h-1.5 w-1.5 bg-indigo-500 rounded-full" />
                         Run interactive Erlang C optimization queues
                      </li>
                   </ul>
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
                  <Button 
                    className="bg-indigo-600 hover:bg-indigo-700 h-11 px-8 rounded-xl font-black text-xs uppercase tracking-widest shadow-lg shadow-indigo-100 text-white w-full sm:w-auto"
                    onClick={handleAISmartFill}
                    disabled={bootstrapping}
                  >
                    {bootstrapping ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                        AI Generating & Running...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4 fill-white mr-2" />
                        Launch AI FTE Requirements Forecast
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

