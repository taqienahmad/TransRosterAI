import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ForecastVolume from './ForecastVolume';
import PredictiveVolume from './PredictiveVolume';
import OperationalWindowSettings from './OperationalWindowSettings';
import { Sparkles, BarChart3, Clock } from 'lucide-react';

interface ForecastingModuleProps {
  isAdmin: boolean;
}

export default function ForecastingModule(props: any) {
  const { isAdmin } = props;
  return (
    <div className="space-y-6">
      <div className="bg-white p-8 rounded-3xl border border-slate-100 shadow-sm relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-50/50 rounded-full blur-3xl -mr-32 -mt-32 transition-transform group-hover:scale-110 duration-700" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-blue-50/50 rounded-full blur-3xl -ml-24 -mb-24 transition-transform group-hover:scale-110 duration-700" />
        
        <div className="relative z-10">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-200">
                <Sparkles className="w-7 h-7 text-white" />
              </div>
              <div>
                <h1 className="text-3xl font-black tracking-tight text-slate-900 uppercase">
                  Forecasting <span className="text-indigo-600">Center</span>
                </h1>
                <div className="flex items-center gap-2 mt-1">
                  <div className="h-1 w-8 bg-indigo-600 rounded-full" />
                  <p className="text-slate-500 text-sm font-bold uppercase tracking-widest">WFM Intelligence Hub</p>
                </div>
              </div>
            </div>
            <p className="text-slate-500 text-base mt-4 max-w-2xl leading-relaxed font-medium">
              Manage historical interaction data, generate <span className="text-indigo-600 font-bold">AI-powered</span> volume predictions, and configure specific operational rules to optimize your workforce efficiency.
            </p>
          </div>
        </div>
      </div>

      <Tabs defaultValue="engine" className="w-full">
        <div className="flex items-center mb-8">
          <TabsList className="flex flex-wrap h-auto gap-2 p-1.5 bg-slate-100/50 border border-slate-200 rounded-xl w-full md:w-auto shadow-sm">
            <TabsTrigger 
              value="engine" 
              className="gap-2 px-6 py-2.5 rounded-lg data-[state=active]:bg-white data-[state=active]:text-indigo-600 data-[state=active]:shadow-md transition-all text-xs font-black uppercase tracking-widest border border-transparent data-[state=active]:border-indigo-100 group"
            >
              <Sparkles className="w-4 h-4 text-slate-400 group-data-[state=active]:text-indigo-600" />
              Predictive Engine
            </TabsTrigger>
            <TabsTrigger 
              value="volume" 
              className="gap-2 px-6 py-2.5 rounded-lg data-[state=active]:bg-white data-[state=active]:text-amber-600 data-[state=active]:shadow-md transition-all text-xs font-black uppercase tracking-widest border border-transparent data-[state=active]:border-amber-100 group"
            >
              <BarChart3 className="w-4 h-4 text-slate-400 group-data-[state=active]:text-amber-600" />
              Forecast Results
            </TabsTrigger>
            <TabsTrigger 
              value="windows" 
              className="gap-2 px-6 py-2.5 rounded-lg data-[state=active]:bg-white data-[state=active]:text-emerald-600 data-[state=active]:shadow-md transition-all text-xs font-black uppercase tracking-widest border border-transparent data-[state=active]:border-emerald-100 group"
            >
              <Clock className="w-4 h-4 text-slate-400 group-data-[state=active]:text-emerald-600" />
              Operating Hours
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="engine" className="mt-0 border-none p-0 outline-none animate-in fade-in slide-in-from-bottom-4 duration-500">
          <PredictiveVolume {...props} />
        </TabsContent>

        <TabsContent value="volume" className="mt-0 border-none p-0 outline-none animate-in fade-in slide-in-from-bottom-4 duration-500">
          <ForecastVolume {...props} />
        </TabsContent>

        <TabsContent value="windows" className="mt-0 border-none p-0 outline-none animate-in fade-in slide-in-from-bottom-4 duration-500">
          <OperationalWindowSettings 
            isAdmin={isAdmin} 
            windows={props.erlangSettings?.operationalWindows}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
