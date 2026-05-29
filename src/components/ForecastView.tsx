import React, { useState, useEffect, useMemo } from 'react';
import { db, collection, onSnapshot, query, setDoc, doc, deleteDoc, Timestamp, OperationType, handleFirestoreError, where, writeBatch } from '../lib/firebase';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend
} from 'recharts';
import { Brain, Sparkles, RefreshCw, AlertCircle, Calculator, Calendar, Info, Users, MessageSquare, Mail, Phone, TrendingUp, Activity, ShieldCheck, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { format, parse, addMonths } from 'date-fns';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import ErlangForecaster from './ErlangForecaster';
import OperationalWindowSettings from './OperationalWindowSettings';
import { ShiftCode } from './ShiftCodeManager';
import { isIntervalInWindow } from '../lib/erlang';

interface Employee {
  id: string;
  nip: string;
  name: string;
  email: string;
  skill: string;
  channel: string;
  site: string;
  gender: string;
  religion: string;
  role: string;
  department: string;
  skills: string[];
  extraWorkingDays?: number;
  extraHours?: number;
}

interface ForecastVolumeData {
  date: string;
  day: string;
  totalVolume: number;
  intervals: Record<string, number>;
}

export default function ForecastView(props: any) {
  const { isAdmin, selectedMonth: externalMonth, onMonthChange } = props;
  const [loading, setLoading] = useState(false);
  const [allVolumeData, setAllVolumeData] = useState<ForecastVolumeData[]>(props.allVolumeData || []);
  const [selectedMonth, setSelectedMonth] = useState<string>(externalMonth || '');
  const [shiftCodes, setShiftCodes] = useState<ShiftCode[]>(props.shiftCodes || []);
  const [employees, setEmployees] = useState<Employee[]>(props.employees || []);
  const [activeSubTab, setActiveSubTab] = useState(() => localStorage.getItem('forecastView_activeSubTab') || 'dashboard');
  const [erlangSettings, setErlangSettings] = useState<any>(props.erlangSettings || null);
  const [erlangResults, setErlangResults] = useState<any[]>([]);
  const [workingDaysRef, setWorkingDaysRef] = useState<any[]>(props.workingDaysRef || []);
  const [leaveRequests, setLeaveRequests] = useState<any[]>(props.leaveRequests || []);
  const [roster, setRoster] = useState<any[]>(props.roster || []);
  const [legacyRoster, setLegacyRoster] = useState<Record<string, Record<string, string>>>(props.legacyRoster || {});

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
    localStorage.setItem('forecastView_activeSubTab', activeSubTab);
  }, [activeSubTab]);

  useEffect(() => { if (props.allVolumeData) setAllVolumeData(props.allVolumeData); }, [props.allVolumeData]);
  useEffect(() => { if (props.shiftCodes) setShiftCodes(props.shiftCodes); }, [props.shiftCodes]);
  useEffect(() => { if (props.employees) setEmployees(props.employees); }, [props.employees]);
  useEffect(() => { if (props.workingDaysRef) setWorkingDaysRef(props.workingDaysRef); }, [props.workingDaysRef]);
  useEffect(() => { if (props.leaveRequests) setLeaveRequests(props.leaveRequests); }, [props.leaveRequests]);
  useEffect(() => { if (props.roster) setRoster(props.roster); }, [props.roster]);
  useEffect(() => { if (props.legacyRoster) setLegacyRoster(props.legacyRoster); }, [props.legacyRoster]);
  useEffect(() => { if (props.erlangSettings) setErlangSettings(props.erlangSettings); }, [props.erlangSettings]);

  useEffect(() => {
    // Other local listeners if any
    const unsubErlangResults = onSnapshot(query(collection(db, 'erlangResults')), (snapshot) => {
      const list = snapshot.docs.map(doc => doc.data());
      setErlangResults(list);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'erlangResults');
    });

    return () => {
      unsubErlangResults();
    };
  }, []);

  const dashboardStats = useMemo(() => {
    if (volumeData.length === 0) return null;
    
    // Convert selectedMonth (MMM-yy) to normalized format if needed, 
    // but since it's already MMM-yy from availableMonths, we can use it directly.
    const monthStr = selectedMonth;
    
    // Get working days from reference if available, otherwise estimate
    const monthRef = workingDaysRef.find(r => (r.month || '').toLowerCase() === (monthStr || '').toLowerCase());
    const targetWorkingDays = monthRef ? monthRef.workingDays : Math.round(volumeData.length * (5/7));
    
    // Calculate total volume (all volume is handled, just shifted if outside windows)
    let totalVolume = 0;
    volumeData.forEach(day => {
      Object.values(day.intervals).forEach(volume => {
        totalVolume += (volume as number);
      });
    });

    const avgDailyVolume = Math.round(totalVolume / volumeData.length);
    const busiestDay = volumeData.reduce((prev, curr) => (curr.totalVolume > prev.totalVolume) ? curr : prev);
    
    // Use Erlang Results for accurate FTE if available
    const relevantResults = erlangResults.filter(r => volumeData.some(v => v.date === r.date));
    
    let totalWorkHours = 0;
    let grossFTE = 0;
    let netFTE = 0;
    
    const operationalWindows = erlangSettings?.operationalWindows;
    
    const channelType = erlangSettings?.channelType || 'call';
    const extraWorkingDays = erlangSettings?.extraWorkingDays || 0;
    const extraHours = erlangSettings?.extraHours || 0;

    const isAgreed = erlangSettings?.isSimulationAgreed || false;
    const adjustmentMultiplier = isAgreed ? 1 : 0;

    // Calculate Effective Available Capacity (FTE) - NO BUFFER for main gap
    const totalCapacityHours = employees.reduce((sum, emp) => {
      const empExtraDays = (emp.extraWorkingDays !== undefined ? emp.extraWorkingDays : extraWorkingDays) * adjustmentMultiplier;
      const empExtraHours = (emp.extraHours !== undefined ? emp.extraHours : extraHours) * adjustmentMultiplier;
      
      // Calculate this employee's approved leave days in this period
      const empLeaveDays = leaveRequests.filter(req => 
        req.employeeId === emp.id && 
        req.status === 'approved' && 
        volumeData.some(d => d.date === req.date)
      ).length;

      return sum + ((targetWorkingDays + empExtraDays - empLeaveDays) * (8 + empExtraHours));
    }, 0);

    const monthlyStandardHours = 8 * targetWorkingDays;
    const effectiveAvailableFTE = (totalCapacityHours / monthlyStandardHours);
    
    // Calculate Required Headcount (Body Count)
    // Demand is fixed at standard 8h shifts
    const monthlyPersonHours = 8 * targetWorkingDays;

    if (relevantResults.length > 0) {
      totalWorkHours = relevantResults.reduce((acc, r) => acc + (r.dayTotalHours || 0), 0);
      const shrinkage = (erlangSettings?.shrinkage || 30) / 100;
      // Since totalWorkHours already includes shrinkage, netFTE is totalWorkHours corrected back to net,
      // and grossFTE is the directly divided totalWorkHours.
      netFTE = (totalWorkHours * (1 - shrinkage)) / monthlyPersonHours;
      grossFTE = Math.ceil(totalWorkHours / monthlyPersonHours);
    } else {
      // Fallback to estimation if no erlang results yet
      const aht = erlangSettings?.aht || 300;
      const shrinkage = (erlangSettings?.shrinkage || 30) / 100;
      const concurrency = erlangSettings?.concurrency || 1;
      
      // Basic workload estimation
      let estimatedWorkHours = (totalVolume * aht) / 3600;
      
      // Adjust for concurrency if chat
      if (channelType === 'chat' || channelType === 'whatsapp' || channelType === 'multiskill_chat_wa') {
        estimatedWorkHours = estimatedWorkHours / concurrency;
      }
      
      // Add a 15% "Erlang Buffer" for fallback estimation to be more realistic than pure workload
      totalWorkHours = estimatedWorkHours * 1.15; 
      
      netFTE = totalWorkHours / monthlyPersonHours;
      grossFTE = Math.ceil(netFTE / (1 - shrinkage));
    }

    return {
      totalVolume,
      avgDailyVolume,
      busiestDay,
      grossFTE,
      totalWorkHours: Math.round(totalWorkHours),
      isEstimate: relevantResults.length === 0,
      headcountGap: Math.round(effectiveAvailableFTE - grossFTE),
      utilization: effectiveAvailableFTE > 0 ? Math.round((grossFTE / effectiveAvailableFTE) * 100) : 0,
      channelType,
      slRisk: (effectiveAvailableFTE - grossFTE) < 0 ? 'High' : (effectiveAvailableFTE - grossFTE) < 5 ? 'Medium' : 'Low'
    };
  }, [volumeData, erlangSettings, erlangResults, employees.length, workingDaysRef]);

  const getChannelIcon = (type: string) => {
    switch (type) {
      case 'chat':
      case 'whatsapp':
      case 'multiskill_chat_wa':
        return <MessageSquare className="w-4 h-4" />;
      case 'email':
        return <Mail className="w-4 h-4" />;
      default:
        return <Phone className="w-4 h-4" />;
    }
  };

  const getChannelLabel = (type: string) => {
    switch (type) {
      case 'chat': return 'Live Chat';
      case 'whatsapp': return 'WhatsApp';
      case 'multiskill_chat_wa': return 'Multiskill';
      case 'email': return 'Email';
      default: return 'Voice / Call';
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-2">
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="bg-[#960000]/5 border-[#960000]/10 text-[#960000] py-1.5 px-3 gap-2 flex rounded-lg shadow-sm">
            <Calculator className="w-3.5 h-3.5" />
            <span className="font-black text-[10px] uppercase tracking-widest">FTE Requirement Engine</span>
          </Badge>

          {dashboardStats && (
            <Badge variant="outline" className="bg-white border-slate-200 text-slate-600 py-1.5 px-3 gap-2 hidden lg:flex rounded-lg shadow-sm">
              <div className="p-0.5 bg-slate-100 rounded">
                {getChannelIcon(dashboardStats.channelType)}
              </div>
              <span className="font-bold text-[9px] uppercase tracking-widest">{getChannelLabel(dashboardStats.channelType)}</span>
            </Badge>
          )}
        </div>

        {/* Removed redundant month selector as it's now global */}
      </div>

      <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
        <ErlangForecaster 
          volumeData={volumeData} 
          shiftCodes={shiftCodes} 
          employees={employees} 
          workingDaysRef={workingDaysRef.find(r => (r.month || '').toLowerCase() === (selectedMonth || '').toLowerCase())}
          erlangResults={erlangResults}
          initialSettings={erlangSettings}
          leaveRequests={leaveRequests}
          roster={roster}
          legacyRoster={legacyRoster}
          selectedMonth={selectedMonth}
        />
      </div>
    </div>
  );
}
