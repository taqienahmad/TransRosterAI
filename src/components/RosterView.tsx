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
import { Switch } from '@/components/ui/switch';
import { Calendar as CalendarIcon, Calendar, Users, Download, Upload, RefreshCw, CheckCircle2, AlertCircle, Clock, Sparkles, TrendingUp, Activity, Target, ShieldCheck, RotateCcw, Zap, Heart, BarChart3, ClipboardCheck, Edit2, Edit3, ListChecks, ArrowRight, AlertTriangle, Settings2, Search, ChevronUp, ChevronDown, Minus, Info, Lightbulb, TrendingDown, ArrowUpRight, History, LayoutGrid, CalendarDays, Filter } from 'lucide-react';
import { toast } from 'sonner';
import { format, startOfWeek, addDays, isSameDay } from 'date-fns';
import { AreaChart, Area, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ComposedChart, PieChart, Pie } from 'recharts';
import * as XLSX from 'xlsx';
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
  skill: string;
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
  offday?: number;
}

interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  status: 'pending' | 'approved' | 'rejected';
}

export default function RosterView(props: any) {
  const { isAdmin, selectedMonth: externalMonth, onMonthChange } = props;
  const [allVolumeData, setAllVolumeData] = useState<ForecastVolumeData[]>(props.allVolumeData || []);
  const [selectedMonth, setSelectedMonth] = useState<string>(externalMonth || '');
  const [shiftCodes, setShiftCodes] = useState<ShiftCode[]>(props.shiftCodes || []);
  const [employees, setEmployees] = useState<Employee[]>(props.employees || []);
  const [workingDaysRef, setWorkingDaysRef] = useState<WorkingDayRef[]>(props.workingDaysRef || []);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>(props.leaveRequests || []);
  const [roster, setRoster] = useState<EmployeeRoster[]>(props.roster || []);
  const [loading, setLoading] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'calendar'>('grid');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [selectedDateForAnalysis, setSelectedDateForAnalysis] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [skillFilter, setSkillFilter] = useState('all');
  const [shiftFilter, setShiftFilter] = useState('all');
  const [isCoverageDialogOpen, setIsCoverageDialogOpen] = useState(false);
  const [selectedCoverageDate, setSelectedCoverageDate] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editingCell, setEditingCell] = useState<{ employeeId: string; date: string; employeeName: string; currentShift: string } | null>(null);
  const [activeViewTab, setActiveViewTab] = useState<'grid' | 'analysis' | 'violations' | 'rules'>('grid');
  const [showAudit, setShowAudit] = useState(false);
  const [extraWorkingDays, setExtraWorkingDays] = useState(0);
  const [extraHours, setExtraHours] = useState(0);
  const [isAgreedToAdjustments, setIsAgreedToAdjustments] = useState(false);
  
  // Skill Allocation State
  const [isSkillCritical, setIsSkillCritical] = useState(false);
  const [skillRatios, setSkillRatios] = useState<Record<string, number>>({}); // Skill name -> percentage (0-100)
  const [isSkillDialogOpen, setIsSkillDialogOpen] = useState(false);
  
  // Extra Time Assignment State
  const [isExtraTimeDialogOpen, setIsExtraTimeDialogOpen] = useState(false);
  const [assignmentMode, setAssignmentMode] = useState<'all' | 'selected'>('all');
  const [selectedEmpIds, setSelectedEmpIds] = useState<Set<string>>(new Set());
  const [tempExtraDays, setTempExtraDays] = useState(0);
  const [tempExtraHours, setTempExtraHours] = useState(0);
  const [empSearchTerm, setEmpSearchTerm] = useState('');
  const [isUpdatingExtra, setIsUpdatingExtra] = useState(false);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [hideUnusedShifts, setHideUnusedShifts] = useState(true);
  const [activeShiftCodes, setActiveShiftCodes] = useState<Set<string>>(new Set());
  const [isShiftConfigExpanded, setIsShiftConfigExpanded] = useState(false);
  const [showTransitionWeek, setShowTransitionWeek] = useState(false);
  
  // Collapsible panel states below the main roster grid
  const [isChartExpanded, setIsChartExpanded] = useState(true);
  const [isPolicyExpanded, setIsPolicyExpanded] = useState(false);
  const [isComplianceExpanded, setIsComplianceExpanded] = useState(false);
  
  const [constraints, setConstraints] = useState({
    minRestHours: 13,
    maxConsecutiveWorking: 6,
    maxConsecutiveOff: 3,
    offAfterNightShift: 2,
    stabilityBonus: 150,
    backwardJumpPenalty: 25000,
    forwardRotationBonus: 200,
    penaltyRest: 45000,
    penaltyConsec1: 2000,
    penaltyConsec2: 10000,
    penaltyConsec3: 50000,
    penaltyOverTarget: 60000,
    preferenceBonus: 1000,
    criticalBonus: 8000,
    maleNightShiftBonus: 500,
    ignoreCeiling: false
  });
  
  // Historical Roster State (Legacy data for jump/consecutive checks)
  const [legacyRoster, setLegacyRoster] = useState<Record<string, Record<string, string>>>({});
  const [optimizationAnalysis, setOptimizationAnalysis] = useState<{
    beforeICA: number;
    afterICA: number;
    underCoverageGap: number;
    overCoverageGap: number;
    improvementPct: number;
    recommendations: { type: string; description: string; impact: string }[];
    distribution?: Record<string, number>;
    distributionRatio?: Record<string, number>;
    actualTotal?: number;
    potentialSupplyDaily?: number;
    requiredDailyHeadcount?: number;
    requiredPoolFTE?: number;
    netFloorGoal?: number;
    skillStats?: Record<string, { assigned: number; required: number }>;
  } | null>(null);

  useEffect(() => {
    if (externalMonth) {
      setSelectedMonth(externalMonth);
    }
  }, [externalMonth]);

  useEffect(() => {
    if (selectedMonth && onMonthChange && selectedMonth !== externalMonth) {
      onMonthChange(selectedMonth);
    }
  }, [selectedMonth, externalMonth, onMonthChange]);

  function isApprovedLeave(employeeId: string, date: string) {
    return leaveRequests.some(req => 
      req.employeeId === employeeId && 
      req.date === date && 
      req.status === 'approved'
    );
  }

  const getEffectiveRestThreshold = () => constraints.minRestHours * 60;
  const getEffectiveMaxConsecWorking = () => constraints.maxConsecutiveWorking;
  const getEffectiveMaxConsecOff = () => constraints.maxConsecutiveOff;

  useEffect(() => {
    // Fetch legacy roster data from Firestore
    const q = query(collection(db, 'legacyRoster'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data: Record<string, Record<string, string>> = {};
      snapshot.docs.forEach(doc => {
        data[doc.id] = doc.data() as Record<string, string>;
      });
      setLegacyRoster(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'legacyRoster');
    });

    return () => unsubscribe();
  }, []);

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
    setIsAgreedToAdjustments(true);
    try {
      await setDoc(doc(db, 'erlangSettings', 'current'), { 
        extraWorkingDays: days, 
        extraHours: hours,
        isSimulationAgreed: true
      }, { merge: true });
      toast.success('Strategy updated and applied to engine.');
    } catch (error) {
      console.error("Failed to save extra settings:", error);
      toast.error('Failed to sync settings with AI Engine');
    }
  };

  const availableMonths = useMemo(() => {
    const months = new Set<string>();
    
    // Add months from forecast volume
    allVolumeData.forEach(d => {
      try {
        months.add(format(new Date(d.date), 'MMM-yy'));
      } catch (e) {
        console.error("Invalid date in volume data:", d.date);
      }
    });

    // Add months from legacy roster
    Object.values(legacyRoster).forEach(empRecord => {
      Object.keys(empRecord).forEach(date => {
        try {
          months.add(format(new Date(date), 'MMM-yy'));
        } catch (e) {}
      });
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
    
    const filtered = allVolumeData.filter(d => format(new Date(d.date), 'MMM-yy') === selectedMonth);
    
    // If no volume data for this month, but it exists in availableMonths (due to legacyRoster)
    if (filtered.length === 0) {
      // Find all dates for this month in legacyRoster
      const datesInMonth = new Set<string>();
      Object.values(legacyRoster).forEach(empRecord => {
        Object.keys(empRecord).forEach(date => {
          try {
            if (format(new Date(date), 'MMM-yy') === selectedMonth) {
              datesInMonth.add(date);
            }
          } catch (e) {}
        });
      });

      if (datesInMonth.size > 0) {
        return Array.from(datesInMonth).sort().map(date => ({
          date,
          day: format(new Date(date), 'EEEE'),
          totalVolume: 0,
          intervals: {} // Skeleton for historical display
        }));
      }
    }
    
    return filtered;
  }, [allVolumeData, selectedMonth, legacyRoster]);

  const extendedVolumeData = useMemo(() => {
    if (!showTransitionWeek || volumeData.length === 0) return volumeData;
    
    // Get the first date of current view
    const firstDateStr = volumeData[0].date;
    const firstDate = new Date(firstDateStr);
    
    // Generate dates for the 7 days preceding
    const prevDays = [];
    for (let i = 7; i >= 1; i--) {
      const d = addDays(firstDate, -i);
      const dStr = format(d, 'yyyy-MM-dd');
      
      // Look for this date in allVolumeData or legacyRoster
      const hasVolume = allVolumeData.find(v => v.date === dStr);
      const isLegacy = Object.values(legacyRoster).some(r => r[dStr]);
      
      if (hasVolume || isLegacy) {
        prevDays.push(hasVolume || {
          date: dStr,
          day: format(d, 'EEEE'),
          totalVolume: 0,
          intervals: {},
          isHistorical: true
        });
      }
    }
    
    return [...prevDays, ...volumeData];
  }, [volumeData, showTransitionWeek, allVolumeData, legacyRoster]);

  useEffect(() => {
    if (availableMonths.length > 0 && !selectedMonth) {
      setSelectedMonth(availableMonths[0]);
    }
  }, [availableMonths, selectedMonth]);

  useEffect(() => {
    if (shiftCodes.length > 0 && activeShiftCodes.size === 0) {
      setActiveShiftCodes(new Set(shiftCodes.map(sc => sc.code)));
    }
  }, [shiftCodes, activeShiftCodes.size]);

  useEffect(() => {
    if (selectedMonth && volumeData.length > 0) {
      const isCurrentDateInMonth = volumeData.some(d => d.date === selectedDateForAnalysis);
      if (!isCurrentDateInMonth) {
        setSelectedDateForAnalysis(volumeData[0].date);
      }
      // Also sync coverage date
      if (selectedCoverageDate && !volumeData.some(d => d.date === selectedCoverageDate)) {
        setSelectedCoverageDate(volumeData[0].date);
      }
    }
  }, [selectedMonth, volumeData, selectedDateForAnalysis, selectedCoverageDate]);

  // Helper: Calculate rest hours between two shifts
  const getRestHours = (prevShift: ShiftCode, nextShift: ShiftCode, extra: number = 0) => {
    const [prevStartH, prevStartM] = prevShift.startTime.split(':').map(Number);
    const [prevEndH, prevEndM] = prevShift.endTime.split(':').map(Number);
    const [nextStartH, nextStartM] = nextShift.startTime.split(':').map(Number);
    
    // Normalization to absolute minutes
    const endTotalMinutes = prevEndH * 60 + prevEndM + (extra * 60);
    const startTotalMinutes = nextStartH * 60 + nextStartM;
    
    // Check if the previous shift was an overnight shift
    // It is overnight if it ends at an hour smaller than it started (e.g., 22:00 to 06:00)
    // OR if it explicitly crosses midnight
    if (prevEndH < prevStartH || (prevEndH === prevStartH && prevEndM < prevStartM)) {
      // Overnight shift: It ends on the same day the next shift starts.
      return startTotalMinutes - endTotalMinutes;
    }
    
    // Normal shift: ends on the previous day.
    return (24 * 60 - endTotalMinutes) + startTotalMinutes;
  };

  interface Violation {
    employeeId: string;
    employeeName: string;
    date: string;
    type: 'REST' | 'CONSECUTIVE' | 'JUMP' | 'OFF_AFTER_NIGHT' | 'CONSECUTIVE_OFF';
    details: string;
    suggestion: string;
    currentShift: string;
  }

  const getRosterViolations = (): Violation[] => {
    const violations: Violation[] = [];
    
    roster.forEach(emp => {
      let consecutiveWorking = 0;
      let consecutiveOff = 0;
      const empExtraHours = emp.extraHours !== undefined ? emp.extraHours : extraHours;
      
      // Look back to legacy roster for initial continuity
      if (volumeData.length > 0) {
        const firstDate = new Date(volumeData[0].date);
        const legacy = legacyRoster[emp.employeeId] || {};
        
        // 7 days lookback for working days
        for (let i = 1; i <= 7; i++) {
          const d = format(addDays(firstDate, -i), 'yyyy-MM-dd');
          if (legacy[d] && legacy[d] !== 'OFF') consecutiveWorking++;
          else break;
        }

        // 7 days lookback for off days
        for (let i = 1; i <= 7; i++) {
          const d = format(addDays(firstDate, -i), 'yyyy-MM-dd');
          if (!legacy[d] || legacy[d] === 'OFF') consecutiveOff++;
          else break;
        }
      }

      volumeData.forEach((day, idx) => {
        const shift = emp.days[day.date] || 'OFF';
        
        // Check Leave Implementation (Rule 9)
        const isOnLeave = isApprovedLeave(emp.employeeId, day.date);
        if (isOnLeave && shift !== 'OFF' && shift !== 'Leave') {
          violations.push({
            employeeId: emp.employeeId, employeeName: emp.employeeName, date: day.date,
            type: 'CONSECUTIVE', details: `Staff has approved leave but is assigned a shift (${shift}).`, currentShift: shift,
            suggestion: "Set to OFF/Leave."
          });
        }

        if (shift !== 'OFF' && shift !== 'Leave') {
          consecutiveWorking++;
          consecutiveOff = 0;
          
          const sCurr = shiftCodes.find(sc => sc.code === shift);
          if (!sCurr) return;

          // 1. Check Rest Violation & Jumps (Rule 7: 13h Gap)
          if (idx > 0) {
            const prevDate = volumeData[idx - 1].date;
            const prevShift = emp.days[prevDate] || 'OFF';
            if (prevShift !== 'OFF' && prevShift !== 'Leave') {
              const sPrev = shiftCodes.find(sc => sc.code === prevShift);
              if (sPrev) {
                const restMins = getRestHours(sPrev, sCurr, empExtraHours);
                const restThreshold = getEffectiveRestThreshold();
                if (restMins < restThreshold) {
                  violations.push({
                    employeeId: emp.employeeId,
                    employeeName: emp.employeeName,
                    date: day.date,
                    type: 'REST',
                    details: `Insufficient rest: ${Math.round(restMins/60*10)/10}h gap (Policy: ${restThreshold/60}h) between ${prevShift} and ${shift}`,
                    suggestion: `Shift jump detected. Minimum 13h gap required.`,
                    currentShift: shift
                  });
                }
                
                // Jump check
                const [pH] = sPrev.startTime.split(':').map(Number);
                const [cH] = sCurr.startTime.split(':').map(Number);
                if (cH < pH) {
                  violations.push({
                    employeeId: emp.employeeId,
                    employeeName: emp.employeeName,
                    date: day.date,
                    type: 'JUMP',
                    details: `Forbidden JUMP (Backward rotation) from ${prevShift} to ${shift}`,
                    currentShift: shift,
                    suggestion: "Switch to forward rotation."
                  });
                }
              }
            }
          }

          // 2. Night Shift Recovery (Rule 8)
          if (constraints.offAfterNightShift > 0 && idx > 0) {
            const prevDate = volumeData[idx - 1].date;
            const prevShift = emp.days[prevDate];
            const prevSc = shiftCodes.find(sc => sc.code === prevShift);
            
            if (prevSc?.isNightShift) {
               violations.push({
                 employeeId: emp.employeeId, employeeName: emp.employeeName, date: day.date,
                 type: 'OFF_AFTER_NIGHT', details: `1st day after Night Shift must be OFF (Staffing Recovery).`, currentShift: shift,
                 suggestion: `Mandatory ${constraints.offAfterNightShift} days recovery period.`
               });
            }

            if (idx > 1 && constraints.offAfterNightShift >= 2) {
              const dbPrevDate = volumeData[idx - 2].date;
              const dbPrevShift = emp.days[dbPrevDate];
              const dbPrevSc = shiftCodes.find(sc => sc.code === dbPrevShift);
              if (dbPrevSc?.isNightShift) {
                 violations.push({
                   employeeId: emp.employeeId, employeeName: emp.employeeName, date: day.date,
                   type: 'OFF_AFTER_NIGHT', details: `2nd day after Night Shift must be OFF (Staffing Recovery).`, currentShift: shift,
                   suggestion: "Mandatory recovery period."
                 });
              }
            }
          }

          // 3. Max Consecutive Working (Rule 5: 4-7 days)
          const maxW = getEffectiveMaxConsecWorking();
          if (consecutiveWorking > maxW) {
            violations.push({
              employeeId: emp.employeeId, employeeName: emp.employeeName, date: day.date,
              type: 'CONSECUTIVE', details: `${consecutiveWorking} consecutive working days (Policy Max: ${maxW})`, currentShift: shift,
              suggestion: "Insert OFF day to break momentum."
            });
          }
        } else {
          consecutiveWorking = 0;
          consecutiveOff++;
          // Policy Constraint (Rule 6)
          const maxO = getEffectiveMaxConsecOff();
          if (consecutiveOff > maxO) {
            violations.push({
              employeeId: emp.employeeId, employeeName: emp.employeeName, date: day.date,
              type: 'CONSECUTIVE_OFF', details: `${consecutiveOff} consecutive off days (Policy Max: ${maxO})`, currentShift: shift,
              suggestion: "Assign shift to utilize capacity."
            });
          }
        }
      });

      // Target Working Days Check (Rule 4)
      const empTarget = Math.round(emp.targetWorkingDays);
      if (emp.totalWorkingDays < empTarget) {
         violations.push({
            employeeId: emp.employeeId, employeeName: emp.employeeName, date: volumeData[volumeData.length-1]?.date,
            type: 'CONSECUTIVE_OFF', details: `Staff below target working days (${emp.totalWorkingDays}/${empTarget})`, currentShift: 'OFF',
            suggestion: "Increase assigned shifts."
         });
      }
    });
    
    return violations;
  };

  const violations = getRosterViolations();

  const handleGenerateRoster = async () => {
    if (volumeData.length === 0) {
      toast.error('No volume data for this month');
      return;
    }
    setLoading(true);
    try {
      const dates = volumeData.map(d => d.date);
      const totalDays = dates.length;
      
      const adjustmentMultiplier = isAgreedToAdjustments ? 1 : 0;
      
      const newRoster: EmployeeRoster[] = employees.map(emp => {
        const empExtraDays = (emp.extraWorkingDays !== undefined ? emp.extraWorkingDays : extraWorkingDays) * adjustmentMultiplier;
        const empTargetWorkingDays = targetWorkingDays + empExtraDays;
        return {
          employeeId: emp.id,
          employeeName: emp.name,
          nip: emp.nip || '',
          gender: emp.gender,
          preferredShifts: emp.preferredShifts || [],
          skill: emp.skill || 'General',
          days: {},
          totalWorkingDays: 0,
          totalOffDays: totalDays,
          targetWorkingDays: empTargetWorkingDays,
          targetOffDays: totalDays - empTargetWorkingDays,
          extraHours: (emp.extraHours !== undefined ? emp.extraHours : extraHours) * adjustmentMultiplier
        };
      });

      // 2. Pre-calculate precise interval requirements per skill
      const dailyIntervalRequirements: Record<string, Record<string, Record<string, number>>> = {};
      const allSkills = uniqueSkills;

      volumeData.forEach(day => {
        dailyIntervalRequirements[day.date] = {};
        const intervalKeys = sortIntervals(Object.keys(day.intervals));
        
        Object.entries(day.intervals).forEach(([interval, val]) => {
          const volume = Number(val) || 0;
          const duration = getIntervalDuration(interval, intervalKeys);
          
          let res: any;
          if (channelType === 'chat' || channelType === 'whatsapp' || channelType === 'multiskill_chat_wa') {
            res = calculateRequiredAgentsChat(volume, aht, targetSL, targetTime, concurrency, duration);
          } else if (channelType === 'email') {
            res = calculateRequiredAgentsEmail(volume, aht, targetSL, tat, duration);
          } else {
            res = calculateRequiredAgents(volume, aht, targetSL, targetTime, duration);
          }
          
          const shrinkageFactor = Math.min(0.99, shrinkage);
          const totalNeeded = Math.ceil(res.agents / (1 - shrinkageFactor));
          
          dailyIntervalRequirements[day.date][interval] = {};
          allSkills.forEach(skill => {
            const ratio = (skillRatios[skill] || (100 / allSkills.length)) / 100;
            dailyIntervalRequirements[day.date][interval][skill] = Math.ceil(totalNeeded * ratio);
          });
        });
      });

      // 3. Track coverage state during generation
      const coverageState: Record<string, Record<string, Record<string, number>>> = {};
      dates.forEach(date => {
        coverageState[date] = {};
        const day = volumeData.find(d => d.date === date);
        if (day) {
          Object.keys(day.intervals).forEach(interval => {
            coverageState[date][interval] = {};
            allSkills.forEach(skill => {
              coverageState[date][interval][skill] = 0;
            });
          });
        }
      });

      // 4. Day-by-Day Allocation
      const consecutiveWorkMap: Record<string, number> = {};
      const lastShiftMap: Record<string, string> = {};
      
      // Initialize with legacy roster and carry-over coverage
      employees.forEach(emp => {
        consecutiveWorkMap[emp.id] = 0;
        lastShiftMap[emp.id] = 'OFF';
        
        if (dates.length > 0) {
          const firstDate = new Date(dates[0]);
          const legacy = legacyRoster[emp.id] || {};
          
          // Look back up to 7 days for consecutive working count
          for (let i = 1; i <= 7; i++) {
            const d = format(addDays(firstDate, -i), 'yyyy-MM-dd');
            if (legacy[d] && legacy[d] !== 'OFF') consecutiveWorkMap[emp.id]++;
            else break;
          }
          
          const prevDay = format(addDays(firstDate, -1), 'yyyy-MM-dd');
          const prevShiftCode = legacy[prevDay];
          if (prevShiftCode && prevShiftCode !== 'OFF') {
            lastShiftMap[emp.id] = prevShiftCode;
            const sc = shiftCodes.find(s => s.code === prevShiftCode);
            if (sc) {
              const firstDayIntervals = Object.keys(volumeData[0].intervals);
              firstDayIntervals.forEach(interval => {
                // If the yesterday's shift carries over into today's morning
                if (isIntervalInShift(interval, sc.startTime, sc.endTime, emp.extraHours || extraHours, false)) {
                  coverageState[dates[0]][interval][emp.skill || 'General']++;
                }
              });
            }
          }
        }
      });

      for (let dayIdx = 0; dayIdx < totalDays; dayIdx++) {
        const currentDate = dates[dayIdx];
        const day = volumeData[dayIdx];
        const dayWeightsValue = dailyWeights[currentDate] || 0;
        
        // Determine how many staff need to work today (proportional to demand)
        const totalCapacity = newRoster.reduce((sum, emp) => sum + emp.targetWorkingDays, 0);
        const dayTargetHeadcount = Math.min(employees.length, Math.ceil((dayWeightsValue / (totalDemand || 1)) * totalCapacity));
        
        // Select employees for today
        const candidates = [...newRoster].sort((a, b) => {
          // Priority 1: Those furthest from their target
          const gapA = a.targetWorkingDays - a.totalWorkingDays;
          const gapB = b.targetWorkingDays - b.totalWorkingDays;
          if (gapA !== gapB) return gapB - gapA;
          
          // Priority 2: Those with fewer consecutive days
          return consecutiveWorkMap[a.employeeId] - consecutiveWorkMap[b.employeeId];
        });

        let assignedToday = 0;
        const intervalKeys = sortIntervals(Object.keys(day.intervals));

        for (const empRoster of candidates) {
          if (assignedToday >= dayTargetHeadcount) break;
          
          // Check Constraints
          const onLeave = isApprovedLeave(empRoster.employeeId, currentDate);
          if (onLeave) continue;

          if (consecutiveWorkMap[empRoster.employeeId] >= getEffectiveMaxConsecWorking()) continue;

          // Find Best Shift for this employee
          let bestShift: ShiftCode | null = null;
          let bestScore = -Infinity;

          const possibleShifts = shiftCodes.filter(sc => activeShiftCodes.has(sc.code));
          const prevShiftCode = lastShiftMap[empRoster.employeeId];
          const sPrev = shiftCodes.find(sc => sc.code === prevShiftCode);

          for (const sc of possibleShifts) {
            // Check rest hours and forward rotation
            if (sPrev) {
              const restMins = getRestHours(sPrev, sc, empRoster.extraHours || 0);
              if (restMins < getEffectiveRestThreshold()) continue;

              const [pH] = sPrev.startTime.split(':').map(Number);
              const [cH] = sc.startTime.split(':').map(Number);
              if (cH < pH) continue; // No backward jumps
            }

            // Calculate Coverage Score (Both current and next day carry-over)
            let score = 0;
            intervalKeys.forEach(interval => {
              if (isIntervalInShift(interval, sc.startTime, sc.endTime, empRoster.extraHours || 0, true)) {
                const req = dailyIntervalRequirements[currentDate][interval][empRoster.skill] || 0;
                const curr = coverageState[currentDate][interval][empRoster.skill] || 0;
                const gap = req - curr;
                
                if (gap > 0) score += 100 + (gap * 10);
                else score -= 20;
              }
            });

            if (dayIdx + 1 < totalDays) {
              const nextDate = dates[dayIdx + 1];
              const nextIntervals = Object.keys(volumeData[dayIdx + 1].intervals);
              nextIntervals.forEach(interval => {
                if (isIntervalInShift(interval, sc.startTime, sc.endTime, empRoster.extraHours || 0, false)) {
                  const req = dailyIntervalRequirements[nextDate][interval][empRoster.skill] || 0;
                  const curr = coverageState[nextDate][interval][empRoster.skill] || 0;
                  const gap = req - curr;
                  
                  if (gap > 0) score += 100 + (gap * 10);
                  else score -= 15; // Slightly less penalty for future overstaffing
                }
              });
            }

            if (score > bestScore) {
              bestScore = score;
              bestShift = sc;
            }
          }

          if (bestShift) {
            empRoster.days[currentDate] = bestShift.code;
            empRoster.totalWorkingDays++;
            empRoster.totalOffDays--;
            
            // Update coverage state (current and next day)
            intervalKeys.forEach(interval => {
              if (isIntervalInShift(interval, bestShift!.startTime, bestShift!.endTime, empRoster.extraHours || 0, true)) {
                coverageState[currentDate][interval][empRoster.skill]++;
              }
            });

            if (dayIdx + 1 < totalDays) {
              const nextDate = dates[dayIdx + 1];
              const nextIntervals = Object.keys(volumeData[dayIdx + 1].intervals);
              nextIntervals.forEach(interval => {
                if (isIntervalInShift(interval, bestShift!.startTime, bestShift!.endTime, empRoster.extraHours || 0, false)) {
                  coverageState[nextDate][interval][empRoster.skill]++;
                }
              });
            }

            assignedToday++;
            consecutiveWorkMap[empRoster.employeeId]++;
            lastShiftMap[empRoster.employeeId] = bestShift.code;
          } else {
            // No valid shift for this employee today
            empRoster.days[currentDate] = 'OFF';
            consecutiveWorkMap[empRoster.employeeId] = 0;
            lastShiftMap[empRoster.employeeId] = 'OFF';
          }
        }

        // Fill remaining employees with OFF
        candidates.forEach(emp => {
          if (!emp.days[currentDate]) {
            emp.days[currentDate] = 'OFF';
            consecutiveWorkMap[emp.employeeId] = 0;
            lastShiftMap[emp.employeeId] = 'OFF';
          }
        });
      }

      setRoster(newRoster);
      await setDoc(doc(db, 'roster', 'current'), { roster: newRoster });
      
      // Calculate Stats for Visual Comparison
      const stats = computeAnalysis(newRoster);
      if (stats) {
        setOptimizationAnalysis({
          beforeICA: 0,
          afterICA: stats.ica,
          underCoverageGap: stats.under,
          overCoverageGap: stats.over,
          improvementPct: 100,
          distribution: stats.distribution,
          distributionRatio: stats.distributionRatio,
          actualTotal: stats.actualTotal,
          potentialSupplyDaily: stats.potentialSupplyDaily,
          requiredDailyHeadcount: stats.requiredDailyHeadcount,
          requiredPoolFTE: stats.requiredPoolFTE,
          netFloorGoal: stats.netFloorGoal,
          skillStats: stats.skillStats,
          recommendations: []
        });
      }

      toast.success('Roster Schedule Generated Successfully');
    } catch (error) {
      console.error(error);
      toast.error('Failed to generate roster');
    } finally {
      setLoading(false);
    }
  };

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

  const handleQuickFix = async (v: Violation) => {
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
              const [prevStartH] = sPrev.startTime.split(':').map(Number);
              const empExtraHours = emp.extraHours !== undefined ? emp.extraHours : extraHours;
              const minRestMin = constraints.minRestHours * 60;
              const safeShifts = shiftCodes.filter(sc => activeShiftCodes.has(sc.code) && getRestHours(sPrev, sc, empExtraHours) >= minRestMin);
              
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
    } else if (v.type === 'CONSECUTIVE' || v.type === 'OFF_AFTER_NIGHT') {
      handleManualShiftChange(v.employeeId, v.date, 'OFF');
      return;
    } else if (v.type === 'CONSECUTIVE_OFF') {
      const emp = roster.find(e => e.employeeId === v.employeeId);
      if (emp) {
        let updatedEmp = { ...emp };
        const target = Math.round(updatedEmp.targetWorkingDays);
        const minRestMin = constraints.minRestHours * 60;
        let working = updatedEmp.totalWorkingDays;
        
        for (let idx = 0; idx < volumeData.length; idx++) {
          const d = volumeData[idx].date;
          if ((updatedEmp.days[d] === 'OFF' || !updatedEmp.days[d]) && !isApprovedLeave(emp.employeeId, d)) {
            const prevDateStr = idx > 0 ? volumeData[idx-1].date : null;
            const nextDateStr = idx < volumeData.length - 1 ? volumeData[idx+1].date : null;
            
            const prevShift = prevDateStr ? (updatedEmp.days[prevDateStr] || 'OFF') : 'OFF';
            const nextShift = nextDateStr ? (updatedEmp.days[nextDateStr] || 'OFF') : 'OFF';
            
            const candidateShifts = shiftCodes.filter(sc => activeShiftCodes.has(sc.code));
            const bestShift = candidateShifts.find(sc => {
              let ok = true;
              if (prevShift !== 'OFF' && prevShift !== 'Leave') {
                const sPrev = shiftCodes.find(c => c.code === prevShift);
                if (sPrev && getRestHours(sPrev, sc, emp.extraHours || 0) < minRestMin) ok = false;
              }
              if (nextShift !== 'OFF' && nextShift !== 'Leave') {
                const sNext = shiftCodes.find(c => c.code === nextShift);
                if (sNext && getRestHours(sc, sNext, emp.extraHours || 0) < minRestMin) ok = false;
              }
              return ok;
            });

            if (bestShift) {
              updatedEmp.days = { ...updatedEmp.days, [d]: bestShift.code };
              working = 0;
              Object.values(updatedEmp.days).forEach(s => { 
                if (s !== 'OFF' && s !== 'Leave') working++; 
              });
              updatedEmp.totalWorkingDays = working;
              updatedEmp.totalOffDays = Object.values(updatedEmp.days).length - working;
              if (working >= target) break;
            }
          }
        }
        
        if (working > emp.totalWorkingDays) {
          const updatedRoster = roster.map(e => e.employeeId === emp.employeeId ? updatedEmp : e);
          setRoster(updatedRoster);
          await setDoc(doc(db, 'roster', 'current'), { roster: updatedRoster });
          toast.success(`Allocated ${working - emp.totalWorkingDays} additional shifts to meet target.`);
          return;
        }
      }
    }
    toast.info("No automatic fix available. Please adjust manually.");
  };

  const getShiftBadgeClasses = (code: string, isRestViolation: boolean, isConsecViolation: boolean, isOnLeave: boolean = false, isNightViolation: boolean = false) => {
    if (isOnLeave || code === 'Leave') return 'bg-amber-100 text-amber-800 border-amber-300 ring-1 ring-amber-200';
    if (code === 'OFF') return 'bg-slate-50 text-slate-300 border-slate-100';
    
    if (isRestViolation || isNightViolation || isConsecViolation) {
      if (isRestViolation || isNightViolation) return 'bg-rose-100 text-rose-700 ring-1 ring-rose-300 border-rose-200';
      return 'bg-amber-100 text-amber-700 ring-1 ring-amber-300 border-amber-200';
    }
    
    const idx = shiftCodes.findIndex(sc => sc.code === code);
    const colors = [
      'bg-blue-50 text-blue-700 border-blue-200',
      'bg-emerald-50 text-emerald-700 border-emerald-200',
      'bg-amber-50 text-amber-700 border-amber-200',
      'bg-purple-50 text-purple-700 border-purple-200',
      'bg-pink-50 text-pink-700 border-pink-200',
      'bg-cyan-50 text-cyan-700 border-cyan-200',
      'bg-orange-50 text-orange-700 border-orange-200',
      'bg-rose-50 text-rose-700 border-rose-200',
      'bg-indigo-50 text-indigo-700 border-indigo-200',
      'bg-violet-50 text-violet-700 border-violet-200'
    ];
    
    // Explicit colors for night shifts to match screenshot
    const codeObj = shiftCodes.find(sc => sc.code === code);
    if (codeObj?.isNightShift) return 'bg-rose-100 text-rose-900 border-rose-300 font-bold';
    if (codeObj && (codeObj.startTime >= '12:00' && codeObj.startTime < '21:00')) return 'bg-orange-100 text-orange-900 border-orange-300 font-bold';

    return colors[idx % colors.length] || 'bg-indigo-50 text-indigo-700 border-indigo-200';
  };

  const getHeatmapStyle = (assigned: number, required: number) => {
    if (required === 0) {
      if (assigned === 0) return { backgroundColor: '#f8fafc', color: '#94a3b8' };
      return { backgroundColor: '#e0f2fe', color: '#0369a1' }; 
    }
    
    const ratio = assigned / required;
    if (ratio === 0) return { backgroundColor: '#f8fafc', color: '#94a3b8' };
    
    // Intense Scaling for heatmap
    if (ratio <= 0.2) return { backgroundColor: '#7f1d1d', color: '#ffffff' }; // Red 900 (Critical Under)
    if (ratio <= 0.5) return { backgroundColor: '#b91c1c', color: '#ffffff' }; // Red 700 (High Under)
    if (ratio <= 0.8) return { backgroundColor: '#ef4444', color: '#ffffff' }; // Red 500 (Moderate Under)
    if (ratio < 1.0) return { backgroundColor: '#fecaca', color: '#991b1b' }; // Red 200 (Low Under)
    
    if (ratio >= 1.0 && ratio <= 1.1) return { backgroundColor: '#dcfce7', color: '#166534' }; // Green 100 (Perfect)
    
    if (ratio <= 1.3) return { backgroundColor: '#e0e7ff', color: '#3730a3' }; // Indigo 100 (Low Surplus)
    if (ratio <= 1.6) return { backgroundColor: '#6366f1', color: '#ffffff' }; // Indigo 500 (Moderate Surplus)
    if (ratio <= 2.0) return { backgroundColor: '#4338ca', color: '#ffffff' }; // Indigo 700 (High Surplus)
    return { backgroundColor: '#312e81', color: '#ffffff' }; // Indigo 900 (Extreme Surplus)
  };

  // Parameters for Staffing (synced from Firestore)
  const [channelType, setChannelType] = useState<'call' | 'chat' | 'email' | 'whatsapp' | 'multiskill_chat_wa'>('call');
  const [aht, setAht] = useState(300);
  const [targetSL, setTargetSL] = useState(0.8);
  const [targetTime, setTargetTime] = useState(20);
  const [concurrency, setConcurrency] = useState(2);
  const [tat, setTat] = useState(3600); // 1 hour default for email
  const [frt, setFrt] = useState(60); // 60s for chat/wa
  const [shrinkage, setShrinkage] = useState(0.3);
  const [workingDays, setWorkingDays] = useState(22);
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
    return applyOperationalWindowsToVolume(extendedVolumeData, operationalWindows);
  }, [extendedVolumeData, operationalWindows]);

  const uniqueSkills = useMemo(() => {
    const skills = Array.from(new Set(employees.map(e => e.skill))).filter(Boolean) as string[];
    return skills.length > 0 ? skills : ['General'];
  }, [employees]);

  const sortIntervals = (keys: string[]) => {
    return [...keys].sort((a, b) => {
      const getMinutes = (s: string) => {
        const m = s.match(/(\d{1,2}):(\d{2})/);
        return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : 0;
      };
      return getMinutes(a) - getMinutes(b);
    });
  };

  const { targetWorkingDays, targetOffDays, targetHolidays, matchedMonth } = useMemo(() => {
    let twd = 22;
    let tod = 8;
    let th = 0;
    let mm = "Default (5/7 ratio)";
    
    if (volumeData.length > 0) {
      const firstDate = new Date(volumeData[0].date);
      const monthLabel = format(firstDate, 'MMM-yy');
      
      // Prioritize the specific workingDays set by the user in the AI Requirement page
      if (workingDays > 0) {
        twd = workingDays;
        mm = `User Set (${twd} WD)`;
      } else {
        const ref = workingDaysRef.find(r => 
          (r.month || '').toLowerCase() === (monthLabel || '').toLowerCase() || 
          r.id === monthLabel
        );
        
        if (ref) {
          // If the provided reference total days is very close to volume data length (e.g. +/- 1 day),
          // we strictly trust the specified working days from the policy.
          const isFullMonthMatch = Math.abs((ref.totalDays || volumeData.length) - volumeData.length) <= 1;
          const baseWorkingDays = ref.workingDays || (ref.totalDays - ref.weekend - ref.holiday);
          
          if (isFullMonthMatch) {
            twd = baseWorkingDays;
          } else {
            const scaleFactor = volumeData.length / (ref.totalDays || volumeData.length || 30);
            twd = Math.round(baseWorkingDays * scaleFactor);
          }
          
          tod = (ref.weekend || 8);
          th = (ref.holiday || 0);
          mm = `Ref: ${ref.month} (${twd} WD)`;
        } else {
          // Fallback to standard ratio if not in reference table
          twd = Math.round(volumeData.length * (5/7));
          tod = volumeData.length - twd;
        }
      }
    }
    return { targetWorkingDays: twd, targetOffDays: tod, targetHolidays: th, matchedMonth: mm };
  }, [volumeData, workingDaysRef, workingDays]);

  const { totalDemand, dailyWeights, workloadMetrics } = useMemo(() => {
    const weights: Record<string, number> = {};

    // 1. Calculate Total Monthly Workload and Total Volume
    let totalMonthlyVolume = 0;
    processedVolume.forEach(day => {
      Object.values(day.intervals).forEach(vol => {
        const v = Number(vol) || 0;
        totalMonthlyVolume += v;
      });
    });

    const shiftLength = 8 + (isAgreedToAdjustments ? extraHours : 0);
    
    // 3. Pre-calculate all interval requirements using Erlang C
    const slFactor = targetSL > 1 ? targetSL / 100 : targetSL;
    const sFactor = shrinkage > 1 ? shrinkage / 100 : shrinkage;
    const shrinkageFactor = Math.min(0.99, sFactor);
    
    let sumOfDailyGrossStartsNeeded = 0;
    let totalStaffingHoursGross = 0;

    processedVolume.forEach(day => {
      const allIntervalKeys = sortIntervals(Object.keys(day.intervals));
      let dayGrossWorkHours = 0;
      
      Object.entries(day.intervals).forEach(([interval, val]) => {
        const v = Number(val) || 0;
        const duration = getIntervalDuration(interval, allIntervalKeys);
        let res: any;
        if (channelType === 'chat' || channelType === 'whatsapp' || channelType === 'multiskill_chat_wa') {
          res = calculateRequiredAgentsChat(v, aht, slFactor, frt || 60, concurrency, duration);
        } else if (channelType === 'email') {
          res = calculateRequiredAgentsEmail(v, aht, slFactor, tat, duration);
        } else {
          res = calculateRequiredAgents(v, aht, slFactor, targetTime, duration);
        }
        
        const grossNeeded = shrinkageFactor >= 1 ? res.agents : Math.ceil(res.agents / (1 - shrinkageFactor));
        dayGrossWorkHours += grossNeeded * duration;
      });

      totalStaffingHoursGross += dayGrossWorkHours;
      const dayStartsNeeded = Math.ceil(dayGrossWorkHours / shiftLength);
      sumOfDailyGrossStartsNeeded += dayStartsNeeded;
      
      // Weight for distribution
      weights[day.date] = dayStartsNeeded;
    });

    const avgDailyOnFloorGross = sumOfDailyGrossStartsNeeded / (processedVolume.length || 1);
    const avgDailyNetFloorGoal = avgDailyOnFloorGross * (1 - shrinkageFactor);
    const rosterMultiplier = (processedVolume.length / (targetWorkingDays || 22));
    const grossFTEValue = avgDailyOnFloorGross * rosterMultiplier;

    return { 
      totalDemand: sumOfDailyGrossStartsNeeded, 
      totalCeiledDemand: sumOfDailyGrossStartsNeeded, 
      dailyWeights: weights,
      workloadMetrics: {
        totalVolume: totalMonthlyVolume,
        totalWorkHours: totalStaffingHoursGross,
        grossFTE: Math.ceil(grossFTEValue),
        grossFTERaw: grossFTEValue,
        netFTE: Math.ceil(avgDailyNetFloorGoal), // Logged in agents goal
        avgDailyHeadcount: Math.ceil(avgDailyOnFloorGross), // Scheduling target
        rosterMultiplier
      }
    };
  }, [processedVolume, aht, targetWorkingDays, shrinkage, channelType, targetSL, frt, concurrency, tat, targetTime, isAgreedToAdjustments, extraHours]);

  const coverageAnalysis = useMemo(() => {
    if (!selectedCoverageDate) return null;
    const day = processedVolume.find(v => v.date === selectedCoverageDate);
    if (!day) return null;

    const dayReqs: Record<string, number> = {};
    let allIntervalKeys = sortIntervals(Object.keys(day.intervals));
    if (allIntervalKeys.length === 0) {
      allIntervalKeys = Array.from({length: 24}, (_, i) => `${i < 10 ? '0' : ''}${i}:00`);
    }

    const prevDate = format(addDays(new Date(selectedCoverageDate), -1), 'yyyy-MM-dd');
    const slFactor = targetSL > 1 ? targetSL / 100 : targetSL;
    const sFact = shrinkage > 1 ? shrinkage / 100 : shrinkage;
    
    Object.entries(day.intervals).forEach(([interval, val]) => {
      const duration = getIntervalDuration(interval, allIntervalKeys);
      const effectiveVolume = Number(val) || 0;
      
      let res: any;
      if (channelType === 'chat' || channelType === 'whatsapp' || channelType === 'multiskill_chat_wa') {
        res = calculateRequiredAgentsChat(effectiveVolume, aht, slFactor, frt || 60, concurrency, duration);
      } else if (channelType === 'email') {
        res = calculateRequiredAgentsEmail(effectiveVolume, aht, slFactor, tat, duration);
      } else {
        res = calculateRequiredAgents(effectiveVolume, aht, slFactor, targetTime, duration);
      }
      const shrinkageFactor = Math.min(0.99, sFact);
      dayReqs[interval] = Math.ceil(res.agents / (1 - shrinkageFactor));
    });

    const dayAssigned: Record<string, number> = {};
    Object.keys(dayReqs).forEach(int => dayAssigned[int] = 0);
    
    roster.forEach(emp => {
      // 1. Current day shift assignments
      const code = emp.days[selectedCoverageDate];
      if (code && code !== 'OFF' && !isApprovedLeave(emp.employeeId, selectedCoverageDate)) {
        const sc = shiftCodes.find(x => x.code === code);
        if (sc) {
          allIntervalKeys.forEach(interval => {
            if (isIntervalInShift(interval, sc.startTime, sc.endTime, extraHours, true)) {
              dayAssigned[interval]++;
            }
          });
        }
      }

      // 2. Previous day shift carry-over assignments (if shift crossed midnight)
      const prevCode = emp.days[prevDate] || (legacyRoster[emp.employeeId]?.[prevDate]);
      if (prevCode && prevCode !== 'OFF' && !isApprovedLeave(emp.employeeId, prevDate)) {
        const sc = shiftCodes.find(x => x.code === prevCode);
        if (sc) {
          allIntervalKeys.forEach(interval => {
            if (isIntervalInShift(interval, sc.startTime, sc.endTime, extraHours, false)) {
              dayAssigned[interval]++;
            }
          });
        }
      }
    });

    const chartData = allIntervalKeys.map(interval => {
      const req = dayReqs[interval] || 0;
      const ass = dayAssigned[interval] || 0;
      return {
        interval,
        required: req,
        assigned: ass,
        gap: Math.max(0, req - ass)
      };
    });

    const maxAssigned = Math.max(...Object.values(dayAssigned), 0);
    const totalGapIntervals = Object.entries(dayReqs).filter(([int, req]) => req > 0 && dayAssigned[int] < req).length;
    const zeroStaffIntervals = Object.entries(dayReqs).filter(([int, req]) => req > 0 && dayAssigned[int] === 0).length;

    return { chartData, maxAssigned, totalGapIntervals, zeroStaffIntervals };
  }, [selectedCoverageDate, roster, processedVolume, shiftCodes, shrinkage, extraHours, channelType, aht, targetSL, targetTime, concurrency, tat]);

  const coverageMatrix = useMemo(() => {
    if (roster.length === 0 || processedVolume.length === 0) return null;
    const dates = processedVolume.map(d => d.date);
    const firstDay = processedVolume[0];
    let rawIntervals = sortIntervals(Object.keys(firstDay.intervals));
    if (rawIntervals.length === 0) {
      rawIntervals = Array.from({length: 24}, (_, i) => `${i < 10 ? '0' : ''}${i}:00`);
    }
    const intervalData: Record<string, Record<string, { assigned: number, required: number }>> = {};

    rawIntervals.forEach(interval => {
      intervalData[interval] = {};
      dates.forEach(date => {
        intervalData[interval][date] = { assigned: 0, required: 0 };
      });
    });

    processedVolume.forEach(day => {
      const allIntervals = sortIntervals(Object.keys(day.intervals));
      Object.entries(day.intervals).forEach(([interval, val]) => {
        const duration = getIntervalDuration(interval, allIntervals);
        const volume = Number(val) || 0;
        
        let res: any;
        if (channelType === 'chat' || channelType === 'whatsapp' || channelType === 'multiskill_chat_wa') {
          res = calculateRequiredAgentsChat(volume, aht, targetSL, targetTime, concurrency, duration);
        } else if (channelType === 'email') {
          res = calculateRequiredAgentsEmail(volume, aht, targetSL, tat, duration);
        } else {
          res = calculateRequiredAgents(volume, aht, targetSL, targetTime, duration);
        }

        const shrinkageFactor = Math.min(0.99, shrinkage);
        let req = Math.ceil(res.agents / (1 - shrinkageFactor));
        
        if (skillFilter !== 'all') {
          req = Math.ceil(req * ((skillRatios[skillFilter] || 0) / 100));
        }
        if (intervalData[interval]) intervalData[interval][day.date].required = req;
      });
    });

    // 2. Calculate Assigned Agents (Respecting Skill Filter)
    const yesterday = dates.length > 0 ? format(addDays(new Date(dates[0]), -1), 'yyyy-MM-dd') : null;

    roster.forEach(emp => {
      if (skillFilter !== 'all' && emp.skill !== skillFilter) return;
      
      const empExtraHours = emp.extraHours !== undefined ? emp.extraHours : extraHours;
      
      // Combine current roster with legacy roster to account for carry-over from previous days
      const combinedDays = { ...(legacyRoster[emp.employeeId] || {}), ...emp.days };

      Object.entries(combinedDays).forEach(([startDate, code]) => {
        if (code === 'OFF' || isApprovedLeave(emp.employeeId, startDate)) return;
        
        const sc = shiftCodes.find(x => x.code === code);
        if (!sc) return;

        const [startH, startM] = sc.startTime.split(':').map(Number);
        const [endH, endM] = sc.endTime.split(':').map(Number);
        
        let startMins = startH * 60 + startM;
        let endMins = endH * 60 + endM + (empExtraHours * 60);
        
        // Handle midnight wrap-around
        if (endMins <= startMins) endMins += 1440;

        rawIntervals.forEach(interval => {
          const [intStartStr] = interval.split(' - ');
          const [intH, intM] = intStartStr.split(':').map(Number);
          const intStartMins = intH * 60 + intM;
          const intEndMins = intStartMins + 60;

          // Check if interval overlaps with shift on original day
          const shiftStartOnDay = startMins;
          const shiftEndOnDay = Math.min(endMins, 1440);
          
          if (intStartMins < shiftEndOnDay && intEndMins > shiftStartOnDay) {
            if (intervalData[interval]?.[startDate]) {
              intervalData[interval][startDate].assigned++;
            }
          }

          // Check if interval overlaps with shift on next day (if midnight crossed)
          if (endMins > 1440) {
            const shiftEndOnNextDay = endMins - 1440;
            if (intStartMins < shiftEndOnNextDay) {
              const nextDayIdx = dates.indexOf(startDate) + 1;
              // Use nextDayIdx 0 only if startDate is exactly yesterday to prevent older shifts from leaking forward
              if ((nextDayIdx > 0 && nextDayIdx < dates.length) || (nextDayIdx === 0 && startDate === yesterday)) {
                const nextDate = dates[nextDayIdx];
                if (intervalData[interval]?.[nextDate]) {
                  intervalData[interval][nextDate].assigned++;
                }
              }
            }
          }
        });
      });
    });

    return { 
      dates, 
      intervals: rawIntervals.map(i => {
        const parts = i.split(':');
        const startH = parseInt(parts[0]);
        const endH = (startH + 1) % 24;
        return { key: i, label: `${i} - ${endH < 10 ? '0' : ''}${endH}:00` };
      }), 
      data: intervalData 
    };
  }, [processedVolume, roster, legacyRoster, shiftCodes, shrinkage, extraHours, channelType, aht, targetSL, targetTime, concurrency, tat, skillFilter, skillRatios]);

  const shiftDistribution = useMemo(() => {
    if (roster.length === 0 || processedVolume.length === 0) return null;
    const dates = processedVolume.map(d => d.date);
    const codes = [...shiftCodes.map(sc => sc.code)];
    const distribution: Record<string, Record<string, number>> = {};
    const targets: Record<string, Record<string, number>> = {};

    codes.forEach(code => {
      distribution[code] = {};
      targets[code] = {};
      dates.forEach(date => {
        distribution[code][date] = 0;
        targets[code][date] = 0;
      });
    });

    // 1. Calculate Actual Counts from Roster
    roster.forEach(emp => {
      if (skillFilter !== 'all' && emp.skill !== skillFilter) return;
      Object.entries(emp.days).forEach(([date, code]) => {
        const isLeave = isApprovedLeave(emp.employeeId, date);
        if (isLeave) return;
        const codeStr = code as string;
        if (distribution[codeStr] && distribution[codeStr][date] !== undefined) {
          distribution[codeStr][date]++;
        }
      });
    });

    // 2. Identify the skills to process for Theoretical Targets
    const skillsToProcess = skillFilter === 'all' 
      ? Array.from(new Set(employees.map(e => e.skill))).filter(Boolean) as string[]
      : [skillFilter];

    // --- REPLICATE GENERATOR BALANCING LOGIC (STRICT PROPORTIONAL DISTRIBUTION) ---
    const totalApprovedLeaveDaysGlobal = leaveRequests.filter(req => 
      req.status === 'approved' && processedVolume.some(d => d.date === req.date)
    ).length;

    const globalIdealCapacity = (employees.reduce((sum, emp) => sum + targetWorkingDays + (emp.extraWorkingDays || 0), 0) - totalApprovedLeaveDaysGlobal);
    const adjustedDailyHeadcountsGlobal: Record<string, number> = {};
    
    if (totalDemand > 0 && globalIdealCapacity > 0) {
      let assignedSoFar = 0;
      processedVolume.forEach(day => {
        const weight = dailyWeights[day.date] || 0;
        const share = (weight / totalDemand) * globalIdealCapacity;
        
        const onLeaveCount = leaveRequests.filter(r => r.date === day.date && r.status === 'approved').length;
        const availableCount = employees.length - onLeaveCount;
        
        const target = Math.min(availableCount, Math.floor(share));
        adjustedDailyHeadcountsGlobal[day.date] = target;
        assignedSoFar += target;
      });

      let diffGlobal = globalIdealCapacity - assignedSoFar;
      if (diffGlobal > 0) {
        const daysWithRemainder = processedVolume.map(day => {
          const weight = dailyWeights[day.date] || 0;
          const floatShare = (weight / totalDemand) * globalIdealCapacity;
          return {
            date: day.date,
            remainder: floatShare - Math.floor(floatShare),
            weight
          };
        }).sort((a, b) => {
          if (Math.abs(b.remainder - a.remainder) > 0.001) return b.remainder - a.remainder;
          return b.weight - a.weight;
        });

        for (const dr of daysWithRemainder) {
          if (diffGlobal <= 0) break;
          const onLeaveCount = leaveRequests.filter(r => r.date === dr.date && r.status === 'approved').length;
          const availableCount = employees.length - onLeaveCount;
          
          if (adjustedDailyHeadcountsGlobal[dr.date] < availableCount) {
            adjustedDailyHeadcountsGlobal[dr.date]++;
            diffGlobal--;
          }
        }
      }
    } else {
      // Fallback
      processedVolume.forEach(day => {
        adjustedDailyHeadcountsGlobal[day.date] = 0;
      });
    }
    // --- END REPLICATION ---

    const skillCarryOver: Record<string, Record<string, number>> = {};
    skillsToProcess.forEach(s => skillCarryOver[s] = {});

    if (processedVolume.length > 0 && legacyRoster) {
      const firstDay = processedVolume[0].date;
      const prevDay = format(addDays(new Date(firstDay), -1), 'yyyy-MM-dd');
      Object.entries(legacyRoster).forEach(([empId, days]) => {
        const emp = employees.find(e => e.id === empId);
        if (emp && skillsToProcess.includes(emp.skill) && days[prevDay] && days[prevDay] !== 'OFF') {
          skillCarryOver[emp.skill][days[prevDay]] = (skillCarryOver[emp.skill][days[prevDay]] || 0) + 1;
        }
      });
    }

    processedVolume.forEach(day => {
      const dayConfig = matchDayName(day.day, operationalWindows, day.date);
      const isDayOpen = dayConfig ? dayConfig.isOpen : true;

      if (!isDayOpen) {
        skillsToProcess.forEach(s => skillCarryOver[s] = {});
        return;
      }

      const headcountPossible = adjustedDailyHeadcountsGlobal[day.date] || 0;

      skillsToProcess.forEach(skill => {
        const filteredEmployees = employees.filter(emp => emp.skill === skill);
        if (filteredEmployees.length === 0) return;

        const onLeaveCount = leaveRequests.filter(r => r.date === day.date && r.status === 'approved' && r.skill === skill).length;
        const availableCount = Math.max(0, filteredEmployees.length - onLeaveCount);
        
        const ratio = (skillRatios[skill] !== undefined ? skillRatios[skill] : (100 / (skillsToProcess.length || 1))) / 100;
        let startsNeeded = Math.min(availableCount, Math.ceil(headcountPossible * ratio));

        const intervalNeeds: Record<string, number> = {};
        const allIntervalKeys = sortIntervals(Object.keys(day.intervals));
        Object.entries(day.intervals).forEach(([interval, val]) => {
          const v = (Number(val) || 0) * ratio;
          const duration = getIntervalDuration(interval, allIntervalKeys);
          let res: any;
          if (channelType === 'chat' || channelType === 'whatsapp' || channelType === 'multiskill_chat_wa') {
            res = calculateRequiredAgentsChat(v, aht, targetSL, targetTime, concurrency, duration);
          } else if (channelType === 'email') {
            res = calculateRequiredAgentsEmail(v, aht, targetSL, tat, duration);
          } else {
            res = calculateRequiredAgents(v, aht, targetSL, targetTime, duration);
          }
          const shrinkageFactor = Math.min(0.99, shrinkage);
          intervalNeeds[interval] = Math.ceil(res.agents / (1 - shrinkageFactor));
        });

        const currentAssigned: Record<string, number> = {};
        allIntervalKeys.forEach(int => {
          let supply = 0;
          Object.entries(skillCarryOver[skill]).forEach(([code, count]) => {
            const sc = shiftCodes.find(c => c.code === code);
            if (sc && isIntervalInShift(int, sc.startTime, sc.endTime, extraHours, false)) supply += count;
          });
          currentAssigned[int] = supply;
        });

        const todaysStarts: Record<string, number> = {};
        shiftCodes.forEach(c => todaysStarts[c.code] = 0);

        let assignedCount = 0;
        const targetShifts = shiftCodes.filter(sc => activeShiftCodes.has(sc.code));

        while (assignedCount < startsNeeded) {
          let bestShift = null;
          let maxScore = -Infinity;

          for (const code of targetShifts) {
            // Constraint Awareness: Eligible Pool check (Soft check for targets)
            if (code.isNightShift) {
               const maleCount = filteredEmployees.filter(e => e.gender !== 'P').length;
               if ((todaysStarts[code.code] || 0) >= maleCount) continue; 
            }
            
            let score = 0;
            allIntervalKeys.forEach(interval => {
              if (isIntervalInShift(interval, code.startTime, code.endTime, extraHours, true)) {
                const gap = intervalNeeds[interval] - currentAssigned[interval];
                const isOpWindow = dayConfig ? isIntervalInWindow(interval, dayConfig.start, dayConfig.end) : true;
                
                if (!isOpWindow) score -= 10000;
                else if (gap > 0) score += (2500 + (gap * 200)); // Prioritize deeper gaps significantly
                else score -= 500;
              }
            });

            // Diversification
            score -= (todaysStarts[code.code] || 0) * 100;
            if (score > maxScore) { maxScore = score; bestShift = code; }
          }

          if (bestShift) {
            todaysStarts[bestShift.code]++;
            targets[bestShift.code][day.date]++;
            allIntervalKeys.forEach(int => {
              if (isIntervalInShift(int, bestShift!.startTime, bestShift!.endTime, extraHours, true)) {
                currentAssigned[int]++;
              }
            });
            assignedCount++;
          } else break;
        }

        // Enforcement for M1 and M3
        ['M1', 'M3'].forEach(mCode => {
          if (todaysStarts[mCode] > 0 && todaysStarts[mCode] < 3) {
            targets[mCode][day.date] += (3 - todaysStarts[mCode]);
            todaysStarts[mCode] = 3;
          }
        });

        skillCarryOver[skill] = todaysStarts;
      });
    });

    let finalCodes = codes;
    if (hideUnusedShifts) {
      finalCodes = codes.filter(code => {
        const hasAssignment = Object.values(distribution[code] || {}).some(v => v > 0);
        const hasTarget = Object.values(targets[code] || {}).some(v => v > 0);
        return hasAssignment || hasTarget;
      });
    }

    return { dates, codes: finalCodes, data: distribution, targets };
  }, [roster, legacyRoster, processedVolume, shiftCodes, shrinkage, extraHours, channelType, aht, targetSL, targetTime, concurrency, tat, operationalWindows, skillFilter, skillRatios, hideUnusedShifts, activeShiftCodes, employees, leaveRequests, dailyWeights, workingDaysRef, targetWorkingDays]);

  const maxAssignedOverall = useMemo(() => {
    if (!coverageMatrix) return 0;
    let max = 0;
    Object.values(coverageMatrix.data).forEach(dayData => {
      Object.values(dayData).forEach(stats => {
        if (stats.assigned > max) max = stats.assigned;
      });
    });
    return max;
  }, [coverageMatrix]);

  const shortageInfo = useMemo(() => {
    if (employees.length === 0 || volumeData.length === 0 || !workloadMetrics) return null;
    
    // Calculate total approved leave days in the period
    const totalApprovedLeaveDays = leaveRequests.reduce((sum, req) => {
      if (req.status === 'approved' && volumeData.some(d => d.date === req.date)) {
        return sum + 1;
      }
      return sum;
    }, 0);

    // Calculate base ideal capacity (without extra days)
    const baseIdealCapacity = (employees.length * targetWorkingDays) - totalApprovedLeaveDays;
    
    // Use the exact same totalRawDemand as workloadMetrics to ensure alignment
    const totalRawDemandBase = workloadMetrics.totalDemand;
    
    const baseShortage = totalRawDemandBase - baseIdealCapacity;
    const suggestedExtraDays = baseShortage > 0 ? Math.ceil(baseShortage / (employees.length || 1)) : 0;
    
    const currentIdealCapacityHours = employees.reduce((sum, emp) => {
      const adjustmentMultiplier = isAgreedToAdjustments ? 1 : 0;
      const empExtraDays = (emp.extraWorkingDays !== undefined ? emp.extraWorkingDays : extraWorkingDays) * adjustmentMultiplier;
      const empExtraHours = (emp.extraHours !== undefined ? emp.extraHours : extraHours) * adjustmentMultiplier;
      const shiftHours = 8 + empExtraHours;
      
      // Calculate this employee's approved leave days in this period
      const empLeaveDays = leaveRequests.filter(req => 
        req.employeeId === emp.id && 
        req.status === 'approved' && 
        volumeData.some(d => d.date === req.date)
      ).length;

      return sum + ((targetWorkingDays + empExtraDays - empLeaveDays) * shiftHours);
    }, 0);

    const monthlyStandardHours = 8 * targetWorkingDays;
    const effectiveAvailableFTE = (currentIdealCapacityHours / (monthlyStandardHours || 1));

    const currentRawDemand = workloadMetrics.totalDemand;
    const currentShortage = Math.max(0, currentRawDemand - (currentIdealCapacityHours / 8));

    return { 
      baseShortage: Math.ceil(baseShortage), 
      suggestedExtraDays, 
      currentShortage: Math.ceil(currentShortage),
      isCovered: currentShortage <= 0.01,
      grossFTE: workloadMetrics.grossFTE,
      grossFTERaw: workloadMetrics.grossFTERaw,
      netFTE: workloadMetrics.netFTE,
      totalVolume: workloadMetrics.totalVolume,
      totalWorkHours: Math.round(workloadMetrics.totalWorkHours),
      effectiveAvailableFTE,
      physicalHeadcount: employees.length,
      effectiveSupply: currentIdealCapacityHours / 8
    };
  }, [employees.length, volumeData, targetWorkingDays, extraWorkingDays, extraHours, workloadMetrics, leaveRequests, isAgreedToAdjustments]);

  useEffect(() => { if (props.employees) setEmployees(props.employees); }, [props.employees]);
  useEffect(() => { if (props.shiftCodes) setShiftCodes(props.shiftCodes); }, [props.shiftCodes]);
  useEffect(() => { 
    if (props.allVolumeData) {
      setAllVolumeData(props.allVolumeData); 
      if (props.allVolumeData.length > 0 && !selectedDateForAnalysis) {
        setSelectedDateForAnalysis(props.allVolumeData[0].date);
      }
    }
  }, [props.allVolumeData]);
  useEffect(() => { if (props.workingDaysRef) setWorkingDaysRef(props.workingDaysRef); }, [props.workingDaysRef]);
  useEffect(() => { if (props.leaveRequests) setLeaveRequests(props.leaveRequests); }, [props.leaveRequests]);
  useEffect(() => { if (props.roster) setRoster(props.roster); }, [props.roster]);
  useEffect(() => { if (props.legacyRoster) setLegacyRoster(props.legacyRoster); }, [props.legacyRoster]);
  useEffect(() => { 
    if (props.erlangSettings) {
      const data = props.erlangSettings;
      if (data.channelType) setChannelType(data.channelType);
      if (data.aht) setAht(data.aht);
      if (data.targetSL) setTargetSL(data.targetSL > 1 ? data.targetSL / 100 : data.targetSL); 
      if (data.targetTime) setTargetTime(data.targetTime);
      if (data.frt) setFrt(data.frt);
      if (data.concurrency) setConcurrency(data.concurrency);
      if (data.tat) setTat(data.tat);
      if (data.shrinkage) setShrinkage(data.shrinkage / 100);
      if (data.workingDays) setWorkingDays(data.workingDays);
      if (data.operationalWindows) setOperationalWindows(data.operationalWindows);
      if (data.extraWorkingDays !== undefined) setExtraWorkingDays(data.extraWorkingDays);
      if (data.extraHours !== undefined) setExtraHours(data.extraHours);
      if (data.isSimulationAgreed !== undefined) setIsAgreedToAdjustments(data.isSimulationAgreed);
      if (data.constraints) {
        setConstraints(prev => ({ ...prev, ...data.constraints }));
      }
    }
  }, [props.erlangSettings]);

  const saveSettings = async (newSettings: any) => {
    try {
      await setDoc(doc(db, 'erlangSettings', 'current'), newSettings, { merge: true });
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  };

  const handleAgreementToggle = async (agreed: boolean) => {
    setIsAgreedToAdjustments(agreed);
    await saveSettings({ isSimulationAgreed: agreed });
  };

  const handleExtraDaysChange = async (days: number) => {
    setExtraWorkingDays(days);
    await saveSettings({ extraWorkingDays: days });
  };

  const handleExtraHoursChange = async (hours: number) => {
    setExtraHours(hours);
    await saveSettings({ extraHours: hours });
  };
  useEffect(() => { if (props.constraints) setConstraints(prev => ({ ...prev, ...props.constraints })); }, [props.constraints]);

  useEffect(() => {
    // Shared state is now handled by App.tsx props.
    // This effect ensures any local initializations happen if needed.
  }, []);

  const updateConstraint = async (key: keyof typeof constraints, value: any) => {
    const newConstraints = { ...constraints, [key]: value };
    setConstraints(newConstraints);
    try {
      await setDoc(doc(db, 'schedulingConstraints', 'current'), newConstraints, { merge: true });
    } catch (error) {
      console.error("Failed to save constraint:", error);
    }
  };

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

  const handleDownloadTemplate = () => {
    if (volumeData.length === 0) {
      toast.error('No month selected. Please select a month first.');
      return;
    }

    const headers = ['NIP', 'Name', ...volumeData.map(d => d.date)];
    const sampleRows = employees.map(emp => [
      emp.nip || '',
      emp.name || '',
      ...volumeData.map(() => 'OFF')
    ]);

    const worksheetData = [headers, ...sampleRows];
    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Template");
    XLSX.writeFile(workbook, `roster_template_${selectedMonth}.xlsx`);
    toast.success('Template downloaded');
  };

  const handleRosterUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setLoading(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

        if (jsonData.length < 2) {
          toast.error('Invalid file format: No data found');
          return;
        }

        const headers = jsonData[0].map(h => (h || '').toString().trim());
        const dateCols: Record<number, string> = {};
        let nipCol = -1;
        let nameCol = -1;

        headers.forEach((h, idx) => {
          const lowerH = h.toLowerCase();
          if (lowerH.includes('nip') || lowerH === 'id') nipCol = idx;
          else if (lowerH.includes('name')) nameCol = idx;
          
          if (h.match(/^\d{4}-\d{2}-\d{2}$/)) {
            dateCols[idx] = h;
          } else {
             try {
                const parts = h.split(/[\/\-]/);
                if (parts.length === 3) {
                   const d = parts[0].padStart(2, '0');
                   const m = parts[1].padStart(2, '0');
                   let y = parts[2];
                   if (y.length === 2) y = '20' + y;
                   const recombined = `${y}-${m}-${d}`;
                   if (!isNaN(Date.parse(recombined))) {
                      dateCols[idx] = recombined;
                   }
                }
             } catch { }
          }
        });

        if (nipCol === -1 && nameCol === -1) {
          toast.error('Could not find NIP or Name column');
          return;
        }

        const newRoster = [...roster];
        let importCount = 0;

        for (let i = 1; i < jsonData.length; i++) {
          const row = jsonData[i];
          const nip = nipCol !== -1 ? (row[nipCol] || '').toString() : '';
          const name = nameCol !== -1 ? (row[nameCol] || '').toString() : '';

          const empIdx = newRoster.findIndex(e => 
            (nip && e.nip === nip) || (name && (e.employeeName || '').toLowerCase() === (name || '').toLowerCase())
          );

          if (empIdx !== -1) {
            const updatedDays = { ...newRoster[empIdx].days };
            Object.entries(dateCols).forEach(([colIdx, dateStr]) => {
              const rowVal = row[parseInt(colIdx)];
              if (rowVal !== undefined && rowVal !== null) {
                const val = rowVal.toString().trim();
                const isValidCode = shiftCodes.some(sc => sc.code === val) || val === 'OFF';
                if (isValidCode) {
                  updatedDays[dateStr] = val;
                }
              }
            });

            const workingDays = Object.values(updatedDays).filter(v => v !== 'OFF' && v !== '').length;
            const offDays = Object.values(updatedDays).filter(v => v === 'OFF').length;

            newRoster[empIdx] = {
              ...newRoster[empIdx],
              days: updatedDays,
              totalWorkingDays: workingDays,
              totalOffDays: offDays
            };
            importCount++;
          }
        }

        setRoster(newRoster);
        setIsUploadDialogOpen(false);
        setShowAudit(true);
        toast.success(`Successfully imported schedule for ${importCount} employees.`);
      } catch (error) {
        console.error('Import error:', error);
        toast.error('Failed to parse file.');
      } finally {
        setLoading(false);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const MetricCard = ({ title, value, icon, description, status }: { title: string, value: string, icon: React.ReactNode, description?: string, status?: 'success' | 'warning' | 'danger' }) => (
    <Card className="border-none shadow-sm hover:bg-slate-50 transition-colors duration-200">
      <CardContent className="p-3">
        <div className="flex items-center justify-between mb-1.5">
          <div className="p-1.5 bg-slate-100 rounded-md">
            {icon}
          </div>
          {status && (
            <div className={`w-1.5 h-1.5 rounded-full ${
              status === 'success' ? 'bg-emerald-500' : 
              status === 'warning' ? 'bg-amber-500' : 'bg-red-500'
            }`} />
          )}
        </div>
        <p className="text-[9px] uppercase font-bold text-slate-400 tracking-wider mb-0.5">{title}</p>
        <p className="text-lg font-black text-slate-900 leading-tight">{value}</p>
        {description && <p className="text-[9px] text-slate-400 font-medium mt-0.5">{description}</p>}
      </CardContent>
    </Card>
  );

  const computeAnalysis = (targetRoster: EmployeeRoster[]) => {
    if (!targetRoster || targetRoster.length === 0 || processedVolume.length === 0) return null;
    
    const analysisShrinkage = props.erlangSettings?.shrinkage || 30;
    const analysisSL = props.erlangSettings?.targetSL || 80;

    let totalAbsDiff = 0;
    let totalRequired = 0;
    let under = 0;
    let over = 0;
    
    const distribution: Record<string, number> = {};
    const dates = processedVolume.map(d => d.date);
    const firstDay = processedVolume[0];
    if (!firstDay) return null;

    const slNorm = analysisSL > 1 ? analysisSL / 100 : analysisSL;
    const shrinkageNorm = analysisShrinkage > 1 ? analysisShrinkage / 100 : analysisShrinkage;
    
    const DEFAULT_DIST: Record<string, number> = {
      "00:00 - 01:00": 0.02, "01:00 - 02:00": 0.015, "02:00 - 03:00": 0.01, "03:00 - 04:00": 0.01,
      "04:00 - 05:00": 0.012, "05:00 - 06:00": 0.015, "06:00 - 07:00": 0.025, "07:00 - 08:00": 0.04,
      "08:00 - 09:00": 0.06, "09:00 - 10:00": 0.07, "10:00 - 11:00": 0.08, "11:00 - 12:00": 0.075,
      "12:00 - 13:00": 0.065, "13:00 - 14:00": 0.07, "14:00 - 15:00": 0.075, "15:00 - 16:00": 0.07,
      "16:00 - 17:00": 0.06, "17:00 - 18:00": 0.05, "18:00 - 19:00": 0.045, "19:00 - 20:00": 0.04,
      "20:00 - 21:00": 0.035, "21:00 - 22:00": 0.03, "22:00 - 23:00": 0.025, "23:00 - 00:00": 0.02
    };

    const rawIntervals = sortIntervals(
      Object.keys(firstDay.intervals || {}).length > 0 
        ? Object.keys(firstDay.intervals) 
        : Object.keys(DEFAULT_DIST)
    );
    
    const intervalData: Record<string, Record<string, Record<string, { assigned: number; required: number }>>> = {};
    const totalSkills = uniqueSkills.length > 0 ? uniqueSkills : ['General'];

    rawIntervals.forEach(interval => {
      intervalData[interval] = {};
      dates.forEach(date => {
        intervalData[interval][date] = {};
        totalSkills.forEach(skill => {
          intervalData[interval][date][skill] = { assigned: 0, required: 0 };
        });
      });
    });

    processedVolume.forEach(day => {
      const vol = Number(day.totalVolume) || 0;
      const dayIntervals = (vol > 0 && (!day.intervals || Object.keys(day.intervals).length === 0))
        ? Object.entries(DEFAULT_DIST).reduce((acc, [int, ratio]) => {
            acc[int] = vol * ratio;
            return acc;
          }, {} as Record<string, number>)
        : (vol > 0 ? (day.intervals || {}) : {});

      Object.entries(dayIntervals).forEach(([interval, val]) => {
        const volume = Number(val) || 0;
        const duration = getIntervalDuration(interval, rawIntervals);
        let res: any;
        if (channelType === 'chat' || channelType === 'whatsapp' || channelType === 'multiskill_chat_wa') {
          res = calculateRequiredAgentsChat(volume, aht, slNorm, targetTime, concurrency, duration);
        } else if (channelType === 'email') {
          res = calculateRequiredAgentsEmail(volume, aht, slNorm, tat, duration);
        } else {
          res = calculateRequiredAgents(volume, aht, slNorm, targetTime, duration);
        }
        const shrinkageFactor = Math.min(0.99, shrinkageNorm);
        const totalNeeded = Math.ceil(res.agents / (1 - shrinkageFactor));
        
        // Distribute requirement among skills proportionally
        if (totalNeeded > 0) {
          totalSkills.forEach(skill => {
            const ratio = (skillRatios[skill] || (100 / totalSkills.length)) / 100;
            if (intervalData[interval]?.[day.date]?.[skill]) {
              intervalData[interval][day.date][skill].required = Math.ceil(totalNeeded * ratio);
            }
          });
        }
      });
    });

    const yesterday = format(addDays(new Date(dates[0]), -1), 'yyyy-MM-dd');

    targetRoster.forEach(emp => {
      const combinedDays = { ...(legacyRoster[emp.employeeId] || {}), ...emp.days };
      const empSkill = emp.skill || 'General';

      Object.entries(combinedDays).forEach(([startDate, code]) => {
        const shiftCode = code as string;
        if (shiftCode === 'OFF') return;
        
        const sc = shiftCodes.find(x => x.code === shiftCode);
        if (!sc) return;

        // Track distribution (only for current month days and valid working shifts)
        if (dates.includes(startDate)) {
          distribution[shiftCode] = (distribution[shiftCode] || 0) + 1;
        }

        const [startH, startM] = sc.startTime.split(':').map(Number);
        const [endH, endM] = sc.endTime.split(':').map(Number);
        let startMins = startH * 60 + startM;
        let endMins = endH * 60 + endM + ((emp.extraHours || extraHours) * 60);
        if (endMins <= startMins) endMins += 1440;

        rawIntervals.forEach(interval => {
          const [intStartStr] = interval.split(' - ');
          const [intH, intM] = intStartStr.split(':').map(Number);
          const intStartMins = intH * 60 + intM;
          const intEndMins = intStartMins + 60;
          
          // Current Day
          if (intStartMins < Math.min(endMins, 1440) && intEndMins > startMins) {
            if (intervalData[interval]?.[startDate]?.[empSkill]) {
              intervalData[interval][startDate][empSkill].assigned++;
            }
          }
          
          // Next Day Spillover
          if (endMins > 1440 && intStartMins < (endMins - 1440)) {
            const nextDayIdx = dates.indexOf(startDate) + 1;
            // Case 1: Within current month
            if (nextDayIdx > 0 && nextDayIdx < dates.length) {
              const nextDate = dates[nextDayIdx];
              if (intervalData[interval]?.[nextDate]?.[empSkill]) {
                intervalData[interval][nextDate][empSkill].assigned++;
              }
            }
            // Case 2: Spillover from yesterday (previous month) into index 0
            else if (nextDayIdx === 0 && startDate === yesterday) {
              const nextDate = dates[0];
              if (intervalData[interval]?.[nextDate]?.[empSkill]) {
                intervalData[interval][nextDate][empSkill].assigned++;
              }
            }
          }
        });
      });
    });

    const skillStats: Record<string, { assigned: number; required: number }> = {};
    totalSkills.forEach(s => skillStats[s] = { assigned: 0, required: 0 });

    rawIntervals.forEach(interval => {
      dates.forEach(date => {
        totalSkills.forEach(skill => {
          const skillData = intervalData[interval]?.[date]?.[skill];
          if (!skillData) return;
          
          totalRequired += skillData.required;
          totalAbsDiff += Math.abs(skillData.required - skillData.assigned);
          const diff = skillData.assigned - skillData.required;
          if (diff < 0) under += Math.abs(diff);
          else if (diff > 0) over += diff;

          // Aggregating per skill
          skillStats[skill].assigned += skillData.assigned;
          skillStats[skill].required += skillData.required;
        });
      });
    });

    const ica = totalRequired === 0 ? 100 : Math.max(0, Math.round((1 - (totalAbsDiff / totalRequired)) * 100));
    
    // Normalize distribution to Average per Day
    const avgDistribution: Record<string, number> = {};
    Object.entries(distribution).forEach(([code, count]) => {
      avgDistribution[code] = count / dates.length;
    });

    // Calculate Theoretical Distribution (Distribute interval requirements among covering shifts)
    const avgTheoreticalDist: Record<string, number> = {};
    const activeCodes = shiftCodes.filter(sc => activeShiftCodes.has(sc.code));
    const theoreticalShiftWorkload: Record<string, number> = {};
    const dailyIntervalCoverage: Record<string, Record<string, string[]>> = {};

    // 1. Map which shifts cover which intervals (accurate multi-day mapping)
    processedVolume.forEach((day, dIdx) => {
      if (!dailyIntervalCoverage[day.date]) dailyIntervalCoverage[day.date] = {};
      
      activeCodes.forEach(sc => {
        rawIntervals.forEach(interval => {
          // Current Day
          if (isIntervalInShift(interval, sc.startTime, sc.endTime, extraHours, true)) {
            if (!dailyIntervalCoverage[day.date][interval]) dailyIntervalCoverage[day.date][interval] = [];
            dailyIntervalCoverage[day.date][interval].push(sc.code);
          }
          // Next Day Spillover
          if (dIdx + 1 < dates.length && isIntervalInShift(interval, sc.startTime, sc.endTime, extraHours, false)) {
            const nextDate = dates[dIdx + 1];
            if (!dailyIntervalCoverage[nextDate]) dailyIntervalCoverage[nextDate] = {};
            if (!dailyIntervalCoverage[nextDate][interval]) dailyIntervalCoverage[nextDate][interval] = [];
            dailyIntervalCoverage[nextDate][interval].push(sc.code);
          }
        });
      });
    });

    // 2. Distribute interval requirements among covering shifts
    processedVolume.forEach(day => {
      rawIntervals.forEach(interval => {
        const coveringCodes = dailyIntervalCoverage[day.date]?.[interval] || [];
        if (coveringCodes.length === 0) return;

        const totalReq = totalSkills.reduce((sum, s) => sum + (intervalData[interval]?.[day.date]?.[s]?.required || 0), 0);
        const share = totalReq / coveringCodes.length;

        coveringCodes.forEach(code => {
          theoreticalShiftWorkload[code] = (theoreticalShiftWorkload[code] || 0) + share;
        });
      });
    });

    // 3. Convert total shift-interval workload to Average Agents per Day per Shift
    const currentExtraHours = isAgreedToAdjustments ? (extraHours || 0) : 0;
    const currentExtraWorkingDays = isAgreedToAdjustments ? (extraWorkingDays || 0) : 0;

    activeCodes.forEach(sc => {
      const [startH] = sc.startTime.split(':').map(Number);
      const [endH] = sc.endTime.split(':').map(Number);
      let duration = (endH - startH + 24) % 24;
      if (duration === 0 && sc.startTime !== sc.endTime) duration = 24;
      const effectiveDuration = Math.max(1, duration + currentExtraHours);
      
      const aggregateWorkload = theoreticalShiftWorkload[sc.code] || 0;
      // Headcount = Total Interval-Units / (Intervals per Shift * Num Days)
      avgTheoreticalDist[sc.code] = aggregateWorkload / (effectiveDuration * dates.length);
    });

    // Round Actuals for cleaner display (Absolute values)
    const roundedActual: Record<string, number> = {};
    
    Object.keys(avgDistribution).forEach(k => {
      roundedActual[k] = Math.round(avgDistribution[k] * 10) / 10;
    });

    // Calculate Ratios for Alignment (Exclude Leave and OFF codes from actual total)
    const NON_WORKING_CODES = ['L', 'AL', 'UL', 'SL', 'ML', 'PL', 'OFF', 'LB', 'OFF-H'];
    const actualTotal = Object.entries(distribution)
      .filter(([code]) => !NON_WORKING_CODES.includes(code.toUpperCase()))
      .reduce((sum, [_, count]) => sum + count, 0) / (dates.length || 1);
    
    // Potential Average Daily Supply (Theoretical Capacity)
    // Consistent with ErlangForecaster: Total Net Working Days / Total Period Days
    const totalWorkingDaysAll = employees.reduce((sum, emp) => {
      const adjustmentMultiplier = isAgreedToAdjustments ? 1 : 0;
      const empExtraDays = (emp.extraWorkingDays !== undefined ? emp.extraWorkingDays : extraWorkingDays) * adjustmentMultiplier;
      
      const empLeaveDays = leaveRequests.filter(req => 
        req.employeeId === emp.id && 
        req.status === 'approved' && 
        volumeData.some(d => d.date === req.date)
      ).length;

      const baseWorkingDays = targetWorkingDays || 22;
      const scaledWorkingDays = baseWorkingDays; // Removed scaling to ensure alignment with requirement page

      return sum + (scaledWorkingDays + empExtraDays - empLeaveDays);
    }, 0);
    const potentialSupplyDaily = totalWorkingDaysAll / (dates.length || 1);

    const actualRatios: Record<string, number> = {};

    Object.keys(avgDistribution).forEach(k => {
      actualRatios[k] = actualTotal > 0 ? Math.round((avgDistribution[k] / actualTotal) * 1000) / 10 : 0;
    });

    // Total Required Agents per Day (Average of daily goals from Erlang engine)
    const erlangResults = props.erlangResults || [];
    const validErlangResults = erlangResults.filter((r: any) => dates.includes(r.date));
    
    // avgDailyGrossScheduled = Average totalAgents per day
    const avgDailyGrossScheduled = validErlangResults.length > 0
      ? validErlangResults.reduce((acc: number, r: any) => acc + (r.totalAgents || 0), 0) / validErlangResults.length
      : 0;

    // Synchronize with ErlangForecaster logic
    const totalDaysInPeriod = dates.length || 1;
    const baseWorkingDays = targetWorkingDays || 22;
    const availabilityFactor = baseWorkingDays / totalDaysInPeriod;
    const rosterMultiplier = 1 / (availabilityFactor || 1);
    
    // Gross FTE = Pool Size needed
    const requiredPoolFTE = Math.ceil(avgDailyGrossScheduled * rosterMultiplier);
    
    // Net Floor Goal = Daily headcount on the floor (after shrinkage)
    const settingsShrinkage = (props.erlangSettings?.shrinkage || 30) / 100;
    const netFloorGoal = Math.ceil(avgDailyGrossScheduled * (1 - settingsShrinkage));

    return { 
      ica, 
      under, 
      over, 
      distribution: roundedActual, 
      distributionRatio: actualRatios,
      actualTotal: Math.round(actualTotal * 10) / 10,
      potentialSupplyDaily: Math.round(potentialSupplyDaily * 10) / 10,
      requiredDailyHeadcount: Math.round(avgDailyGrossScheduled * 10) / 10,
      requiredPoolFTE,
      netFloorGoal,
      skillStats 
    };
  };

  function isIntervalInShift(interval: string, shiftStart: string, shiftEnd: string, extra: number = 0, checkStartDayOnly: boolean = true): boolean {
    try {
      const [intStartStr] = interval.split(' - ');
      const [intH] = intStartStr.split(':').map(Number);
      const [startH] = shiftStart.split(':').map(Number);
      const [endH] = shiftEnd.split(':').map(Number);
      
      let duration = (endH - startH + 24) % 24;
      if (duration === 0 && shiftStart !== shiftEnd) duration = 24;
      
      const effectiveDuration = duration + extra;
      const diff = (intH - startH + 24) % 24;
      const isWithinShift = diff < effectiveDuration;

      if (!isWithinShift) return false;
      if (checkStartDayOnly) return intH >= startH;
      return intH < startH; // Is in the carry-over portion (next day)
    } catch (e) {
      return false;
    }
  }

  useEffect(() => {
    if (roster.length > 0 && volumeData.length > 0) {
      const stats = computeAnalysis(roster);
      if (stats) {
        setOptimizationAnalysis({
          beforeICA: 0,
          afterICA: stats.ica,
          underCoverageGap: stats.under,
          overCoverageGap: stats.over,
          improvementPct: 100,
          distribution: stats.distribution,
          distributionRatio: stats.distributionRatio,
          actualTotal: stats.actualTotal,
          potentialSupplyDaily: stats.potentialSupplyDaily,
          requiredDailyHeadcount: stats.requiredDailyHeadcount,
          requiredPoolFTE: stats.requiredPoolFTE,
          netFloorGoal: stats.netFloorGoal,
          skillStats: stats.skillStats,
          recommendations: []
        });
      }
    }
  }, [roster, volumeData, shiftCodes, activeShiftCodes, extraHours, extraWorkingDays, isAgreedToAdjustments, aht, targetSL, targetTime, concurrency, tat, shrinkage, channelType]);

  const downloadRoster = () => {
    if (roster.length === 0) return;
    const dates = volumeData.map(d => d.date);
    const allShiftCodes = shiftCodes.map(sc => sc.code);
    
    // 1. Roster Data Sheet
    const rosterData = roster.map(emp => {
      const employeeInfo = employees.find(e => e.id === emp.employeeId);
      const shiftCounts: Record<string, number> = {};
      allShiftCodes.forEach(code => {
        shiftCounts[code] = Object.values(emp.days).filter(d => d === code).length;
      });

      const row: any = {
        'NIP': emp.nip,
        'Name': emp.employeeName,
        'Skill': employeeInfo?.skill || '-',
      };

      dates.forEach(d => {
        row[d] = isApprovedLeave(emp.employeeId, d) ? 'Leave' : (emp.days[d] || 'OFF');
      });

      allShiftCodes.forEach(code => {
        row[`Total ${code}`] = shiftCounts[code];
      });

      row['Total Work'] = emp.totalWorkingDays;
      row['Total Off'] = emp.totalOffDays;

      return row;
    });

    // Daily Summary (Shifts per day)
    const dailySummaries = allShiftCodes.map(code => {
      const row: any = { 'Metric': `TOTAL ${code}` };
      dates.forEach(d => {
        row[d] = roster.filter(emp => emp.days[d] === code).length;
      });
      return row;
    });

    const dailyTotalRow: any = { 'Metric': 'TOTAL ASSIGNED' };
    dates.forEach(d => {
      dailyTotalRow[d] = roster.filter(emp => emp.days[d] && emp.days[d] !== 'OFF' && !isApprovedLeave(emp.employeeId, d)).length;
    });

    // 2. Coverage Analysis Sheet
    const coverageRows: any[] = [];
    if (coverageMatrix) {
      coverageMatrix.intervals.forEach(interval => {
        const row: any = { 'Interval': interval.label };
        dates.forEach(date => {
          const stats = coverageMatrix.data[interval.key][date];
          row[date] = `${stats.assigned} / Req: ${stats.required}`;
        });
        coverageRows.push(row);
      });
    }

    // Generate Workbook
    const wb = XLSX.utils.book_new();
    
    // Sheet 1: Roster & Summaries
    const wsRoster = XLSX.utils.json_to_sheet(rosterData);
    XLSX.utils.book_append_sheet(wb, wsRoster, 'Roster');

    const wsSummary = XLSX.utils.json_to_sheet([...dailySummaries, dailyTotalRow]);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Daily Shift Summary');

    // Sheet 2: Interval Coverage
    const wsCoverage = XLSX.utils.json_to_sheet(coverageRows);
    XLSX.utils.book_append_sheet(wb, wsCoverage, 'Interval Coverage');

    // Download
    XLSX.writeFile(wb, `Roster_Export_${format(new Date(), 'yyyyMMdd')}.xlsx`);
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
                if (sPrev && sCurr && getRestHours(sPrev, sCurr, extraHours) < getEffectiveRestThreshold()) restViolation = true;
              }
              let count = 1;
              for (let i = dayIdx - 1; i >= 0; i--) {
                if (employee.days[processedVolume[i].date] !== 'OFF') count++;
                else break;
              }
              if (count >= getEffectiveMaxConsecWorking() + 1) consecViolation = true;
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
    if (!coverageMatrix) return 0;
    
    let totalAbsDiff = 0;
    let totalRequired = 0;

    coverageMatrix.intervals.forEach(interval => {
      coverageMatrix.dates.forEach(date => {
        const stats = coverageMatrix.data[interval.key][date];
        totalRequired += stats.required;
        totalAbsDiff += Math.abs(stats.required - stats.assigned);
      });
    });

    if (totalRequired === 0) return 100;
    return Math.max(0, Math.round((1 - (totalAbsDiff / totalRequired)) * 100));
  };

  const getUnderOverStats = () => {
    if (!coverageMatrix) return { under: 0, over: 0 };
    
    let under = 0;
    let over = 0;

    coverageMatrix.intervals.forEach(interval => {
      coverageMatrix.dates.forEach(date => {
        const stats = coverageMatrix.data[interval.key][date];
        const diff = stats.assigned - stats.required;
        if (diff < 0) under += Math.abs(diff);
        else if (diff > 0) over += diff;
      });
    });

    return { under, over };
  };

  const getCoverageDataForSelectedDate = () => {
    if (!selectedDateForAnalysis || volumeData.length === 0) return [];
    const day = volumeData.find(d => d.date === selectedDateForAnalysis);
    if (!day) return [];

    const dayReqs: Record<string, number> = {};
    const skillReqs: Record<string, Record<string, number>> = {};
    const allIntervalKeys = sortIntervals(Object.keys(day.intervals));
    
    uniqueSkills.forEach(s => skillReqs[s] = {});

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
      const shrinkageFactor = Math.min(0.99, shrinkage);
      const totalNeeded = Math.ceil(res.agents / (1 - shrinkageFactor));
      dayReqs[interval] = totalNeeded;

      // Split requirement by skill ratios
      uniqueSkills.forEach(skill => {
        const ratio = (skillRatios[skill] || (100 / uniqueSkills.length)) / 100;
        skillReqs[skill][interval] = Math.ceil(totalNeeded * ratio);
      });
    });

    const dayAssigned: Record<string, number> = {};
    const skillAssigned: Record<string, Record<string, number>> = {};
    
    uniqueSkills.forEach(s => skillAssigned[s] = {});
    Object.keys(dayReqs).forEach(int => {
      dayAssigned[int] = 0;
      uniqueSkills.forEach(s => skillAssigned[s][int] = 0);
    });

    const prevDate = format(addDays(new Date(day.date), -1), 'yyyy-MM-dd');

    roster.forEach(emp => {
      const empInfo = employees.find(e => e.id === emp.employeeId);
      const skill = empInfo?.skill || 'General';
      const shiftCode = emp.days[day.date];
      
      if (shiftCode && shiftCode !== 'OFF' && !isApprovedLeave(emp.employeeId, day.date)) {
        const code = shiftCodes.find(c => c.code === shiftCode);
        if (code) {
          Object.keys(dayReqs).forEach(interval => {
            if (isIntervalInShift(interval, code.startTime, code.endTime, extraHours, true)) {
              dayAssigned[interval]++;
              if (skillAssigned[skill]) skillAssigned[skill][interval]++;
            }
          });
        }
      }

      // Carry-over assignments from previous day
      const prevShiftCode = emp.days[prevDate] || (legacyRoster[emp.employeeId]?.[prevDate]);
      if (prevShiftCode && prevShiftCode !== 'OFF' && !isApprovedLeave(emp.employeeId, prevDate)) {
        const sc = shiftCodes.find(c => c.code === prevShiftCode);
        if (sc) {
          Object.keys(dayReqs).forEach(interval => {
            if (isIntervalInShift(interval, sc.startTime, sc.endTime, extraHours, false)) {
              dayAssigned[interval]++;
              if (skillAssigned[skill]) skillAssigned[skill][interval]++;
            }
          });
        }
      }
    });

    return Object.keys(dayReqs).sort().map(interval => {
      const skillsData: Record<string, any> = {};
      uniqueSkills.forEach(skill => {
        skillsData[`${skill}_Req`] = skillReqs[skill][interval];
        skillsData[`${skill}_Assigned`] = skillAssigned[skill][interval];
      });

      return {
        interval,
        Required: dayReqs[interval],
        Assigned: dayAssigned[interval],
        Variance: dayAssigned[interval] - dayReqs[interval],
        ...skillsData
      };
    });
  };

  const dailySkillCoverage = useMemo(() => {
    if (roster.length === 0 || extendedVolumeData.length === 0) return {};
    
    const coverage: Record<string, Record<string, { assigned: number; required: number }>> = {};
    
    const intervalRequirements: Record<string, Record<string, Record<string, number>>> = {};
    
    extendedVolumeData.forEach(day => {
      intervalRequirements[day.date] = {};
      Object.entries(day.intervals).forEach(([interval, val]) => {
        const volume = Number(val) || 0;
        let res;
        // Match channel types case-insensitively just in case
        const type = (channelType || 'call').toLowerCase();
        if (type === 'chat' || type === 'whatsapp' || type === 'multiskill_chat_wa') {
          res = calculateRequiredAgentsChat(volume, aht, targetSL, targetTime, concurrency, 1);
        } else if (type === 'email') {
          res = calculateRequiredAgentsEmail(volume, aht, targetSL, tat, 1);
        } else {
          res = calculateRequiredAgents(volume, aht, targetSL, targetTime, 1);
        }
        const shrinkageFactor = Math.min(0.99, shrinkage);
        const totalNeeded = Math.ceil(res.agents / (1 - shrinkageFactor));
        
        const skillNeeds: Record<string, number> = {};
        let allocated = 0;
        
        // Pass 1: Proportional Floor + Critical
        uniqueSkills.forEach(skill => {
          const ratio = (skillRatios[skill] !== undefined ? skillRatios[skill] : (100 / uniqueSkills.length)) / 100;
          let share = Math.floor(totalNeeded * ratio);
          if (isSkillCritical && totalNeeded > 0 && share === 0 && ratio > 0) {
            share = 1;
          }
          skillNeeds[skill] = share;
          allocated += share;
        });

        // Pass 2: Fill remaining if sum < total (Priority based on ratio)
        if (allocated < totalNeeded) {
          const remainder = totalNeeded - allocated;
          const sortedSkills = [...uniqueSkills].sort((a, b) => (skillRatios[b] || 0) - (skillRatios[a] || 0));
          for (let i = 0; i < remainder; i++) {
            skillNeeds[sortedSkills[i % sortedSkills.length]]++;
          }
        }
        
        intervalRequirements[day.date][interval] = skillNeeds;
      });
    });

    extendedVolumeData.forEach((day, idx) => {
      coverage[day.date] = {};
      uniqueSkills.forEach(skill => {
        coverage[day.date][skill] = { assigned: 0, required: 0 };
        
        // Pivot requirements: Today 07:00 -> Tomorrow 06:59
        let totalShiftCycleReq = 0;
        let intervalsInCycle = 0;
        
        // Today's part
        Object.entries(intervalRequirements[day.date]).forEach(([interval, skillNeeds]) => {
          const h = parseInt(interval.split(':')[0]);
          if (h >= 7) {
            totalShiftCycleReq += skillNeeds[skill] || 0;
            intervalsInCycle++;
          }
        });
        
        // Tomorrow's part
        const nextDay = extendedVolumeData[idx + 1];
        if (nextDay && intervalRequirements[nextDay.date]) {
          Object.entries(intervalRequirements[nextDay.date]).forEach(([interval, skillNeeds]) => {
            const h = parseInt(interval.split(':')[0]);
            if (h < 7) {
              totalShiftCycleReq += skillNeeds[skill] || 0;
              intervalsInCycle++;
            }
          });
        }
        
        coverage[day.date][skill].required = intervalsInCycle > 0 ? Math.round(totalShiftCycleReq / intervalsInCycle) : 0;
      });
    });
    
    roster.forEach(emp => {
      const empSkill = emp.skill || 'General';
      Object.entries(emp.days).forEach(([date, code]) => {
        if (code !== 'OFF' && coverage[date] && coverage[date][empSkill]) {
          coverage[date][empSkill].assigned++;
        }
      });
      Object.entries(legacyRoster[emp.employeeId] || {}).forEach(([date, code]) => {
        if (code !== 'OFF' && coverage[date] && coverage[date][empSkill]) {
          coverage[date][empSkill].assigned++;
        }
      });
    });
    
    return coverage;
  }, [roster, extendedVolumeData, uniqueSkills, skillRatios, isSkillCritical, shrinkage, aht, targetSL, targetTime, channelType, concurrency, tat, legacyRoster]);

  const filteredRoster = useMemo(() => {
    // Ensure all database employees are represented in the roster list view
    const rosterMap = new Map(roster.map(r => [r.employeeId, r]));
    
    const combined = employees.map(emp => {
      const rosterEntry = rosterMap.get(emp.id);
      if (rosterEntry) return { ...(rosterEntry as EmployeeRoster), isDatabaseAligned: true };
      
      // Fallback for employees in database but not in current roster month
      return {
        employeeId: emp.id,
        employeeName: emp.name,
        nip: emp.nip,
        skill: emp.skill || 'General',
        days: {},
        totalWorkingDays: 0,
        totalOffDays: 0,
        targetWorkingDays: targetWorkingDays + (emp.extraWorkingDays || 0),
        targetOffDays: 0,
        extraHours: emp.extraHours || 0,
        isDatabaseAligned: true,
        isNew: true
      };
    });

    return combined
      .filter(emp => {
        const matchesSearch = (emp.employeeName || '').toLowerCase().includes((searchTerm || '').toLowerCase()) || 
                              (emp.nip || '').toLowerCase().includes((searchTerm || '').toLowerCase());
        const matchesSkill = skillFilter === 'all' || emp.skill === skillFilter;
        
        let matchesShift = true;
        if (shiftFilter !== 'all') {
          matchesShift = Object.values(emp.days).includes(shiftFilter);
        }

        return matchesSearch && matchesSkill && matchesShift;
      })
      .sort((a, b) => {
        const skillA = a.skill || 'General';
        const skillB = b.skill || 'General';
        if (skillA !== skillB) return skillA.localeCompare(skillB);
        return a.employeeName.localeCompare(b.employeeName);
      });
  }, [roster, employees, searchTerm, skillFilter, shiftFilter, targetWorkingDays]);

  const computedViolationsList = useMemo(() => {
    return getRosterViolations();
  }, [roster, shiftCodes, constraints]);

  return (
    <div className="space-y-6 max-w-full">
      {/* Top Professional Analytics Dashboard */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Interval Coverage Accuracy (ICA)"
          value={`${optimizationAnalysis?.afterICA !== undefined ? optimizationAnalysis.afterICA : 0}%`}
          icon={<Heart className="w-5 h-5 text-indigo-600 animate-pulse" />}
          description={
            (optimizationAnalysis?.afterICA || 0) >= 90
              ? "✨ Optimal staffing alignment"
              : "⚠️ Needs optimization adjustment"
          }
          status={(optimizationAnalysis?.afterICA || 0) >= 90 ? 'success' : (optimizationAnalysis?.afterICA || 0) >= 75 ? 'warning' : 'danger'}
        />
        
        <MetricCard
          title="Coverage Shortage Status"
          value={shortageInfo?.isCovered ? "Fulfillment: 100%" : `Short: ${shortageInfo?.currentShortage || 0} slots`}
          icon={<AlertCircle className="w-5 h-5 text-amber-600" />}
          description={
            shortageInfo?.isCovered 
              ? "Full headcount requirement met" 
              : `💡 Suggested: ${shortageInfo?.suggestedExtraDays || 0} extra working days`
          }
          status={shortageInfo?.isCovered ? 'success' : 'warning'}
        />

        <MetricCard
          title="Active Capacity"
          value={`${employees.length} Agents`}
          icon={<Users className="w-5 h-5 text-slate-600" />}
          description={`Supply Goal: ${shortageInfo?.physicalHeadcount || 0} FTEs`}
          status="success"
        />

        <MetricCard
          title="Health Audit Compliance"
          value={`${computedViolationsList.length === 0 ? "100%" : `${Math.max(0, 100 - computedViolationsList.length * 5)}%`}`}
          icon={<ShieldCheck className="w-5 h-5 text-emerald-600" />}
          description={
            computedViolationsList.length === 0 
              ? "✅ No WFM rule violations" 
              : `⚠️ ${computedViolationsList.length} alert(s) detected`
          }
          status={computedViolationsList.length === 0 ? 'success' : 'danger'}
        />
      </div>

      {/* AI Forecast Validation & Strategic Suggestions Card */}
      <div className="bg-gradient-to-r from-indigo-50/60 to-slate-50 border border-indigo-100/80 rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-indigo-100/60 pb-4">
          <div className="space-y-1 text-left">
            <h3 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-indigo-600 animate-pulse" />
              AI Forecast Validation & Strategic Suggestions
            </h3>
            <p className="text-[11px] text-slate-500 font-medium leading-none">
              Validasi otomatis antara kebutuhan hasil forecasting (AI Requirements) dan kapasitas staf riil (Actual Headcount).
            </p>
          </div>
          <div className="flex items-center gap-2 bg-white px-3.5 py-1.5 rounded-xl border border-slate-200 shadow-xs shrink-0 self-start md:self-auto">
            <div className={`w-2.5 h-2.5 rounded-full ${shortageInfo?.isCovered ? 'bg-emerald-500' : 'bg-rose-500 animate-pulse'}`} />
            <span className="text-[10px] font-black text-slate-800 uppercase tracking-wider">
              {shortageInfo?.isCovered ? "Fisik Staf Terpenuhi" : "Defisit Kapasitas Staf"}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Headcount Validation Column (Left) */}
          <div className="lg:col-span-5 bg-white border border-slate-150/80 rounded-xl p-5 space-y-4 shadow-3xs">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-left">Headcount Validation</h4>
            
            <div className="space-y-4">
              <div className="flex justify-between items-center border-b border-slate-50 pb-2">
                <span className="text-xs font-semibold text-slate-600">Actual Active Headcount</span>
                <span className="text-xs font-extrabold text-slate-900 font-mono">{employees.length} Agents</span>
              </div>
              <div className="flex justify-between items-center border-b border-slate-50 pb-2">
                <span className="text-xs font-semibold text-slate-600">AI Forecast Required Headcount</span>
                <span className="text-xs font-extrabold text-indigo-600 font-mono">{(shortageInfo?.grossFTE || 0)} FTEs</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs font-semibold text-slate-600">Staffing Balance Status</span>
                <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${
                  employees.length >= (shortageInfo?.grossFTE || 0) 
                    ? 'bg-emerald-50 text-emerald-700' 
                    : 'bg-rose-50 text-rose-700'
                }`}>
                  {employees.length >= (shortageInfo?.grossFTE || 0) 
                    ? `Surplus +${employees.length - (shortageInfo?.grossFTE || 0)} Agents` 
                    : `Short -${(shortageInfo?.grossFTE || 0) - employees.length} Agents`
                  }
                </span>
              </div>

              {/* Progress gauge visual */}
              <div className="space-y-1.5 pt-1 text-left">
                <div className="flex justify-between text-[10px] font-bold text-slate-400">
                  <span>Coverage Gauge</span>
                  <span>{Math.round(Math.min(100, (employees.length / ((shortageInfo?.grossFTE || 1))) * 100))}% Capacity Fit</span>
                </div>
                <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden border border-slate-200">
                  <div 
                    className={`h-full transition-all duration-500 rounded-full ${
                      employees.length >= (shortageInfo?.grossFTE || 0) ? 'bg-emerald-500' : 'bg-red-500'
                    }`}
                    style={{ width: `${Math.min(100, (employees.length / ((shortageInfo?.grossFTE || 1))) * 100)}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Strategic Suggestions Column (Right) */}
          <div className="lg:col-span-7 flex flex-col justify-between space-y-4">
            <div className="space-y-3 text-left">
              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">WFM Strategic Recommendations</h4>
              
              <ul className="space-y-2.5">
                {/* 1. Policy OT Suggestion */}
                <li className="flex items-start gap-2.5 text-xs text-slate-705">
                  <div className="w-5 h-5 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0 text-indigo-600 mt-0.5 font-bold text-[10px]">1</div>
                  <div className="leading-relaxed">
                    {employees.length < (shortageInfo?.grossFTE || 0) ? (
                      <span>
                        <strong>Kebijakan Overtime:</strong> Ditemukan defisit kapasitas dibanding estimasi Erlang C. Disarankan mengaktifkan tombol <strong>Auto-Apply Overtime</strong> untuk menambah <strong>+{shortageInfo?.suggestedExtraDays || 1} hari kerja lembur</strong> atau memperpanjang shift kerja para agen.
                      </span>
                    ) : (
                      <span>
                        <strong>Kapasitas Terpenuhi:</strong> Jumlah agen yang aktif saat ini ({employees.length}) sudah di atas forecast rata-rata ({(shortageInfo?.grossFTE || 0)} FTE). Tidak diperlukan overtime tambahan untuk periode ini.
                      </span>
                    )}
                  </div>
                </li>

                {/* 2. Leave Request Conflicts */}
                <li className="flex items-start gap-2.5 text-xs text-slate-705">
                  <div className="w-5 h-5 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0 text-indigo-600 mt-0.5 font-bold text-[10px]">2</div>
                  <div className="leading-relaxed">
                    {(() => {
                      const pendingLeaves = leaveRequests.filter(r => r.status === 'pending').length;
                      if (employees.length < (shortageInfo?.grossFTE || 0)) {
                        return (
                          <span>
                            <strong>Manajemen Cuti:</strong> Terdapat <strong>{pendingLeaves} pengajuan cuti tertunda</strong>. Disarankan menunda persetujuan cuti tambahan agar tidak memperlebar gap kapasitas staf.
                          </span>
                        );
                      } else {
                        return (
                          <span>
                            <strong>Manajemen Cuti:</strong> Terdapat <strong>{pendingLeaves} pengajuan cuti tertunda</strong>. Anda memiliki redundansi staf yang aman, sehingga <strong>persetujuan cuti dapat disetujui sepenuhnya</strong>.
                          </span>
                        );
                      }
                    })()}
                  </div>
                </li>

                {/* 3. Coverage Overlaps Index */}
                <li className="flex items-start gap-2.5 text-xs text-slate-705">
                  <div className="w-5 h-5 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0 text-indigo-600 mt-0.5 font-bold text-[10px]">3</div>
                  <div className="leading-relaxed">
                    <span>
                      <strong>Distribusi Jam Kerja (ICA):</strong> Akurasi keselarasan grafik interval adalah <strong>{optimizationAnalysis?.afterICA || 0}%</strong>. Jalankan kembali tombol <strong>Generate Roster</strong> untuk mensinkronisasi shift agar merata mengikuti grafik demand beban kerja.
                    </span>
                  </div>
                </li>
              </ul>
            </div>

            {/* Quick Action Buttons inside suggestions */}
            {employees.length < (shortageInfo?.grossFTE || 0) && (
              <div className="pt-2 flex justify-start">
                <Button 
                  onClick={async () => {
                    setIsAgreedToAdjustments(true);
                    const suggestedDays = shortageInfo?.suggestedExtraDays || 1;
                    setExtraWorkingDays(suggestedDays);
                    setExtraHours(1);
                    await saveSettings({
                      isSimulationAgreed: true,
                      extraWorkingDays: suggestedDays,
                      extraHours: 1
                    });
                    toast.success(`Berhasil menyesuaikan: +${suggestedDays} Hari Kerja Tambahan & +1 Jam Overtime diaktifkan secara otomatis!`);
                  }}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-[10px] uppercase tracking-wider h-8 px-4 gap-1.5 shadow-sm rounded-lg"
                >
                  <Zap className="w-3.5 h-3.5" />
                  Auto-Adjust Overtime
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Interactive Command Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm space-y-4">
        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="bg-slate-50 border border-slate-100 px-3.5 py-1.5 rounded-lg flex items-center gap-2">
              <CalendarDays className="w-4 h-4 text-indigo-600" />
              <span className="text-xs font-black text-slate-900 uppercase tracking-tight">
                {selectedMonth ? format(new Date(selectedMonth), 'MMMM yyyy') : 'No Month Selected'}
              </span>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <Input
                placeholder="Search agent name or NIP..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 h-9 w-[240px] text-xs bg-slate-50 border-slate-200"
              />
            </div>

            <Select value={skillFilter} onValueChange={setSkillFilter}>
              <SelectTrigger className="w-[140px] h-9 text-xs bg-slate-50 border-slate-200 font-bold">
                <SelectValue placeholder="Skill Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs font-semibold">All Skills</SelectItem>
                {uniqueSkills.map(s => (
                  <SelectItem key={s} value={s} className="text-xs font-semibold">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={shiftFilter} onValueChange={setShiftFilter}>
              <SelectTrigger className="w-[140px] h-9 text-xs bg-slate-50 border-slate-200 font-bold font-mono">
                <SelectValue placeholder="Shift Code" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs font-semibold">All Shifts</SelectItem>
                <SelectItem value="OFF" className="text-xs font-mono font-semibold">OFF</SelectItem>
                {shiftCodes.map(sc => (
                  <SelectItem key={sc.code} value={sc.code} className="text-xs font-mono font-semibold">{sc.code}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={handleGenerateRoster}
              disabled={loading || volumeData.length === 0}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold h-9 text-xs gap-1.5 shadow-sm shadow-indigo-100"
            >
              {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              Generate Roster
            </Button>

            <Button
              variant="outline"
              onClick={() => setIsUploadDialogOpen(true)}
              className="border-slate-200 hover:bg-slate-50 text-slate-700 font-bold h-9 text-xs gap-1.5"
            >
              <Upload className="w-3.5 h-3.5" />
              Upload Roster
            </Button>

            <Button
              variant="outline"
              onClick={downloadRoster}
              disabled={roster.length === 0}
              className="border-slate-200 hover:bg-slate-50 text-slate-700 font-bold h-9 text-xs gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              Export Excel
            </Button>

            <Button
              variant="outline"
              onClick={handleDownloadTemplate}
              className="border-slate-200 hover:bg-slate-50 text-slate-700 font-bold h-9 text-xs gap-1.5"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              Template
            </Button>

            {roster.length > 0 && (
              <Button
                variant="destructive"
                onClick={() => setShowClearConfirm(true)}
                className="bg-rose-50 border border-rose-100 hover:bg-rose-100 text-rose-600 font-bold h-9 text-xs gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Clear
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Main Feature Content Container */}
      <div className="w-full">
        {/* TAB 1: Roster Grid Plan */}
        <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <h3 className="font-bold text-slate-900 text-sm">Monthly Operational Grid</h3>
              <p className="text-[11px] text-slate-500 font-medium">
                  Review complete roster schedule. Click on any shift cell to edit, or double click to toggle, or click agent name to view calendar.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant={viewMode === 'grid' ? 'default' : 'outline'}
                  onClick={() => setViewMode('grid')}
                  className="font-bold h-8 text-xs gap-1.5"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  Grid view
                </Button>
                <Button
                  variant={viewMode === 'calendar' ? 'default' : 'outline'}
                  onClick={() => {
                    setViewMode('calendar');
                    if (filteredRoster.length > 0 && !selectedEmployeeId) {
                      setSelectedEmployeeId(filteredRoster[0].employeeId);
                    }
                  }}
                  className="font-bold h-8 text-xs gap-1.5"
                >
                  <CalendarDays className="w-3.5 h-3.5" />
                  Calendar view
                </Button>
              </div>
            </div>

            {roster.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 space-y-4 border border-dashed border-slate-200 rounded-lg bg-slate-50/50">
                <Users className="w-12 h-12 text-slate-300" />
                <div className="text-center space-y-1">
                  <p className="text-sm font-bold text-slate-700">No Roster Generated for this Month</p>
                  <p className="text-xs text-slate-400 max-w-sm">
                    Click the <strong>Generate Roster</strong> button above to construct schedule using the Erlang staffing algorithm.
                  </p>
                </div>
              </div>
            ) : viewMode === 'grid' ? (
              <div className="overflow-x-auto rounded-lg border border-slate-150">
                <table className="w-full border-collapse text-left text-xs bg-white">
                  <thead className="bg-slate-50 border-b border-slate-200 sticky top-0 z-10">
                    <tr>
                      <th className="p-3 font-semibold text-slate-700 min-w-[200px] sticky left-0 bg-slate-50 shadow-[2px_0_5px_rgba(0,0,0,0.05)] z-20">
                        Employee Agent
                      </th>
                      <th className="p-3 font-semibold text-slate-700 text-center w-20">WD Ratio</th>
                      {volumeData.map(day => {
                        const dateObj = new Date(day.date);
                        const isWe = dateObj.getDay() === 0 || dateObj.getDay() === 6;
                        return (
                          <th 
                            key={day.date} 
                            className={`p-1.5 font-bold text-center border-l border-slate-100 min-w-[42px] ${isWe ? 'bg-indigo-50/30' : ''}`}
                          >
                            <span className="block text-[8px] text-slate-400 uppercase tracking-tight leading-none">
                              {format(dateObj, 'EEE')}
                            </span>
                            <span className="block text-xs text-slate-700 mt-0.5 leading-none">
                              {format(dateObj, 'd')}
                            </span>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredRoster.map(emp => {
                      const leaveDaysInPeriod = leaveRequests.filter(req => 
                        req.employeeId === emp.employeeId && req.status === 'approved'
                      ).map(r => r.date);
                      
                      return (
                        <tr key={emp.employeeId} className="hover:bg-slate-50/50 transition-colors">
                          <td className="p-3 font-medium text-slate-900 sticky left-0 bg-white shadow-[2px_0_5px_rgba(0,0,0,0.05)] z-10">
                            <div className="flex items-center gap-2.5">
                              <button 
                                onClick={() => {
                                  setSelectedEmployeeId(emp.employeeId);
                                  setViewMode('calendar');
                                }}
                                className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center hover:bg-indigo-100 group transition-colors"
                                title="Click to open personal monthly calendar"
                              >
                                <span className="text-[10px] uppercase font-black text-slate-600 group-hover:text-indigo-700">
                                  {emp.employeeName.charAt(0)}
                                </span>
                              </button>
                              <div className="flex flex-col text-left">
                                <span className="font-bold text-slate-900 leading-tight">{emp.employeeName}</span>
                                <span className="text-[9px] font-mono text-slate-400 leading-none mt-0.5">
                                  {emp.nip || '-'} • {emp.skill}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td className="p-3 text-center border-l border-slate-100 font-bold font-mono">
                            <span className={emp.totalWorkingDays >= emp.targetWorkingDays ? 'text-emerald-600' : 'text-slate-500'}>
                              {emp.totalWorkingDays}
                            </span>
                            <span className="text-slate-300">/{Math.round(emp.targetWorkingDays)}</span>
                          </td>
                          
                          {volumeData.map(day => {
                            const shiftCode = emp.days[day.date] || 'OFF';
                            const isOnLeave = leaveDaysInPeriod.includes(day.date);
                            
                            // Check violations for cell
                            let isCellRestViolation = false;
                            let isCellConsecutiveViolation = false;
                            const dIdx = volumeData.findIndex(x => x.date === day.date);
                            if (shiftCode !== 'OFF' && dIdx !== -1) {
                              const prevDay = dIdx > 0 ? volumeData[dIdx - 1].date : null;
                              const prevCode = prevDay ? emp.days[prevDay] : null;
                              if (prevCode && prevCode !== 'OFF') {
                                const sPrev = shiftCodes.find(sc => sc.code === prevCode);
                                const sCurr = shiftCodes.find(sc => sc.code === shiftCode);
                                if (sPrev && sCurr && getRestHours(sPrev, sCurr, emp.extraHours || 0) < getEffectiveRestThreshold()) {
                                  isCellRestViolation = true;
                                }
                              }
                              let consecCount = 1;
                              for (let idx = dIdx - 1; idx >= 0; idx--) {
                                if (emp.days[volumeData[idx].date] !== 'OFF') consecCount++;
                                else break;
                              }
                              if (consecCount > getEffectiveMaxConsecWorking()) {
                                isCellConsecutiveViolation = true;
                              }
                            }

                            const hasAlert = isCellRestViolation || isCellConsecutiveViolation;
                            const badgeColorClasses = getShiftBadgeClasses(shiftCode, isCellRestViolation, isCellConsecutiveViolation, isOnLeave);

                            return (
                              <td 
                                key={day.date} 
                                className="p-1 border-l border-slate-100 text-center"
                              >
                                <button
                                  onClick={() => setEditingCell({
                                    employeeId: emp.employeeId,
                                    date: day.date,
                                    employeeName: emp.employeeName,
                                    currentShift: shiftCode
                                  })}
                                  className={`w-full min-h-[28px] rounded flex items-center justify-center font-mono text-[10px] font-bold border cursor-pointer relative hover:brightness-95 hover:shadow-xs transition-shadow ${badgeColorClasses}`}
                                >
                                  {isOnLeave ? 'L' : shiftCode}
                                  {shiftCode !== 'OFF' && (emp.extraHours || 0) > 0 && (
                                    <span className="absolute -top-1 -right-1 bg-indigo-600 text-white text-[7px] w-3 h-3 rounded-full flex items-center justify-center border border-white z-10">
                                      +
                                    </span>
                                  )}
                                  {hasAlert && (
                                    <span className="absolute bottom-0 right-0 bg-red-500 w-1.5 h-1.5 rounded-full m-0.5" />
                                  )}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              /* Calendar View for Selected Employee */
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                <div className="lg:col-span-1 border border-slate-100 rounded-lg p-3 space-y-2 max-h-[500px] overflow-y-auto">
                  <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest px-2 mb-2">Select Agent</h4>
                  {filteredRoster.map(emp => (
                    <button
                      key={emp.employeeId}
                      onClick={() => setSelectedEmployeeId(emp.employeeId)}
                      className={`w-full p-2.5 rounded-lg flex items-center gap-2.5 text-left text-xs font-bold transition-all ${
                        selectedEmployeeId === emp.employeeId 
                          ? 'bg-indigo-600 text-white shadow-md' 
                          : 'hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black ${
                        selectedEmployeeId === emp.employeeId ? 'bg-white/20 text-white' : 'bg-slate-105 text-slate-600'
                      }`}>
                        {emp.employeeName.charAt(0)}
                      </div>
                      <div className="flex flex-col flex-1 leading-tight overflow-hidden">
                        <span className="truncate">{emp.employeeName}</span>
                        <span className={`text-[9px] font-mono ${selectedEmployeeId === emp.employeeId ? 'text-white/60' : 'text-slate-400'}`}>
                          {emp.nip || '-'}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="lg:col-span-3 border border-slate-150 rounded-lg bg-slate-50/10">
                  {(() => {
                    const selectedRosterEmp = roster.find(r => r.employeeId === selectedEmployeeId);
                    if (selectedRosterEmp) {
                      return <PersonalCalendar employee={selectedRosterEmp} />;
                    }
                    return (
                      <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                        <CalendarDays className="w-12 h-12 text-slate-300 mb-3" />
                        <span className="text-xs font-bold">Please select an agent from left pane</span>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}
          </div>

          {/* BELOW THE GRID: Collapsible Insight Panels (Replaces the disjointed tabs layout) */}
          <div className="space-y-6 mt-6">
            
            {/* COLLAPSIBLE 1: Hourly Interval Coverage Analyzer (Fulfillment Analytics) */}
            <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm text-left">
              <button 
                type="button"
                onClick={() => setIsChartExpanded(!isChartExpanded)}
                className="w-full flex items-center justify-between text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600">
                    <BarChart3 className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-slate-900 text-sm">Hourly Interval Coverage Analyzer</h4>
                    <p className="text-[11px] text-slate-500 font-medium">
                      Bandingkan grafik beban kerja hasil peramalan per jam (Erlang) dengan kapasitas supply dari roster aktif.
                    </p>
                  </div>
                </div>
                <div className="text-slate-400 hover:text-slate-600">
                  {isChartExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </div>
              </button>
              
              {isChartExpanded && (
                <div className="pt-6 border-t border-slate-100 mt-4 space-y-6">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div className="space-y-0.5">
                      <h3 className="font-bold text-slate-900 text-xs">Interval Statistics Analysis</h3>
                      <p className="text-[10px] text-slate-400">Pilih tanggal spesifik untuk meninjau kecocokan supply lantai dibanding demand real-time.</p>
                    </div>

                    <div className="flex items-center gap-2.5">
                      <span className="text-xs text-slate-500 font-bold">Analysis Date:</span>
                      <Select 
                        value={selectedDateForAnalysis || ''} 
                        onValueChange={setSelectedDateForAnalysis}
                      >
                        <SelectTrigger className="w-[180px] h-9 text-xs bg-slate-50 border-slate-205 font-bold font-mono">
                          <SelectValue placeholder="Choose a date" />
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                          {volumeData.map(d => (
                            <SelectItem key={d.date} value={d.date} className="text-xs font-mono font-bold">
                              {format(new Date(d.date), 'dd MMM yyyy (EEE)')}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {(() => {
                    const coverageData = getCoverageDataForSelectedDate();
                    if (coverageData.length === 0) {
                      return (
                        <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                          <BarChart3 className="w-12 h-12 text-slate-300 mb-2" />
                          <span className="text-xs font-bold text-center">No volume or roster data mapped for selected date</span>
                        </div>
                      );
                    }

                    const totalRequiredOnDate = coverageData.reduce((acc, curr) => acc + curr.Required, 0);
                    const totalAssignedOnDate = coverageData.reduce((acc, curr) => acc + curr.Assigned, 0);
                    const dailyCoverageAccuracy = totalRequiredOnDate === 0 ? 100 : Math.max(0, Math.round((1 - (Math.abs(totalRequiredOnDate - totalAssignedOnDate) / totalRequiredOnDate)) * 105));

                    return (
                      <div className="space-y-6">
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                          <div className="bg-slate-50 border border-slate-100 p-3.5 rounded-xl">
                            <p className="text-[9px] uppercase tracking-wider font-extrabold text-slate-400 mb-0.5">Interval Accuracy (ICA)</p>
                            <p className="text-lg font-black text-slate-900">{Math.min(100, dailyCoverageAccuracy)}%</p>
                          </div>

                          <div className="bg-slate-50 border border-slate-100 p-3.5 rounded-xl">
                            <p className="text-[9px] uppercase tracking-wider font-extrabold text-slate-400 mb-0.5">Demand Goal</p>
                            <p className="text-lg font-black text-slate-900">{totalRequiredOnDate} agent-hours</p>
                          </div>

                          <div className="bg-slate-50 border border-slate-100 p-3.5 rounded-xl">
                            <p className="text-[9px] uppercase tracking-wider font-extrabold text-slate-400 mb-0.5">Scheduled Supply</p>
                            <p className="text-lg font-black text-slate-900">{totalAssignedOnDate} agent-hours</p>
                          </div>

                          <div className="bg-slate-50 border border-slate-100 p-3.5 rounded-xl">
                            <p className="text-[9px] uppercase tracking-wider font-extrabold text-slate-400 mb-0.5">Variance Status</p>
                            <p className={`text-lg font-black ${totalAssignedOnDate >= totalRequiredOnDate ? 'text-emerald-600' : 'text-amber-600'}`}>
                              {totalAssignedOnDate - totalRequiredOnDate >= 0 ? `+${totalAssignedOnDate - totalRequiredOnDate} slots` : `${totalAssignedOnDate - totalRequiredOnDate} slots`}
                            </p>
                          </div>
                        </div>

                        <div className="h-[300px] w-full border border-slate-100 p-2 rounded-xl bg-slate-50/30">
                          <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={coverageData}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                              <XAxis 
                                dataKey="interval" 
                                stroke="#94a3b8" 
                                fontSize={9} 
                                tickLine={false} 
                                tickFormatter={(val) => val.split(' - ')[0]}
                              />
                              <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} axisLine={false} />
                              <Tooltip />
                              <Legend verticalAlign="top" height={36} />
                              <Area 
                                name="Scheduled Agents" 
                                type="monotone" 
                                dataKey="Assigned" 
                                fill="#818cf8" 
                                stroke="#4f46e5" 
                                fillOpacity={0.12} 
                              />
                              <Area 
                                name="Required Agents"
                                type="stepAfter"
                                dataKey="Required" 
                                stroke="#ef4444" 
                                fill="transparent" 
                                strokeWidth={2}
                                strokeDasharray="4 4"
                              />
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>

            {/* COLLAPSIBLE 2: WFM Health Compliance Auditor (Violations list) */}
            <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm text-left">
              <button 
                type="button"
                onClick={() => setIsComplianceExpanded(!isComplianceExpanded)}
                className="w-full flex items-center justify-between text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-rose-50 flex items-center justify-center text-rose-600">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-slate-900 text-sm flex items-center gap-2">
                      WFM Health Compliance Auditor
                      {computedViolationsList.length > 0 && (
                        <span className="bg-rose-500 text-white text-[10px] px-2 py-0.5 rounded-full font-black animate-pulse">
                          {computedViolationsList.length} Alerts
                        </span>
                      )}
                    </h4>
                    <p className="text-[11px] text-slate-500 font-medium">
                      Deteksi instan celah istirahat karyawan, batas hari kerja berturut-turut, dan shift kembali.
                    </p>
                  </div>
                </div>
                <div className="text-slate-400 hover:text-slate-600">
                  {isComplianceExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </div>
              </button>

              {isComplianceExpanded && (
                <div className="pt-6 border-t border-slate-100 mt-4 space-y-4">
                  {computedViolationsList.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-emerald-600 bg-emerald-50/10 border border-dashed border-emerald-200 rounded-xl space-y-2">
                      <CheckCircle2 className="w-10 h-10 text-emerald-500" />
                      <div className="text-center space-y-1">
                        <span className="text-xs font-black uppercase tracking-tight">Absolute Compliance Achieved</span>
                        <p className="text-xs text-emerald-855">100% Bebas pelanggaran aturan istirahat, streak harian, atau rotasi ilegal.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {computedViolationsList.map((v, i) => (
                        <div 
                          key={`${v.employeeId}-${v.date}-${v.type}-${i}`} 
                          className="border border-slate-150 p-4 rounded-xl bg-white flex flex-col justify-between space-y-3 shadow-xs hover:border-slate-300 transition-colors"
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-full bg-rose-50 flex items-center justify-center text-rose-600">
                                <AlertTriangle className="w-4 h-4" />
                              </div>
                              <div className="text-left">
                                <h4 className="text-xs font-black text-slate-950">{v.employeeName}</h4>
                                <p className="text-[10px] text-slate-400 uppercase tracking-widest font-mono">
                                  {format(new Date(v.date), 'dd MMM yyyy')} • {v.type.toUpperCase()}
                                </p>
                              </div>
                            </div>
                            <Badge variant="destructive" className="bg-rose-500 text-white font-black text-[9px] uppercase">
                              Rule Breach
                            </Badge>
                          </div>
                          
                          <p className="text-xs text-slate-600 font-medium text-left leading-relaxed">
                            {v.message || v.description}
                          </p>

                          <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-100 text-left">
                            <span className="block text-[9px] font-black text-slate-400 uppercase tracking-wider">Automated Recommendation</span>
                            <p className="text-xs text-slate-700 font-medium mt-1">
                              {v.type === 'rest' 
                                ? "Assign a late morning/afternoon shift to guarantee at least minimum rest spacing, or toggle off." 
                                : v.type === 'consecutive'
                                ? "Force active work assigned shift to OFF to break too long consec working streak."
                                : "Avoid assigning morning shifts right after evening shifts."
                              }
                            </p>
                          </div>

                          <div className="flex justify-end gap-2 pt-1.5 border-t border-slate-50">
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => setEditingCell({
                                employeeId: v.employeeId,
                                date: v.date,
                                employeeName: v.employeeName,
                                currentShift: roster.find(r => r.employeeId === v.employeeId)?.days[v.date] || 'OFF'
                              })}
                              className="h-8 text-[10px] font-bold border-indigo-200 text-indigo-600 hover:bg-slate-50 uppercase tracking-wider"
                            >
                              Manual Override
                            </Button>
                            <Button 
                              variant="default" 
                              size="sm"
                              onClick={async () => {
                                await handleManualShiftChange(v.employeeId, v.date, 'OFF');
                                toast.success(`Quick Repair Applied: ${v.employeeName} pada ${v.date} diset ke OFF!`);
                              }}
                              className="h-8 text-[10px] font-bold bg-indigo-600 text-white hover:bg-indigo-700 uppercase tracking-wider"
                            >
                              Fix: Force OFF
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* COLLAPSIBLE 3: Labor Policy & Staffing Constraints (Rules configuration) */}
            <div className="bg-white p-5 rounded-xl border border-slate-100 shadow-sm text-left">
              <button 
                type="button"
                onClick={() => setIsPolicyExpanded(!isPolicyExpanded)}
                className="w-full flex items-center justify-between text-left"
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600">
                    <Settings2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-extrabold text-slate-900 text-sm">Labor Policy & Constraints Settings</h4>
                    <p className="text-[11px] text-slate-500 font-medium">
                      Atur legalitas interval rest minimal, limit hari kerja berturut-turut, dan adaptasi Overtime darurat.
                    </p>
                  </div>
                </div>
                <div className="text-slate-400 hover:text-slate-600">
                  {isPolicyExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </div>
              </button>

              {isPolicyExpanded && (
                <div className="pt-6 border-t border-slate-100 mt-4 space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
                    <div className="space-y-4">
                      <div className="border border-slate-100 p-4 rounded-xl space-y-3 bg-white">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-black text-slate-700 uppercase tracking-tight">Minimum Daily Rest Interval</span>
                          <span className="text-xs font-mono font-black text-slate-900 bg-slate-100 px-2 py-0.5 rounded">{constraints.minRestHours} Hours</span>
                        </div>
                        <Input 
                          type="range" 
                          min="10" 
                          max="18" 
                          value={constraints.minRestHours}
                          onChange={(e) => updateConstraint('minRestHours', Number(e.target.value))}
                          className="w-full shrink-0 accent-indigo-600 h-1"
                        />
                        <p className="text-[10px] text-slate-400 leading-relaxed">
                          Sela minimal waktu istirahat antar shif harian. Standar Undang-Undang adalah 11-13 jam untuk efisiensi kognitif agen.
                        </p>
                      </div>

                      <div className="border border-slate-100 p-4 rounded-xl space-y-3 bg-white">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-black text-slate-700 uppercase tracking-tight">Maximum Consecutive Working Days</span>
                          <span className="text-xs font-mono font-black text-slate-900 bg-slate-100 px-2 py-0.5 rounded">{constraints.maxConsecutiveWorking} Days</span>
                        </div>
                        <Input 
                          type="range" 
                          min="4" 
                          max="7" 
                          value={constraints.maxConsecutiveWorking}
                          onChange={(e) => updateConstraint('maxConsecutiveWorking', Number(e.target.value))}
                          className="w-full shrink-0 accent-indigo-600 h-1"
                        />
                        <p className="text-[10px] text-slate-400 leading-relaxed">
                          Batas maksimal hari kerja berturut-turut sebelum karyawan diwajibkan mendapat hari libur (OFF).
                        </p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      <div className="border border-slate-100 p-4 rounded-xl space-y-3 bg-white">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-black text-slate-705 uppercase tracking-tight">Maximum Consecutive Off Days</span>
                          <span className="text-xs font-mono font-black text-slate-900 bg-slate-100 px-2 py-0.5 rounded">{constraints.maxConsecutiveOff} Days</span>
                        </div>
                        <Input 
                          type="range" 
                          min="2" 
                          max="4" 
                          value={constraints.maxConsecutiveOff}
                          onChange={(e) => updateConstraint('maxConsecutiveOff', Number(e.target.value))}
                          className="w-full shrink-0 accent-indigo-600 h-1"
                        />
                        <p className="text-[10px] text-slate-400 leading-relaxed">
                          Batasan maksimal hari libur berurutan demi menjaga keseimbangan rotasi dan target kapasitas harian.
                        </p>
                      </div>

                      <div className="border border-slate-100 p-4 rounded-xl space-y-3 bg-white">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-black text-slate-705 uppercase tracking-tight">Night Shift Recovery Buffer OFF</span>
                          <span className="text-xs font-mono font-black text-slate-900 bg-slate-100 px-2 py-0.5 rounded">{constraints.offAfterNightShift} Days</span>
                        </div>
                        <Input 
                          type="range" 
                          min="1" 
                          max="3" 
                          value={constraints.offAfterNightShift}
                          onChange={(e) => updateConstraint('offAfterNightShift', Number(e.target.value))}
                          className="w-full shrink-0 accent-indigo-600 h-1"
                        />
                        <p className="text-[10px] text-slate-400 leading-relaxed">
                          Hari istirahat wajib setelah agen dijadwalkan masuk Shif Malam untuk memulihkan ritme sirkadian tubuh.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-indigo-50/10 border border-indigo-100 p-5 rounded-xl space-y-4">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between border-b border-indigo-100/50 pb-3 gap-3">
                      <div className="space-y-0.5 text-left">
                        <h4 className="text-xs font-black text-slate-900 uppercase tracking-tight">Overtime & Demand Adjustment Multilaterals</h4>
                        <p className="text-[10px] text-slate-500 leading-relaxed font-semibold">
                          Mengijinkan penambahan hari kerja atau jam kerja lembur guna menutup gap kapasitas selama peak season.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-slate-700 uppercase tracking-tight">Apply Adjustments:</span>
                        <Switch 
                          checked={isAgreedToAdjustments} 
                          onCheckedChange={handleAgreementToggle} 
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <span className="block text-[10px] font-black text-slate-400 uppercase tracking-widest text-left">Additional working days per employee:</span>
                        <div className="flex items-center gap-3">
                          <Button 
                            variant="outline" 
                            onClick={() => handleExtraDaysChange(Math.max(0, extraWorkingDays - 1))}
                            disabled={!isAgreedToAdjustments || extraWorkingDays <= 0}
                            className="w-8 h-8 rounded-full p-0 flex items-center justify-center font-bold"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </Button>
                          <span className="text-xs font-black text-slate-800 w-16 text-center">{extraWorkingDays} days</span>
                          <Button 
                            variant="outline" 
                            onClick={() => handleExtraDaysChange(extraWorkingDays + 1)}
                            disabled={!isAgreedToAdjustments}
                            className="w-8 h-8 rounded-full p-0 flex items-center justify-center font-bold"
                          >
                            +
                          </Button>
                        </div>
                        <p className="text-[9px] text-slate-400">Menambahkan kuota kerja lembur per agen ke dalam engine penjadwalan</p>
                      </div>

                      <div className="space-y-2">
                        <span className="block text-[10px] font-black text-slate-400 uppercase tracking-widest text-left">Overtime hours per shift:</span>
                        <div className="flex items-center gap-3">
                          <Button 
                            variant="outline" 
                            onClick={() => handleExtraHoursChange(Math.max(0, extraHours - 1))}
                            disabled={!isAgreedToAdjustments || extraHours <= 0}
                            className="w-8 h-8 rounded-full p-0 flex items-center justify-center font-bold"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </Button>
                          <span className="text-xs font-black text-slate-800 w-16 text-center">{extraHours} hours</span>
                          <Button 
                            variant="outline" 
                            onClick={() => handleExtraHoursChange(extraHours + 1)}
                            disabled={!isAgreedToAdjustments}
                            className="w-8 h-8 rounded-full p-0 flex items-center justify-center font-bold"
                          >
                            +
                          </Button>
                        </div>
                        <p className="text-[9px] text-slate-400">Memperpanjang durasi shif harian dari standar 8 jam</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

          </div>
        </div>

      {editingCell && (
        <Dialog open={!!editingCell} onOpenChange={() => setEditingCell(null)}>
          <DialogContent className="max-w-md bg-white p-6 rounded-lg">
            <DialogHeader className="text-left">
              <DialogTitle className="text-base font-black text-slate-950 uppercase tracking-tight">
                Change shift assignment
              </DialogTitle>
              <p className="text-xs text-slate-500 font-bold uppercase tracking-wider py-0.5 leading-none border-b border-slate-100 pb-2">
                {editingCell.employeeName} — {format(new Date(editingCell.date), 'dd MMMM yyyy')}
              </p>
            </DialogHeader>
            <div className="space-y-4 py-3">
              <div className="space-y-1.5">
                <label className="block text-xs font-extrabold text-slate-400 uppercase tracking-widest text-left">
                  Operational Shift Code assignment:
                </label>
                <Select 
                  value={editingCell.currentShift || 'OFF'} 
                  onValueChange={async (val) => {
                    await handleManualShiftChange(editingCell.employeeId, editingCell.date, val);
                    setEditingCell(null);
                  }}
                >
                  <SelectTrigger className="w-full bg-slate-50 font-bold text-xs h-10 border-slate-200">
                    <SelectValue placeholder="Select shift code..." />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    <SelectItem value="OFF" className="text-xs font-bold text-rose-500 hover:text-rose-600">
                      OFF (Work Off day)
                    </SelectItem>
                    {shiftCodes.map(sc => (
                      <SelectItem key={sc.code} value={sc.code} className="text-xs font-mono font-semibold">
                        {sc.code} ({sc.startTime} - {sc.endTime} | {sc.name})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter className="mt-4 gap-2 text-left justify-start">
              <Button 
                variant="ghost" 
                onClick={() => setEditingCell(null)} 
                className="font-bold text-xs h-9"
              >
                Cancel Override
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Upload excel schedule popup */}
      <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
        <DialogContent className="max-w-md bg-white p-6 rounded-lg">
          <DialogHeader className="text-left">
            <DialogTitle className="text-base font-black text-slate-950 uppercase tracking-tight">
              Excel schedule importer
            </DialogTitle>
            <p className="text-xs text-slate-400 font-bold uppercase tracking-wider leading-relaxed border-b border-slate-100 pb-2.5">
              Sync offline rosters directly back to the active TransRosterAI database.
            </p>
          </DialogHeader>
          <div className="space-y-4 py-4 text-left">
            <p className="text-xs text-slate-500 leading-relaxed">
              Upload an Excel schedule sheet matching the downloaded template grid headers (columns should map agent NIP or Name, and subsequent dates as YYYY-MM-DD). Values inside cells must match active Shift Codes (e.g., M1, M2) or OFF.
            </p>
            <div className="border border-dashed border-slate-200 p-6 rounded-lg flex flex-col items-center justify-center bg-slate-50/50 hover:bg-slate-50/75 transition-colors">
              <input
                type="file"
                accept=".xlsx,.xls"
                id="rosterUploadExcelPicker"
                onChange={handleRosterUpload}
                className="hidden"
              />
              <label 
                htmlFor="rosterUploadExcelPicker"
                className="flex flex-col items-center justify-center cursor-pointer space-y-2.5 text-center"
              >
                <Upload className="w-8 h-8 text-indigo-500 hover:scale-105 transition-transform" />
                <span className="text-xs font-bold text-indigo-600 hover:underline">Select Excel Spreadsheet template</span>
                <span className="text-[10px] text-slate-400">Supports .xls or .xlsx formats</span>
              </label>
            </div>
          </div>
          <DialogFooter className="mt-2 text-left">
            <Button
              variant="ghost"
              onClick={() => setIsUploadDialogOpen(false)}
              className="font-bold text-xs h-9"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Wipe/Clear Roster Confirmation */}
      <Dialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <DialogContent className="max-w-md bg-white p-6 rounded-lg">
          <DialogHeader className="text-left">
            <DialogTitle className="text-base font-black text-rose-600 uppercase tracking-tight flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0" />
              Destructive Operation
            </DialogTitle>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider leading-relaxed border-b border-rose-100 pb-2.5">
              Wipe current monthly roster?
            </p>
          </DialogHeader>
          <div className="py-3 text-left">
            <p className="text-xs text-slate-600 leading-relaxed">
              This will permanently delete all shifts scheduled for the active cycle month of <strong className="text-slate-900 font-black">{selectedMonth}</strong>. This action is irreversible and will put the database back into offline/blank state until regenerated.
            </p>
          </div>
          <DialogFooter className="mt-4 gap-2 justify-end">
            <Button
              variant="ghost"
              onClick={() => setShowClearConfirm(false)}
              className="font-bold text-xs h-9"
            >
              Keep Schedule
            </Button>
            <Button
              variant="destructive"
              onClick={clearRoster}
              className="bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs h-9 uppercase tracking-wider"
            >
              Wipe Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {loading && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex flex-col items-center justify-center z-50">
          <div className="bg-white px-8 py-6 rounded-xl border border-slate-100 shadow-2xl flex flex-col items-center space-y-3 max-w-sm text-center">
            <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin" />
            <span className="text-xs font-black uppercase tracking-widest text-slate-900">Syncing database...</span>
            <p className="text-[10px] text-slate-400 font-bold leading-relaxed uppercase tracking-wider max-w-xs">
              Optimizing schedules & re-calculating WFM erlang staffing metrics
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
