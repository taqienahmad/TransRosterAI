import React, { useState, useEffect } from 'react';
import { db, collection, onSnapshot, query, orderBy, OperationType, handleFirestoreError } from '../lib/firebase';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer, 
  AreaChart, 
  Area,
  BarChart,
  Bar
} from 'recharts';
import { format, subDays, startOfDay, endOfDay, parseISO, isWithinInterval } from 'date-fns';
import { BarChart3, TrendingUp, Calendar, Info } from 'lucide-react';

interface HistoricalVolume {
  date: string;
  day: string;
  totalVolume: number;
  intervals: Record<string, number>;
}

export default function HistoryDashboard() {
  const [history, setHistory] = useState<HistoricalVolume[]>([]);
  const [timeRange, setTimeRange] = useState('30'); // days
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, 'historicalVolume'), orderBy('date', 'asc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => doc.data() as HistoricalVolume);
      setHistory(data);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'historicalVolume');
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const filteredData = history.filter(h => {
    const date = parseISO(h.date);
    const rangeDate = subDays(new Date(), parseInt(timeRange));
    return date >= rangeDate;
  });

  const avgVolume = filteredData.length > 0 
    ? Math.round(filteredData.reduce((sum, h) => sum + h.totalVolume, 0) / filteredData.length)
    : 0;

  const maxVolume = filteredData.length > 0
    ? Math.max(...filteredData.map(h => h.totalVolume))
    : 0;

  // Day of week distribution
  const dayDistribution = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => {
    const dayData = filteredData.filter(h => h.day.startsWith(day));
    const avg = dayData.length > 0 
      ? Math.round(dayData.reduce((sum, h) => sum + h.totalVolume, 0) / dayData.length)
      : 0;
    return { name: day, volume: avg };
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Historical Trends</h2>
          <p className="text-slate-500 text-sm">Analyze patterns and volume distributions from the past {timeRange} days.</p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-[180px] bg-white border-slate-200">
              <Calendar className="w-4 h-4 mr-2 text-slate-400" />
              <SelectValue placeholder="Time Range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 Days</SelectItem>
              <SelectItem value="14">Last 14 Days</SelectItem>
              <SelectItem value="30">Last 30 Days</SelectItem>
              <SelectItem value="90">Last 90 Days</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-white border-none shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-bold uppercase tracking-wider text-slate-400">Total Avg Volume</CardDescription>
            <CardTitle className="text-3xl font-bold text-slate-900">{avgVolume.toLocaleString()}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-slate-500">Average interactions per day in selected range.</p>
          </CardContent>
        </Card>
        <Card className="bg-white border-none shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-bold uppercase tracking-wider text-slate-400">Peak Volume</CardDescription>
            <CardTitle className="text-3xl font-bold text-indigo-600">{maxVolume.toLocaleString()}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-slate-500">Highest daily interaction count detected.</p>
          </CardContent>
        </Card>
        <Card className="bg-white border-none shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription className="text-xs font-bold uppercase tracking-wider text-slate-400">Data Points</CardDescription>
            <CardTitle className="text-3xl font-bold text-slate-900">{filteredData.length}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-slate-500">Days of historical data analyzed.</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="border-none shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-indigo-600" />
              <CardTitle className="text-lg">Volume Over Time</CardTitle>
            </div>
            <CardDescription>Daily interaction totals across the selected period.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={filteredData}>
                  <defs>
                    <linearGradient id="colorVol" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.1}/>
                      <stop offset="95%" stopColor="#4f46e5" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="date" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 10, fill: '#64748b' }}
                    tickFormatter={(val) => format(parseISO(val), 'MMM d')}
                  />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                  />
                  <Area type="monotone" dataKey="totalVolume" stroke="#4f46e5" fillOpacity={1} fill="url(#colorVol)" strokeWidth={2} name="Total Volume" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-sm">
          <CardHeader>
            <div className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-indigo-600" />
              <CardTitle className="text-lg">Weekly Distribution</CardTitle>
            </div>
            <CardDescription>Average volume per day of the week.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={dayDistribution}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="name" 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 10, fill: '#64748b' }}
                  />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#64748b' }} />
                  <Tooltip 
                    cursor={{ fill: '#f8fafc' }}
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                  />
                  <Bar dataKey="volume" fill="#4f46e5" radius={[4, 4, 0, 0]} name="Avg Volume" barSize={40} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {filteredData.length === 0 && !loading && (
        <Card className="bg-amber-50 border-amber-100 border p-8 text-center flex flex-col items-center gap-3">
          <Info className="w-12 h-12 text-amber-500 opacity-50" />
          <div className="space-y-1">
            <h3 className="font-bold text-amber-900">No Historical Data Found</h3>
            <p className="text-amber-700 text-sm max-w-md">Please upload historical volume data through the Forecasting Engine to see trends here.</p>
          </div>
        </Card>
      )}
    </div>
  );
}
