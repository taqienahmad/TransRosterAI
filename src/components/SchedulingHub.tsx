import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ForecastView from './ForecastView';
import RosterView from './RosterView';
import { Calendar, TrendingUp, LayoutDashboard, Info, ShieldCheck, ClipboardCheck, Settings2, BarChart3, HelpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { format } from 'date-fns';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from '@/components/ui/dialog';

export default function SchedulingHub(props: any) {
  const [activeTab, setActiveTab] = useState('forecast');
  const [selectedMonth, setSelectedMonth] = useState<string>('');

  // Extract available months from volume data
  const availableMonths = React.useMemo(() => {
    const months = new Set<string>();
    const allVolumeData = props.allVolumeData || [];
    allVolumeData.forEach((d: any) => {
      try {
        const date = new Date(d.date);
        if (!isNaN(date.getTime())) {
          months.add(format(date, 'MMM-yy'));
        }
      } catch (e) {}
    });
    return Array.from(months).sort((a, b) => {
      const [m, y] = a.split('-');
      const [m2, y2] = b.split('-');
      const monthsOrder = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const dateA = new Date(2000 + parseInt(y), monthsOrder.indexOf(m));
      const dateB = new Date(2000 + parseInt(y2), monthsOrder.indexOf(m2));
      return dateA.getTime() - dateB.getTime();
    });
  }, [props.allVolumeData]);

  // Set initial month
  React.useEffect(() => {
    if (availableMonths.length > 0 && !selectedMonth) {
      setSelectedMonth(availableMonths[0]);
    }
  }, [availableMonths, selectedMonth]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <LayoutDashboard className="w-6 h-6 text-indigo-600" />
            Scheduling Hub
          </h1>
          <p className="text-[10px] sm:text-xs text-slate-500 font-medium lowercase tracking-tight">Intelligent Workforce Management & Strategic Planning</p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm transition-all hover:border-indigo-200">
            <Calendar className="w-3.5 h-3.5 text-slate-400" />
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">Global Period:</span>
              <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                <SelectTrigger className="w-[110px] border-none shadow-none h-5 p-0 text-xs font-bold text-slate-900 focus:ring-0">
                  <SelectValue placeholder="Month" />
                </SelectTrigger>
                <SelectContent className="rounded-lg border-slate-200">
                  {availableMonths.map(m => (
                    <SelectItem key={m} value={m} className="text-xs font-medium">{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2 border-indigo-200 text-indigo-600 hover:bg-indigo-50 font-bold text-[10px] uppercase tracking-wider">
                <HelpCircle className="w-4 h-4" />
                Operational Guide
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto rounded-[2rem]">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 font-black text-slate-900">
                  <Info className="w-5 h-5 text-indigo-600" />
                  Workforce Management System Guide
                </DialogTitle>
                <DialogDescription className="text-xs font-medium">
                  Understand the functions and usage of each tool in the Scheduling Hub.
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-6 mt-4">
                <section className="space-y-3">
                  <h3 className="text-xs font-black text-slate-900 border-b pb-1 uppercase tracking-widest">Phase 1: Intelligence & Forecasting</h3>
                  <div className="grid grid-cols-1 gap-4">
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                      <p className="text-xs font-black text-indigo-600 flex items-center gap-2 uppercase">
                        <TrendingUp className="w-3.5 h-3.5" />
                        Generate AI Forecast
                      </p>
                      <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                        Uses historical volume trends and Gemini AI to predict future workload. 
                        <span className="block mt-2 font-bold text-slate-900 italic">Usage: Run this monthly or weekly to set the baseline demand.</span>
                      </p>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                      <p className="text-xs font-black text-indigo-600 flex items-center gap-2 uppercase">
                        <BarChart3 className="w-3.5 h-3.5" />
                        Erlang intelligence
                      </p>
                      <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                        Converts forecasted volume into required Headcount (FTE) based on Service Level (SL) targets.
                        <span className="block mt-2 font-bold text-slate-900 italic">Usage: Use this to fine-tune shrinkage, AHT, and concurrency settings.</span>
                      </p>
                    </div>
                  </div>
                </section>

                <section className="space-y-3">
                  <h3 className="text-xs font-black text-slate-900 border-b pb-1 uppercase tracking-widest">Phase 2: Roster Production</h3>
                  <div className="grid grid-cols-1 gap-4">
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                      <p className="text-xs font-black text-amber-600 flex items-center gap-2 uppercase">
                        <Settings2 className="w-3.5 h-3.5" />
                        Policy Configuration
                      </p>
                      <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                        Configure your local workforce policies, rest periods, and shift constraints.
                        <span className="block mt-2 font-bold text-slate-900 italic">Usage: Set these parameters before manually assigning or importing shifts.</span>
                      </p>
                    </div>
                  </div>
                </section>

                <section className="space-y-3">
                  <h3 className="text-xs font-black text-slate-900 border-b pb-1 uppercase tracking-widest">Phase 3: Final Audit & Compliance</h3>
                  <div className="grid grid-cols-1 gap-4">
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                      <p className="text-xs font-black text-rose-600 flex items-center gap-2 uppercase">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        Health Audit
                      </p>
                      <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                        Scans for violations like 13h rest gaps, 6-day streaks, or backward jumps (Night to Morning).
                        <span className="block mt-2 font-bold text-slate-900 italic">Usage: Review this BEFORE sharing the roster with staff to ensure compliance.</span>
                      </p>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                      <p className="text-xs font-black text-blue-600 flex items-center gap-2 uppercase">
                        <ClipboardCheck className="w-3.5 h-3.5" />
                        WFM Audit Summary
                      </p>
                      <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                        Verifies if every employee has met their target working days for the month.
                        <span className="block mt-2 font-bold text-slate-900 italic">Usage: Use to ensure fair distribution of hours among all staff.</span>
                      </p>
                    </div>
                  </div>
                </section>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <div className="flex items-center justify-between mb-4">
          <TabsList className="grid grid-cols-2 w-full sm:w-[350px]">
            <TabsTrigger value="forecast" className="gap-2 px-1 sm:px-4 text-[10px] sm:text-xs">
              <TrendingUp className="w-3.5 h-3.5 sm:w-4 h-4" />
              AI Requirements
            </TabsTrigger>
            <TabsTrigger value="roster" className="gap-2 px-1 sm:px-4 text-[10px] sm:text-xs">
              <Calendar className="w-3.5 h-3.5 sm:w-4 h-4" />
              Roster Management
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="forecast" className="mt-0 border-none p-0 outline-none">
          <ForecastView 
            {...props} 
            selectedMonth={selectedMonth} 
            onMonthChange={setSelectedMonth} 
          />
        </TabsContent>
        
        <TabsContent value="roster" className="mt-0 border-none p-0 outline-none">
          <RosterView 
            {...props} 
            selectedMonth={selectedMonth} 
            onMonthChange={setSelectedMonth} 
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
