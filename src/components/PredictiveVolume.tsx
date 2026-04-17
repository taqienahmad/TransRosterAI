import React, { useState, useEffect } from 'react';
import { db, collection, onSnapshot, query, setDoc, doc, deleteDoc, OperationType, handleFirestoreError } from '../lib/firebase';
import { GoogleGenAI, Type } from "@google/genai";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Upload, Download, Trash2, Calendar, BarChart3, TrendingUp, Sparkles, Loader2, ArrowRight, History } from 'lucide-react';
import { toast } from 'sonner';
import { format, addMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, parse } from 'date-fns';

interface HistoricalVolume {
  date: string;
  day: string;
  totalVolume: number;
  intervals: Record<string, number>;
}

export default function PredictiveVolume({ isAdmin }: { isAdmin: boolean }) {
  const [history, setHistory] = useState<HistoricalVolume[]>([]);
  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [targetMonth, setTargetMonth] = useState(format(addMonths(new Date(), 1), 'yyyy-MM'));

  useEffect(() => {
    const q = query(collection(db, 'historicalVolume'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(doc => doc.data() as HistoricalVolume);
      setHistory(list.sort((a, b) => a.date.localeCompare(b.date)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'historicalVolume');
    });
    return () => unsubscribe();
  }, []);

  const downloadTemplate = () => {
    const csvContent = "sep=;\nDates;01/01/2026;02/01/2026;03/01/2026\nDays;Thu;Fri;Sat\nTotal Volume;1200;1350;900\n08:00 - 09:00;100;110;80\n09:00 - 10:00;150;160;100\n10:00 - 11:00;200;210;120";
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'historical_volume_template.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !isAdmin) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        let text = event.target?.result as string;
        text = text.replace(/^\ufeff/, '');
        let lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
        
        if (lines[0].startsWith('sep=')) lines = lines.slice(1);

        const firstLine = lines[0];
        const counts = { ',': (firstLine.match(/,/g) || []).length, ';': (firstLine.match(/;/g) || []).length, '\t': (firstLine.match(/\t/g) || []).length };
        const separator = (Object.keys(counts) as Array<keyof typeof counts>).reduce((a, b) => counts[a] > counts[b] ? a : b);
        
        const dataMatrix = lines.map(line => line.split(separator).map(v => v.trim()));
        const datesIdx = dataMatrix.findIndex(row => row[0]?.toLowerCase().includes('date'));
        const daysIdx = dataMatrix.findIndex(row => row[0]?.toLowerCase().includes('day'));
        const totalVolumeIdx = dataMatrix.findIndex(row => row[0]?.toLowerCase().includes('volume'));

        if (datesIdx === -1 || totalVolumeIdx === -1) {
          toast.error('Invalid format. Missing "Dates" or "Total Volume" rows.');
          return;
        }

        const datesRow = dataMatrix[datesIdx];
        const daysRow = daysIdx !== -1 ? dataMatrix[daysIdx] : [];
        const totalVolumeRow = dataMatrix[totalVolumeIdx];
        const intervalRows = dataMatrix.filter((_, idx) => idx !== datesIdx && idx !== daysIdx && idx !== totalVolumeIdx);

        const parseNumber = (val: string): number => {
          let s = (val || '0').trim().replace(/\s/g, '').replace(/,/g, '');
          return parseFloat(s) || 0;
        };

        let successCount = 0;
        for (let col = 1; col < datesRow.length; col++) {
          const rawDate = datesRow[col];
          if (!rawDate) continue;

          let dateStr = '';
          const parts = rawDate.split(/[\/\-]/);
          if (parts.length === 3) {
            dateStr = parts[2].length === 4 ? `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}` : `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
          }

          if (!dateStr) continue;

          const intervals: Record<string, number> = {};
          intervalRows.forEach(row => { if (row[0]) intervals[row[0]] = parseNumber(row[col]); });

          await setDoc(doc(db, 'historicalVolume', dateStr), {
            date: dateStr,
            day: daysRow[col] || format(parse(dateStr, 'yyyy-MM-dd', new Date()), 'EEE'),
            totalVolume: parseNumber(totalVolumeRow[col]),
            intervals
          });
          successCount++;
        }

        toast.success(`Uploaded ${successCount} historical data points`);
      } catch (err) {
        toast.error('Failed to process historical CSV');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const generatePrediction = async () => {
    if (history.length < 14) {
      toast.error('Please upload at least 2 weeks of historical data for meaningful prediction.');
      return;
    }

    setIsGenerating(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      // Prepare training data for AI - summarizing to keep prompt size manageable
      // Usually we'd send all intervals, but first let's try daily totals and average interval patterns
      const historySummary = history.map(h => ({
        d: h.date,
        v: h.totalVolume,
        day: h.day
      }));

      // Calculate an average interval distribution pattern from history
      const intervalSum: Record<string, number> = {};
      const intervalCount: Record<string, number> = {};
      history.forEach(h => {
        Object.entries(h.intervals).forEach(([time, val]) => {
          const v = val as number;
          intervalSum[time] = (intervalSum[time] || 0) + v;
          intervalCount[time] = (intervalCount[time] || 0) + 1;
        });
      });

      const avgIntervalDistribution: Record<string, number> = {};
      Object.keys(intervalSum).forEach(time => {
        avgIntervalDistribution[time] = intervalSum[time] / intervalCount[time];
      });

      const targetStartDate = startOfMonth(parse(targetMonth, 'yyyy-MM', new Date()));
      const targetEndDate = endOfMonth(targetStartDate);
      const daysToForecast = eachDayOfInterval({ start: targetStartDate, end: targetEndDate });

      const prompt = `
        You are an expert workforce forecaster. 
        I am giving you historical contact volume data for the last 3 months.
        Detect:
        1. Growth/Decline Trends (Month-over-month).
        2. Day-of-week seasonality (e.g. are Mondays busier?).
        3. Recurring patterns.

        HISTORY (JSON): ${JSON.stringify(historySummary.slice(-60))} 
        
        GENERATE PREDICTION:
        For every day from ${format(targetStartDate, 'yyyy-MM-dd')} to ${format(targetEndDate, 'yyyy-MM-dd')}.
        Return a JSON object where keys are dates (YYYY-MM-DD) and values are predicted TOTAL volumes for that day.
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            description: "Map of date strings to total volume numbers",
            properties: {} // Dynamic keys
          }
        }
      });

      const predictions = JSON.parse(response.text);
      
      let savedCount = 0;
      for (const [dateStr, totalVol] of Object.entries(predictions)) {
        const dateObj = parse(dateStr, 'yyyy-MM-dd', new Date());
        const dayName = format(dateObj, 'EEE');
        
        // Distribute total predicted volume into intervals using historical avg distribution
        const dailyTotal = totalVol as number;
        const distSum = Object.values(avgIntervalDistribution).reduce((a, b) => a + b, 0);
        const intervals: Record<string, number> = {};
        
        Object.entries(avgIntervalDistribution).forEach(([time, avgVal]) => {
          intervals[time] = Math.round((avgVal / distSum) * dailyTotal);
        });

        await setDoc(doc(db, 'forecastVolume', dateStr), {
          date: dateStr,
          day: dayName,
          totalVolume: dailyTotal,
          intervals
        });
        savedCount++;
      }

      toast.success(`Prediction generated for ${savedCount} days in ${targetMonth}`);
    } catch (err) {
      console.error(err);
      toast.error('Prediction failed. Ensure history data is clean.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleClearHistory = async () => {
    try {
      const promises = history.map(h => deleteDoc(doc(db, 'historicalVolume', h.date)));
      await Promise.all(promises);
      toast.success('Historical data cleared');
      setIsClearDialogOpen(false);
    } catch (err) {
      toast.error('Failed to clear history');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-3">
            <Sparkles className="w-8 h-8 text-indigo-600" />
            Predictive AI Forecasting
          </h1>
          <p className="text-slate-500">Generate future volume forecasts based on historical 3-month trends.</p>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2">
             <Dialog open={isClearDialogOpen} onOpenChange={setIsClearDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="text-rose-600 border-rose-100 hover:bg-rose-50" disabled={history.length === 0}>
                  <Trash2 className="w-4 h-4 mr-2" /> Clear History
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Clear all history?</DialogTitle></DialogHeader>
                <p className="py-4 text-sm text-slate-500">This will remove all 3 months of historical data points.</p>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsClearDialogOpen(false)}>Cancel</Button>
                  <Button variant="destructive" onClick={handleClearHistory}>Confirm Delete</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Button variant="outline" onClick={downloadTemplate} className="gap-2">
              <Download className="w-4 h-4" /> Template
            </Button>
            
            <label className="cursor-pointer">
              <Input type="file" accept=".csv" className="hidden" onChange={handleFileUpload} />
              <div className="flex items-center gap-2 px-4 py-2 rounded-md bg-slate-900 text-white hover:bg-slate-800 text-sm font-medium transition-colors">
                <History className="w-4 h-4" /> Upload 3-Month History
              </div>
            </label>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 border-none shadow-sm overflow-hidden bg-white">
          <CardHeader className="bg-slate-50/50 border-b border-slate-100">
            <CardTitle className="text-lg flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-indigo-500" />
              Historical Data Preview
            </CardTitle>
            <CardDescription>Review the base data used for AI training.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[500px] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-white shadow-sm">
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Day</TableHead>
                    <TableHead className="text-right">Volume</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.length > 0 ? (
                    history.slice(-15).reverse().map(h => (
                      <TableRow key={h.date}>
                        <TableCell className="font-mono text-xs">{h.date}</TableCell>
                        <TableCell className="text-xs text-slate-500">{h.day}</TableCell>
                        <TableCell className="text-right font-bold">{h.totalVolume.toLocaleString()}</TableCell>
                      </TableRow>
                    ))
                  ) : (
                    <TableRow><TableCell colSpan={3} className="h-64 text-center text-slate-400">No historical data. Upload last 3 months to begin.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
            {history.length > 15 && (
              <div className="p-3 text-center bg-slate-50 text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                Showing most recent 15 of {history.length} days
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border-none shadow-md bg-gradient-to-br from-indigo-600 to-violet-700 text-white">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-indigo-200" />
                Generate Forecast
              </CardTitle>
              <CardDescription className="text-indigo-100/70">Project your volume for the next operating period.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-indigo-200">Target Month</label>
                <Input 
                  type="month" 
                  value={targetMonth} 
                  onChange={e => setTargetMonth(e.target.value)}
                  className="bg-white/10 border-white/20 text-white placeholder:text-white/50 focus:ring-white/30"
                />
              </div>

              <div className="p-4 bg-white/10 rounded-xl border border-white/10 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span>History Status</span>
                  <span className={history.length >= 60 ? 'text-emerald-300' : 'text-amber-300'}>
                    {history.length} / 90 days
                  </span>
                </div>
                <div className="w-full bg-white/10 rounded-full h-1.5 overflow-hidden">
                  <div className="bg-indigo-300 h-full" style={{ width: `${Math.min(100, (history.length / 90) * 100)}%` }} />
                </div>
                <p className="text-[10px] text-indigo-100/60 leading-relaxed italic">
                  *AI forecasting is most accurate with at least 60-90 days of continuous record.
                </p>
              </div>

              <Button 
                onClick={generatePrediction} 
                disabled={isGenerating || history.length < 14}
                className="w-full h-12 bg-white text-indigo-600 hover:bg-slate-50 font-bold shadow-lg"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    AI Analyzing Trends...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5 mr-2" />
                    Generate AI Prediction
                  </>
                )}
              </Button>

              {history.length < 14 && (
                <p className="text-xs text-rose-300 text-center flex items-center justify-center gap-1">
                  Upload more data to unlock AI features
                </p>
              )}
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Summary Metrics</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <span className="text-xs text-slate-500">Data Span</span>
                <span className="text-sm font-bold">
                  {history.length > 0 ? `${format(parse(history[0].date, 'yyyy-MM-dd', new Date()), 'MMM yy')} - ${format(parse(history[history.length - 1].date, 'yyyy-MM-dd', new Date()), 'MMM yy')}` : 'N/A'}
                </span>
              </div>
              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <span className="text-xs text-slate-500">Peak Identified</span>
                <span className="text-sm font-bold text-indigo-600">
                  {history.length > 0 ? Math.max(...history.map(h => h.totalVolume)).toLocaleString() : '0'}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
