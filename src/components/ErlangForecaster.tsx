import React, { useState, useEffect, useMemo } from 'react';
import { db, collection, onSnapshot, query, setDoc, doc, OperationType, handleFirestoreError, writeBatch } from '../lib/firebase';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { calculateRequiredAgents, calculateRequiredAgentsChat, calculateRequiredAgentsEmail, ErlangResult, getIntervalDuration, isIntervalInWindow, matchDayName, applyOperationalWindowsToVolume } from '../lib/erlang';
import { Calculator, FileText, TrendingUp, Info, Clock, Users, CheckCircle2, Calendar, RefreshCw, AlertCircle, MessageSquare, Mail, Phone, ShieldCheck } from 'lucide-react';
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
  leaveRequests = []
}: { 
  volumeData: ForecastVolumeData[], 
  shiftCodes: ShiftCode[], 
  employees: Employee[],
  workingDaysRef?: any,
  erlangResults?: any[],
  initialSettings?: any,
  leaveRequests?: any[]
}) {
  const [channelType, setChannelType] = useState<'call' | 'chat' | 'email' | 'whatsapp' | 'multiskill_chat_wa'>('call');
  const [aht, setAht] = useState(300);
  const [targetSL, setTargetSL] = useState(80);
  const [targetTime, setTargetTime] = useState(20);
  const [concurrency, setConcurrency] = useState(2);
  const [tat, setTat] = useState(3600);
  const [shrinkage, setShrinkage] = useState(30);
  const [operationalWindows, setOperationalWindows] = useState<any>(initialSettings?.operationalWindows || null);
  const [lastAppliedSettings, setLastAppliedSettings] = useState<any>(null);

  // Sync with initialSettings prop
  useEffect(() => {
    if (initialSettings) {
      if (initialSettings.channelType) setChannelType(initialSettings.channelType);
      if (initialSettings.aht) setAht(initialSettings.aht);
      if (initialSettings.targetSL) setTargetSL(initialSettings.targetSL);
      if (initialSettings.targetTime) setTargetTime(initialSettings.targetTime);
      if (initialSettings.concurrency) setConcurrency(initialSettings.concurrency);
      if (initialSettings.tat) setTat(initialSettings.tat);
      if (initialSettings.shrinkage) setShrinkage(initialSettings.shrinkage);
      if (initialSettings.operationalWindows) setOperationalWindows(initialSettings.operationalWindows);
      if (initialSettings.lastApplied) setLastAppliedSettings(initialSettings.lastApplied);
    }
  }, [initialSettings]);

  const results = useMemo(() => {
    return erlangResults.filter(r => volumeData.some(v => v.date === r.date))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [erlangResults, volumeData]);

  const [calculating, setCalculating] = useState(false);

  const isStale = lastAppliedSettings && (
    channelType !== lastAppliedSettings.channelType ||
    aht !== lastAppliedSettings.aht ||
    targetSL !== lastAppliedSettings.targetSL ||
    targetTime !== lastAppliedSettings.targetTime ||
    concurrency !== lastAppliedSettings.concurrency ||
    tat !== lastAppliedSettings.tat ||
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

  const handleReset = async () => {
    const defaults = {
      channelType: 'call' as const,
      aht: 300,
      targetSL: 80,
      targetTime: 20,
      concurrency: 2,
      tat: 3600,
      shrinkage: 30,
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
    setChannelType(defaults.channelType);
    setAht(defaults.aht);
    setTargetSL(defaults.targetSL);
    setTargetTime(defaults.targetTime);
    setConcurrency(defaults.concurrency);
    setTat(defaults.tat);
    setShrinkage(defaults.shrinkage);
    setOperationalWindows(defaults.operationalWindows);
    await saveSettings(defaults);
    toast.success('Parameters reset to defaults');
  };

  useEffect(() => {
    // Removed internal listener to use props from ForecastView
  }, []);

  const handleCalculate = async () => {
    if (volumeData.length === 0) {
      toast.error('No volume data found. Please upload volume data first.');
      return;
    }

    setCalculating(true);
    try {
      const dailyResults: any[] = [];
      const batch = writeBatch(db);

      // 1. Adjust forecast volume based on operational windows (Carry-over)
      const processedVolume = applyOperationalWindowsToVolume(volumeData, operationalWindows);

      processedVolume.forEach((data) => {
        let dayPeak = 0;
        let dayTotalHours = 0;
        const intervalNeeds: Record<string, number> = {};
        const allIntervalKeys = Object.keys(data.intervals).sort();
        
        // Intervals are already processed for window and carry-over by applyOperationalWindowsToVolume
        Object.entries(data.intervals).forEach(([interval, effectiveVolume]) => {
          const duration = getIntervalDuration(interval, allIntervalKeys);
          let res;
          if (channelType === 'chat' || channelType === 'whatsapp' || channelType === 'multiskill_chat_wa') {
            res = calculateRequiredAgentsChat(effectiveVolume as number, aht, targetSL / 100, targetTime, concurrency, duration);
          } else if (channelType === 'email') {
            res = calculateRequiredAgentsEmail(effectiveVolume as number, aht, targetSL / 100, tat, duration);
          } else {
            res = calculateRequiredAgents(effectiveVolume as number, aht, targetSL / 100, targetTime, duration);
          }
          intervalNeeds[interval] = res.agents;
          dayPeak = Math.max(dayPeak, res.agents);
          dayTotalHours += res.agents * duration;
        });

        // Simple headcount calculation (Total hours / 8 hours per shift * shrinkage)
        const dayConfig = matchDayName(data.day, operationalWindows, data.date);
        const isDayOpen = dayConfig ? dayConfig.isOpen : true;
        
        let baseHeadcount = Math.ceil((dayTotalHours / 8) * (1 + shrinkage / 100));
        let peakNeeded = Math.ceil(dayPeak * (1 + shrinkage / 100));
        let headcount = Math.max(baseHeadcount, peakNeeded);
        
        if (!isDayOpen) headcount = 0; // Force 0 for closed days

        // Improved shift suggestion logic (Greedy Coverage Optimizer):
        const shiftSuggestions: Record<string, number> = {};
        shiftCodes.forEach(c => shiftSuggestions[c.code] = 0);

        if (shiftCodes.length > 0) {
          const currentAssigned: Record<string, number> = {};
          Object.keys(intervalNeeds).forEach(int => currentAssigned[int] = 0);

          let assignedCount = 0;
          while (assignedCount < headcount) {
            let bestShift = null;
            let maxScore = -Infinity;

            for (const code of shiftCodes) {
              let score = 0;
              Object.keys(intervalNeeds).forEach(interval => {
                if (isIntervalInShift(interval, code.startTime, code.endTime)) {
                  const gap = intervalNeeds[interval] - currentAssigned[interval];
                  
                  // Check if this interval is actually within the operational window for this day
                  const dayName = data.day;
                  const dayConfig = matchDayName(dayName, operationalWindows, data.date);
                  
                  let isOpWindow = true;
                  if (dayConfig) {
                    if (!dayConfig.isOpen) isOpWindow = false;
                    else isOpWindow = isIntervalInWindow(interval, dayConfig.start, dayConfig.end);
                  }

                  if (!isOpWindow) {
                    // HEAVY PENALTY: Do not suggest shifts that cover closed hours
                    score -= 10000;
                  } else if (gap > 0) {
                    // CRITICAL: Filling an empty slot is highest priority
                    score += Math.min(gap, 1) * 2000 + Math.max(0, gap - 1) * 500;
                  } else {
                    // MINOR PENALTY: Over-coverage is much better than under-coverage
                    score -= (Math.abs(gap) + 1) * 10;
                  }
                }
              });

              if (shiftSuggestions[code.code] > 0) score += 1;

              if (score > maxScore) {
                maxScore = score;
                bestShift = code;
              }
            }

            if (bestShift) {
              shiftSuggestions[bestShift.code]++;
              Object.keys(intervalNeeds).forEach(interval => {
                if (isIntervalInShift(interval, bestShift!.startTime, bestShift!.endTime)) {
                  currentAssigned[interval]++;
                }
              });
              assignedCount++;
            } else {
              // Fallback if no shift is "good", pick the one with least penalty
              const fallbackShift = shiftCodes[0];
              shiftSuggestions[fallbackShift.code]++;
              assignedCount++;
            }
          }
        }

        // Generate Draft Assignments
        const assignments: Record<string, string> = {};
        if (employees.length > 0 && shiftCodes.length > 0) {
          let empIndex = 0;
          Object.entries(shiftSuggestions).forEach(([code, count]) => {
            for (let i = 0; i < count; i++) {
              if (empIndex < employees.length) {
                assignments[employees[empIndex].id] = code;
                empIndex++;
              }
            }
          });
          for (let i = empIndex; i < employees.length; i++) {
            assignments[employees[i].id] = 'OFF';
          }
        }

        // Calculate Actual Interval Supply based on assignments
        const intervalSupply: Record<string, number> = {};
        Object.keys(data.intervals).forEach(interval => {
          let supply = 0;
          Object.values(assignments).forEach(shiftCode => {
            if (shiftCode === 'OFF') return;
            const codeObj = shiftCodes.find(c => c.code === shiftCode);
            if (codeObj && isIntervalInShift(interval, codeObj.startTime, codeObj.endTime)) {
              supply++;
            }
          });
          intervalSupply[interval] = supply;
        });

        const resultItem = {
          date: data.date,
          day: data.day,
          totalAgents: headcount,
          peakAgents: dayPeak,
          dayTotalHours,
          intervalNeeds,
          shiftSuggestions,
          assignments,
          intervalSupply
        };

        dailyResults.push(resultItem);
        const docRef = doc(db, 'erlangResults', data.date);
        batch.set(docRef, resultItem);
      });

      await batch.commit();
      
      // Save these as last applied
      const applied = { 
        channelType, 
        aht, 
        targetSL, 
        targetTime, 
        concurrency, 
        tat, 
        targetShrinkage: shrinkage,
        operationalWindows
      };
      await setDoc(doc(db, 'erlangSettings', 'current'), { lastApplied: applied }, { merge: true });
      setLastAppliedSettings(applied);
      
      toast.success('Staffing requirements calculated and saved');
    } catch (error) {
      console.error(error);
      toast.error('Error calculating requirements');
    } finally {
      setCalculating(false);
    }
  };

  // Helper to check if an interval falls within a shift
  function isIntervalInShift(interval: string, shiftStart: string, shiftEnd: string): boolean {
    try {
      const [intStartStr] = interval.split(' - ');
      const [intH] = intStartStr.split(':').map(Number);
      const [startH] = shiftStart.split(':').map(Number);
      const [endH] = shiftEnd.split(':').map(Number);

      if (startH < endH) {
        return intH >= startH && intH < endH;
      } else {
        // Overnight shift (e.g., 22:00 - 06:00)
        return intH >= startH || intH < endH;
      }
    } catch (e) {
      return false;
    }
  }

  const monthlyStats = useMemo(() => {
    if (results.length === 0) return null;
    
    const totalVolume = volumeData.reduce((acc, d) => acc + d.totalVolume, 0);
    const totalStaffingHours = results.reduce((acc, r) => acc + (r.dayTotalHours || 0), 0);
    
    // Calculate FTE needed using reference data if available
    const totalDays = volumeData.length;
    const targetWorkingDays = workingDaysRef ? workingDaysRef.workingDays : Math.round(totalDays * (5/7));
    const shiftLength = 8;
    const extraWorkingDays = initialSettings?.extraWorkingDays || 0;
    const extraHours = initialSettings?.extraHours || 0;

    // Calculate Effective Available Capacity (FTE) - NO BUFFER for main gap
    const totalCapacityHours = employees.reduce((sum, emp) => {
      const empExtraDays = emp.extraWorkingDays !== undefined ? emp.extraWorkingDays : extraWorkingDays;
      const empExtraHours = emp.extraHours !== undefined ? emp.extraHours : extraHours;
      
      // Calculate this employee's approved leave days in this period
      const empLeaveDays = leaveRequests.filter(req => 
        req.employeeId === emp.id && 
        req.status === 'approved' && 
        volumeData.some(d => d.date === req.date)
      ).length;

      return sum + ((targetWorkingDays + empExtraDays - empLeaveDays) * (shiftLength + empExtraHours));
    }, 0);

    const monthlyStandardHours = shiftLength * targetWorkingDays;
    const effectiveAvailableFTE = (totalCapacityHours / monthlyStandardHours);
    
    // Calculate Required Headcount (Body Count)
    // Demand is fixed at standard 8h shifts
    const monthlyPersonHours = shiftLength * targetWorkingDays;
    const netFTE = totalStaffingHours / monthlyPersonHours;
    const grossFTEValue = netFTE / (1 - (shrinkage / 100));
    const grossFTE = Math.ceil(grossFTEValue);
    const avgDailyHeadcount = results.length > 0 ? Math.ceil(results.reduce((acc, r) => acc + r.totalAgents, 0) / results.length) : 0;
    
    return {
      totalVolume,
      totalWorkHours: totalStaffingHours,
      netFTE: Math.ceil(netFTE),
      grossFTE,
      avgDailyHeadcount,
      headcountGap: Math.round((effectiveAvailableFTE - grossFTE) * 100) / 100,
      shrinkageOverhead: grossFTE - Math.ceil(netFTE),
      peakVariance: results.length > 0 ? Math.round(((Math.max(...results.map(r => r.peakAgents)) / avgDailyHeadcount) - 1) * 100) : 0,
      effectiveAvailableFTE
    };
  }, [results, volumeData, shrinkage, employees.length, workingDaysRef]);

  return (
    <div className="space-y-6">
      <Card className="border-none shadow-sm bg-indigo-50/50 border border-indigo-100">
        <CardContent className="p-6">
          <div className="flex gap-4">
            <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
              <Info className="w-5 h-5 text-indigo-600" />
            </div>
            <div className="space-y-2">
              <h3 className="font-bold text-indigo-900">Staffing Calculation</h3>
              <p className="text-sm text-indigo-700 leading-relaxed">
                This tool uses the <strong>Erlang C</strong> formula to calculate the number of agents needed for each interval based on your uploaded volume. 
                It then suggests a headcount and shift distribution to meet your service level targets.
              </p>
              <div className="flex items-center gap-4 pt-2">
                <div className="flex items-center gap-2 text-xs font-medium text-indigo-600">
                  <CheckCircle2 className="w-4 h-4" />
                  {volumeData.length} Days of Volume Data
                </div>
                <div className="flex items-center gap-2 text-xs font-medium text-indigo-600">
                  <CheckCircle2 className="w-4 h-4" />
                  {shiftCodes.length} Active Shift Codes
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Parameters */}
        <Card className="lg:col-span-3 border-none shadow-sm h-fit sticky top-6">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Calculator className="w-5 h-5 text-indigo-600" />
              Parameters
            </CardTitle>
            <CardDescription>Configure Erlang C variables</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <label className="text-[11px] font-bold uppercase text-slate-500 tracking-wider">Channel Type</label>
              <Select value={channelType} onValueChange={(val: any) => {
                setChannelType(val);
                saveSettings({ channelType: val });
              }}>
                <SelectTrigger className="w-full bg-slate-50 border-slate-200">
                  <SelectValue placeholder="Select channel" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="call">
                    <div className="flex items-center gap-2">
                      <Phone className="w-4 h-4 text-blue-500" />
                      <span>Call (Voice)</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="chat">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-emerald-500" />
                      <span>Live Chat</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="whatsapp">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-green-500" />
                      <span>WhatsApp</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="multiskill_chat_wa">
                    <div className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-indigo-500" />
                      <span>Multiskill</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="email">
                    <div className="flex items-center gap-2">
                      <Mail className="w-4 h-4 text-amber-500" />
                      <span>Email</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 gap-4">
              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase text-slate-500 tracking-wider">Avg Handling Time (sec)</label>
                <Input type="number" className="bg-slate-50 border-slate-200" value={aht} onChange={e => {
                  const val = Number(e.target.value);
                  setAht(val);
                  saveSettings({ aht: val });
                }} />
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase text-slate-500 tracking-wider">
                  Target SL (%)
                </label>
                <Input type="number" className="bg-slate-50 border-slate-200" value={targetSL} onChange={e => {
                  const val = Number(e.target.value);
                  setTargetSL(val);
                  saveSettings({ targetSL: val });
                }} />
              </div>
            </div>

            {channelType !== 'email' && (
              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase text-slate-500 tracking-wider">
                  Target Time (sec)
                </label>
                <Input type="number" className="bg-slate-50 border-slate-200" value={targetTime} onChange={e => {
                  const val = Number(e.target.value);
                  setTargetTime(val);
                  saveSettings({ targetTime: val });
                }} />
              </div>
            )}

            {(channelType === 'chat' || channelType === 'whatsapp' || channelType === 'multiskill_chat_wa') && (
              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase text-slate-500 tracking-wider">Max Concurrency</label>
                <Input type="number" className="bg-slate-50 border-slate-200" value={concurrency} onChange={e => {
                  const val = Number(e.target.value);
                  setConcurrency(val);
                  saveSettings({ concurrency: val });
                }} />
              </div>
            )}

            {channelType === 'email' && (
              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase text-slate-500 tracking-wider">Target TAT (sec)</label>
                <Input type="number" className="bg-slate-50 border-slate-200" value={tat} onChange={e => {
                  const val = Number(e.target.value);
                  setTat(val);
                  saveSettings({ tat: val });
                }} />
              </div>
            )}

            <div className="space-y-2">
              <label className="text-[11px] font-bold uppercase text-slate-500 tracking-wider">Shrinkage (%)</label>
              <Input type="number" className="bg-slate-50 border-slate-200" value={shrinkage} onChange={e => {
                const val = Number(e.target.value);
                setShrinkage(val);
                saveSettings({ shrinkage: val });
              }} />
            </div>

            <div className="pt-4 flex flex-col gap-3">
              <Button 
                className="w-full h-12 text-sm font-bold shadow-lg shadow-indigo-200 bg-indigo-600 hover:bg-indigo-700 transition-all" 
                onClick={handleCalculate}
                disabled={volumeData.length === 0 || calculating}
              >
                {calculating ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Calculator className="w-4 h-4 mr-2" />}
                Calculate Needs
              </Button>
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-slate-400 hover:text-slate-600 text-[11px] uppercase tracking-widest font-bold"
                onClick={handleReset}
              >
                Reset Defaults
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Right Column: Results */}
        <div className="lg:col-span-9 space-y-6">
          {monthlyStats && (
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
              {/* Main Staffing Card */}
              <Card className="md:col-span-5 border-none shadow-xl bg-gradient-to-br from-indigo-600 to-violet-700 text-white overflow-hidden relative">
                <div className="absolute top-0 right-0 p-6 opacity-10">
                  <Users className="w-32 h-32 -mr-8 -mt-8" />
                </div>
                <CardContent className="p-8 relative z-10 h-full flex flex-col justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Badge className="bg-white/20 text-white border-none hover:bg-white/30 text-[10px] font-bold uppercase tracking-wider">
                        Target Output
                      </Badge>
                    </div>
                    <h3 className="text-xs font-bold uppercase tracking-widest text-indigo-100 mb-1">Gross FTE Needed</h3>
                    <div className="flex items-baseline gap-2">
                      <span className="text-6xl font-black tracking-tight">{monthlyStats.grossFTE}</span>
                      <span className="text-xl font-medium text-indigo-200">Agents</span>
                    </div>
                  </div>
                  <div className="mt-8 pt-6 border-t border-white/10 space-y-3">
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-indigo-200">Net Production FTE</span>
                      <span className="font-bold">{monthlyStats.netFTE}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-indigo-200">Shrinkage Buffer ({shrinkage}%)</span>
                      <span className="font-bold">+{monthlyStats.shrinkageOverhead}</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-indigo-200">Avg Daily Supply</span>
                      <span className="font-bold">{monthlyStats.avgDailyHeadcount}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Secondary Stats Grid */}
              <div className="md:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-6">
                {/* Workload Section */}
                <Card className="border-none shadow-sm bg-white overflow-hidden group border border-slate-100">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between mb-4">
                      <div className="p-2 bg-blue-50 rounded-lg">
                        <TrendingUp className="w-5 h-5 text-blue-600" />
                      </div>
                      <Badge variant="outline" className="text-[10px] font-bold uppercase tracking-wider text-slate-400 border-slate-200">Workload</Badge>
                    </div>
                    <div className="space-y-4">
                      <div>
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Monthly Volume</p>
                        <p className="text-3xl font-black text-slate-900">{monthlyStats.totalVolume.toLocaleString()}</p>
                      </div>
                      <div className="pt-4 border-t border-slate-50">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Total Work Hours</p>
                        <p className="text-3xl font-black text-slate-900">{Math.round(monthlyStats.totalWorkHours).toLocaleString()}h</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Capacity Section */}
                <Card className={`border-none shadow-sm overflow-hidden group border ${monthlyStats.headcountGap < 0 ? 'bg-rose-50/50 border-rose-100' : 'bg-emerald-50/50 border-emerald-100'}`}>
                  <CardContent className="p-6 h-full flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-4">
                        <div className={`p-2 rounded-lg ${monthlyStats.headcountGap < 0 ? 'bg-rose-100' : 'bg-emerald-100'}`}>
                          <Users className={`w-5 h-5 ${monthlyStats.headcountGap < 0 ? 'text-rose-600' : 'text-emerald-600'}`} />
                        </div>
                        <Badge variant="outline" className={`text-[10px] font-bold uppercase tracking-wider ${monthlyStats.headcountGap < 0 ? 'border-rose-200 text-rose-600' : 'border-emerald-200 text-emerald-600'}`}>
                          Capacity
                        </Badge>
                      </div>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Headcount Gap</p>
                      <h3 className={`text-4xl font-black ${monthlyStats.headcountGap < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                        {monthlyStats.headcountGap > 0 ? '+' : ''}{monthlyStats.headcountGap}
                      </h3>
                      <p className={`text-[10px] font-bold mt-1 uppercase tracking-wider ${monthlyStats.headcountGap < 0 ? 'text-rose-500' : 'text-emerald-500'}`}>
                        {monthlyStats.headcountGap < 0 ? 'Hiring Required' : 'Sufficient'}
                      </p>
                    </div>
                    <div className="pt-6">
                      <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">
                        <span>Current Staff</span>
                        <span>Required</span>
                      </div>
                      <div className="h-2 w-full bg-slate-200 rounded-full overflow-hidden flex">
                        <div 
                          className={`h-full transition-all duration-1000 ${monthlyStats.headcountGap < 0 ? 'bg-rose-500' : 'bg-emerald-500'}`} 
                          style={{ width: `${Math.min(100, (monthlyStats.effectiveAvailableFTE / monthlyStats.grossFTE) * 100)}%` }}
                        />
                      </div>
                      <div className="flex justify-between mt-1 text-[10px] font-bold text-slate-500">
                        <span>{monthlyStats.effectiveAvailableFTE.toFixed(1)} Effective Agents</span>
                        <span>{monthlyStats.grossFTE} Target</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
          {results.length > 0 ? (
            <>
              <Card className="border-none shadow-sm h-[400px]">
                <CardHeader className="flex flex-row items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <TrendingUp className="w-5 h-5 text-primary" />
                      Staffing Forecast Chart
                    </CardTitle>
                    <CardDescription>Daily headcount and peak concurrency needs.</CardDescription>
                  </div>
                  <div className="flex items-center gap-3">
                    {isStale && (
                      <Badge variant="destructive" className="animate-pulse gap-1 py-1">
                        <AlertCircle className="w-3 h-3" />
                        Settings Changed
                      </Badge>
                    )}
                    <div className="text-xs text-slate-400 font-medium hidden md:block">
                      {isStale ? 'Recalculate to update roster' : 'Ready for scheduling?'}
                    </div>
                    <Button 
                      variant={isStale ? "default" : "outline"} 
                      size="sm" 
                      className={`gap-2 ${isStale ? 'bg-amber-500 hover:bg-amber-600 text-white border-none' : 'text-primary border-primary/20 hover:bg-primary/5'}`} 
                      onClick={() => window.location.hash = '#roster'}
                    >
                      <Calendar className="w-4 h-4" />
                      Go to Roster
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={results}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fontSize: 12, fill: '#64748b'}} />
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
                    <Clock className="w-5 h-5 text-primary" />
                    Shift Distribution Summary
                  </CardTitle>
                  <CardDescription>Visibility of agents needed per shift across all dates.</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader className="bg-slate-50">
                        <TableRow>
                          <TableHead className="min-w-[100px] sticky left-0 bg-slate-50 z-20">Shift</TableHead>
                          <TableHead className="min-w-[120px] sticky left-[100px] bg-slate-50 z-20 border-r">Interval</TableHead>
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
                        {shiftCodes.length > 0 ? (
                          shiftCodes.map(code => (
                            <TableRow key={code.code} className="hover:bg-slate-50/50 transition-colors">
                              <TableCell className="font-bold text-slate-900 sticky left-0 bg-white z-10">{code.code}</TableCell>
                              <TableCell className="text-xs text-slate-500 sticky left-[100px] bg-white z-10 border-r">{code.startTime} - {code.endTime}</TableCell>
                              {results.map(res => (
                                <TableCell key={res.date} className="text-center">
                                  <span className={`font-medium ${res.shiftSuggestions[code.code] > 0 ? 'text-indigo-600 font-bold' : 'text-slate-300'}`}>
                                    {res.shiftSuggestions[code.code] || 0}
                                  </span>
                                </TableCell>
                              ))}
                            </TableRow>
                          ))
                        ) : (
                          <TableRow>
                            <TableCell colSpan={results.length + 2} className="h-24 text-center text-slate-500 italic">
                              No shift codes defined to suggest coverage.
                            </TableCell>
                          </TableRow>
                        )}
                        {/* Total Row */}
                        <TableRow className="bg-slate-50/50 font-bold">
                          <TableCell className="sticky left-0 bg-slate-50 z-10">Total Need</TableCell>
                          <TableCell className="sticky left-[100px] bg-slate-50 z-10 border-r"></TableCell>
                          {results.map(res => (
                            <TableCell key={res.date} className="text-center text-primary">
                              {res.totalAgents}
                            </TableCell>
                          ))}
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-none shadow-sm overflow-hidden">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="w-5 h-5 text-primary" />
                    Interval Coverage Analysis (Supply vs Demand)
                  </CardTitle>
                  <CardDescription>
                    Visibility of concurrent agents on duty per 1-hour interval. 
                    <span className="text-red-500 font-bold ml-2">Red</span> indicates understaffed gaps.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader className="bg-slate-50">
                        <TableRow>
                          <TableHead className="min-w-[150px] sticky left-0 bg-slate-50 z-20 border-r">Interval</TableHead>
                          {results.map(res => (
                            <TableHead key={res.date} className="min-w-[120px] text-center">
                              <div className="flex flex-col items-center">
                                <span className="text-xs font-bold">{res.date}</span>
                                <span className="text-[10px] text-slate-500 uppercase">{res.day.substring(0, 3)}</span>
                              </div>
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Object.keys(results[0].intervalNeeds)
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
                            {results.map(res => {
                              const supply = res.intervalSupply[interval] || 0;
                              const demand = res.intervalNeeds[interval] || 0;
                              const isUnderstaffed = supply < demand;
                              const isNoStaff = supply === 0 && demand > 0;
                              
                              return (
                                <TableCell key={res.date} className="text-center p-2">
                                  <div className={`flex flex-col items-center justify-center rounded-lg p-1 border ${
                                    isNoStaff 
                                      ? 'bg-red-100 border-red-300 text-red-700 animate-pulse' 
                                      : isUnderstaffed 
                                        ? 'bg-orange-50 border-orange-200 text-orange-700' 
                                        : 'bg-emerald-50 border-emerald-100 text-emerald-700'
                                  }`}>
                                    <span className="text-sm font-bold">{supply}</span>
                                    <div className="flex items-center gap-1 text-[10px] opacity-70">
                                      <span>Req:</span>
                                      <span>{demand}</span>
                                    </div>
                                  </div>
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : (
            <div className="h-[400px] flex flex-col items-center justify-center bg-white rounded-xl border border-dashed border-slate-200 text-slate-400 space-y-4">
              <Calculator className="w-12 h-12 opacity-20" />
              <div className="text-center">
                <p className="font-medium">Ready to calculate</p>
                <p className="text-sm">Adjust parameters and click calculate to see requirements.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

