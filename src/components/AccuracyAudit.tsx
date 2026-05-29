import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LineChart, Line, AreaChart, Area, Cell } from 'recharts';
import { History as HistoryIcon, TrendingUp, BarChart3, AlertCircle, Calendar, Target, CheckCircle2 } from 'lucide-react';
import { ForecastingEngine } from '../lib/forecasting-engine';

interface AccuracyAuditProps {
  historicalVolume: any[];
}

export default function AccuracyAudit({ historicalVolume = [] }: AccuracyAuditProps) {
  const history = useMemo(() => {
    return [...historicalVolume].sort((a, b) => a.date.localeCompare(b.date));
  }, [historicalVolume]);

  const auditData = useMemo(() => {
    if (history.length < 14) return null;

    const allIntervals = Object.keys(history[0]?.intervals || {}).sort();
    
    // Interval MAPE Analysis
    const intervalMAPEs = allIntervals.map(int => {
      const values = history.map(h => h.intervals[int] || 0);
      // We'll compare historical against a simple 7-day moving average as a "Forecast Target"
      const forecastBaseline = values.map((_, i) => {
        if (i < 7) return values[i];
        const prev7 = values.slice(i - 7, i);
        return prev7.reduce((a, b) => a + b, 0) / 7;
      });

      const mape = ForecastingEngine.calculateMAPE(values.slice(7), forecastBaseline.slice(7));
      return { interval: int, mape };
    });

    // Weekday vs Weekend Analysis
    const weekdayHistory = history.filter(h => !['Sat', 'Sun'].includes(h.day));
    const weekendHistory = history.filter(h => ['Sat', 'Sun'].includes(h.day));

    const getDailyAvg = (data: any[]) => data.reduce((a, b) => a + b.totalVolume, 0) / (data.length || 1);
    
    const dailyAccuracy = {
      overall: getDailyAvg(history),
      weekday: getDailyAvg(weekdayHistory),
      weekend: getDailyAvg(weekendHistory)
    };

    // Decomposition for high-level trend
    const decomp = ForecastingEngine.decompose(history.map(h => ({ date: h.date, value: h.totalVolume })), 7);

    const decompChart = history.slice(decomp?.trend.findIndex(t => t !== null) || 0).map((h, i) => {
      const idx = i + (decomp?.trend.findIndex(t => t !== null) || 0);
      return {
        date: h.date,
        actual: h.totalVolume,
        trend: decomp?.trend[idx],
        residual: decomp?.residual[idx]
      };
    });

    return { 
      intervalMAPEs, 
      dailyAccuracy, 
      decompChart, 
      seasonality: decomp?.seasonality || [],
      allIntervals 
    };
  }, [history]);

  if (!auditData) {
    return (
      <Card className="border-none shadow-sm bg-white">
        <CardContent className="p-12 flex flex-col items-center text-center space-y-4">
          <HistoryIcon className="w-12 h-12 text-slate-200" />
          <h2 className="text-xl font-bold text-slate-900">Need More Data</h2>
          <p className="text-slate-500 max-w-sm">Please upload at least 14 days of historical data to run the accuracy audit and time series decomposition.</p>
        </CardContent>
      </Card>
    );
  }

  const avgMAPE = auditData.intervalMAPEs.reduce((a, b) => a + b.mape, 0) / auditData.intervalMAPEs.length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-none shadow-sm bg-white border border-slate-100">
          <CardHeader className="p-4 flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-500">Overall Interval MAPE</CardTitle>
            <Target className="w-4 h-4 text-indigo-500" />
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="flex flex-col">
              <span className={`text-2xl font-bold ${avgMAPE < 15 ? 'text-emerald-600' : avgMAPE < 25 ? 'text-amber-600' : 'text-rose-600'}`}>
                {avgMAPE.toFixed(1)}%
              </span>
              <p className="text-[10px] text-slate-400 mt-1">Weighted Mean Absolute Percentage Error across all intervals.</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm bg-white border border-slate-100">
          <CardHeader className="p-4 flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-500">Stability Segment</CardTitle>
            <Calendar className="w-4 h-4 text-blue-500" />
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Weekday Avg</span>
                <span className="text-lg font-bold text-slate-700">{Math.round(auditData.dailyAccuracy.weekday).toLocaleString()}</span>
              </div>
              <div className="flex flex-col border-l border-slate-100 pl-4">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Weekend Avg</span>
                <span className="text-lg font-bold text-slate-700">{Math.round(auditData.dailyAccuracy.weekend).toLocaleString()}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm bg-white border border-slate-100">
          <CardHeader className="p-4 flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-slate-500">Confidence Score</CardTitle>
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          </CardHeader>
          <CardContent className="p-4 pt-0">
             <div className="flex flex-col">
              <span className="text-2xl font-bold text-slate-700">
                {avgMAPE < 10 ? 'Elite' : avgMAPE < 20 ? 'High' : avgMAPE < 35 ? 'Moderate' : 'Unstable'}
              </span>
              <p className="text-[10px] text-slate-400 mt-1">Based on historical deviation from seasonal patterns.</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-none shadow-sm bg-white">
          <CardHeader className="bg-slate-50/50 border-b border-slate-100">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-indigo-500" />
              MAPE per Interval
            </CardTitle>
            <CardDescription className="text-xs">Identifikasi jam-jam dengan volatilitas tinggi atau forecast error besar.</CardDescription>
          </CardHeader>
          <CardContent className="p-4">
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={auditData.intervalMAPEs}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis 
                    dataKey="interval" 
                    fontSize={9} 
                    tickFormatter={(val) => val.split(' - ')[0]} 
                  />
                  <YAxis fontSize={10} unit="%" />
                  <Tooltip 
                    contentStyle={{ fontSize: '10px' }}
                    labelStyle={{ fontWeight: 'bold' }}
                  />
                  <Bar dataKey="mape" name="MAPE %" fill="#6366f1" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm bg-white">
          <CardHeader className="bg-slate-50/50 border-b border-slate-100">
            <CardTitle className="text-sm flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-500" />
              Time Series Decomposition (Daily Trend)
            </CardTitle>
            <CardDescription className="text-xs">Memisahkan Tren jangka panjang dari fluktuasi harian.</CardDescription>
          </CardHeader>
          <CardContent className="p-4">
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={auditData.decompChart}>
                  <defs>
                    <linearGradient id="colorTrend" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#8884d8" stopOpacity={0.1}/>
                      <stop offset="95%" stopColor="#8884d8" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" fontSize={9} hide />
                  <YAxis fontSize={10} />
                  <Tooltip contentStyle={{ fontSize: '10px' }} />
                  <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '10px' }} />
                  <Area type="monotone" dataKey="trend" name="Calculated Trend" stroke="#8884d8" fillOpacity={1} fill="url(#colorTrend)" />
                  <Line type="monotone" dataKey="actual" name="Actual Volume" stroke="#cbd5e1" dot={false} strokeWidth={1} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm bg-white">
          <CardHeader className="bg-slate-50/50 border-b border-slate-100">
            <CardTitle className="text-sm flex items-center gap-2">
              <HistoryIcon className="w-4 h-4 text-amber-500" />
              Seasonal Indices (Weekly Pattern)
            </CardTitle>
            <CardDescription className="text-xs">Relative impact of each day of the week based on decomposition.</CardDescription>
          </CardHeader>
          <CardContent className="p-4">
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={auditData.seasonality.map((val, i) => ({ day: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i], value: Math.round(val) }))}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="day" fontSize={10} />
                  <YAxis fontSize={10} label={{ value: 'Dev from Trend', angle: -90, position: 'insideLeft', fontSize: 10 }} />
                  <Tooltip contentStyle={{ fontSize: '10px' }} />
                  <Bar dataKey="value" name="Deviation" radius={[4, 4, 0, 0]}>
                    {auditData.seasonality.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry >= 0 ? "#10b981" : "#f43f5e"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm bg-white">
          <CardHeader className="bg-slate-50/50 border-b border-slate-100">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-indigo-500" />
              Accuracy Recommendations
            </CardTitle>
            <CardDescription className="text-xs">AI suggestions to improve forecast and rostering.</CardDescription>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <div className="space-y-4">
              {avgMAPE > 20 && (
                <div className="flex gap-3 p-3 rounded-xl bg-orange-50 border border-orange-100">
                   <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
                      <AlertCircle className="w-4 h-4 text-orange-600" />
                   </div>
                   <div className="space-y-1">
                      <p className="text-xs font-bold text-orange-800 uppercase tracking-tight">High Volatility Detected</p>
                      <p className="text-[10px] text-orange-700 leading-relaxed">
                        MAPE interval Anda di atas 20%. Pertimbangkan untuk menggunakan <strong>Exponential Smoothing</strong> dengan Alpha tinggi ({" > "}0.5) untuk menangkap perubahan mendadak.
                      </p>
                   </div>
                </div>
              )}
              
              {Math.abs(auditData.dailyAccuracy.weekday - auditData.dailyAccuracy.weekend) > (auditData.dailyAccuracy.overall * 0.2) && (
                <div className="flex gap-3 p-3 rounded-xl bg-indigo-50 border border-indigo-100">
                   <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center shrink-0">
                      <Calendar className="w-4 h-4 text-indigo-600" />
                   </div>
                   <div className="space-y-1">
                      <p className="text-xs font-bold text-indigo-800 uppercase tracking-tight">Strong Weekend Variance</p>
                      <p className="text-[10px] text-indigo-700 leading-relaxed">
                        Ada perbedaan signifikan ({" > "}20%) antara Weekday dan Weekend. Roster harus memiliki alokasi headcount yang berbeda drastis di akhir pekan.
                      </p>
                   </div>
                </div>
              )}

              <div className="flex gap-3 p-3 rounded-xl bg-emerald-50 border border-emerald-100">
                 <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                 </div>
                 <div className="space-y-1">
                    <p className="text-xs font-bold text-emerald-800 uppercase tracking-tight">Strategy Suggestion</p>
                    <p className="text-[10px] text-emerald-700 leading-relaxed">
                      Lakukan forecast per interval menggunakan bobot mingguan. Jika MAPE jam tertentu (misal: 12:00) selalu tinggi, tambahkan buffer agents khusus di jam tersebut (Shrinkage manual).
                    </p>
                 </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
