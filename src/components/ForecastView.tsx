import React, { useState, useEffect, useMemo } from 'react';
import { db, collection, onSnapshot, query, setDoc, doc, deleteDoc, Timestamp, OperationType, handleFirestoreError, where } from '../lib/firebase';
import { generateStaffingForecast, ForecastData } from '../lib/gemini';
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
import { format } from 'date-fns';
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

export default function ForecastView({ isAdmin }: { isAdmin: boolean }) {
  const [forecasts, setForecasts] = useState<ForecastData[]>([]);
  const [loading, setLoading] = useState(false);
  const [allVolumeData, setAllVolumeData] = useState<ForecastVolumeData[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [shiftCodes, setShiftCodes] = useState<ShiftCode[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [activeSubTab, setActiveSubTab] = useState(() => localStorage.getItem('forecastView_activeSubTab') || 'dashboard');
  const [erlangSettings, setErlangSettings] = useState<any>(null);
  const [erlangResults, setErlangResults] = useState<any[]>([]);
  const [workingDaysRef, setWorkingDaysRef] = useState<any[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<any[]>([]);

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

  useEffect(() => {
    // Listen to AI Forecasts
    const qForecasts = query(collection(db, 'forecasts'));
    const unsubForecasts = onSnapshot(qForecasts, (snapshot) => {
      const list = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          ...data,
          date: data.date instanceof Timestamp ? format(data.date.toDate(), 'yyyy-MM-dd') : data.date
        } as ForecastData;
      });
      setForecasts(list.sort((a, b) => a.date.localeCompare(b.date)));
    });

    // Listen to Forecast Volume (The data uploaded in the previous step)
    const qVolume = query(collection(db, 'forecastVolume'));
    const unsubVolume = onSnapshot(qVolume, (snapshot) => {
      const list = snapshot.docs.map(doc => doc.data() as ForecastVolumeData);
      setAllVolumeData(list.sort((a, b) => a.date.localeCompare(b.date)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'forecastVolume');
    });

    // Listen to Shift Codes
    const qShifts = query(collection(db, 'shiftCodes'));
    const unsubShifts = onSnapshot(qShifts, (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ShiftCode));
      setShiftCodes(list);
    });

    // Listen to Employees
    const qEmployees = query(collection(db, 'employees'));
    const unsubEmployees = onSnapshot(qEmployees, (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Employee));
      setEmployees(list);
    });

    // Listen to Erlang Settings
    const unsubSettings = onSnapshot(doc(db, 'erlangSettings', 'current'), (snapshot) => {
      if (snapshot.exists()) {
        setErlangSettings(snapshot.data());
      }
    });

    // Listen to Erlang Results
    const unsubErlangResults = onSnapshot(query(collection(db, 'erlangResults')), (snapshot) => {
      const list = snapshot.docs.map(doc => doc.data());
      setErlangResults(list);
    });

    // Listen to Working Days Reference
    const unsubWorkingDays = onSnapshot(query(collection(db, 'workingDaysRef')), (snapshot) => {
      const list = snapshot.docs.map(doc => doc.data());
      setWorkingDaysRef(list);
    });

    // Listen to Leave Requests
    const qLeaves = isAdmin 
      ? query(collection(db, 'leaveRequests'))
      : query(collection(db, 'leaveRequests'), where('status', '==', 'approved'));

    const unsubLeaves = onSnapshot(qLeaves, (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setLeaveRequests(list);
    });

    return () => {
      unsubForecasts();
      unsubVolume();
      unsubShifts();
      unsubEmployees();
      unsubSettings();
      unsubErlangResults();
      unsubWorkingDays();
      unsubLeaves();
    };
  }, []);

  const handleGenerateForecast = async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      // Use volumeData as historical context for the AI
      const context = volumeData.map(v => ({
        date: v.date,
        totalVolume: v.totalVolume
      }));
      
      const result = await generateStaffingForecast(context);
      if (result && result.length > 0) {
        // Save to Firestore
        for (const item of result) {
          const id = `forecast_${item.date}`;
          await setDoc(doc(db, 'forecasts', id), {
            ...item,
            date: Timestamp.fromDate(new Date(item.date))
          });
        }
        toast.success('AI Forecast generated successfully');
      } else {
        toast.error('Failed to generate forecast');
      }
    } catch (error) {
      console.error(error);
      toast.error('Error in AI processing');
    } finally {
      setLoading(false);
    }
  };

  const handleClearForecasts = async () => {
    if (!isAdmin) return;
    try {
      const promises = forecasts.map(f => deleteDoc(doc(db, 'forecasts', `forecast_${f.date}`)));
      await Promise.all(promises);
      toast.success('AI Forecast data cleared');
    } catch (error) {
      toast.error('Failed to clear forecast data');
    }
  };

  const dashboardStats = useMemo(() => {
    if (volumeData.length === 0) return null;
    
    const operationalWindows = erlangSettings?.operationalWindows;
    
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
    
    // Get working days from reference if available, otherwise estimate
    const monthRef = workingDaysRef.find(r => r.month === selectedMonth);
    const targetWorkingDays = monthRef ? monthRef.workingDays : Math.round(volumeData.length * (5/7));
    
    const channelType = erlangSettings?.channelType || 'call';
    const extraWorkingDays = erlangSettings?.extraWorkingDays || 0;
    const extraHours = erlangSettings?.extraHours || 0;

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
      netFTE = totalWorkHours / monthlyPersonHours;
      grossFTE = Math.ceil(netFTE / (1 - shrinkage));
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
      headcountGap: Math.round((effectiveAvailableFTE - grossFTE) * 100) / 100,
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
    <div className="space-y-6">
      <Tabs value={activeSubTab} onValueChange={setActiveSubTab} className="w-full">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
          <div className="flex items-center gap-4">
            <TabsList className="bg-slate-100/50 p-1 border border-slate-200/60 rounded-xl">
              <TabsTrigger 
                value="dashboard" 
                className="gap-2 px-6 py-2.5 rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-indigo-600 transition-all"
              >
                <TrendingUp className="w-4 h-4" />
                <span className="font-bold text-xs uppercase tracking-wider">Executive Dashboard</span>
              </TabsTrigger>
              <TabsTrigger 
                value="op-window" 
                className="gap-2 px-6 py-2.5 rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-indigo-600 transition-all"
              >
                <Clock className="w-4 h-4" />
                <span className="font-bold text-xs uppercase tracking-wider">Op Window</span>
              </TabsTrigger>
              <TabsTrigger 
                value="erlang" 
                className="gap-2 px-6 py-2.5 rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-indigo-600 transition-all"
              >
                <Calculator className="w-4 h-4" />
                <span className="font-bold text-xs uppercase tracking-wider">Staffing Needs</span>
              </TabsTrigger>
            </TabsList>

            {dashboardStats && (
              <Badge variant="outline" className="bg-indigo-50/50 border-indigo-100 text-indigo-600 py-2 px-4 gap-2 hidden lg:flex rounded-full">
                <div className="p-1 bg-indigo-100 rounded-full">
                  {getChannelIcon(dashboardStats.channelType)}
                </div>
                <span className="font-bold text-[10px] uppercase tracking-widest">{getChannelLabel(dashboardStats.channelType)}</span>
                <div className="w-1 h-1 rounded-full bg-indigo-300 mx-1" />
                <span className="text-[10px] text-indigo-400 font-bold uppercase tracking-widest">Active Channel</span>
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-3 bg-white px-4 py-2 rounded-xl border border-slate-200 shadow-sm">
            <div className="p-1.5 bg-indigo-50 rounded-lg">
              <Calendar className="w-4 h-4 text-indigo-600" />
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Reporting Period</span>
              <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                <SelectTrigger className="w-[140px] border-none shadow-none h-5 p-0 text-sm font-black text-slate-900 focus:ring-0">
                  <SelectValue placeholder="Select Month" />
                </SelectTrigger>
                <SelectContent className="rounded-xl border-slate-200">
                  {availableMonths.map(m => (
                    <SelectItem key={m} value={m} className="text-sm font-medium">{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        <TabsContent value="dashboard" className="space-y-6 mt-0 focus-visible:outline-none">
          <div className="mb-6">
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Executive Overview</h1>
            <p className="text-slate-500">Enterprise-level visibility into staffing demand and operational requirements.</p>
          </div>

          {dashboardStats ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <Card className="border-none shadow-lg bg-gradient-to-br from-indigo-600 to-violet-700 text-white overflow-hidden relative group">
                  <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                    <TrendingUp className="w-24 h-24 -mr-8 -mt-8" />
                  </div>
                  <CardContent className="p-6 relative z-10">
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-xs font-bold uppercase tracking-widest text-indigo-100">Monthly Volume</p>
                      <div className="p-2 bg-white/10 rounded-lg">
                        <Activity className="w-4 h-4 text-white" />
                      </div>
                    </div>
                    <h3 className="text-4xl font-black tracking-tight mb-1">{dashboardStats.totalVolume.toLocaleString()}</h3>
                    <p className="text-xs text-indigo-100/80 font-medium">Total Interactions</p>
                  </CardContent>
                </Card>

                <Card className="border-none shadow-lg bg-white overflow-hidden relative group">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Work Hours</p>
                      <div className="p-2 bg-slate-50 rounded-lg">
                        <Calculator className="w-4 h-4 text-slate-400" />
                      </div>
                    </div>
                    <h3 className="text-4xl font-black tracking-tight text-slate-900 mb-1">{dashboardStats.totalWorkHours.toLocaleString()}h</h3>
                    <p className="text-xs text-slate-400 font-medium">Net Production Time</p>
                  </CardContent>
                </Card>

                <Card className="border-none shadow-lg bg-white overflow-hidden relative group">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Monthly FTE</p>
                      <div className="p-2 bg-slate-50 rounded-lg">
                        <Users className="w-4 h-4 text-slate-400" />
                      </div>
                    </div>
                    <h3 className="text-4xl font-black tracking-tight text-slate-900 mb-1">{dashboardStats.grossFTE}</h3>
                    <p className="text-xs text-slate-400 font-medium">Agents Required</p>
                  </CardContent>
                </Card>

                <Card className="border-none shadow-lg bg-white overflow-hidden relative group">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between mb-4">
                      <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Peak Day</p>
                      <div className="p-2 bg-slate-50 rounded-lg">
                        <Calendar className="w-4 h-4 text-slate-400" />
                      </div>
                    </div>
                    <h3 className="text-xl font-black tracking-tight text-slate-900 mb-1">
                      {format(new Date(dashboardStats.busiestDay.date), 'MMM do')}
                    </h3>
                    <p className="text-xs text-slate-400 font-medium">{format(new Date(dashboardStats.busiestDay.date), 'EEEE')}</p>
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                <Card className={`border-none shadow-lg overflow-hidden relative group ${dashboardStats.headcountGap < 0 ? 'bg-rose-50' : 'bg-emerald-50'}`}>
                  <CardContent className="p-6 flex items-center justify-between">
                    <div>
                      <p className={`text-xs font-bold uppercase tracking-widest mb-1 ${dashboardStats.headcountGap < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>Capacity Gap</p>
                      <h3 className={`text-4xl font-black ${dashboardStats.headcountGap < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                        {dashboardStats.headcountGap > 0 ? '+' : ''}{dashboardStats.headcountGap}
                      </h3>
                      <p className={`text-xs font-medium mt-1 ${dashboardStats.headcountGap < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                        {dashboardStats.headcountGap < 0 ? 'Action required: Hiring needed' : 'Optimal: Surplus capacity'}
                      </p>
                    </div>
                    <div className={`p-4 rounded-2xl ${dashboardStats.headcountGap < 0 ? 'bg-rose-100' : 'bg-emerald-100'}`}>
                      <Users className={`w-8 h-8 ${dashboardStats.headcountGap < 0 ? 'text-rose-600' : 'text-emerald-600'}`} />
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-none shadow-lg bg-white overflow-hidden relative group cursor-help" title="Percentage of total agent capacity utilized by the forecasted workload.">
                  <CardContent className="p-6 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Resource Utilization</p>
                      <h3 className="text-4xl font-black text-slate-900">{dashboardStats.utilization}%</h3>
                      <p className="text-xs font-medium text-slate-400 mt-1">Target range: 75% - 85%</p>
                    </div>
                    <div className="p-4 rounded-2xl bg-slate-100">
                      <TrendingUp className="w-8 h-8 text-slate-600" />
                    </div>
                  </CardContent>
                </Card>

                <Card className={`border-none shadow-lg overflow-hidden relative group ${dashboardStats.slRisk === 'High' ? 'bg-rose-50' : dashboardStats.slRisk === 'Medium' ? 'bg-amber-50' : 'bg-emerald-50'}`}>
                  <CardContent className="p-6 flex items-center justify-between">
                    <div>
                      <p className={`text-xs font-bold uppercase tracking-widest mb-1 ${dashboardStats.slRisk === 'High' ? 'text-rose-400' : dashboardStats.slRisk === 'Medium' ? 'text-amber-400' : 'text-emerald-400'}`}>Service Level Risk</p>
                      <h3 className={`text-4xl font-black ${dashboardStats.slRisk === 'High' ? 'text-rose-700' : dashboardStats.slRisk === 'Medium' ? 'text-amber-700' : 'text-emerald-700'}`}>{dashboardStats.slRisk}</h3>
                      <p className={`text-xs font-medium mt-1 ${dashboardStats.slRisk === 'High' ? 'text-rose-600' : dashboardStats.slRisk === 'Medium' ? 'text-amber-600' : 'text-emerald-600'}`}>
                        {dashboardStats.slRisk === 'High' ? 'Critical: SL targets at risk' : dashboardStats.slRisk === 'Medium' ? 'Caution: Limited buffer' : 'Stable: Targets achievable'}
                      </p>
                    </div>
                    <div className={`p-4 rounded-2xl ${dashboardStats.slRisk === 'High' ? 'bg-rose-100' : dashboardStats.slRisk === 'Medium' ? 'bg-amber-100' : 'bg-emerald-100'}`}>
                      <AlertCircle className={`w-8 h-8 ${dashboardStats.slRisk === 'High' ? 'text-rose-600' : dashboardStats.slRisk === 'Medium' ? 'text-amber-600' : 'text-emerald-600'}`} />
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-1 gap-6">
                <Card className="border-none shadow-lg bg-white overflow-hidden">
                  <CardHeader className="flex flex-row items-center justify-between border-b border-slate-50 pb-4">
                    <div>
                      <CardTitle className="text-xl font-bold text-slate-900">Volume Distribution Trend</CardTitle>
                      <CardDescription>Daily volume patterns across the selected period.</CardDescription>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-indigo-500" />
                        <span className="text-xs font-medium text-slate-600">Total Volume</span>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-6 h-[400px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={volumeData}>
                        <defs>
                          <linearGradient id="colorVolume" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.1}/>
                            <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis 
                          dataKey="date" 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{fontSize: 11, fill: '#94a3b8'}}
                          dy={10}
                        />
                        <YAxis 
                          axisLine={false} 
                          tickLine={false} 
                          tick={{fontSize: 11, fill: '#94a3b8'}}
                          dx={-10}
                        />
                        <Tooltip 
                          contentStyle={{ 
                            borderRadius: '16px', 
                            border: 'none', 
                            boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
                            padding: '12px'
                          }}
                          itemStyle={{ fontWeight: 600, fontSize: '12px' }}
                          labelStyle={{ color: '#64748b', marginBottom: '4px', fontSize: '11px', fontWeight: 500 }}
                        />
                        <Line 
                          type="monotone" 
                          dataKey="totalVolume" 
                          name="Total Volume" 
                          stroke="#6366f1" 
                          strokeWidth={4} 
                          dot={{ r: 4, fill: '#6366f1', strokeWidth: 2, stroke: '#fff' }} 
                          activeDot={{ r: 6, strokeWidth: 0 }} 
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>
            </>
          ) : (
            <div className="h-[400px] flex flex-col items-center justify-center text-slate-400 space-y-4 bg-white rounded-2xl border border-dashed border-slate-200">
              <TrendingUp className="w-12 h-12 opacity-20" />
              <p>Upload volume data to view the executive dashboard.</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="op-window" className="mt-0 focus-visible:outline-none">
          <div className="mb-6">
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Operational Windows</h1>
            <p className="text-slate-500">Configure dynamic operating hours for each day of the week.</p>
          </div>
          <OperationalWindowSettings 
            windows={erlangSettings?.operationalWindows} 
            onUpdate={(windows) => setErlangSettings({ ...erlangSettings, operationalWindows: windows })}
          />
        </TabsContent>

        <TabsContent value="erlang" className="mt-0">
          <div className="mb-6">
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">Staffing Requirement</h1>
            <p className="text-slate-500">Calculate headcount needed based on your uploaded volume and shift patterns.</p>
          </div>
          <ErlangForecaster 
            volumeData={volumeData} 
            shiftCodes={shiftCodes} 
            employees={employees} 
            workingDaysRef={workingDaysRef.find(r => r.month === selectedMonth)}
            erlangResults={erlangResults}
            initialSettings={erlangSettings}
            leaveRequests={leaveRequests}
          />
        </TabsContent>

      </Tabs>
    </div>
  );
}
