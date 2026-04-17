import React, { useState, useEffect, useMemo } from 'react';
import { db, collection, onSnapshot, query, setDoc, doc, OperationType, handleFirestoreError, auth, where } from '../lib/firebase';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Calendar as CalendarIcon, Users, Download, RefreshCw, CheckCircle2, AlertCircle, Clock, Sparkles, TrendingUp, Activity, Target, ShieldCheck, Zap, Heart, BarChart3, ClipboardCheck, Edit2, ListChecks, ArrowRight, AlertTriangle, Settings2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { format, startOfWeek, addDays, isSameDay } from 'date-fns';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { ShiftCode } from './ShiftCodeManager';
import { calculateRequiredAgents, calculateRequiredAgentsChat, calculateRequiredAgentsEmail, getIntervalDuration, isIntervalInWindow, matchDayName, applyOperationalWindowsToVolume } from '../lib/erlang';
import { writeBatch } from '../lib/firebase';

interface Employee {
  id: string;
  nip: string;
  name: string;
  skill: string;
  gender?: string;
  preferredShifts?: string[];
  extraWorkingDays?: number;
  extraHours?: number;
}

interface ForecastVolumeData {
  date: string;
  day: string;
  totalVolume: number;
  intervals: Record<string, number>;
}

interface RosterDay {
  date: string;
  shiftCode: string;
}

interface EmployeeRoster {
  employeeId: string;
  employeeName: string;
  nip: string;
  gender?: string;
  preferredShifts?: string[];
  days: Record<string, string>; // date -> shiftCode
  totalWorkingDays: number;
  totalOffDays: number;
  targetWorkingDays: number;
  targetOffDays: number;
  extraHours?: number;
}

interface WorkingDayRef {
  id: string;
  month: string;
  totalDays: number;
  workingDays: number;
  weekend: number;
  holiday: number;
}

interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  status: 'pending' | 'approved' | 'rejected';
}

export default function RosterView({ isAdmin }: { isAdmin: boolean }) {
  const [allVolumeData, setAllVolumeData] = useState<ForecastVolumeData[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [shiftCodes, setShiftCodes] = useState<ShiftCode[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [workingDaysRef, setWorkingDaysRef] = useState<WorkingDayRef[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [roster, setRoster] = useState<EmployeeRoster[]>([]);
  const [loading, setLoading] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'calendar'>('grid');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [selectedDateForAnalysis, setSelectedDateForAnalysis] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [skillFilter, setSkillFilter] = useState('all');
  const [shiftFilter, setShiftFilter] = useState('all');
  const [isEditing, setIsEditing] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const [extraWorkingDays, setExtraWorkingDays] = useState(0);
  const [extraHours, setExtraHours] = useState(0);
  
  // Extra Time Assignment State
  const [isExtraTimeDialogOpen, setIsExtraTimeDialogOpen] = useState(false);
  const [assignmentMode, setAssignmentMode] = useState<'all' | 'selected'>('all');
  const [selectedEmpIds, setSelectedEmpIds] = useState<Set<string>>(new Set());
  const [tempExtraDays, setTempExtraDays] = useState(0);
  const [tempExtraHours, setTempExtraHours] = useState(0);
  const [empSearchTerm, setEmpSearchTerm] = useState('');
  const [isUpdatingExtra, setIsUpdatingExtra] = useState(false);

  const handleApplyExtraTime = async () => {
    setIsUpdatingExtra(true);
    try {
      if (assignmentMode === 'all') {
        // Update global settings
        await updateExtraSettings(tempExtraDays, tempExtraHours);
        
        // Also update ALL employees in the database to match this global setting for consistency
        const batch = writeBatch(db);
        employees.forEach(emp => {
          const ref = doc(db, 'employees', emp.id);
          batch.update(ref, {
            extraWorkingDays: tempExtraDays,
            extraHours: tempExtraHours
          });
        });
        await batch.commit();
        toast.success(`Applied ${tempExtraDays}d / ${tempExtraHours}h to all ${employees.length} staff`);
      } else {
        // Update only selected employees
        const batch = writeBatch(db);
        const selectedCount = selectedEmpIds.size;
        
        if (selectedCount === 0) {
          toast.error('No staff selected');
          setIsUpdatingExtra(false);
          return;
        }

        selectedEmpIds.forEach(id => {
          const ref = doc(db, 'employees', id);
          batch.update(ref, {
            extraWorkingDays: tempExtraDays,
            extraHours: tempExtraHours
          });
        });
        
        await batch.commit();
        toast.success(`Applied ${tempExtraDays}d / ${tempExtraHours}h to ${selectedCount} selected staff`);
      }
      setIsExtraTimeDialogOpen(false);
    } catch (error) {
      console.error(error);
      toast.error('Failed to update extra time settings');
    } finally {
      setIsUpdatingExtra(false);
    }
  };

  const toggleEmpSelect = (id: string) => {
    const newSet = new Set(selectedEmpIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedEmpIds(newSet);
  };

  const toggleSelectAllEmps = () => {
    if (selectedEmpIds.size === employees.length) {
      setSelectedEmpIds(new Set());
    } else {
      setSelectedEmpIds(new Set(employees.map(e => e.id)));
    }
  };

  const updateExtraSettings = async (days: number, hours: number) => {
    setExtraWorkingDays(days);
    setExtraHours(hours);
    try {
      await setDoc(doc(db, 'erlangSettings', 'current'), { 
        extraWorkingDays: days, 
        extraHours: hours 
      }, { merge: true });
    } catch (error) {
      console.error("Failed to save extra settings:", error);
    }
  };

  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    allVolumeData.forEach(d => {
      try {
        months.add(format(new Date(d.date), 'MMM-yy'));
      } catch (e) {
        console.error("Invalid date in volume data:", d.date);
      }
    });
    return Array.from(months).sort((a, b) => {
      // Parse MMM-yy to date for sorting
      const [m, y] = a.split('-');
      const [m2, y2] = b.split('-');
      const dateA = new Date(2000 + parseInt(y), ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(m));
      const dateB = new Date(2000 + parseInt(y2), ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].indexOf(m2));
      return dateA.getTime() - dateB.getTime();
    });
  }, [allVolumeData]);

  const volumeData = useMemo(() => {
    if (!selectedMonth) return allVolumeData;
    return allVolumeData.filter(d => format(new Date(d.date), 'MMM-yy') === selectedMonth);
  }, [allVolumeData, selectedMonth]);

  useEffect(() => {
    if (availableMonths.length > 0 && !selectedMonth) {
      setSelectedMonth(availableMonths[0]);
    }
  }, [availableMonths, selectedMonth]);

  useEffect(() => {
    if (selectedMonth && volumeData.length > 0) {
      const isCurrentDateInMonth = volumeData.some(d => d.date === selectedDateForAnalysis);
      if (!isCurrentDateInMonth) {
        setSelectedDateForAnalysis(volumeData[0].date);
      }
    }
  }, [selectedMonth, volumeData, selectedDateForAnalysis]);

  // Helper: Calculate rest hours between two shifts
  const getRestHours = (prevShift: ShiftCode, nextShift: ShiftCode, extra: number = 0) => {
    const [prevEndH, prevEndM] = prevShift.endTime.split(':').map(Number);
    const [nextStartH, nextStartM] = nextShift.startTime.split(':').map(Number);
    
    let endTotalMinutes = prevEndH * 60 + prevEndM + (extra * 60);
    let startTotalMinutes = nextStartH * 60 + nextStartM;
    
    const [prevStartH] = prevShift.startTime.split(':').map(Number);
    if (prevEndH < prevStartH) {
       // Overnight shift
       return startTotalMinutes - (endTotalMinutes - 1440);
    }
    
    // Normal shift: rest is (24h - end) + start
    return (24 * 60 - endTotalMinutes) + startTotalMinutes;
  };

  interface Violation {
    employeeId: string;
    employeeName: string;
    date: string;
    type: 'REST' | 'CONSECUTIVE' | 'JUMP';
    details: string;
    suggestion: string;
    currentShift: string;
  }

  const getRosterViolations = (): Violation[] => {
    const violations: Violation[] = [];
    
    roster.forEach(emp => {
      let consecutive = 0;
      const empExtraHours = emp.extraHours !== undefined ? emp.extraHours : extraHours;
      
      volumeData.forEach((day, idx) => {
        const shift = emp.days[day.date] || 'OFF';
        
        if (shift !== 'OFF') {
          consecutive++;
          
          // Check Rest Violation
          if (idx > 0) {
            const prevDate = volumeData[idx - 1].date;
            const prevShift = emp.days[prevDate] || 'OFF';
            if (prevShift !== 'OFF') {
              const sPrev = shiftCodes.find(sc => sc.code === prevShift);
              const sCurr = shiftCodes.find(sc => sc.code === shift);
              if (sPrev && sCurr) {
                const restMins = getRestHours(sPrev, sCurr, empExtraHours);
                if (restMins < 11 * 60) {
                  violations.push({
                    employeeId: emp.employeeId,
                    employeeName: emp.employeeName,
                    date: day.date,
                    type: 'REST',
                    details: `Only ${Math.round(restMins/60*10)/10}h rest between ${prevShift} and ${shift}`,
                    suggestion: `Change ${day.date} to an earlier shift or move to a day after an OFF day.`,
                    currentShift: shift
                  });
                } else {
                  // Check for "Jump" (Backward Rotation) even if rest is legal
                  const [prevStartH] = sPrev.startTime.split(':').map(Number);
                  const [currStartH] = sCurr.startTime.split(':').map(Number);
                  if (currStartH < prevStartH) {
                    violations.push({
                      employeeId: emp.employeeId,
                      employeeName: emp.employeeName,
                      date: day.date,
                      type: 'JUMP',
                      details: `Backward shift rotation (Jump) from ${prevShift} to ${shift}`,
                      suggestion: `Not recommended: This reduces jumping accuracy and employee comfort. Consider swapping with a later shift.`,
                      currentShift: shift
                    });
                  }
                }
              }
            }
          }
          
          // Check Consecutive Violation
          if (consecutive > 5) {
            violations.push({
              employeeId: emp.employeeId,
              employeeName: emp.employeeName,
              date: day.date,
              type: 'CONSECUTIVE',
              details: `${consecutive} consecutive working days`,
              suggestion: `Change ${day.date} to OFF and assign to an employee with fewer working days.`,
              currentShift: shift
            });
          }
        } else {
          consecutive = 0;
        }
      });
    });
    
    return violations;
  };

  const violations = getRosterViolations();

  const handleManualShiftChange = async (employeeId: string, date: string, newShiftCode: string) => {
    try {
      const updatedRoster = roster.map(emp => {
        if (emp.employeeId === employeeId) {
          const oldShift = emp.days[date] || 'OFF';
          if (oldShift === newShiftCode) return emp;

          const newDays = { ...emp.days, [date]: newShiftCode };
          
          // Recalculate totals
          let working = 0;
          let off = 0;
          Object.values(newDays).forEach(s => {
            if (s === 'OFF') off++;
            else working++;
          });

          return {
            ...emp,
            days: newDays,
            totalWorkingDays: working,
            totalOffDays: off
          };
        }
        return emp;
      });

      setRoster(updatedRoster);
      await setDoc(doc(db, 'roster', 'current'), { roster: updatedRoster });
      toast.success('Roster updated manually');
    } catch (error) {
      console.error(error);
      toast.error('Failed to update roster');
    }
  };

  const handleQuickFix = (v: Violation) => {
    if (v.type === 'REST' || v.type === 'JUMP') {
      const dayIdx = volumeData.findIndex(d => d.date === v.date);
      if (dayIdx > 0) {
        const prevDate = volumeData[dayIdx - 1].date;
        const emp = roster.find(e => e.employeeId === v.employeeId);
        if (emp) {
          const prevShift = emp.days[prevDate] || 'OFF';
          if (prevShift !== 'OFF') {
            const sPrev = shiftCodes.find(sc => sc.code === prevShift);
            if (sPrev) {
              // Find first shift that gives 11h rest and is NOT a jump if possible
              const [prevStartH] = sPrev.startTime.split(':').map(Number);
              const empExtraHours = emp.extraHours !== undefined ? emp.extraHours : extraHours;
              const safeShifts = shiftCodes.filter(sc => getRestHours(sPrev, sc, empExtraHours) >= 11 * 60);
              
              // Prefer non-jump
              const bestShift = safeShifts.find(sc => {
                const [currStartH] = sc.startTime.split(':').map(Number);
                return currStartH >= prevStartH;
              }) || safeShifts[0];

              if (bestShift) {
                handleManualShiftChange(v.employeeId, v.date, bestShift.code);
                return;
              }
            }
          }
        }
      }
    } else if (v.type === 'CONSECUTIVE') {
      handleManualShiftChange(v.employeeId, v.date, 'OFF');
      return;
    }
    toast.info("No automatic fix available. Please adjust manually.");
  };

  const handleBulkFix = async () => {
    if (violations.length === 0) return;
    
    setLoading(true);
    try {
      let updatedRoster = [...roster];
      
      for (const v of violations) {
        const empIdx = updatedRoster.findIndex(e => e.employeeId === v.employeeId);
        if (empIdx === -1) continue;
        
        const emp = updatedRoster[empIdx];
        const dayIdx = volumeData.findIndex(d => d.date === v.date);
        
        if (v.type === 'REST' || v.type === 'JUMP') {
          if (dayIdx > 0) {
            const prevDate = volumeData[dayIdx - 1].date;
            const prevShift = emp.days[prevDate] || 'OFF';
            if (prevShift !== 'OFF') {
              const sPrev = shiftCodes.find(sc => sc.code === prevShift);
              if (sPrev) {
                const [prevStartH] = sPrev.startTime.split(':').map(Number);
                const empExtraHours = emp.extraHours !== undefined ? emp.extraHours : extraHours;
                const safeShifts = shiftCodes.filter(sc => getRestHours(sPrev, sc, empExtraHours) >= 11 * 60);
                
                const bestShift = safeShifts.find(sc => {
                  const [currStartH] = sc.startTime.split(':').map(Number);
                  return currStartH >= prevStartH;
                }) || safeShifts[0];

                if (bestShift) {
                  const newDays = { ...emp.days, [v.date]: bestShift.code };
                  let working = 0; let off = 0;
                  Object.values(newDays).forEach(s => { if (s === 'OFF') off++; else working++; });
                  updatedRoster[empIdx] = { ...emp, days: newDays, totalWorkingDays: working, totalOffDays: off };
                }
              }
            }
          }
        } else if (v.type === 'CONSECUTIVE') {
          const newDays = { ...emp.days, [v.date]: 'OFF' };
          let working = 0; let off = 0;
          Object.values(newDays).forEach(s => { if (s === 'OFF') off++; else working++; });
          updatedRoster[empIdx] = { ...emp, days: newDays, totalWorkingDays: working, totalOffDays: off };
        }
      }

      setRoster(updatedRoster);
      await setDoc(doc(db, 'roster', 'current'), { roster: updatedRoster });
      toast.success(`Resolved ${violations.length} violations`);
    } catch (error) {
      console.error(error);
      toast.error('Failed to apply bulk fix');
    } finally {
      setLoading(false);
    }
  };

  const getShiftBadgeClasses = (code: string, isRestViolation: boolean, isConsecViolation: boolean, isOnLeave: boolean = false) => {
    if (isOnLeave || code === 'Leave') return 'bg-amber-100 text-amber-800 border-amber-300 ring-1 ring-amber-200';
    if (code === 'OFF') return 'bg-slate-50 text-slate-300 border-slate-100';
    if (isRestViolation || isConsecViolation) {
      if (isRestViolation) return 'bg-red-50 text-red-700 border-red-300 ring-1 ring-red-200';
      return 'bg-orange-50 text-orange-700 border-orange-300 ring-1 ring-orange-200';
    }
    
    const idx = shiftCodes.findIndex(sc => sc.code === code);
    const colors = [
      'bg-blue-50 text-blue-700 border-blue-200',
      'bg-emerald-50 text-emerald-700 border-emerald-200',
      'bg-amber-50 text-amber-700 border-amber-200',
      'bg-purple-50 text-purple-700 border-purple-200',
      'bg-pink-50 text-pink-700 border-pink-200',
      'bg-cyan-50 text-cyan-700 border-cyan-200'
    ];
    return colors[idx % colors.length] || 'bg-indigo-50 text-indigo-700 border-indigo-200';
  };

  // Parameters for Staffing (synced from Firestore)
  const [channelType, setChannelType] = useState<'call' | 'chat' | 'email' | 'whatsapp' | 'multiskill_chat_wa'>('call');
  const [aht, setAht] = useState(300);
  const [targetSL, setTargetSL] = useState(0.8);
  const [targetTime, setTargetTime] = useState(20);
  const [concurrency, setConcurrency] = useState(2);
  const [tat, setTat] = useState(3600); // 1 hour default for email
  const [shrinkage, setShrinkage] = useState(0.3);
  const [operationalWindows, setOperationalWindows] = useState<any>({
    'Monday': { start: '00:00', end: '23:59', isOpen: true },
    'Tuesday': { start: '00:00', end: '23:59', isOpen: true },
    'Wednesday': { start: '00:00', end: '23:59', isOpen: true },
    'Thursday': { start: '00:00', end: '23:59', isOpen: true },
    'Friday': { start: '00:00', end: '23:59', isOpen: true },
    'Saturday': { start: '00:00', end: '23:59', isOpen: true },
    'Sunday': { start: '00:00', end: '23:59', isOpen: true },
  });

  // 0. Pre-process volume data based on operational windows (Carry-over volume)
  const processedVolume = useMemo(() => {
    return applyOperationalWindowsToVolume(volumeData, operationalWindows);
  }, [volumeData, operationalWindows]);

  const { totalDemand, dailyWeights } = useMemo(() => {
    const weights: Record<string, number> = {};
    let total = 0;

    processedVolume.forEach(day => {
      let dayTotalHours = 0;
      let maxAgentsForDay = 0;
      const allIntervalKeys = Object.keys(day.intervals).sort();
      
      Object.entries(day.intervals).forEach(([interval, effectiveVolume]) => {
        const duration = getIntervalDuration(interval, allIntervalKeys);
        let res;
        if (channelType === 'chat' || channelType === 'whatsapp' || channelType === 'multiskill_chat_wa') {
          res = calculateRequiredAgentsChat(effectiveVolume as number, aht, targetSL, targetTime, concurrency, duration);
        } else if (channelType === 'email') {
          res = calculateRequiredAgentsEmail(effectiveVolume as number, aht, targetSL, tat, duration);
        } else {
          res = calculateRequiredAgents(effectiveVolume as number, aht, targetSL, targetTime, duration);
        }
        dayTotalHours += res.agents * duration;
        if (res.agents > maxAgentsForDay) maxAgentsForDay = res.agents;
      });
      
      const standardShiftLength = 8;
      // Weights are now the MAX of (total hours/8) OR the peak requirement
      let weight = Math.max(
        Math.ceil((dayTotalHours / standardShiftLength) * (1 + shrinkage)),
        Math.ceil(maxAgentsForDay * (1 + shrinkage))
      );
      
      const dayConfig = matchDayName(day.day, operationalWindows, day.date);
      if (dayConfig && !dayConfig.isOpen) weight = 0;
      
      weights[day.date] = weight;
      total += weight;
    });
    return { totalDemand: total, dailyWeights: weights };
  }, [processedVolume, aht, targetSL, targetTime, shrinkage, channelType, concurrency, tat]);

  const { targetWorkingDays, targetOffDays, targetHolidays, matchedMonth } = useMemo(() => {
    let twd = 22;
    let tod = 9;
    let th = 0;
    let mm = "Default (5/7 ratio)";
    
    if (volumeData.length > 0) {
      const firstDate = new Date(volumeData[0].date);
      const monthStr = format(firstDate, 'MMM-yy');
      const ref = workingDaysRef.find(r => r.month.toLowerCase() === monthStr.toLowerCase());
      
      if (ref) {
        const scaleFactor = volumeData.length / ref.totalDays;
        
        // Intelligent detection: if workingDays + weekend + holiday = totalDays, then workingDays is net.
        // If workingDays + weekend = totalDays, then workingDays is gross and we subtract holidays.
        let netWorkingDays = ref.workingDays;
        if (ref.workingDays + ref.weekend === ref.totalDays && ref.holiday > 0) {
          netWorkingDays = ref.workingDays - ref.holiday;
        }
        
        twd = Math.round(netWorkingDays * scaleFactor);
        th = Math.round(ref.holiday * scaleFactor);
        tod = volumeData.length - twd; // Off days include weekends and holidays
        mm = ref.month;
      } else {
        // Fallback to standard 5/7 ratio
        twd = Math.round(volumeData.length * (5/7));
        tod = volumeData.length - twd;
      }
    }
    return { targetWorkingDays: twd, targetOffDays: tod, targetHolidays: th, matchedMonth: mm };
  }, [volumeData, workingDaysRef]);

  const isApprovedLeave = (employeeId: string, date: string) => {
    return leaveRequests.some(req => 
      req.employeeId === employeeId && 
      req.date === date && 
      req.status === 'approved'
    );
  };

  const shortageInfo = useMemo(() => {
    if (employees.length === 0 || volumeData.length === 0) return null;
    
    // Calculate total approved leave days in the period
    const totalApprovedLeaveDays = leaveRequests.reduce((sum, req) => {
      if (req.status === 'approved' && volumeData.some(d => d.date === req.date)) {
        return sum + 1;
      }
      return sum;
    }, 0);

    // Calculate base ideal capacity (without extra days)
    const baseIdealCapacity = (employees.length * targetWorkingDays) - totalApprovedLeaveDays;
    
    // Calculate raw demand (100% supply factor)
    let totalRawDemandBase = 0;
    volumeData.forEach(day => {
      let dayTotalHours = 0;
      let maxAgentsForDay = 0;
      const allIntervalKeys = Object.keys(day.intervals).sort();
      Object.entries(day.intervals).forEach(([interval, val]) => {
        const duration = getIntervalDuration(interval, allIntervalKeys);
        const volume = Number(val) || 0;
        let res;
        if (channelType === 'chat' || channelType === 'whatsapp' || channelType === 'multiskill_chat_wa') {
          res = calculateRequiredAgentsChat(volume, aht, targetSL, targetTime, concurrency, duration);
        } else if (channelType === 'email') {
          res = calculateRequiredAgentsEmail(volume, aht, targetSL, tat, duration);
        } else {
          res = calculateRequiredAgents(volume, aht, targetSL, targetTime, duration);
        }
        dayTotalHours += res.agents * duration;
        if (res.agents > maxAgentsForDay) maxAgentsForDay = res.agents;
      });
      const weight = Math.max(
        Math.ceil((dayTotalHours / 8) * (1 + shrinkage)),
        Math.ceil(maxAgentsForDay * (1 + shrinkage))
      );
      totalRawDemandBase += weight;
    });
    
    const baseShortage = totalRawDemandBase - baseIdealCapacity;
    const suggestedExtraDays = baseShortage > 0 ? Math.ceil(baseShortage / employees.length) : 0;
    
    const currentIdealCapacity = employees.reduce((sum, emp) => {
      const empExtraDays = emp.extraWorkingDays !== undefined ? emp.extraWorkingDays : extraWorkingDays;
      const empExtraHours = emp.extraHours !== undefined ? emp.extraHours : extraHours;
      const shiftMultiplier = (8 + empExtraHours) / 8;
      
      // Calculate this employee's approved leave days in this period
      const empLeaveDays = leaveRequests.filter(req => 
        req.employeeId === emp.id && 
        req.status === 'approved' && 
        volumeData.some(d => d.date === req.date)
      ).length;

      return sum + ((targetWorkingDays + empExtraDays - empLeaveDays) * shiftMultiplier);
    }, 0);

    let currentRawDemand = 0;
    volumeData.forEach(day => {
      const needed = dailyWeights[day.date] || 0;
      currentRawDemand += needed; // Actual real demand
    });

    const currentShortage = Math.max(0, currentRawDemand - currentIdealCapacity);

    // Monthly FTE Calculation
    const totalWorkHours = volumeData.reduce((acc, day) => {
      let dayHours = 0;
      const allIntervalKeys = Object.keys(day.intervals).sort();
      Object.entries(day.intervals).forEach(([interval, val]) => {
        // Check if interval is within window for this specific day
        const dayName = day.day; // e.g., "Monday"
        const dayConfig = operationalWindows?.[dayName];
        
        let isInWindow = true;
        if (dayConfig) {
          if (!dayConfig.isOpen) {
            isInWindow = false;
          } else {
            isInWindow = isIntervalInWindow(interval, dayConfig.start, dayConfig.end);
          }
        }

        if (!isInWindow) return;

        const duration = getIntervalDuration(interval, allIntervalKeys);
        const volume = Number(val) || 0;
        let res;
        if (channelType === 'chat' || channelType === 'whatsapp' || channelType === 'multiskill_chat_wa') {
          res = calculateRequiredAgentsChat(volume, aht, targetSL, targetTime, concurrency, duration);
        } else if (channelType === 'email') {
          res = calculateRequiredAgentsEmail(volume, aht, targetSL, tat, duration);
        } else {
          res = calculateRequiredAgents(volume, aht, targetSL, targetTime, duration);
        }
        dayHours += res.agents * duration;
      });
      return acc + dayHours;
    }, 0);

    const netFTE = totalWorkHours / (8 * targetWorkingDays);
    const grossFTE = netFTE / (1 - shrinkage);

    return { 
      baseShortage, 
      suggestedExtraDays, 
      currentShortage,
      isCovered: currentShortage === 0,
      grossFTE: Math.ceil(grossFTE),
      totalWorkHours: Math.round(totalWorkHours),
      effectiveSupply: currentIdealCapacity
    };
  }, [employees.length, volumeData, targetWorkingDays, extraWorkingDays, extraHours, dailyWeights, aht, targetSL, targetTime, shrinkage, operationalWindows, channelType, concurrency, tat]);

  useEffect(() => {
    const unsubVolume = onSnapshot(query(collection(db, 'forecastVolume')), (snapshot) => {
      const list = snapshot.docs.map(doc => doc.data() as ForecastVolumeData);
      const sorted = list.sort((a, b) => a.date.localeCompare(b.date));
      setAllVolumeData(sorted);
      if (sorted.length > 0 && !selectedDateForAnalysis) {
        setSelectedDateForAnalysis(sorted[0].date);
      }
    });

    const unsubShifts = onSnapshot(query(collection(db, 'shiftCodes')), (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ShiftCode));
      setShiftCodes(list);
    });

    const unsubEmployees = onSnapshot(query(collection(db, 'employees')), (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Employee));
      setEmployees(list);
    });

    const unsubRef = onSnapshot(query(collection(db, 'workingDaysRef')), (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as WorkingDayRef));
      setWorkingDaysRef(list);
    });

    const unsubRoster = onSnapshot(doc(db, 'roster', 'current'), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data.roster) {
          // Sanitize to prevent undefined issues
          const sanitized = data.roster.map((emp: any) => ({
            ...emp,
            gender: emp.gender || 'L',
            preferredShifts: emp.preferredShifts || [],
            extraHours: emp.extraHours !== undefined ? emp.extraHours : 0
          }));
          setRoster(sanitized);
        }
      }
    });

    const unsubSettings = onSnapshot(doc(db, 'erlangSettings', 'current'), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data.channelType) setChannelType(data.channelType);
        if (data.aht) setAht(data.aht);
        if (data.targetSL) setTargetSL(data.targetSL / 100); // Erlang lib expects 0.8 for 80%
        if (data.targetTime) setTargetTime(data.targetTime);
        if (data.concurrency) setConcurrency(data.concurrency);
        if (data.tat) setTat(data.tat);
        if (data.shrinkage) setShrinkage(data.shrinkage / 100);
        if (data.operationalWindows) setOperationalWindows(data.operationalWindows);
        if (data.extraWorkingDays !== undefined) setExtraWorkingDays(data.extraWorkingDays);
        if (data.extraHours !== undefined) setExtraHours(data.extraHours);
      }
    });

    const qLeaves = isAdmin 
      ? query(collection(db, 'leaveRequests'))
      : query(collection(db, 'leaveRequests'), where('status', '==', 'approved'));

    const unsubLeaves = onSnapshot(qLeaves, (snapshot) => {
      setLeaveRequests(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as LeaveRequest)));
    });

    return () => {
      unsubVolume();
      unsubShifts();
      unsubEmployees();
      unsubRef();
      unsubRoster();
      unsubSettings();
      unsubLeaves();
    };
  }, []);

  const getJumpingAccuracy = () => {
    if (roster.length === 0 || volumeData.length < 2) return 100;
    
    let totalShifts = 0;
    let jumps = 0;
    
    roster.forEach(emp => {
      volumeData.forEach((day, idx) => {
        if (idx === 0) return;
        const prevDate = volumeData[idx - 1].date;
        const currShift = emp.days[day.date];
        const prevShift = emp.days[prevDate];
        
        if (currShift && currShift !== 'OFF' && prevShift && prevShift !== 'OFF') {
          totalShifts++;
          const sCurr = shiftCodes.find(sc => sc.code === currShift);
          const sPrev = shiftCodes.find(sc => sc.code === prevShift);
          if (sCurr && sPrev) {
            const [pH] = sPrev.startTime.split(':').map(Number);
            const [cH] = sCurr.startTime.split(':').map(Number);
            if (cH < pH) jumps++;
          }
        }
      });
    });
    
    if (totalShifts === 0) return 100;
    return Math.round(((totalShifts - jumps) / totalShifts) * 100);
  };

  const clearRoster = async () => {
    setLoading(true);
    try {
      await setDoc(doc(db, 'roster', 'current'), { roster: [] });
      setRoster([]);
      setShowClearConfirm(false);
      toast.success('Roster cleared successfully');
    } catch (error) {
      console.error(error);
      toast.error('Failed to clear roster');
    } finally {
      setLoading(false);
    }
  };

  const MetricCard = ({ title, value, icon, description, status }: { title: string, value: string, icon: React.ReactNode, description: string, status?: 'success' | 'warning' | 'danger' }) => (
    <Card className="border-none shadow-sm hover:shadow-md transition-shadow duration-200">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="p-2 bg-slate-50 rounded-lg">
            {icon}
          </div>
          {status && (
            <div className={`w-2 h-2 rounded-full ${
              status === 'success' ? 'bg-emerald-500' : 
              status === 'warning' ? 'bg-amber-500' : 'bg-red-500'
            }`} />
          )}
        </div>
        <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">{title}</p>
        <p className="text-xl font-bold text-slate-900 my-1">{value}</p>
        <p className="text-[10px] text-slate-400 font-medium">{description}</p>
      </CardContent>
    </Card>
  );

  const generateBalancedRoster = async (mode: 'base' | 'overtime' = 'base') => {
    if (volumeData.length === 0 || shiftCodes.length === 0 || employees.length === 0) {
      toast.error('Missing data (Volume, Shifts, or Employees)');
      return;
    }

    setLoading(true);
    try {
      // 1. Use memoized daily requirements (already carry-over processed in processedVolume)

      // 2. Determine Effective Target Working Days per Employee
      const getEmpTargetDays = (emp: Employee) => {
        const empExtraDays = emp.extraWorkingDays !== undefined ? emp.extraWorkingDays : extraWorkingDays;
        return mode === 'overtime' ? (targetWorkingDays + empExtraDays) : targetWorkingDays;
      };

      // 2.5 Constraint Check Helper
      const isConstraintViolation = (emp: EmployeeRoster, shiftCode: string) => {
        if (shiftCode === 'OFF') return false;
        const codeObj = shiftCodes.find(c => c.code === shiftCode);
        if (!codeObj) return false;

        // Female Night Shift Constraint (P = Perempuan / Female)
        if (emp.gender === 'P' && codeObj.isNightShift) return true;

        // Shift Preference Constraint
        if (emp.preferredShifts && emp.preferredShifts.length > 0) {
          if (!emp.preferredShifts.includes(shiftCode)) return true;
        }

        return false;
      };

      toast.info(`Generating ${mode === 'overtime' ? 'Overtime' : 'Base'} Roster with per-agent settings...`);

      // 3. Calculate Precision Headcounts
      // Total shifts available in the month for all employees (Ideal Capacity)
      const totalApprovedLeaveDays = leaveRequests.reduce((sum, req) => {
        if (req.status === 'approved' && volumeData.some(d => d.date === req.date)) {
          return sum + 1;
        }
        return sum;
      }, 0);

      const idealCapacity = employees.reduce((sum, emp) => sum + getEmpTargetDays(emp), 0) - totalApprovedLeaveDays;
      const adjustedDailyHeadcounts: Record<string, number> = {};
      
      // Calculate raw demand (100% coverage)
      const rawDailyDemand: Record<string, number> = {};
      let totalRawDemand = 0;
      processedVolume.forEach(day => {
        const needed = dailyWeights[day.date] || 0;
        const onLeaveCount = leaveRequests.filter(r => r.date === day.date && r.status === 'approved').length;
        const availableCount = employees.length - onLeaveCount;
        
        // Use 100% supply factor for base planning
        const supplyTarget = Math.ceil(needed);
        const capped = Math.min(supplyTarget, availableCount);
        rawDailyDemand[day.date] = capped;
        totalRawDemand += capped;
      });

      // Initial assignment based on raw demand
      let assignedSoFar = 0;
      processedVolume.forEach(day => {
        adjustedDailyHeadcounts[day.date] = rawDailyDemand[day.date];
        assignedSoFar += rawDailyDemand[day.date];
      });

      let diff = idealCapacity - assignedSoFar;
      
      // Balancing Logic:
      if (diff > 0) {
        // Surplus: Fill up to idealCapacity to ensure staff get their days
        // CRITICAL: Skip days that are officially closed in operational windows
        const sortedByWeightDesc = [...processedVolume].sort((a, b) => dailyWeights[b.date] - dailyWeights[a.date]);
        let safetyCounter = 0;
        while (diff > 0 && safetyCounter < 100) {
          let changed = false;
          for (const day of sortedByWeightDesc) {
            const dayConfig = matchDayName(day.day, operationalWindows, day.date);
            const isDayOpen = dayConfig ? dayConfig.isOpen : true;
            const onLeaveCount = leaveRequests.filter(r => r.date === day.date && r.status === 'approved').length;
            const availableCount = employees.length - onLeaveCount;

            if (isDayOpen && adjustedDailyHeadcounts[day.date] < availableCount) {
              adjustedDailyHeadcounts[day.date]++;
              diff--;
              changed = true;
            }
            if (diff === 0) break;
          }
          if (!changed) break;
          safetyCounter++;
        }
      } else if (diff < 0) {
        // Shortage: we MUST reduce assignments to stay within the active target days.
        const sortedByWeightAsc = [...processedVolume].sort((a, b) => dailyWeights[a.date] - dailyWeights[b.date]);
        let safetyCounter = 0;
        while (diff < 0 && safetyCounter < 100) {
          let changed = false;
          for (const day of sortedByWeightAsc) {
            if (adjustedDailyHeadcounts[day.date] > 0) {
              adjustedDailyHeadcounts[day.date]--;
              diff++;
              changed = true;
            }
            if (diff === 0) break;
          }
          if (!changed) break;
          safetyCounter++;
        }
      }

      // 4. Calculate Shift Distributions for each day based on adjusted headcount
      const dailyRequirements: Record<string, Record<string, number>> = {};

      processedVolume.forEach(day => {
        const headcount = adjustedDailyHeadcounts[day.date];
        const shiftSuggestions: Record<string, number> = {};
        shiftCodes.forEach(c => shiftSuggestions[c.code] = 0);

        // Calculate required agents per interval for this day
        const intervalRequirements: Record<string, number> = {};
        const allIntervalKeys = Object.keys(day.intervals).sort();
        
        // Intervals are already processed for window and carry-over by processedVolume
        Object.entries(day.intervals).forEach(([interval, effectiveVolume]) => {
          const duration = getIntervalDuration(interval, allIntervalKeys);
          let res;
          if (channelType === 'chat' || channelType === 'whatsapp' || channelType === 'multiskill_chat_wa') {
            res = calculateRequiredAgentsChat(effectiveVolume as number, aht, targetSL, targetTime, concurrency, duration);
          } else if (channelType === 'email') {
            res = calculateRequiredAgentsEmail(effectiveVolume as number, aht, targetSL, tat, duration);
          } else {
            res = calculateRequiredAgents(effectiveVolume as number, aht, targetSL, targetTime, duration);
          }
          intervalRequirements[interval] = Math.ceil(res.agents * (1 + shrinkage));
        });

        const currentAssigned: Record<string, number> = {};
        Object.keys(intervalRequirements).forEach(int => currentAssigned[int] = 0);

        let assignedCount = 0;
        while (assignedCount < headcount) {
          let bestShift = null;
          let maxScore = -Infinity;

          for (const code of shiftCodes) {
            let score = 0;
            
            Object.keys(intervalRequirements).forEach(interval => {
              if (isIntervalInShift(interval, code.startTime, code.endTime, extraHours)) {
                const gap = intervalRequirements[interval] - currentAssigned[interval];
                
                // Check if this interval is actually within the operational window for this day
                const dayName = day.day;
                const dayConfig = matchDayName(dayName, operationalWindows, day.date);
                
                let isOpWindow = true;
                if (dayConfig) {
                  if (!dayConfig.isOpen) isOpWindow = false;
                  else isOpWindow = isIntervalInWindow(interval, dayConfig.start, dayConfig.end);
                }

                if (!isOpWindow) {
                  // HEAVY PENALTY: Do not assign staff during closed hours
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

            // Tie-breaker: prefer shifts that are already suggested for this day
            if (shiftSuggestions[code.code] > 0) {
              score += 1;
            }

            if (score > maxScore) {
              maxScore = score;
              bestShift = code;
            }
          }

          if (bestShift) {
            shiftSuggestions[bestShift.code]++;
            Object.keys(intervalRequirements).forEach(interval => {
              if (isIntervalInShift(interval, bestShift!.startTime, bestShift!.endTime, extraHours)) {
                currentAssigned[interval]++;
              }
            });
            assignedCount++;
          } else {
            break;
          }
        }
        dailyRequirements[day.date] = shiftSuggestions;
      });

      // 5. Initialize Roster and Shift Counters
      const newRoster: EmployeeRoster[] = employees.map(emp => {
        const baseEmpTargetDays = getEmpTargetDays(emp);
        const empLeaveDays = leaveRequests.filter(req => 
          req.employeeId === emp.id && 
          req.status === 'approved' && 
          volumeData.some(d => d.date === req.date)
        ).length;
        
        const empTargetDays = Math.max(0, baseEmpTargetDays - empLeaveDays);
        const empTargetOff = Math.max(0, processedVolume.length - empTargetDays - empLeaveDays);

        return {
          employeeId: emp.id,
          employeeName: emp.name,
          nip: emp.nip,
          gender: emp.gender || 'L',
          preferredShifts: emp.preferredShifts || [],
          days: {},
          totalWorkingDays: 0,
          totalOffDays: 0,
          targetWorkingDays: empTargetDays,
          targetOffDays: empTargetOff,
          extraHours: emp.extraHours !== undefined ? emp.extraHours : extraHours
        };
      });

      const shiftCounts: Record<string, Record<string, number>> = {}; // employeeId -> shiftCode -> count
      employees.forEach(emp => {
        shiftCounts[emp.id] = {};
        shiftCodes.forEach(sc => {
          shiftCounts[emp.id][sc.code] = 0;
        });
      });

      // 6. Assign shifts day by day with enhanced "Best Match" logic for Jumping Accuracy and Coverage
      processedVolume.forEach((day, dayIdx) => {
        const reqs = { ...dailyRequirements[day.date] };
        const prevDayDate = dayIdx > 0 ? processedVolume[dayIdx - 1].date : null;
        const remainingDaysInMonth = processedVolume.length - dayIdx;
        
        // Create a list of all required shift slots for today
        const shiftSlots: string[] = [];
        Object.entries(reqs).forEach(([code, count]) => {
          for (let i = 0; i < count; i++) shiftSlots.push(code);
        });

        // Pre-assign approved leave as OFF
        newRoster.forEach(emp => {
          if (!emp.days[day.date] && isApprovedLeave(emp.employeeId, day.date)) {
            emp.days[day.date] = 'OFF';
            emp.totalOffDays++;
          }
        });

        const availableEmployees = [...newRoster].filter(emp => !emp.days[day.date]);
        
        // Helper to check consecutive days
        const getConsecutive = (emp: EmployeeRoster) => {
          let count = 0;
          for (let i = dayIdx - 1; i >= 0; i--) {
            const d = processedVolume[i].date;
            if (emp.days[d] && emp.days[d] !== 'OFF') count++;
            else break;
          }
          return count;
        };

        // Helper to check consecutive off days
        const getConsecutiveOff = (emp: EmployeeRoster) => {
          let count = 0;
          for (let i = dayIdx - 1; i >= 0; i--) {
            const d = processedVolume[i].date;
            if (emp.days[d] === 'OFF') count++;
            else break;
          }
          return count;
        };

        // Assign shifts using a greedy "Best Match" approach
        while (shiftSlots.length > 0 && availableEmployees.length > 0) {
          let bestMatch: { empIdx: number, slotIdx: number, score: number } | null = null;

          for (let eIdx = 0; eIdx < availableEmployees.length; eIdx++) {
            const emp = availableEmployees[eIdx];
            const consec = getConsecutive(emp);
            const consecOff = getConsecutiveOff(emp);
            const needed = emp.targetWorkingDays - emp.totalWorkingDays;
            const isCritical = needed >= remainingDaysInMonth;

            for (let sIdx = 0; sIdx < shiftSlots.length; sIdx++) {
              const shiftCode = shiftSlots[sIdx];
              const codeObj = shiftCodes.find(c => c.code === shiftCode)!;
              
              let score = 0;

              // 1. Hard Constraints (Rest Period & Labor Law)
              if (consec >= 5) score -= 1000; // Penalty for 5 days
              if (consec >= 6) score -= 8000; // Critical penalty for 6-day violation

              // 1.2 Gender-based constraints & Preferences
              if (isConstraintViolation(emp, shiftCode)) {
                continue; // HARD SKIP: Do not assign this shift to this employee
              } else if (emp.preferredShifts && emp.preferredShifts.includes(shiftCode)) {
                score += 2000; // Significant bonus for fulfilling a preference
              }
              
              // 1.5 OFF Day Distribution (Spacing)
              if (consecOff === 0 && emp.totalOffDays < emp.targetOffDays) {
                // If they haven't had an OFF day recently, they might need one
                // But if they are critical for working, we still prioritize work
              }
              if (consecOff >= 1) score += 100; // Encourage breaking off streaks if they have had at least 1 day off
              if (consecOff >= 2) score += 500; // Strongly encourage returning to work after 2 days off
              
              if (prevDayDate) {
                const prevShiftCode = emp.days[prevDayDate];
                if (prevShiftCode && prevShiftCode !== 'OFF') {
                  const prevCodeObj = shiftCodes.find(c => c.code === prevShiftCode);
                  if (prevCodeObj) {
                    const empExtraHours = emp.extraHours !== undefined ? emp.extraHours : extraHours;
                    const rest = getRestHours(prevCodeObj, codeObj, empExtraHours);
                    if (rest < 11 * 60) score -= 10000; // Critical penalty for rest violation
                    
                    // 2. Forward Rotation (Jumping Accuracy)
                    const [prevH] = prevCodeObj.startTime.split(':').map(Number);
                    const [currH] = codeObj.startTime.split(':').map(Number);
                    if (currH < prevH) {
                      score -= 3000; // Even heavier penalty for backward jump
                    } else if (currH > prevH) {
                      score += 150; // Higher bonus for forward rotation
                    } else {
                      score += 80; // Higher bonus for same shift (stability)
                    }
                  }
                } else {
                  // Coming from OFF day - neutral but slightly positive
                  score += 50; 
                }
              }

              // 3. Monthly Target Adherence
              if (isCritical) score += 5000;
              score += needed * 100;

              // STRICT TARGET ADHERENCE: Heavy penalty if already at or over target
              if (emp.totalWorkingDays >= emp.targetWorkingDays) {
                score -= 20000;
              }

              // 4. Shift Balancing
              const shiftCount = shiftCounts[emp.employeeId][shiftCode] || 0;
              score -= shiftCount * 20;

              // 5. Off Day Balancing
              if (consecOff >= 2) score += 200;

              if (!bestMatch || score > bestMatch.score) {
                bestMatch = { empIdx: eIdx, slotIdx: sIdx, score };
              }
            }
          }

          if (bestMatch && bestMatch.score > -5000) {
            const emp = availableEmployees[bestMatch.empIdx];
            const shiftCode = shiftSlots[bestMatch.slotIdx];
            
            emp.days[day.date] = shiftCode;
            emp.totalWorkingDays++;
            shiftCounts[emp.employeeId][shiftCode] = (shiftCounts[emp.employeeId][shiftCode] || 0) + 1;
            
            shiftSlots.splice(bestMatch.slotIdx, 1);
            availableEmployees.splice(bestMatch.empIdx, 1);
          } else {
            // No more viable matches for today
            break;
          }
        }

        // Assign OFF to remaining employees
        availableEmployees.forEach(emp => {
          emp.days[day.date] = 'OFF';
          emp.totalOffDays++;
        });

        // 6.5 Daily Jump Optimizer: Swap shifts on the same day to minimize jumps
        if (prevDayDate) {
          let dailySwapSafety = 0;
          let swappedThisDay = true;
          while (swappedThisDay && dailySwapSafety < 5) {
            swappedThisDay = false;
            dailySwapSafety++;
            for (let i = 0; i < newRoster.length; i++) {
              for (let j = i + 1; j < newRoster.length; j++) {
                const emp1 = newRoster[i];
                const emp2 = newRoster[j];
                const shift1 = emp1.days[day.date];
                const shift2 = emp2.days[day.date];

                if (shift1 !== 'OFF' && shift2 !== 'OFF' && shift1 !== shift2) {
                  const sCode1 = shiftCodes.find(c => c.code === shift1)!;
                  const sCode2 = shiftCodes.find(c => c.code === shift2)!;

                  const getJumps = (emp: EmployeeRoster, sCode: ShiftCode) => {
                    const prev = emp.days[prevDayDate];
                    if (!prev || prev === 'OFF') return 0;
                    const prevS = shiftCodes.find(c => c.code === prev)!;
                    const [pH] = prevS.startTime.split(':').map(Number);
                    const [cH] = sCode.startTime.split(':').map(Number);
                    return cH < pH ? 1 : 0;
                  };

                  const checkRest = (emp: EmployeeRoster, sCode: ShiftCode) => {
                    const prev = emp.days[prevDayDate];
                    if (prev && prev !== 'OFF') {
                      const sPrev = shiftCodes.find(sc => sc.code === prev);
                      const empExtraHours = emp.extraHours !== undefined ? emp.extraHours : extraHours;
                      if (sPrev && getRestHours(sPrev, sCode, empExtraHours) < 11 * 60) return false;
                    }
                    return true;
                  };

                  const currentJumps = getJumps(emp1, sCode1) + getJumps(emp2, sCode2);
                  const swappedJumps = getJumps(emp1, sCode2) + getJumps(emp2, sCode1);

                  if (swappedJumps < currentJumps && checkRest(emp1, sCode2) && checkRest(emp2, sCode1)) {
                    emp1.days[day.date] = shift2;
                    emp2.days[day.date] = shift1;
                    shiftCounts[emp1.employeeId][shift1]--;
                    shiftCounts[emp1.employeeId][shift2]++;
                    shiftCounts[emp2.employeeId][shift2]--;
                    shiftCounts[emp2.employeeId][shift1]++;
                    swappedThisDay = true;
                  }
                }
              }
            }
          }

          // 6.6 Daily Fairness Balancer: Swap shifts to improve even distribution IF it doesn't create jumps
          let fairnessSafety = 0;
          let fairnessSwapped = true;
          while (fairnessSwapped && fairnessSafety < 5) {
            fairnessSwapped = false;
            fairnessSafety++;
            for (let i = 0; i < newRoster.length; i++) {
              for (let j = i + 1; j < newRoster.length; j++) {
                const emp1 = newRoster[i];
                const emp2 = newRoster[j];
                const shift1 = emp1.days[day.date];
                const shift2 = emp2.days[day.date];

                if (shift1 !== 'OFF' && shift2 !== 'OFF' && shift1 !== shift2) {
                  const sCode1 = shiftCodes.find(c => c.code === shift1)!;
                  const sCode2 = shiftCodes.find(c => c.code === shift2)!;

                  const aCount1 = shiftCounts[emp1.employeeId][shift1] || 0;
                  const aCount2 = shiftCounts[emp1.employeeId][shift2] || 0;
                  const bCount1 = shiftCounts[emp2.employeeId][shift1] || 0;
                  const bCount2 = shiftCounts[emp2.employeeId][shift2] || 0;

                  // Fairness score: we want counts to be as close as possible
                  const currentDiff = Math.abs(aCount1 - bCount1) + Math.abs(aCount2 - bCount2);
                  const swappedDiff = Math.abs((aCount1 - 1) - (bCount1 + 1)) + Math.abs((aCount2 + 1) - (bCount2 - 1));

                  if (swappedDiff < currentDiff) {
                    // Check if swap is safe (No Jumps, No Rest Violations)
                    const getJumps = (emp: EmployeeRoster, sCode: ShiftCode) => {
                      const prev = emp.days[prevDayDate];
                      if (!prev || prev === 'OFF') return 0;
                      const prevS = shiftCodes.find(c => c.code === prev)!;
                      const [pH] = prevS.startTime.split(':').map(Number);
                      const [cH] = sCode.startTime.split(':').map(Number);
                      return cH < pH ? 1 : 0;
                    };
                    const checkRest = (emp: EmployeeRoster, sCode: ShiftCode) => {
                      const prev = emp.days[prevDayDate];
                      if (prev && prev !== 'OFF') {
                        const sPrev = shiftCodes.find(sc => sc.code === prev);
                        if (sPrev && getRestHours(sPrev, sCode, extraHours) < 11 * 60) return false;
                      }
                      return true;
                    };

                    const currentJumps = getJumps(emp1, sCode1) + getJumps(emp2, sCode2);
                    const swappedJumps = getJumps(emp1, sCode2) + getJumps(emp2, sCode1);

                    if (swappedJumps <= currentJumps && checkRest(emp1, sCode2) && checkRest(emp2, sCode1)) {
                      emp1.days[day.date] = shift2;
                      emp2.days[day.date] = shift1;
                      shiftCounts[emp1.employeeId][shift1]--;
                      shiftCounts[emp1.employeeId][shift2]++;
                      shiftCounts[emp2.employeeId][shift2]--;
                      shiftCounts[emp2.employeeId][shift1]++;
                      fairnessSwapped = true;
                    }
                  }
                }
              }
            }
          }
        }
      });

      // 6.8 Compliance First Rebalancer: Resolve violations before worrying about precision
      // This stage specifically targets Rest and Consecutive Day violations
      let complianceSafety = 0;
      while (complianceSafety < 500) {
        let violationFound = false;
        for (const emp of newRoster) {
          for (let i = 0; i < volumeData.length; i++) {
            const date = volumeData[i].date;
            const shift = emp.days[date];
            if (shift === 'OFF') continue;

            // 1. Check Rest Violation
            let restViolation = false;
            if (i > 0) {
              const prevShift = emp.days[volumeData[i-1].date];
              if (prevShift && prevShift !== 'OFF') {
                const sPrev = shiftCodes.find(sc => sc.code === prevShift);
                const sCurr = shiftCodes.find(sc => sc.code === shift);
                if (sPrev && sCurr && getRestHours(sPrev, sCurr, extraHours) < 11 * 60) {
                  restViolation = true;
                }
              }
            }

            // 2. Check Consecutive Violation
            let consecCount = 0;
            for (let j = i; j >= 0; j--) {
              if (emp.days[volumeData[j].date] !== 'OFF') consecCount++;
              else break;
            }
            for (let j = i + 1; j < volumeData.length; j++) {
              if (emp.days[volumeData[j].date] !== 'OFF') consecCount++;
              else break;
            }
            const consecViolation = consecCount > 5;

            if (restViolation || consecViolation) {
              let resolved = false;
              // Try to find an OFF day for this employee that doesn't cause violations
              for (let j = 0; j < volumeData.length; j++) {
                const targetDate = volumeData[j].date;
                if (emp.days[targetDate] === 'OFF' && !isApprovedLeave(emp.employeeId, targetDate)) {
                  const sCurr = shiftCodes.find(sc => sc.code === shift)!;
                  let targetRestOk = true;
                  if (j > 0) {
                    const prev = emp.days[volumeData[j-1].date];
                    if (prev && prev !== 'OFF') {
                      const sPrev = shiftCodes.find(sc => sc.code === prev);
                      if (sPrev && getRestHours(sPrev, sCurr, extraHours) < 11 * 60) targetRestOk = false;
                    }
                  }
                  if (targetRestOk && j < volumeData.length - 1) {
                    const next = emp.days[volumeData[j+1].date];
                    if (next && next !== 'OFF') {
                      const sNext = shiftCodes.find(sc => sc.code === next);
                      if (sNext && getRestHours(sCurr, sNext, extraHours) < 11 * 60) targetRestOk = false;
                    }
                  }

                  let targetConsecCount = 1;
                  for (let k = j - 1; k >= 0; k--) {
                    if (emp.days[volumeData[k].date] !== 'OFF') targetConsecCount++;
                    else break;
                  }
                  for (let k = j + 1; k < volumeData.length; k++) {
                    if (emp.days[volumeData[k].date] !== 'OFF') targetConsecCount++;
                    else break;
                  }
                  const targetConsecOk = targetConsecCount <= 5;

                  if (targetRestOk && targetConsecOk && !isConstraintViolation(emp, shift)) {
                    emp.days[targetDate] = shift;
                    emp.days[date] = 'OFF';
                    resolved = true;
                    violationFound = true;
                    break;
                  }
                }
              }

              if (!resolved) {
                // Try swapping with another employee
                for (const other of newRoster) {
                  if (other.employeeId === emp.employeeId) continue;
                  if (other.days[date] !== 'OFF' || isApprovedLeave(other.employeeId, date)) continue;

                  for (let j = 0; j < volumeData.length; j++) {
                    const otherDate = volumeData[j].date;
                    const otherShift = other.days[otherDate];
                    if (otherShift !== 'OFF' && emp.days[otherDate] === 'OFF' && !isApprovedLeave(emp.employeeId, otherDate)) {
                      const sOther = shiftCodes.find(sc => sc.code === otherShift)!;
                      let empOtherRestOk = true;
                      if (j > 0) {
                        const prev = emp.days[volumeData[j-1].date];
                        if (prev && prev !== 'OFF') {
                          const sPrev = shiftCodes.find(sc => sc.code === prev);
                          if (sPrev && getRestHours(sPrev, sOther, extraHours) < 11 * 60) empOtherRestOk = false;
                        }
                      }
                      if (empOtherRestOk && j < volumeData.length - 1) {
                        const next = emp.days[volumeData[j+1].date];
                        if (next && next !== 'OFF') {
                          const sNext = shiftCodes.find(sc => sc.code === next);
                          if (sNext && getRestHours(sOther, sNext, extraHours) < 11 * 60) empOtherRestOk = false;
                        }
                      }

                      const sEmp = shiftCodes.find(sc => sc.code === shift)!;
                      const dateIdx = i;
                      let otherDateRestOk = true;
                      if (dateIdx > 0) {
                        const prev = other.days[volumeData[dateIdx-1].date];
                        if (prev && prev !== 'OFF') {
                          const sPrev = shiftCodes.find(sc => sc.code === prev);
                          if (sPrev && getRestHours(sPrev, sEmp, extraHours) < 11 * 60) otherDateRestOk = false;
                        }
                      }
                      if (otherDateRestOk && dateIdx < volumeData.length - 1) {
                        const next = other.days[volumeData[dateIdx+1].date];
                        if (next && next !== 'OFF') {
                          const sNext = shiftCodes.find(sc => sc.code === next);
                          if (sNext && getRestHours(sEmp, sNext, extraHours) < 11 * 60) otherDateRestOk = false;
                        }
                      }

                      if (empOtherRestOk && otherDateRestOk && !isConstraintViolation(emp, otherShift) && !isConstraintViolation(other, shift)) {
                        emp.days[date] = 'OFF';
                        emp.days[otherDate] = otherShift;
                        other.days[date] = shift;
                        other.days[otherDate] = 'OFF';
                        resolved = true;
                        violationFound = true;
                        break;
                      }
                    }
                  }
                  if (resolved) break;
                }
              }
            }
            if (violationFound) break;
          }
          if (violationFound) break;
        }
        if (!violationFound) break;
        complianceSafety++;
      }

      // 7. Post-Processing Rebalancer for 100% Precision
      // If someone is over and someone is under, swap shifts on days where the under-target person is OFF
      let rebalanceSafety = 0;
      
      const getMaxStreak = (emp: EmployeeRoster) => {
        let max = 0;
        let current = 0;
        volumeData.forEach(day => {
          if (emp.days[day.date] !== 'OFF') {
            current++;
            if (current > max) max = current;
          } else {
            current = 0;
          }
        });
        return max;
      };

      while (rebalanceSafety < 1000) {
        const overTarget = newRoster
          .filter(e => e.totalWorkingDays > e.targetWorkingDays)
          .sort((a, b) => {
            const aStreak = getMaxStreak(a);
            const bStreak = getMaxStreak(b);
            if (aStreak >= 6 && bStreak < 6) return -1;
            if (aStreak < 6 && bStreak >= 6) return 1;
            return b.totalWorkingDays - a.totalWorkingDays;
          })[0];
          
        const underTarget = newRoster
          .filter(e => e.totalWorkingDays < e.targetWorkingDays)
          .sort((a, b) => a.totalWorkingDays - b.totalWorkingDays)[0];
        
        if (!overTarget || !underTarget) break;

        // Find a day where overTarget worked and underTarget was OFF
        let swapped = false;
        
        const daysToTry = [...volumeData].sort((a, b) => {
          const aIsStreak = overTarget.days[a.date] !== 'OFF';
          const bIsStreak = overTarget.days[b.date] !== 'OFF';
          return aIsStreak === bIsStreak ? 0 : (aIsStreak ? -1 : 1);
        });

        // STAGE 1: Try to find a swap that doesn't violate rest rules AND consecutive rules
        for (const day of daysToTry) {
          const overShift = overTarget.days[day.date];
          const underShift = underTarget.days[day.date];
          if (overShift !== 'OFF' && underShift === 'OFF' && !isApprovedLeave(underTarget.employeeId, day.date)) {
            const dayIdx = volumeData.findIndex(d => d.date === day.date);
            const sCurr = shiftCodes.find(sc => sc.code === overShift);
            if (!sCurr) continue;

            let restOk = true;
            let isJump = false;
            if (dayIdx > 0) {
              const prevDate = volumeData[dayIdx - 1].date;
              const prevShift = underTarget.days[prevDate];
              if (prevShift && prevShift !== 'OFF') {
                const sPrev = shiftCodes.find(sc => sc.code === prevShift);
                if (sPrev) {
                  if (getRestHours(sPrev, sCurr, extraHours) < 11 * 60) restOk = false;
                  const [pH] = sPrev.startTime.split(':').map(Number);
                  const [cH] = sCurr.startTime.split(':').map(Number);
                  if (cH < pH) isJump = true;
                }
              }
            }
            if (restOk && dayIdx < volumeData.length - 1) {
              const nextDate = volumeData[dayIdx + 1].date;
              const nextShift = underTarget.days[nextDate];
              if (nextShift && nextShift !== 'OFF') {
                const sNext = shiftCodes.find(sc => sc.code === nextShift);
                if (sNext) {
                  if (getRestHours(sCurr, sNext, extraHours) < 11 * 60) restOk = false;
                  const [cH] = sCurr.startTime.split(':').map(Number);
                  const [nH] = sNext.startTime.split(':').map(Number);
                  if (nH < cH) isJump = true;
                }
              }
            }

            let consecOk = true;
            let count = 0;
            for (let i = dayIdx - 1; i >= 0; i--) {
              if (underTarget.days[volumeData[i].date] !== 'OFF') count++;
              else break;
            }
            for (let i = dayIdx + 1; i < volumeData.length; i++) {
              if (underTarget.days[volumeData[i].date] !== 'OFF') count++;
              else break;
            }
            if (count >= 5) consecOk = false;

            if (restOk && consecOk && !isJump && !isConstraintViolation(underTarget, overShift)) {
              underTarget.days[day.date] = overShift;
              overTarget.days[day.date] = 'OFF';
              overTarget.totalWorkingDays--; overTarget.totalOffDays++;
              underTarget.totalWorkingDays++; underTarget.totalOffDays--;
              swapped = true; break;
            }
          }
        }

        // STAGE 2: Try to find a swap that satisfies rest rules (Consecutive is secondary)
        if (!swapped) {
          for (const day of daysToTry) {
            const overShift = overTarget.days[day.date];
            const underShift = underTarget.days[day.date];
            if (overShift !== 'OFF' && underShift === 'OFF' && !isApprovedLeave(underTarget.employeeId, day.date)) {
              const dayIdx = volumeData.findIndex(d => d.date === day.date);
              const sCurr = shiftCodes.find(sc => sc.code === overShift);
              if (!sCurr) continue;

              let restOk = true;
              if (dayIdx > 0) {
                const prevDate = volumeData[dayIdx - 1].date;
                const prevShift = underTarget.days[prevDate];
                if (prevShift && prevShift !== 'OFF') {
                  const sPrev = shiftCodes.find(sc => sc.code === prevShift);
                  if (sPrev && getRestHours(sPrev, sCurr, extraHours) < 11 * 60) restOk = false;
                }
              }
              if (restOk && dayIdx < volumeData.length - 1) {
                const nextDate = volumeData[dayIdx + 1].date;
                const nextShift = underTarget.days[nextDate];
                if (nextShift && nextShift !== 'OFF') {
                  const sNext = shiftCodes.find(sc => sc.code === nextShift);
                  if (sNext && getRestHours(sCurr, sNext, extraHours) < 11 * 60) restOk = false;
                }
              }

              if (restOk && !isConstraintViolation(underTarget, overShift)) {
                underTarget.days[day.date] = overShift;
                overTarget.days[day.date] = 'OFF';
                overTarget.totalWorkingDays--; overTarget.totalOffDays++;
                underTarget.totalWorkingDays++; underTarget.totalOffDays--;
                swapped = true; break;
              }
            }
          }
        }

        if (!swapped) break; 
        rebalanceSafety++;
      }

      // 7.5 Final Precision Polish: One last pass to ensure targets are hit if possible
      let polishSafety = 0;
      while (polishSafety < 1000) {
        const empUnder = newRoster
          .filter(e => e.totalWorkingDays < e.targetWorkingDays)
          .sort((a, b) => a.totalWorkingDays - b.totalWorkingDays)[0];
        
        if (!empUnder) break;

        let fixed = false;

        // STAGE A: Try to find a day where we can just ADD a shift (if headcount < employees.length)
        // CRITICAL: Must be an OPEN day
        for (const day of processedVolume) {
          const dayConfig = matchDayName(day.day, operationalWindows, day.date);
          const isDayOpen = dayConfig ? dayConfig.isOpen : true;

          if (isDayOpen && empUnder.days[day.date] === 'OFF' && !isApprovedLeave(empUnder.employeeId, day.date) && adjustedDailyHeadcounts[day.date] < employees.length) {
            // Check constraints
            const dayIdx = processedVolume.findIndex(d => d.date === day.date);
            
            // Find best shift for this day based on demand gap
            const dayReqs = dailyRequirements[day.date];
            const currentDayAssigned: Record<string, number> = {};
            shiftCodes.forEach(sc => currentDayAssigned[sc.code] = 0);
            newRoster.forEach(e => {
              const s = e.days[day.date];
              if (s && s !== 'OFF') currentDayAssigned[s]++;
            });

            let bestShift = shiftCodes[0].code;
            let maxGap = -Infinity;
            shiftCodes.forEach(sc => {
              const gap = (dayReqs[sc.code] || 0) - currentDayAssigned[sc.code];
              if (gap > maxGap) {
                maxGap = gap;
                bestShift = sc.code;
              }
            });

            const sCurr = shiftCodes.find(sc => sc.code === bestShift)!;
            let restOk = true;
            if (dayIdx > 0) {
              const prev = empUnder.days[processedVolume[dayIdx-1].date];
              if (prev && prev !== 'OFF') {
                const sPrev = shiftCodes.find(sc => sc.code === prev);
                if (sPrev && getRestHours(sPrev, sCurr, extraHours) < 11 * 60) restOk = false;
              }
            }
            if (restOk && dayIdx < processedVolume.length - 1) {
              const next = empUnder.days[processedVolume[dayIdx+1].date];
              if (next && next !== 'OFF') {
                const sNext = shiftCodes.find(sc => sc.code === next);
                if (sNext && getRestHours(sCurr, sNext, extraHours) < 11 * 60) restOk = false;
              }
            }

            if (restOk) {
              // Also check consecutive ok
              let consecCount = 1;
              for (let i = dayIdx - 1; i >= 0; i--) {
                if (empUnder.days[processedVolume[i].date] !== 'OFF') consecCount++;
                else break;
              }
              for (let i = dayIdx + 1; i < processedVolume.length; i++) {
                if (empUnder.days[processedVolume[i].date] !== 'OFF') consecCount++;
                else break;
              }
              
              if (consecCount <= 5 && !isConstraintViolation(empUnder, bestShift)) {
                empUnder.days[day.date] = bestShift;
                empUnder.totalWorkingDays++;
                empUnder.totalOffDays--;
                adjustedDailyHeadcounts[day.date]++;
                fixed = true;
                break;
              }
            }
          }
        }

        if (fixed) {
          polishSafety++;
          continue;
        }

        // STAGE B: Try to swap with someone who is OVER target
        const empOver = newRoster
          .filter(e => e.totalWorkingDays > e.targetWorkingDays)
          .sort((a, b) => b.totalWorkingDays - a.totalWorkingDays)[0];

        if (empOver) {
          for (const day of processedVolume) {
            const shift = empOver.days[day.date];
            if (shift && shift !== 'OFF' && empUnder.days[day.date] === 'OFF' && !isApprovedLeave(empUnder.employeeId, day.date)) {
              // Day is already open if someone is working there, but check for safety
              const dayConfig = matchDayName(day.day, operationalWindows, day.date);
              if (dayConfig && !dayConfig.isOpen) continue;

              const dayIdx = processedVolume.findIndex(d => d.date === day.date);
              const sCurr = shiftCodes.find(sc => sc.code === shift)!;
              
              let restOk = true;
              if (dayIdx > 0) {
                const prev = empUnder.days[processedVolume[dayIdx-1].date];
                if (prev && prev !== 'OFF') {
                  const sPrev = shiftCodes.find(sc => sc.code === prev);
                  if (sPrev && getRestHours(sPrev, sCurr, extraHours) < 11 * 60) restOk = false;
                }
              }
              if (restOk && dayIdx < processedVolume.length - 1) {
                const next = empUnder.days[processedVolume[dayIdx+1].date];
                if (next && next !== 'OFF') {
                  const sNext = shiftCodes.find(sc => sc.code === next);
                  if (sNext && getRestHours(sCurr, sNext, extraHours) < 11 * 60) restOk = false;
                }
              }

              if (restOk && !isConstraintViolation(empUnder, shift) && !isConstraintViolation(empOver, 'OFF')) {
                empUnder.days[day.date] = shift;
                empOver.days[day.date] = 'OFF';
                empUnder.totalWorkingDays++; empUnder.totalOffDays--;
                empOver.totalWorkingDays--; empOver.totalOffDays++;
                fixed = true;
                break;
              }
            }
          }
        }

        if (!fixed) break; // No more possible improvements for this employee
        polishSafety++;
      }

      // 7.6 Distribution Optimizer: Improve OFF day spacing
      // Look for long work streaks and try to move an OFF day from elsewhere to break it
      newRoster.forEach(emp => {
        let safety = 0;
        while (safety < 10) {
          let longStreakStart = -1;
          let currentStreak = 0;
          for (let i = 0; i < processedVolume.length; i++) {
            if (emp.days[processedVolume[i].date] !== 'OFF') {
              currentStreak++;
              if (currentStreak > 5 && longStreakStart === -1) longStreakStart = i - currentStreak + 1;
            } else {
              currentStreak = 0;
            }
          }

          if (longStreakStart === -1) break;

          // Try to move an OFF day from a "short streak" or "isolated OFF" area to the middle of this long streak
          const targetDayIdx = longStreakStart + 3; // Middle of the streak
          if (targetDayIdx >= processedVolume.length) break;
          const targetDate = processedVolume[targetDayIdx].date;
          const currentShift = emp.days[targetDate];

          // Find another day where this employee is OFF but could work
          let moved = false;
          for (let i = 0; i < processedVolume.length; i++) {
            const offDate = processedVolume[i].date;
            if (emp.days[offDate] === 'OFF' && Math.abs(i - targetDayIdx) > 2) {
              // Can we work on offDate? (Check window)
              const dayConfig = matchDayName(processedVolume[i].day, operationalWindows, processedVolume[i].date);
              if (dayConfig && !dayConfig.isOpen) continue;

              // Find another employee to swap with
              for (const other of newRoster) {
                if (other.employeeId !== emp.employeeId && 
                    other.days[targetDate] === 'OFF' && 
                    !isApprovedLeave(other.employeeId, targetDate) &&
                    other.days[offDate] === currentShift &&
                    !isApprovedLeave(emp.employeeId, offDate)) {
                  // Potential 2-way swap
                  // Emp: Work(target) -> OFF(target), OFF(off) -> Work(off)
                  // Other: OFF(target) -> Work(target), Work(off) -> OFF(off)
                  // This maintains precision for both!
                  
                  emp.days[targetDate] = 'OFF';
                  emp.days[offDate] = currentShift;
                  other.days[targetDate] = currentShift;
                  other.days[offDate] = 'OFF';
                  moved = true;
                  break;
                }
              }
            }
            if (moved) break;
          }
          if (!moved) break;
          safety++;
        }
      });

      // 8. Consecutive Day Optimizer
      // Try to break up 6+ day streaks by shifting a shift to a nearby OFF day for the SAME employee
      newRoster.forEach(emp => {
        let consecutive = 0;
        let streakStartIdx = -1;
        
        for (let i = 0; i < processedVolume.length; i++) {
          if (emp.days[processedVolume[i].date] !== 'OFF') {
            if (consecutive === 0) streakStartIdx = i;
            consecutive++;
            
            if (consecutive >= 6) {
              // We have a streak of 6 or more. Try to move one shift to a nearby OFF day.
              let moved = false;
              // Look for an OFF day within +/- 3 days of the streak
              const searchRange = 5;
              for (let offset = -searchRange; offset <= searchRange; offset++) {
                const targetIdx = i + offset;
                if (targetIdx >= 0 && targetIdx < processedVolume.length && 
                    emp.days[processedVolume[targetIdx].date] === 'OFF' &&
                    !isApprovedLeave(emp.employeeId, processedVolume[targetIdx].date)) {
                  // Check if this interval is actually within the operational window for this day
                  const targetDay = processedVolume[targetIdx];
                  const dayConfig = matchDayName(targetDay.day, operationalWindows, targetDay.date);
                  if (dayConfig && !dayConfig.isOpen) continue;

                  // Check if moving the shift from 'i' to 'targetIdx' is safe
                  const shiftToMove = emp.days[processedVolume[i].date];
                  
                  // Simple check: would targetIdx create a new streak?
                  let newStreakCount = 1;
                  for (let j = targetIdx - 1; j >= 0; j--) {
                    if (emp.days[processedVolume[j].date] !== 'OFF') newStreakCount++;
                    else break;
                  }
                  for (let j = targetIdx + 1; j < processedVolume.length; j++) {
                    if (emp.days[processedVolume[j].date] !== 'OFF') newStreakCount++;
                    else break;
                  }
                  
                  if (newStreakCount <= 5) {
                    // Perform the move
                    emp.days[processedVolume[targetIdx].date] = shiftToMove;
                    emp.days[processedVolume[i].date] = 'OFF';
                    moved = true;
                    // Reset streak detection for this employee
                    consecutive = 0;
                    i = Math.max(-1, streakStartIdx - 1); 
                    break;
                  }
                }
              }
              if (!moved) consecutive = 0; // Give up on this streak
            }
          } else {
            consecutive = 0;
          }
        }
      });
      
      await setDoc(doc(db, 'roster', 'current'), { roster: newRoster });
      setRoster(newRoster);
      
      const precisionCount = newRoster.filter(e => e.totalWorkingDays >= e.targetWorkingDays).length;
      const precisionPct = Math.round((precisionCount / newRoster.length) * 100);

      // 6-Day Compliance Check (Max 5 consecutive)
      let complianceViolations = 0;
      newRoster.forEach(emp => {
        let consecutive = 0;
        processedVolume.forEach(day => {
          if (emp.days[day.date] !== 'OFF') {
            consecutive++;
            if (consecutive >= 6) complianceViolations++;
          } else {
            consecutive = 0;
          }
        });
      });
      const compliancePct = Math.round(((newRoster.length - complianceViolations) / newRoster.length) * 100);

      if (precisionPct < 100) {
        toast.warning(`Roster precision is at ${precisionPct}%. Some targets couldn't be met due to constraints.`);
      } else {
        toast.success(`Balanced roster generated with 100% precision and ${compliancePct}% 6-day compliance!`);
      }
    } catch (error) {
      console.error(error);
      toast.error('Failed to generate roster');
    } finally {
      setLoading(false);
    }
  };

  function isIntervalInShift(interval: string, shiftStart: string, shiftEnd: string, extra: number = 0): boolean {
    try {
      const [intStartStr] = interval.split(' - ');
      const [intH] = intStartStr.split(':').map(Number);
      const [startH] = shiftStart.split(':').map(Number);
      const [endH] = shiftEnd.split(':').map(Number);
      
      let duration = (endH - startH + 24) % 24;
      // If endH is same as startH but it's not a 0-length shift (which shouldn't happen in our app)
      if (duration === 0 && shiftStart !== shiftEnd) duration = 24;
      
      const effectiveDuration = duration + extra;
      const diff = (intH - startH + 24) % 24;
      
      return diff < effectiveDuration;
    } catch (e) {
      return false;
    }
  }

  const downloadRoster = () => {
    if (roster.length === 0) return;
    const dates = volumeData.map(d => d.date);
    
    // Header
    const headers = ['NIP', 'Name', 'Skill', ...dates, 'Total Work', 'Total Off'];
    
    // Employee Rows
    const rows = roster.map(emp => {
      const employeeInfo = employees.find(e => e.id === emp.employeeId);
      return [
        emp.nip,
        emp.employeeName,
        employeeInfo?.skill || '-',
        ...dates.map(d => isApprovedLeave(emp.employeeId, d) ? 'Leave' : (emp.days[d] || 'OFF')),
        emp.totalWorkingDays,
        emp.totalOffDays
      ];
    });

    // Summary Section
    const summaryRows = [
      [],
      ['ROSTER SUMMARY'],
      ['Metric', 'Value'],
      ['Total Employees', roster.length],
      ['Total Forecast Days', volumeData.length],
      ['Avg Working Days', (roster.reduce((acc, curr) => acc + curr.totalWorkingDays, 0) / roster.length).toFixed(1)],
      ['Interval Coverage Accuracy', `${getIntervalAccuracy()}%`],
      ['Jumping Accuracy', `${getJumpingAccuracy()}%`],
      [],
      ['SHIFT DISTRIBUTION SUMMARY'],
      ['Shift Code', 'Total Assignments']
    ];

    shiftCodes.forEach(code => {
      let count = 0;
      roster.forEach(emp => {
        Object.values(emp.days).forEach(d => {
          if (d === code.code) count++;
        });
      });
      summaryRows.push([code.code, count]);
    });

    const csvContent = [headers, ...rows, ...summaryRows].map(r => r.join(';')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `enhanced_roster_${format(new Date(), 'yyyyMMdd')}.csv`;
    a.click();
  };

  const PersonalCalendar = ({ employee }: { employee: EmployeeRoster }) => {
    if (!volumeData.length) return null;
    
    const firstDate = new Date(volumeData[0].date);
    const monthStart = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
    const monthEnd = new Date(firstDate.getFullYear(), firstDate.getMonth() + 1, 0);
    
    const daysInMonth = [];
    let curr = new Date(monthStart);
    // Pad start
    const startDay = curr.getDay(); // 0 is Sunday
    for (let i = 0; i < startDay; i++) {
      daysInMonth.push(null);
    }
    // Actual days
    while (curr <= monthEnd) {
      daysInMonth.push(new Date(curr));
      curr.setDate(curr.getDate() + 1);
    }
    
    return (
      <div className="space-y-4 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold">
              {employee.employeeName.charAt(0)}
            </div>
            <div>
              <h3 className="font-bold text-slate-900">{employee.employeeName}</h3>
              <p className="text-xs text-slate-500 font-mono">{employee.nip}</p>
            </div>
          </div>
          <div className="flex gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-emerald-500" />
              <span>Working</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-slate-200" />
              <span>OFF</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-px bg-slate-200 rounded-lg overflow-hidden border border-slate-200">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
            <div key={d} className="bg-slate-50 p-2 text-center text-[10px] font-bold text-slate-500 uppercase">
              {d}
            </div>
          ))}
          {daysInMonth.map((date, idx) => {
            if (!date) return <div key={`pad-${idx}`} className="bg-slate-50/50 h-24" />;
            
            const dateStr = format(date, 'yyyy-MM-dd');
            const shift = employee.days[dateStr] || 'OFF';
            const onLeave = isApprovedLeave(employee.employeeId, dateStr);
            const isToday = isSameDay(date, new Date());
            
            // Check violations
            let restViolation = false;
            let consecViolation = false;
            const dayIdx = processedVolume.findIndex(d => d.date === dateStr);
            if (shift !== 'OFF' && dayIdx !== -1) {
              const prevDayDate = dayIdx > 0 ? processedVolume[dayIdx - 1].date : null;
              const prevShiftCode = prevDayDate ? employee.days[prevDayDate] : null;
              if (prevShiftCode && prevShiftCode !== 'OFF') {
                const sPrev = shiftCodes.find(sc => sc.code === prevShiftCode);
                const sCurr = shiftCodes.find(sc => sc.code === shift);
                if (sPrev && sCurr && getRestHours(sPrev, sCurr, extraHours) < 11 * 60) restViolation = true;
              }
              let count = 1;
              for (let i = dayIdx - 1; i >= 0; i--) {
                if (employee.days[processedVolume[i].date] !== 'OFF') count++;
                else break;
              }
              if (count >= 6) consecViolation = true;
            }

            return (
              <div 
                key={dateStr} 
                className={`bg-white h-24 p-2 relative group transition-colors hover:bg-slate-50 ${isToday ? 'ring-1 ring-inset ring-indigo-500 z-10' : ''}`}
              >
                <span className={`text-xs font-medium ${isToday ? 'text-indigo-600 font-bold' : 'text-slate-400'}`}>
                  {date.getDate()}
                </span>
                <div className="mt-2">
                  {shift !== 'OFF' ? (
                    <div className={`rounded-md p-1.5 text-[10px] font-bold text-center shadow-sm relative ${getShiftBadgeClasses(shift, restViolation, consecViolation, onLeave)}`}>
                      {onLeave ? 'Leave' : shift}
                      {shift !== 'OFF' && (employee.extraHours || 0) > 0 && (
                        <div className="absolute -top-1 -right-1 bg-indigo-600 text-white text-[7px] px-1 rounded-full font-black border border-white shadow-sm z-10">
                          +{(employee.extraHours || 0)}h
                        </div>
                      )}
                      {(restViolation || consecViolation) && (
                        <AlertCircle className="w-3 h-3 inline ml-1 text-current opacity-70" />
                      )}
                    </div>
                  ) : (
                    <div className="rounded-md p-1.5 text-[10px] font-medium text-center text-slate-300 bg-slate-50 border border-dashed border-slate-200">
                      {onLeave ? 'Leave' : 'OFF'}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const getIntervalAccuracy = () => {
    if (roster.length === 0 || processedVolume.length === 0) return 0;
    
    let totalRequired = 0;
    let totalAbsDiff = 0;

    processedVolume.forEach(day => {
      const dayReqs: Record<string, number> = {};
      const allIntervalKeys = Object.keys(day.intervals).sort();
      Object.entries(day.intervals).forEach(([interval, val]) => {
        const duration = getIntervalDuration(interval, allIntervalKeys);
        const effectiveVolume = Number(val) || 0;
        let res;
        if (channelType === 'chat' || channelType === 'whatsapp' || channelType === 'multiskill_chat_wa') {
          res = calculateRequiredAgentsChat(effectiveVolume, aht, targetSL, targetTime, concurrency, duration);
        } else if (channelType === 'email') {
          res = calculateRequiredAgentsEmail(effectiveVolume, aht, targetSL, tat, duration);
        } else {
          res = calculateRequiredAgents(effectiveVolume, aht, targetSL, targetTime, duration);
        }
        const req = Math.ceil(res.agents * (1 + shrinkage));
        dayReqs[interval] = req;
        totalRequired += req * duration;
      });

      const dayAssigned: Record<string, number> = {};
      Object.keys(dayReqs).forEach(int => dayAssigned[int] = 0);

      roster.forEach(emp => {
        const shiftCode = emp.days[day.date];
        if (shiftCode && shiftCode !== 'OFF') {
          const code = shiftCodes.find(c => c.code === shiftCode);
          if (code) {
            Object.keys(dayReqs).forEach(interval => {
              if (isIntervalInShift(interval, code.startTime, code.endTime, extraHours)) {
                dayAssigned[interval]++;
              }
            });
          }
        }
      });

      Object.keys(dayReqs).forEach(interval => {
        totalAbsDiff += Math.abs(dayReqs[interval] - dayAssigned[interval]);
      });
    });

    if (totalRequired === 0) return 100;
    return Math.round(Math.max(0, (1 - (totalAbsDiff / (totalRequired * 2))) * 100));
  };

  const getCoverageDataForSelectedDate = () => {
    if (!selectedDateForAnalysis || volumeData.length === 0) return [];
    const day = volumeData.find(d => d.date === selectedDateForAnalysis);
    if (!day) return [];

    const dayReqs: Record<string, number> = {};
    const allIntervalKeys = Object.keys(day.intervals).sort();
    Object.entries(day.intervals).forEach(([interval, val]) => {
      const duration = getIntervalDuration(interval, allIntervalKeys);
      const volume = Number(val) || 0;
      let res;
      if (channelType === 'chat' || channelType === 'whatsapp' || channelType === 'multiskill_chat_wa') {
        res = calculateRequiredAgentsChat(volume, aht, targetSL, targetTime, concurrency, duration);
      } else if (channelType === 'email') {
        res = calculateRequiredAgentsEmail(volume, aht, targetSL, tat, duration);
      } else {
        res = calculateRequiredAgents(volume, aht, targetSL, targetTime, duration);
      }
      dayReqs[interval] = Math.ceil(res.agents * (1 + shrinkage));
    });

    const dayAssigned: Record<string, number> = {};
    Object.keys(dayReqs).forEach(int => dayAssigned[int] = 0);

    roster.forEach(emp => {
      const shiftCode = emp.days[day.date];
      if (shiftCode && shiftCode !== 'OFF') {
        const code = shiftCodes.find(c => c.code === shiftCode);
        if (code) {
          Object.keys(dayReqs).forEach(interval => {
            if (isIntervalInShift(interval, code.startTime, code.endTime, extraHours)) {
              dayAssigned[interval]++;
            }
          });
        }
      }
    });

    return Object.keys(dayReqs).sort().map(interval => ({
      interval,
      Required: dayReqs[interval],
      Assigned: dayAssigned[interval]
    }));
  };

  const filteredRoster = roster.filter(emp => {
    const employeeInfo = employees.find(e => e.id === emp.employeeId);
    const matchesSearch = emp.employeeName.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          emp.nip.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesSkill = skillFilter === 'all' || employeeInfo?.skill === skillFilter;
    
    let matchesShift = true;
    if (shiftFilter !== 'all') {
      matchesShift = Object.values(emp.days).includes(shiftFilter);
    }

    return matchesSearch && matchesSkill && matchesShift;
  });

  const uniqueSkills = Array.from(new Set(employees.map(e => e.skill))).filter(Boolean);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Roster Management</h1>
          <p className="text-slate-500">Generate and manage balanced employee schedules.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-slate-100 p-1 rounded-lg mr-2">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => setViewMode('grid')}
              className={`text-xs h-7 px-3 ${viewMode === 'grid' ? 'bg-white shadow-sm' : 'text-slate-500'}`}
            >
              Grid
            </Button>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => {
                setViewMode('calendar');
                if (!selectedEmployeeId && roster.length > 0) setSelectedEmployeeId(roster[0].employeeId);
              }}
              className={`text-xs h-7 px-3 ${viewMode === 'calendar' ? 'bg-white shadow-sm' : 'text-slate-500'}`}
            >
              Calendar
            </Button>
          </div>
          {isAdmin && (
            <div className="flex gap-2">
              <Button 
                variant={showAudit ? "default" : "outline"} 
                size="sm"
                onClick={() => setShowAudit(!showAudit)}
                className={`gap-2 ${showAudit ? 'bg-rose-500 hover:bg-rose-600 text-white' : ''}`}
              >
                <ListChecks className="w-4 h-4" />
                Health Audit {violations.length > 0 && <Badge className="ml-1 bg-white text-rose-500 h-4 px-1 min-w-[16px]">{violations.length}</Badge>}
              </Button>
              <Button 
                variant={isEditing ? "default" : "outline"} 
                size="sm"
                onClick={() => setIsEditing(!isEditing)}
                className={`gap-2 ${isEditing ? 'bg-amber-500 hover:bg-amber-600' : ''}`}
              >
                <Edit2 className="w-4 h-4" />
                {isEditing ? "Finish Editing" : "Manual Edit"}
              </Button>
              <Dialog 
                open={isExtraTimeDialogOpen} 
                onOpenChange={(open) => {
                  if (open) {
                    setTempExtraDays(extraWorkingDays);
                    setTempExtraHours(extraHours);
                  }
                  setIsExtraTimeDialogOpen(open);
                }}
              >
                <DialogTrigger asChild>
                  <Button 
                    variant="outline"
                    size="sm"
                    className="h-9 px-3 gap-2 border-slate-200 hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-slate-500 uppercase">Extra Days:</span>
                      <span className="text-xs font-bold text-indigo-600">{extraWorkingDays}</span>
                    </div>
                    <div className="w-px h-3 bg-slate-200 mx-1" />
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-slate-500 uppercase">Extra Hours:</span>
                      <span className="text-xs font-bold text-blue-600">{extraHours}</span>
                    </div>
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[500px] max-h-[90vh] flex flex-col">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <Settings2 className="w-5 h-5 text-indigo-600" />
                      Manage Extra Time Assignment
                    </DialogTitle>
                    <CardDescription>
                      Configure additional working days and hours for your staff.
                    </CardDescription>
                  </DialogHeader>

                  <div className="space-y-6 py-4 overflow-y-auto pr-2">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase">Extra Working Days</label>
                        <Input 
                          type="number" 
                          min="0" 
                          max="10"
                          value={tempExtraDays}
                          onChange={(e) => setTempExtraDays(parseInt(e.target.value) || 0)}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase">Extra Hours (OT)</label>
                        <Input 
                          type="number" 
                          min="0" 
                          max="4"
                          step="0.5"
                          value={tempExtraHours}
                          onChange={(e) => setTempExtraHours(parseFloat(e.target.value) || 0)}
                        />
                      </div>
                    </div>

                    <div className="space-y-3">
                      <label className="text-xs font-bold text-slate-500 uppercase">Assignment Scope</label>
                      <div className="grid grid-cols-2 gap-2">
                        <Button 
                          variant={assignmentMode === 'all' ? 'default' : 'outline'}
                          className={`justify-start gap-2 h-12 ${assignmentMode === 'all' ? 'bg-indigo-600' : ''}`}
                          onClick={() => setAssignmentMode('all')}
                        >
                          <Users className="w-4 h-4" />
                          <div className="text-left">
                            <p className="text-sm font-bold">Apply to All</p>
                            <p className="text-[10px] opacity-80 font-normal">Set as global default</p>
                          </div>
                        </Button>
                        <Button 
                          variant={assignmentMode === 'selected' ? 'default' : 'outline'}
                          className={`justify-start gap-2 h-12 ${assignmentMode === 'selected' ? 'bg-indigo-600' : ''}`}
                          onClick={() => setAssignmentMode('selected')}
                        >
                          <ListChecks className="w-4 h-4" />
                          <div className="text-left">
                            <p className="text-sm font-bold">Assign to Selected</p>
                            <p className="text-[10px] opacity-80 font-normal">Target specific staff</p>
                          </div>
                        </Button>
                      </div>
                    </div>

                    {assignmentMode === 'selected' && (
                      <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-bold text-slate-500 uppercase">Select Staff ({selectedEmpIds.size})</label>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-6 text-[10px] uppercase font-bold text-indigo-600"
                            onClick={toggleSelectAllEmps}
                          >
                            {selectedEmpIds.size === employees.length ? 'Deselect All' : 'Select All'}
                          </Button>
                        </div>
                        <div className="relative">
                          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
                          <Input 
                            placeholder="Search staff..." 
                            className="pl-8 h-8 text-xs"
                            value={empSearchTerm}
                            onChange={(e) => setEmpSearchTerm(e.target.value)}
                          />
                        </div>
                        <div className="border rounded-lg max-h-[200px] overflow-y-auto divide-y">
                          {employees
                            .filter(e => e.name.toLowerCase().includes(empSearchTerm.toLowerCase()) || e.nip.includes(empSearchTerm))
                            .map(emp => (
                              <div 
                                key={emp.id} 
                                className={`flex items-center gap-3 p-2 hover:bg-slate-50 cursor-pointer transition-colors ${selectedEmpIds.has(emp.id) ? 'bg-indigo-50/50' : ''}`}
                                onClick={() => toggleEmpSelect(emp.id)}
                              >
                                <Checkbox 
                                  checked={selectedEmpIds.has(emp.id)}
                                  onCheckedChange={() => toggleEmpSelect(emp.id)}
                                  onClick={(e) => e.stopPropagation()}
                                />
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-bold text-slate-900 truncate">{emp.name}</p>
                                  <p className="text-[10px] text-slate-500">{emp.nip} • {emp.skill}</p>
                                </div>
                                {(emp.extraWorkingDays || emp.extraHours) ? (
                                  <Badge variant="outline" className="text-[8px] h-4 px-1 border-indigo-100 text-indigo-600">
                                    Current: {emp.extraWorkingDays}d/{emp.extraHours}h
                                  </Badge>
                                ) : null}
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <DialogFooter className="border-t pt-4">
                    <Button variant="ghost" onClick={() => setIsExtraTimeDialogOpen(false)} disabled={isUpdatingExtra}>Cancel</Button>
                    <Button 
                      className="bg-indigo-600 hover:bg-indigo-700 gap-2" 
                      onClick={handleApplyExtraTime}
                      disabled={isUpdatingExtra || (assignmentMode === 'selected' && selectedEmpIds.size === 0)}
                    >
                      {isUpdatingExtra ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                      Confirm & Apply
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              {showClearConfirm ? (
                <div className="flex gap-1 animate-in fade-in slide-in-from-right-2 duration-200">
                  <Button variant="destructive" size="sm" onClick={clearRoster} disabled={loading}>Confirm Clear</Button>
                  <Button variant="ghost" size="sm" onClick={() => setShowClearConfirm(false)} disabled={loading}>Cancel</Button>
                </div>
              ) : (
                <Button 
                  variant="outline" 
                  onClick={() => setShowClearConfirm(true)} 
                  disabled={loading || roster.length === 0}
                  className="text-slate-500 hover:text-red-600 hover:bg-red-50 border-slate-200"
                >
                  Clear Roster
                </Button>
              )}
              <Button onClick={() => generateBalancedRoster('base')} disabled={loading} className="gap-2 bg-indigo-600 hover:bg-indigo-700 text-white">
                {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                Generate Balanced Roster
              </Button>
            </div>
          )}
          <Button variant="outline" onClick={downloadRoster} disabled={roster.length === 0} className="gap-2">
            <Download className="w-4 h-4" />
            Export CSV
          </Button>
        </div>
      </div>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
        <div className="flex flex-wrap items-center gap-4 flex-1">
          <div className="relative flex-1 max-w-xs">
            <Activity className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text"
              placeholder="Search name or NIP..."
              className="w-full pl-10 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Period:</span>
            <Select value={selectedMonth} onValueChange={setSelectedMonth}>
              <SelectTrigger className="w-[140px] bg-white border-slate-200 h-9 text-sm">
                <CalendarIcon className="w-4 h-4 mr-2 text-indigo-500" />
                <SelectValue placeholder="Select Month" />
              </SelectTrigger>
              <SelectContent>
                {availableMonths.map(m => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <select 
            className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            value={skillFilter}
            onChange={(e) => setSkillFilter(e.target.value)}
          >
            <option value="all">All Skills</option>
            {uniqueSkills.map(skill => (
              <option key={skill} value={skill}>{skill}</option>
            ))}
          </select>
          <select 
            className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            value={shiftFilter}
            onChange={(e) => setShiftFilter(e.target.value)}
          >
            <option value="all">All Shifts</option>
            {shiftCodes.map(shift => (
              <option key={shift.code} value={shift.code}>{shift.code}</option>
            ))}
          </select>
        </div>
        <div className="text-xs text-slate-500 font-medium">
          Showing {filteredRoster.length} of {roster.length} employees
        </div>
      </div>

      {shortageInfo && (
        <Card className={`border-amber-200 animate-in fade-in slide-in-from-top-4 duration-300 ${shortageInfo.isCovered ? 'bg-emerald-50/30 border-emerald-200' : 'bg-amber-50/30'}`}>
          <CardHeader className="pb-2">
            <CardTitle className={`text-lg flex items-center gap-2 ${shortageInfo.isCovered ? 'text-emerald-800' : 'text-amber-800'}`}>
              {shortageInfo.isCovered ? <CheckCircle2 className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
              {shortageInfo.isCovered ? 'Manpower Shortage Resolved' : 'Manpower Shortage Detected'}
            </CardTitle>
            <CardDescription className={shortageInfo.isCovered ? 'text-emerald-700' : 'text-amber-700'}>
              {shortageInfo.isCovered 
                ? 'Your current settings (Extra Days/Hours) are sufficient to cover the real forecast demand.' 
                : 'The base employee capacity is insufficient to meet the real forecast demand.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex flex-col md:flex-row gap-6">
              <div className="space-y-1">
                <p className={`text-sm ${shortageInfo.isCovered ? 'text-emerald-900' : 'text-amber-900'}`}>
                  Base gap: <span className="font-bold">{shortageInfo.baseShortage} shifts</span> missing.
                  {shortageInfo.currentShortage > 0 && (
                    <> Remaining gap: <span className="font-bold text-rose-600">{shortageInfo.currentShortage} shifts</span>.</>
                  )}
                </p>
                <p className={`text-xs ${shortageInfo.isCovered ? 'text-emerald-700' : 'text-amber-700'}`}>
                  {shortageInfo.isCovered 
                    ? 'Click "Confirm & Apply Overtime" to generate the roster with these settings.'
                    : `Suggested adjustment: +${shortageInfo.suggestedExtraDays} working days per employee.`}
                </p>
              </div>
              <div className="h-10 w-px bg-slate-200 hidden md:block" />
              <div className="space-y-1">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Monthly FTE Requirement</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-indigo-600">{shortageInfo.grossFTE}</span>
                  <span className="text-xs text-slate-400">Agents Needed</span>
                </div>
                <p className="text-[10px] text-slate-400 italic">Based on {shortageInfo.totalWorkHours.toLocaleString()} work hours</p>
              </div>
            </div>
            <div className={`flex items-center gap-3 p-3 rounded-lg border shadow-sm ${shortageInfo.isCovered ? 'bg-white border-emerald-200' : 'bg-white border-amber-200'}`}>
              {!shortageInfo.isCovered && (
                <div className="text-center px-4 border-r border-amber-100">
                  <p className="text-[10px] uppercase font-bold text-amber-500">Suggested Extra</p>
                  <p className="text-xl font-bold text-amber-900">+{shortageInfo.suggestedExtraDays} Days</p>
                </div>
              )}
              <div className="flex gap-2">
                {!shortageInfo.isCovered && (
                  <Button 
                    size="sm" 
                    variant="outline" 
                    className="border-amber-300 text-amber-700 hover:bg-amber-100"
                    onClick={() => updateExtraSettings(extraWorkingDays + shortageInfo.suggestedExtraDays, extraHours)}
                  >
                    Apply Suggestion
                  </Button>
                )}
                <Button 
                  size="sm" 
                  variant="default" 
                  className={`${shortageInfo.isCovered ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-amber-600 hover:bg-amber-700'} text-white gap-2`}
                  onClick={() => generateBalancedRoster('overtime')}
                  disabled={loading || (extraWorkingDays === 0 && extraHours === 0)}
                >
                  <Zap className="w-4 h-4" />
                  Confirm & Apply Overtime
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {showAudit && (
        <Card className="border-rose-200 bg-rose-50/30 animate-in fade-in slide-in-from-top-4 duration-300">
          <CardHeader className="pb-2">
            <CardTitle className="text-rose-800 text-lg flex items-center gap-2">
              <ShieldCheck className="w-5 h-5" />
              Roster Health Audit Report
            </CardTitle>
            <div className="flex items-center justify-between">
              <CardDescription className="text-rose-600">
                Found {violations.length} violations that require attention.
              </CardDescription>
              {violations.length > 0 && (
                <Button 
                  size="sm" 
                  variant="outline" 
                  className="text-rose-600 border-rose-200 hover:bg-rose-50 gap-2"
                  onClick={handleBulkFix}
                  disabled={loading}
                >
                  <Sparkles className="w-4 h-4" />
                  Fix All Violations
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {violations.length === 0 ? (
              <div className="py-6 text-center text-emerald-600 font-medium flex flex-col items-center gap-2">
                <CheckCircle2 className="w-8 h-8" />
                No violations found! Your roster is 100% compliant.
              </div>
            ) : (
              <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
                {violations.map((v, i) => (
                  <div key={i} className={`border rounded-lg p-3 flex items-start gap-3 shadow-sm ${
                    v.type === 'REST' ? 'bg-white border-rose-100' : 
                    v.type === 'CONSECUTIVE' ? 'bg-white border-amber-100' : 
                    'bg-white border-slate-100'
                  }`}>
                    <div className={`mt-0.5 p-1 rounded-full ${
                      v.type === 'REST' ? 'bg-red-100 text-red-600' : 
                      v.type === 'CONSECUTIVE' ? 'bg-orange-100 text-orange-600' : 
                      'bg-slate-100 text-slate-600'
                    }`}>
                      {v.type === 'JUMP' ? <Clock className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-slate-900 text-sm">{v.employeeName}</span>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className={`text-[10px] uppercase ${
                            v.type === 'REST' ? 'text-rose-600 border-rose-200' : 
                            v.type === 'CONSECUTIVE' ? 'text-amber-600 border-amber-200' : 
                            'text-slate-500 border-slate-200'
                          }`}>
                            {v.type === 'REST' ? 'REST VIOLATION' : 
                             v.type === 'CONSECUTIVE' ? 'CONSECUTIVE WORK' : 
                             'NOT RECOMMENDED (JUMP)'}
                          </Badge>
                          <Badge variant="outline" className="text-[10px] uppercase">{format(new Date(v.date), 'MMM d, yyyy')}</Badge>
                        </div>
                      </div>
                      <p className="text-xs text-slate-600 mb-2">
                        <span className={`font-semibold ${
                          v.type === 'REST' ? 'text-rose-700' : 
                          v.type === 'CONSECUTIVE' ? 'text-amber-700' : 
                          'text-slate-700'
                        }`}>{v.type}:</span> {v.details}
                      </p>
                      <div className="bg-slate-50 rounded p-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3 border border-slate-100">
                        <div className="flex items-center gap-2">
                          <ArrowRight className="w-3 h-3 text-indigo-500" />
                          <span className="text-[11px] text-slate-500 italic">Suggestion: {v.suggestion}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button 
                            size="sm" 
                            variant="default" 
                            className="h-7 px-3 text-[10px] bg-indigo-600 hover:bg-indigo-700 gap-1"
                            onClick={() => handleQuickFix(v)}
                          >
                            <Zap className="w-3 h-3" />
                            Quick Fix
                          </Button>
                          <Select 
                            value={v.currentShift} 
                            onValueChange={(val) => handleManualShiftChange(v.employeeId, v.date, val)}
                          >
                            <SelectTrigger className="h-7 text-[10px] w-24 bg-white">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="OFF">OFF</SelectItem>
                              {shiftCodes.map(sc => (
                                <SelectItem key={sc.code} value={sc.code}>{sc.code}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button 
                            size="sm" 
                            variant="outline" 
                            className="h-7 px-2 text-[10px] text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-200"
                            onClick={() => handleManualShiftChange(v.employeeId, v.date, 'OFF')}
                          >
                            Set OFF
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1 border-none shadow-sm bg-gradient-to-br from-indigo-600 to-blue-700 text-white overflow-hidden relative">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <TrendingUp className="w-24 h-24" />
          </div>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-indigo-100 flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Capacity Overview
            </CardTitle>
          </CardHeader>
          <CardContent>
            {roster.length === 0 ? (
              <div className="py-8 flex flex-col items-center justify-center text-indigo-200 gap-2">
                <CalendarIcon className="w-8 h-8 opacity-50" />
                <p className="text-xs font-medium">No data to analyze</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between items-end mb-1">
                    <span className="text-2xl font-bold">
                      {Math.round(((shortageInfo?.effectiveSupply || 0) / (totalDemand || 1)) * 100)}%
                    </span>
                    <span className="text-xs text-indigo-100 font-medium">Coverage</span>
                  </div>
                  <div className="w-full bg-white/20 h-2 rounded-full overflow-hidden backdrop-blur-sm">
                    <div 
                      className="h-full bg-white transition-all duration-500 ease-out"
                      style={{ 
                        width: `${Math.min(100, (shortageInfo?.effectiveSupply || 0) / (totalDemand || 1) * 100)}%` 
                      }}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div className="bg-white/10 rounded-lg p-2 backdrop-blur-sm">
                    <p className="text-[10px] uppercase font-bold text-indigo-100 mb-1">Demand</p>
                    <p className="text-lg font-bold">{totalDemand}</p>
                  </div>
                  <div className="bg-white/10 rounded-lg p-2 backdrop-blur-sm">
                    <p className="text-[10px] uppercase font-bold text-indigo-100 mb-1">Supply</p>
                    <p className="text-lg font-bold">{shortageInfo?.effectiveSupply ? Math.round(shortageInfo.effectiveSupply) : 0}</p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <MetricCard 
              title="Monthly Target" 
              value={roster.length > 0 ? `${roster[0]?.targetWorkingDays}W / ${roster[0]?.targetOffDays}O${targetHolidays > 0 ? ` (${targetHolidays}H)` : ''}` : '-'}
              icon={<Target className="w-4 h-4 text-blue-500" />}
              description={targetHolidays > 0 ? "Includes holidays as OFF" : "Standard work/off ratio"}
            />
            <MetricCard 
              title="Roster Precision" 
              value={roster.length > 0 ? `${Math.round((roster.filter(e => e.totalWorkingDays >= e.targetWorkingDays).length / roster.length) * 100)}%` : '-'}
              icon={<CheckCircle2 className="w-4 h-4 text-emerald-500" />}
              description="Target adherence"
              status={roster.length > 0 ? (roster.every(e => e.totalWorkingDays >= e.targetWorkingDays) ? 'success' : 'warning') : undefined}
            />
            <MetricCard 
              title="6-Day Compliance" 
              value={roster.length > 0 ? `${(() => {
                let violations = 0;
                roster.forEach(emp => {
                  let consecutive = 0;
                  volumeData.forEach(day => {
                    if (emp.days[day.date] !== 'OFF') {
                      consecutive++;
                      if (consecutive >= 6) {
                        violations++;
                        return;
                      }
                    } else {
                      consecutive = 0;
                    }
                  });
                });
                return Math.round(((roster.length - violations) / roster.length) * 100);
              })()}%` : '-'}
              icon={<ShieldCheck className="w-4 h-4 text-orange-500" />}
              description="Labor law safety"
              status={roster.length > 0 ? ((() => {
                let violations = 0;
                roster.forEach(emp => {
                  let consecutive = 0;
                  volumeData.forEach(day => {
                    if (emp.days[day.date] !== 'OFF') {
                      consecutive++;
                      if (consecutive >= 6) {
                        violations++;
                        return;
                      }
                    } else {
                      consecutive = 0;
                    }
                  });
                });
                return violations === 0;
              })() ? 'success' : 'warning') : undefined}
            />
            <MetricCard 
              title="Jumping Accuracy" 
              value={roster.length > 0 ? `${getJumpingAccuracy()}%` : '-'}
              icon={<Zap className="w-4 h-4 text-amber-500" />}
              description="Forward rotation"
              status={roster.length > 0 ? (getJumpingAccuracy() >= 95 ? 'success' : getJumpingAccuracy() >= 80 ? 'warning' : 'danger') : undefined}
            />
          </div>

          <div className="grid grid-cols-1 gap-4">
            <MetricCard 
              title="Interval Coverage Accuracy" 
              value={roster.length > 0 ? `${getIntervalAccuracy()}%` : '-'}
              icon={<BarChart3 className="w-4 h-4 text-indigo-500" />}
              description="Staff vs Demand per interval"
              status={roster.length > 0 ? (getIntervalAccuracy() >= 90 ? 'success' : getIntervalAccuracy() >= 75 ? 'warning' : 'danger') : undefined}
            />
          </div>
        </div>
      </div>

      {roster.length > 0 && selectedDateForAnalysis && (
        <Card className="border-none shadow-sm overflow-hidden">
          <CardHeader className="border-b border-slate-100 flex flex-row items-center justify-between py-4">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Activity className="w-5 h-5 text-indigo-600" />
                Interval Coverage Analysis
              </CardTitle>
              <CardDescription>
                Required vs Assigned staff for {format(new Date(selectedDateForAnalysis), 'EEEE, MMMM d, yyyy')}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500">Select Date:</span>
              <select 
                className="text-xs border border-slate-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                value={selectedDateForAnalysis}
                onChange={(e) => setSelectedDateForAnalysis(e.target.value)}
              >
                {volumeData.map(day => (
                  <option key={day.date} value={day.date}>
                    {format(new Date(day.date), 'MMM d')}
                  </option>
                ))}
              </select>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={getCoverageDataForSelectedDate()}>
                  <defs>
                    <linearGradient id="colorRequired" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.1}/>
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorAssigned" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.1}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="interval" 
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fill: '#64748b' }}
                    interval={3}
                  />
                  <YAxis 
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fill: '#64748b' }}
                  />
                  <Tooltip 
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Legend verticalAlign="top" align="right" iconType="circle" wrapperStyle={{ fontSize: '12px', paddingBottom: '20px' }} />
                  <Area 
                    type="monotone" 
                    dataKey="Required" 
                    stroke="#6366f1" 
                    strokeWidth={2}
                    fillOpacity={1} 
                    fill="url(#colorRequired)" 
                  />
                  <Area 
                    type="monotone" 
                    dataKey="Assigned" 
                    stroke="#10b981" 
                    strokeWidth={2}
                    fillOpacity={1} 
                    fill="url(#colorAssigned)" 
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-none shadow-sm bg-blue-50/30 border border-blue-100/50">
        <CardContent className="p-4 flex items-start gap-4">
          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0 mt-1">
            <Sparkles className="w-5 h-5 text-blue-600" />
          </div>
          <div className="space-y-1">
            <h3 className="font-bold text-blue-900 text-sm">Roster Insights & Logic</h3>
            <div className="text-xs text-blue-700 leading-relaxed max-w-4xl space-y-2">
              <p>
                <strong>Manpower Shortage Detection:</strong> Compares your <strong>Monthly FTE Requirement</strong> (based on AI Forecast) against your <strong>Total Available Shifts</strong>. 
                This indicator shows the <strong>Real Demand</strong> without hidden buffers, helping you see the exact gap to be filled.
              </p>
              <p>
                <strong>Extra Working Days:</strong> Increases the monthly target working days per employee. This improves <strong>Coverage</strong> but reduces rest days, which may increase <em>6-Day Compliance</em> violations.
              </p>
              <p>
                <strong>Extra Hours (+Nh):</strong> Extends the effective duration of every assigned shift (e.g., 8h → 9h). This is reflected by a <span className="inline-flex items-center px-1 bg-indigo-600 text-white rounded-full text-[7px] font-black">+Nh</span> badge on shifts. 
                It helps meet demand with fewer staff but reduces mandatory rest periods between shifts.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {roster.length > 0 ? (
        <Card className="border-none shadow-sm overflow-hidden">
          <CardHeader className="border-b border-slate-100 flex flex-row items-center justify-between space-y-0 py-4">
            <CardTitle className="text-lg flex items-center gap-2">
              {viewMode === 'grid' ? (
                <>
                  <Users className="w-5 h-5 text-primary" />
                  Monthly Roster Grid
                </>
              ) : (
                <>
                  <CalendarIcon className="w-5 h-5 text-primary" />
                  Personal Roster Calendar
                </>
              )}
            </CardTitle>
            {viewMode === 'calendar' && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500 font-medium">Select Employee:</span>
                <select 
                  className="text-xs border rounded-md p-1 bg-white outline-none focus:ring-1 ring-indigo-500"
                  value={selectedEmployeeId || ''}
                  onChange={(e) => setSelectedEmployeeId(e.target.value)}
                >
                  {roster.map(emp => (
                    <option key={emp.employeeId} value={emp.employeeId}>{emp.employeeName}</option>
                  ))}
                </select>
              </div>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {viewMode === 'grid' ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className="min-w-[150px] sticky left-0 bg-slate-50 z-20">Employee</TableHead>
                    <TableHead className="min-w-[100px] text-center border-r bg-slate-50/50">Summary (W/O)</TableHead>
                    <TableHead className="min-w-[120px] text-center border-r bg-slate-50/50">Shift Mix</TableHead>
                    {volumeData.map(day => (
                      <TableHead key={day.date} className="min-w-[80px] text-center">
                        <div className="flex flex-col items-center">
                          <span className="text-[10px] font-bold">{day.date.split('-').slice(1).join('/')}</span>
                          <span className="text-[9px] text-slate-500 uppercase">{day.day.substring(0, 3)}</span>
                        </div>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRoster.map(emp => (
                    <TableRow key={emp.employeeId} className="hover:bg-slate-50/50 transition-colors">
                      <TableCell className="font-medium text-slate-900 sticky left-0 bg-white z-10">
                        <div className="flex flex-col">
                          <span className="text-sm">{emp.employeeName}</span>
                          <span className="text-[10px] text-slate-400 font-mono">{emp.nip}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center border-r bg-slate-50/30">
                        <div className="flex flex-col gap-1.5 py-1">
                          <div className="flex items-center justify-center gap-1">
                            <Badge 
                              variant={emp.totalWorkingDays !== emp.targetWorkingDays ? "destructive" : "secondary"}
                              className="text-[10px] px-1.5 h-5 font-bold"
                            >
                              {emp.totalWorkingDays} / {emp.targetWorkingDays} W
                            </Badge>
                          </div>
                          <div className="flex items-center justify-center">
                            <Badge 
                              variant={emp.totalOffDays !== emp.targetOffDays ? "destructive" : "outline"}
                              className={`text-[10px] px-1.5 h-5 font-bold ${emp.totalOffDays === emp.targetOffDays ? 'bg-slate-100 text-slate-600 border-slate-200' : ''}`}
                            >
                              {emp.totalOffDays} / {emp.targetOffDays} O
                            </Badge>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-center border-r bg-slate-50/10 min-w-[120px]">
                        <div className="flex flex-col gap-2 px-2">
                          <div className="flex h-2 w-full bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                            {shiftCodes.map((sc, idx) => {
                              const count = Object.values(emp.days).filter(d => d === sc.code).length;
                              if (count === 0) return null;
                              const colors = ['bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-purple-500', 'bg-pink-500', 'bg-cyan-500'];
                              const color = colors[idx % colors.length];
                              return (
                                <div 
                                  key={sc.code}
                                  className={`${color} h-full border-r border-white/20 last:border-0`}
                                  style={{ width: `${(count / volumeData.length) * 100}%` }}
                                  title={`${sc.code}: ${count} days`}
                                />
                              );
                            })}
                            {(() => {
                              const offCount = Object.values(emp.days).filter(d => d === 'OFF').length;
                              if (offCount === 0) return null;
                              return (
                                <div 
                                  className="bg-slate-200 h-full"
                                  style={{ width: `${(offCount / volumeData.length) * 100}%` }}
                                  title={`OFF: ${offCount} days`}
                                />
                              );
                            })()}
                          </div>
                          <div className="flex flex-wrap justify-center gap-x-2 gap-y-0.5">
                            {shiftCodes.map((sc, idx) => {
                              const count = Object.values(emp.days).filter(d => d === sc.code).length;
                              if (count === 0) return null;
                              const colors = ['text-blue-600', 'text-emerald-600', 'text-amber-600', 'text-purple-600', 'text-pink-600', 'text-cyan-600'];
                              return (
                                <span key={sc.code} className={`text-[9px] font-bold ${colors[idx % colors.length]}`}>
                                  {sc.code}:{count}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      </TableCell>
                      {volumeData.map((day, dayIdx) => {
                        const shift = emp.days[day.date] || 'OFF';
                        const onLeave = isApprovedLeave(emp.employeeId, day.date);
                        const prevDayDate = dayIdx > 0 ? volumeData[dayIdx - 1].date : null;
                        const prevShiftCode = prevDayDate ? emp.days[prevDayDate] : null;
                        
                        let restViolation = false;
                        let restHours = 0;
                        let consecViolation = false;
                        let consecDays = 0;

                        if (shift !== 'OFF') {
                          // Rest Violation check
                          if (prevShiftCode && prevShiftCode !== 'OFF') {
                            const sPrev = shiftCodes.find(sc => sc.code === prevShiftCode);
                            const sCurr = shiftCodes.find(sc => sc.code === shift);
                            if (sPrev && sCurr) {
                              const restMins = getRestHours(sPrev, sCurr, extraHours);
                              if (restMins < 11 * 60) {
                                restViolation = true;
                                restHours = Math.round(restMins / 60 * 10) / 10;
                              }
                            }
                          }

                          // Consecutive Day Violation check (6-day compliance)
                          let count = 1;
                          for (let i = dayIdx - 1; i >= 0; i--) {
                            const d = volumeData[i].date;
                            if (emp.days[d] && emp.days[d] !== 'OFF') count++;
                            else break;
                          }
                          if (count >= 6) {
                            consecViolation = true;
                            consecDays = count;
                          }
                        }

                        return (
                          <TableCell key={day.date} className="text-center p-1">
                            <div className="relative inline-block">
                              {isEditing && isAdmin ? (
                                <Select 
                                  value={shift} 
                                  onValueChange={(val) => handleManualShiftChange(emp.employeeId, day.date, val)}
                                >
                                  <SelectTrigger className={`text-[10px] px-1 h-6 min-w-[45px] justify-center font-bold border-dashed ${getShiftBadgeClasses(shift, restViolation, consecViolation, onLeave)}`}>
                                    <SelectValue placeholder={shift} />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="OFF">OFF</SelectItem>
                                    {shiftCodes.map(sc => (
                                      <SelectItem key={sc.code} value={sc.code}>{sc.code}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <Badge 
                                  variant="outline" 
                                  className={`text-[10px] px-1 h-6 min-w-[40px] justify-center font-bold ${getShiftBadgeClasses(shift, restViolation, consecViolation, onLeave)}`}
                                  title={
                                    restViolation ? `Rest Violation: Only ${restHours}h rest` : 
                                    consecViolation ? `6-Day Compliance Violation: ${consecDays} consecutive days` : 
                                    undefined
                                  }
                                >
                                  {onLeave ? 'Leave' : shift}
                                </Badge>
                              )}
                              {shift !== 'OFF' && (emp.extraHours || 0) > 0 && (
                                <div className="absolute -bottom-1.5 -right-1.5 bg-indigo-600 text-white text-[7px] px-1 rounded-full font-black border border-white shadow-sm z-10">
                                  +{(emp.extraHours || 0)}h
                                </div>
                              )}
                              {(restViolation || consecViolation) && (
                                <div className="absolute -top-1 -right-1 bg-white rounded-full">
                                  <AlertCircle className={`w-3 h-3 ${restViolation ? 'text-red-500' : 'text-orange-500'} fill-white`} />
                                </div>
                              )}
                            </div>
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            selectedEmployeeId && roster.find(e => e.employeeId === selectedEmployeeId) && (
              <PersonalCalendar employee={roster.find(e => e.employeeId === selectedEmployeeId)!} />
            )
          )}
        </CardContent>
      </Card>
      ) : (
        <div className="h-[400px] flex flex-col items-center justify-center bg-white rounded-xl border border-dashed border-slate-200 text-slate-400 space-y-4">
          <CalendarIcon className="w-12 h-12 opacity-20" />
          <div className="text-center">
            <p className="font-medium">No roster generated yet</p>
            <p className="text-sm">Click "Generate Balanced Roster" to create a schedule.</p>
          </div>
        </div>
      )}
    </div>
  );
}
