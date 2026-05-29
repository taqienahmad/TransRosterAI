import React, { useState, useEffect } from 'react';
import { db, collection, onSnapshot, query, setDoc, doc, deleteDoc, OperationType, handleFirestoreError, writeBatch } from '../lib/firebase';
import { GoogleGenAI, Type } from "@google/genai";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Upload, Download, Trash2, Calendar, BarChart3, TrendingUp, Sparkles, Loader2, ArrowRight, History, Calculator, Settings2, Info, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { format, addMonths, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, parse, differenceInDays, subMonths } from 'date-fns';
import { ForecastingEngine, ForecastMethod, ForecastMode, EventAdjustment, ForecastResult, HistoricalData } from '../lib/forecasting-engine';
import { WfmConfigEngine, WfmConfigOutput, WfmPreset, ServiceType } from '../lib/wfm-config-engine';

interface HistoricalVolume {
  date: string;
  day: string;
  totalVolume: number;
  intervals: Record<string, number>;
}

interface ForecastVolume {
  date: string;
  day: string;
  totalVolume: number; // Final volume
  baselineVolume: number;
  eventApplied?: EventAdjustment | null;
  intervals: Record<string, number>;
  metadata?: {
    methodUsed: string;
    modeUsed: string;
    eventImpact?: number;
  };
}

const DEFAULT_INTERVAL_DISTRIBUTION: Record<string, number> = {
  "00:00 - 01:00": 0.02, "01:00 - 02:00": 0.015, "02:00 - 03:00": 0.01, "03:00 - 04:00": 0.01,
  "04:00 - 05:00": 0.012, "05:00 - 06:00": 0.015, "06:00 - 07:00": 0.025, "07:00 - 08:00": 0.04,
  "08:00 - 09:00": 0.06, "09:00 - 10:00": 0.07, "10:00 - 11:00": 0.08, "11:00 - 12:00": 0.075,
  "12:00 - 13:00": 0.065, "13:00 - 14:00": 0.07, "14:00 - 15:00": 0.075, "15:00 - 16:00": 0.07,
  "16:00 - 17:00": 0.06, "17:00 - 18:00": 0.05, "18:00 - 19:00": 0.045, "19:00 - 20:00": 0.04,
  "20:00 - 21:00": 0.035, "21:00 - 22:00": 0.03, "22:00 - 23:00": 0.025, "23:00 - 00:00": 0.02
};

export default function PredictiveVolume(props: any) {
  const { isAdmin, historicalVolume, forecastEvents } = props;
  const [history, setHistory] = useState<HistoricalVolume[]>(historicalVolume || []);
  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDetectingEvents, setIsDetectingEvents] = useState(false);
  const [targetMonth, setTargetMonth] = useState(format(addMonths(new Date(), 1), 'yyyy-MM'));
  const [forecastMode, setForecastMode] = useState<ForecastMode>('hybrid');
  const [serviceType, setServiceType] = useState<ServiceType>('generic');
  const [method, setMethod] = useState<ForecastMethod | 'ai'>('holt-winters');
  const [maPeriod, setMaPeriod] = useState(14);
  const [alpha, setAlpha] = useState(0.3);
  const [beta, setBeta] = useState(0.1);
  const [gamma, setGamma] = useState(0.2);
  const [wfmPreset, setWfmPreset] = useState<WfmPreset>('Balanced');
  const [events, setEvents] = useState<EventAdjustment[]>(forecastEvents || []);
  const [analysis, setAnalysis] = useState<any>(null);
  const [configResult, setConfigResult] = useState<WfmConfigOutput | null>(null);
  const [accuracyMetrics, setAccuracyMetrics] = useState<any>(null);

  useEffect(() => {
    if (historicalVolume && historicalVolume.length > 30) {
      // Backtesting: Compare last 7 days actuals vs a naive/MA forecast if we had only up to last 14 days
      // For simplicity, let's just calculate MAPE on the whole set if we have enough data
      const actuals = history.map(h => h.totalVolume);
      // We can't easily backtest without complex logic, but we can calculate interval-level consistency
      
      const intervalMAPEs: Record<string, number> = {};
      const allIntervals = Object.keys(history[0]?.intervals || {});
      
      allIntervals.forEach(int => {
        const values = history.map(h => h.intervals[int] || 0);
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        const diffs = values.map(v => Math.abs(v - avg));
        const mape = (diffs.reduce((a, b) => a + b, 0) / (avg * values.length)) * 100;
        intervalMAPEs[int] = mape;
      });

      setAccuracyMetrics({
        avgMAPE: ForecastingEngine.calculateMAPE(actuals.slice(0, -7), actuals.slice(7)), // Simple lag check
        intervalMAPEs
      });
    }
  }, [history]);

  useEffect(() => {
    if (historicalVolume) {
      const sorted = [...historicalVolume].sort((a: any, b: any) => a.date.localeCompare(b.date));
      setHistory(sorted);
      if (sorted.length >= 14) {
        setAnalysis(ForecastingEngine.analyzeData(sorted.map((h: any) => ({ date: h.date, value: h.totalVolume }))));
      } else {
        setAnalysis(null);
        setConfigResult(null);
      }
    }
  }, [historicalVolume]);

  useEffect(() => {
    if (forecastEvents) {
      setEvents([...forecastEvents].sort((a: any, b: any) => a.date.localeCompare(b.date)));
    }
  }, [forecastEvents]);

  useEffect(() => {
    if (analysis) {
      const result = WfmConfigEngine.optimize(
        history.length,
        analysis.trend,
        analysis.seasonality,
        forecastMode,
        serviceType,
        events.length > 0
      );
      
      setConfigResult(result);

      if (forecastMode === 'auto') {
        setWfmPreset(result.recommended_preset);
      }
    }
  }, [analysis, forecastMode, serviceType, events.length, history.length]);

  useEffect(() => {
    const params = WfmConfigEngine.getPresetParameters(wfmPreset);
    setAlpha(params.alpha);
    setBeta(params.beta);
    setGamma(params.gamma);
    setMaPeriod(params.window_size);
  }, [wfmPreset]);

  useEffect(() => {
    // Redundant listeners removed - Using App level shared state
    /*
    const q = query(collection(db, 'historicalVolume'));
    const unsubscribeHistory = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(doc => doc.data() as HistoricalVolume);
      const sorted = list.sort((a, b) => a.date.localeCompare(b.date));
      setHistory(sorted);
      
      if (sorted.length >= 14) {
        setAnalysis(ForecastingEngine.analyzeData(sorted.map(h => ({ date: h.date, value: h.totalVolume }))));
      } else {
        setAnalysis(null);
        setConfigResult(null);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'historicalVolume');
    });

    const eq = query(collection(db, 'forecastEvents'));
    const unsubscribeEvents = onSnapshot(eq, (snapshot) => {
      const list = snapshot.docs.map(doc => doc.data() as EventAdjustment);
      setEvents(list.sort((a, b) => a.date.localeCompare(b.date)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'forecastEvents');
    });

    return () => {
      unsubscribeHistory();
      unsubscribeEvents();
    };
    */
  }, []);

  const downloadTemplate = () => {
    const csvContent = "sep=;\nDates;01/01/2026;02/01/2026;03/01/2026\nDays;Thu;Fri;Sat\nTotal Volume;1200;1350;900\n00:00 - 01:00;24;27;18\n01:00 - 02:00;18;20;14\n02:00 - 03:00;12;14;9\n03:00 - 04:00;12;14;9\n04:00 - 05:00;14;16;11\n05:00 - 06:00;18;20;14\n06:00 - 07:00;30;34;23\n07:00 - 08:00;48;54;36\n08:00 - 09:00;72;81;54\n09:00 - 10:00;84;95;63\n10:00 - 11:00;96;108;72\n11:00 - 12:00;90;101;68\n12:00 - 13:00;78;88;59\n13:00 - 14:00;84;95;63\n14:00 - 15:00;90;101;68\n15:00 - 16:00;84;95;63\n16:00 - 17:00;72;81;54\n17:00 - 18:00;60;68;45\n18:00 - 19:00;54;61;41\n19:00 - 20:00;48;54;36\n20:00 - 21:00;42;47;32\n21:00 - 22:00;36;41;27\n22:00 - 23:00;30;34;23\n23:00 - 00:00;24;27;18";
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
        const datesIdx = dataMatrix.findIndex(row => (row[0] || '').toString().toLowerCase().includes('date'));
        const daysIdx = dataMatrix.findIndex(row => (row[0] || '').toString().toLowerCase().includes('day'));
        const totalVolumeIdx = dataMatrix.findIndex(row => (row[0] || '').toString().toLowerCase().includes('volume'));

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
    if (history.length < 7) {
      toast.error('Please upload at least 1 week of historical data.');
      return;
    }

    setIsGenerating(true);
    try {
      const targetStartDate = startOfMonth(parse(targetMonth, 'yyyy-MM', new Date()));
      const targetEndDate = endOfMonth(targetStartDate);
      const daysToForecast = eachDayOfInterval({ start: targetStartDate, end: targetEndDate });

      // Helper for segmented interval distribution
      const getAvgDistribution = (filteredHistory: HistoricalVolume[]) => {
        const sum: Record<string, number> = {};
        const count: Record<string, number> = {};
        filteredHistory.forEach(h => {
          Object.entries(h.intervals).forEach(([time, val]) => {
            const v = Number(val) || 0;
            sum[time] = (sum[time] || 0) + v;
            count[time] = (count[time] || 0) + 1;
          });
        });
        const dist: Record<string, number> = {};
        Object.keys(sum).forEach(time => dist[time] = sum[time] / count[time]);
        const total = Object.values(dist).reduce((a, b) => a + b, 0);
        return { dist, total };
      };

      const weekdayHistory = history.filter(h => !['Sat', 'Sun'].includes(h.day));
      const weekendHistory = history.filter(h => ['Sat', 'Sun'].includes(h.day));
      const eventDates = events.map(e => e.date);
      const campaignHistory = history.filter(h => eventDates.includes(h.date));
      const paydayHistory = history.filter(h => {
        const d = new Date(h.date).getDate();
        return d >= 25 || d <= 2; // Payday window
      });
      const twinDateHistory = history.filter(h => {
        const d = new Date(h.date);
        return d.getDate() === d.getMonth() + 1;
      });
      
      const weekdayDist = getAvgDistribution(weekdayHistory);
      const weekendDist = getAvgDistribution(weekendHistory);
      const campaignDist = getAvgDistribution(campaignHistory);
      const paydayDist = getAvgDistribution(paydayHistory);
      const twinDateDist = getAvgDistribution(twinDateHistory);
      const globalDist = getAvgDistribution(history);

      const forecastResults: Record<string, ForecastResult> = {};

      if (method === 'ai') {
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
          throw new Error('API Key Gemini tidak ditemukan. Silakan hubungi dministrator.');
        }

        const ai = new GoogleGenAI({ apiKey });
        const historySummary = history.map(h => ({ d: h.date, v: h.totalVolume, day: h.day }));
        
        const prompt = `
          Anda adalah pakar perencanaan tenaga kerja (WFM). 
          Gunakan data historis berikut untuk mendeteksi tren dan musiman, lalu buat prediksi volume harian.
          
          HISTORY (JSON): ${JSON.stringify(historySummary.slice(-60))} 
          
          BUAT PREDIKSI:
          Untuk setiap hari dari ${format(targetStartDate, 'yyyy-MM-dd')} hingga ${format(targetEndDate, 'yyyy-MM-dd')}.
        `;

        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: { 
              type: Type.OBJECT, 
              properties: {
                predictions: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      date: { type: Type.STRING, description: "Tanggal dalam format YYYY-MM-DD" },
                      totalVolume: { type: Type.NUMBER, description: "Total prediksi volume interaksi" }
                    },
                    required: ["date", "totalVolume"]
                  }
                }
              },
              required: ["predictions"]
            }
          }
        });

        const data = JSON.parse(response.text);
        if (data.predictions && Array.isArray(data.predictions)) {
          data.predictions.forEach((p: any) => {
            forecastResults[p.date] = { 
              date: p.date,
              baseline: p.totalVolume, 
              finalForecast: p.totalVolume,
              methodUsed: 'holt-winters', // Placeholder for AI result metadata
              modeUsed: 'auto'
            };
          });
        }
      } else {
        // Deterministic engine logic
        const histData: HistoricalData[] = history.map(h => ({ date: h.date, value: h.totalVolume }));
        
        daysToForecast.forEach((dateObj) => {
          const dateStr = format(dateObj, 'yyyy-MM-dd');
          const result = ForecastingEngine.generateForecast(
            histData,
            dateStr,
            forecastMode,
            method as ForecastMethod,
            { alpha, beta, gamma, windowSize: maPeriod },
            events
          );
          forecastResults[dateStr] = result;
        });
      }

      let savedCount = 0;
      for (const [dateStr, res] of Object.entries(forecastResults)) {
        const dateObj = parse(dateStr, 'yyyy-MM-dd', new Date());
        const dayName = format(dateObj, 'EEE');
        const finalTotal = Math.max(0, Math.round(res.finalForecast));
        const intervals: Record<string, number> = {};
        
        const isWeekend = ['Sat', 'Sun'].includes(dayName);
        const dayOfMonth = dateObj.getDate();
        const isTwinDate = dayOfMonth === dateObj.getMonth() + 1;
        const isPayday = dayOfMonth >= 25 || dayOfMonth <= 2;
        const hasEvent = res.eventApplied !== null;
        
        let activeDist;
        if (hasEvent && campaignDist.total > 0) {
          activeDist = campaignDist;
        } else if (isTwinDate && twinDateDist.total > 0) {
          activeDist = twinDateDist;
        } else if (isPayday && paydayDist.total > 0) {
          activeDist = paydayDist;
        } else {
          activeDist = isWeekend ? weekendDist : weekdayDist;
        }

        const fallbackDist = globalDist.total > 0 ? globalDist : { dist: DEFAULT_INTERVAL_DISTRIBUTION, total: 1 };

        const useDist = activeDist.total > 0 ? activeDist : fallbackDist;

        Object.keys(useDist.dist).forEach((time) => {
          const avgVal = Number(useDist.dist[time]) || 0;
          const totalDist = Number(useDist.total) || 1;
          // Apply distribution ratio to final day total
          intervals[time] = Math.round((avgVal / totalDist) * finalTotal);
        });

        const forecastDoc: ForecastVolume = {
          date: dateStr,
          day: dayName,
          totalVolume: finalTotal,
          baselineVolume: res.baseline,
          eventApplied: res.eventApplied || null,
          intervals,
          metadata: {
            methodUsed: res.methodUsed,
            modeUsed: res.modeUsed,
            eventImpact: res.eventImpact ?? 0
          }
        };

        await setDoc(doc(db, 'forecastVolume', dateStr), forecastDoc);
        savedCount++;
      }

      toast.success(`Forecast generated for ${savedCount} days using ${forecastMode.toUpperCase()} mode.`);
    } catch (err) {
      console.error(err);
      toast.error('Forecasting failed. Please check your data.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleClearHistory = async () => {
    if (!isAdmin || history.length === 0) return;
    try {
      const batchSize = 500;
      const chunks = [];
      for (let i = 0; i < history.length; i += batchSize) {
        chunks.push(history.slice(i, i + batchSize));
      }

      for (const chunk of chunks) {
        const batch = writeBatch(db);
        chunk.forEach(h => {
          batch.delete(doc(db, 'historicalVolume', h.date));
        });
        await batch.commit();
      }

      toast.success('Historical data cleared');
      setIsClearDialogOpen(false);
    } catch (err) {
      console.error('Clear history error:', err);
      toast.error('Failed to clear history');
    }
  };

  const handleDetectEvents = async () => {
    if (history.length < 30) {
      toast.error('Gunakan setidaknya 30 hari data historis untuk mendeteksi dampak event.');
      return;
    }

    setIsDetectingEvents(true);
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error('API Key Gemini tidak ditemukan.');

      const ai = new GoogleGenAI({ apiKey });
      const recentHistory = history.slice(-90).map(h => ({ d: h.date, v: h.totalVolume }));
      
      const prompt = `
        Analisis anomali volume dari data historis berikut.
        Identifikasi lonjakan (spikes) atau penurunan (dips) yang tidak wajar.
        Kelompokkan pola berulang (misal: akhir bulan).
        Hitung dampak (%) dibandingkan volume normal di sekitarnya.
        
        DATA: ${JSON.stringify(recentHistory)}
        
        KEMBALIKAN: JSON array of objects dengan properti:
        - date (YYYY-MM-DD): Tanggal event masalalu.
        - type (payday, campaign, holiday, other).
        - impact (float, e.g. 0.45 untuk +45%).
        - description (Singkat, misal: "Lonjakan Gajian Akhir Bulan").
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                date: { type: Type.STRING },
                type: { type: Type.STRING, enum: ["payday", "campaign", "holiday", "other"] },
                impact: { type: Type.NUMBER },
                description: { type: Type.STRING }
              },
              required: ["date", "type", "impact"]
            }
          }
        }
      });

      const detected = JSON.parse(response.text);
      if (Array.isArray(detected)) {
        // We map detected past events to future dates for scheduling
        // For simplicity, let's just suggest them as insights for now or add them directly
        toast.success(`Ditemukan ${detected.length} anomali historis. AI menyarankan analisis dampak untuk perencanaan mendatang.`);
        console.log("Detected Anomalies:", detected);
      }
    } catch (err) {
      toast.error('Gagal mendeteksi anomali.');
    } finally {
      setIsDetectingEvents(false);
    }
  };

  const addEvent = async (event: any) => {
    try {
      await setDoc(doc(db, 'forecastEvents', event.date), event);
      toast.success('Event ditambahkan ke kalender.');
    } catch (err) {
      toast.error('Gagal menambah event.');
    }
  };

  const removeEvent = async (date: string) => {
    try {
      await deleteDoc(doc(db, 'forecastEvents', date));
      toast.success('Event dihapus.');
    } catch (err) {
      toast.error('Gagal menghapus event.');
    }
  };

  const handleServiceTypeChange = (newType: ServiceType) => {
    setServiceType(newType);
    
    // Automatically apply the industry's recommended settings
    const industryRule = WfmConfigEngine.INDUSTRY_RULES[newType];
    if (industryRule) {
      setWfmPreset(industryRule.preset);
      setForecastMode(industryRule.mode);
    }
  };

  const historicalSummary = React.useMemo(() => {
    if (history.length === 0) return null;

    // Monthly Trend
    const monthlyData: Record<string, number> = {};
    const monthlyCounts: Record<string, number> = {};
    
    // Weekly Distribution (Day of Week)
    const dowData: Record<string, number[]> = {
      'Mon': [], 'Tue': [], 'Wed': [], 'Thu': [], 'Fri': [], 'Sat': [], 'Sun': []
    };

    history.forEach(h => {
      const monthKey = format(parse(h.date, 'yyyy-MM-dd', new Date()), 'MMM yyyy');
      monthlyData[monthKey] = (monthlyData[monthKey] || 0) + h.totalVolume;
      monthlyCounts[monthKey] = (monthlyCounts[monthKey] || 0) + 1;

      const dayName = h.day || format(parse(h.date, 'yyyy-MM-dd', new Date()), 'EEE');
      if (dowData[dayName]) {
        dowData[dayName].push(h.totalVolume);
      }
    });

    const monthlyTrend = Object.entries(monthlyData).map(([month, total]) => ({
      month,
      total,
      avg: Math.round(total / monthlyCounts[month])
    }));

    const weeklyDist = Object.entries(dowData).map(([day, volumes]) => ({
      day,
      avg: volumes.length > 0 ? Math.round(volumes.reduce((a, b) => a + b, 0) / volumes.length) : 0
    }));

    const allVolumes = history.map(h => h.totalVolume);
    const dailyStats = {
      avg: Math.round(allVolumes.reduce((a, b) => a + b, 0) / allVolumes.length),
      max: Math.max(...allVolumes),
      min: Math.min(...allVolumes)
    };

    return { monthlyTrend, weeklyDist, dailyStats };
  }, [history]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-3">
            <Sparkles className="w-8 h-8 text-indigo-600" />
            Forecasting Engine
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

      {history.length === 0 ? (
        <Card className="border-none shadow-sm bg-white overflow-hidden">
          <CardContent className="p-12 flex flex-col items-center text-center space-y-6">
            <div className="w-24 h-24 bg-indigo-50 rounded-3xl flex items-center justify-center mb-4">
              <Sparkles className="w-12 h-12 text-indigo-500 animate-pulse" />
            </div>
            <div className="max-w-md space-y-2">
              <h2 className="text-2xl font-bold text-slate-900 border-none">Ready to Predict the Future?</h2>
              <p className="text-slate-500">
                To start generating AI-powered forecasts, we need historical data. 
                Upload at least <span className="font-bold text-slate-900">3 months</span> of your past volume data (CSV format) to train the engine.
              </p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-4xl pt-8">
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 flex flex-col items-center space-y-3">
                <div className="w-10 h-10 bg-white rounded-full shadow-sm flex items-center justify-center text-indigo-600 font-bold">1</div>
                <h3 className="font-bold text-sm">Download Template</h3>
                <p className="text-[11px] text-slate-400">Get the correct CSV structure for the engine.</p>
                <Button variant="ghost" size="sm" onClick={downloadTemplate} className="text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50">Download</Button>
              </div>
              
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 flex flex-col items-center space-y-3">
                <div className="w-10 h-10 bg-white rounded-full shadow-sm flex items-center justify-center text-indigo-600 font-bold">2</div>
                <h3 className="font-bold text-sm">Upload History</h3>
                <p className="text-[11px] text-slate-400">Fill the CSV with your data and upload it here.</p>
                <label className="cursor-pointer">
                  <Input type="file" accept=".csv" className="hidden" onChange={handleFileUpload} />
                  <div className="px-4 py-1.5 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 text-[11px] font-medium transition-colors">Select File</div>
                </label>
              </div>
              
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100 flex flex-col items-center space-y-3">
                <div className="w-10 h-10 bg-white rounded-full shadow-sm flex items-center justify-center text-emerald-600 font-bold">3</div>
                <h3 className="font-bold text-sm">AI Forecasting</h3>
                <p className="text-[11px] text-slate-400">Configure parameters and run the prediction.</p>
                <div className="px-4 py-1.5 rounded-md bg-slate-200 text-slate-400 cursor-not-allowed text-[11px] font-medium">Locked</div>
              </div>
            </div>

            <div className="flex items-center gap-6 pt-8 text-xs text-slate-400 font-medium">
              <div className="flex items-center gap-2"><TrendingUp className="w-4 h-4" /> Trend Analysis</div>
              <div className="flex items-center gap-2"><Calendar className="w-4 h-4" /> Seasonality</div>
              <div className="flex items-center gap-2"><Calculator className="w-4 h-4" /> Erlang Support</div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {historicalSummary && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card className="border-none shadow-sm bg-white border border-slate-100 overflow-hidden group">
                <CardHeader className="p-4 pb-2">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Monthly Trend</p>
              <CardTitle className="text-sm font-bold flex items-center justify-between">
                Total Volume
                <TrendingUp className="w-3 h-3 text-emerald-500" />
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="space-y-2">
                {historicalSummary.monthlyTrend.slice(-3).map((m, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">{m.month}</span>
                    <span className="font-bold text-slate-700">{m.total.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </CardContent>
            <div className="h-1 bg-emerald-500/20 group-hover:bg-emerald-500 transition-colors" />
          </Card>

          <Card className="border-none shadow-sm bg-white overflow-hidden group">
            <CardHeader className="p-4 pb-2">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Monthly Dist.</p>
              <CardTitle className="text-sm font-bold flex items-center justify-between">
                Daily Avg.
                <BarChart3 className="w-3 h-3 text-blue-500" />
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="space-y-2">
                {historicalSummary.monthlyTrend.slice(-3).map((m, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">{m.month}</span>
                    <span className="font-bold text-blue-600">{m.avg.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </CardContent>
            <div className="h-1 bg-blue-500/20 group-hover:bg-blue-500 transition-colors" />
          </Card>

          <Card className="border-none shadow-sm bg-white overflow-hidden group">
            <CardHeader className="p-4 pb-2">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Weekly Dist.</p>
              <CardTitle className="text-sm font-bold flex items-center justify-between">
                Avg by Day
                <Calendar className="w-3 h-3 text-amber-500" />
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="grid grid-cols-4 gap-1">
                {historicalSummary.weeklyDist.map((w, idx) => (
                  <div key={idx} className="flex flex-col items-center p-1 rounded bg-slate-50 scale-95 origin-center">
                    <span className="text-[8px] font-bold text-slate-400 uppercase">{w.day}</span>
                    <span className="text-[10px] font-bold text-slate-700">{w.avg.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </CardContent>
            <div className="h-1 bg-amber-500/20 group-hover:bg-amber-500 transition-colors" />
          </Card>

          <Card className="border-none shadow-sm bg-white overflow-hidden group">
            <CardHeader className="p-4 pb-2">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Daily Stats</p>
              <CardTitle className="text-sm font-bold flex items-center justify-between">
                Overall Analysis
                <History className="w-3 h-3 text-indigo-500" />
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-3">
              <div className="flex items-center justify-between bg-indigo-50 p-2 rounded-lg">
                <div className="flex flex-col">
                  <span className="text-[8px] font-bold text-indigo-400 uppercase">Average</span>
                  <span className="text-sm font-bold text-indigo-700">{historicalSummary.dailyStats.avg.toLocaleString()}</span>
                </div>
                <div className="flex flex-col text-right border-l border-indigo-100 pl-3">
                  <span className="text-[8px] font-bold text-indigo-400 uppercase">Max/Min</span>
                  <span className="text-[10px] font-bold text-indigo-600">
                    {historicalSummary.dailyStats.max.toLocaleString()} / {historicalSummary.dailyStats.min.toLocaleString()}
                  </span>
                </div>
              </div>
            </CardContent>
            <div className="h-1 bg-indigo-500/20 group-hover:bg-indigo-500 transition-colors" />
          </Card>
        </div>
      )}

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
                    [...history].reverse().map(h => (
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
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="border-none shadow-sm min-h-[500px] bg-white">
            <CardHeader className="pb-4 border-b border-slate-50">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <Settings2 className="w-5 h-5 text-indigo-500" />
                  <CardTitle className="text-lg">Forecasting Engine</CardTitle>
                </div>
                <div className="flex items-center gap-1 text-[10px] font-bold text-slate-400">
                  v2.4
                </div>
              </div>
              <CardDescription>Pilih mode dan parameter mesin peramalan.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                    <span>Service Type / Industry</span>
                    <Badge variant="secondary" className="text-[9px] h-4">Context Optimized</Badge>
                  </label>
                  <Select value={serviceType} onValueChange={handleServiceTypeChange}>
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Pilih Industri" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="generic">Generic / Default</SelectItem>
                      <SelectItem value="marketplace">E-Commerce Marketplace</SelectItem>
                      <SelectItem value="banking">Retail Banking</SelectItem>
                      <SelectItem value="fintech">Fintech / Payment</SelectItem>
                      <SelectItem value="telco">Telecommunication</SelectItem>
                      <SelectItem value="logistics">Logistics & Courier</SelectItem>
                      <SelectItem value="public_service">Public Service</SelectItem>
                    </SelectContent>
                  </Select>
                  {configResult?.industry_note && (
                    <div className="text-[10px] text-slate-500 bg-slate-50 p-2 rounded italic border-l-2 border-indigo-200">
                      {configResult.industry_note}
                    </div>
                  )}
                  {configResult?.event_config.enabled && (
                    <div className="p-2 rounded border border-indigo-100 bg-indigo-50/30 space-y-1">
                      <div className="text-[9px] font-bold text-indigo-700 uppercase flex items-center gap-1">
                        <Calendar className="w-2.5 h-2.5" />
                        Recommended Event Logic
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {configResult.event_config.types.map(t => (
                          <Badge key={t} variant="outline" className="text-[8px] h-3.5 bg-white border-indigo-200 text-indigo-600 uppercase">
                            {t}
                          </Badge>
                        ))}
                      </div>
                      <div className="text-[8px] text-indigo-500 font-medium italic">
                        Impact Pattern: {configResult.event_config.pattern.toUpperCase()}
                      </div>
                    </div>
                  )}
                </div>

                {configResult && (configResult.warnings.length > 0 || configResult.suggestions.length > 0) && (
                  <div className="space-y-2">
                    {configResult.warnings.map((warning, idx) => (
                      <div key={`w-${idx}`} className="flex items-start gap-2 p-2 rounded-lg bg-rose-50 border border-rose-100 text-[10px] text-rose-700 font-medium">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-rose-500" />
                        <span>{warning}</span>
                      </div>
                    ))}
                    {configResult.suggestions.map((suggestion, idx) => (
                      <div key={`s-${idx}`} className="flex items-start gap-2 p-2 rounded-lg bg-indigo-50 border border-indigo-100 text-[10px] text-indigo-700 font-medium">
                        <Sparkles className="w-3.5 h-3.5 shrink-0 text-indigo-500" />
                        <span>{suggestion}</span>
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-between">
                    <span>Forecast Mode</span>
                    <div className="flex items-center gap-2">
                      {configResult && configResult.recommended_mode !== forecastMode && (
                         <div className="flex items-center gap-1 text-[9px] text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100 italic">
                            Rec: {configResult.recommended_mode}
                         </div>
                      )}
                      <Badge variant="outline" className="text-[10px] uppercase font-bold text-indigo-600 bg-indigo-50 border-indigo-200">
                        {forecastMode}
                      </Badge>
                    </div>
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['single', 'hybrid', 'auto'] as ForecastMode[]).map((m) => (
                      <Button
                        key={m}
                        variant={forecastMode === m ? 'default' : 'outline'}
                        className={`text-[11px] h-8 capitalize transition-all ${forecastMode === m ? 'bg-indigo-600 hover:bg-indigo-700' : ''}`}
                        onClick={() => setForecastMode(m)}
                      >
                        {m}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Target Month</label>
                  <Input 
                    type="month" 
                    value={targetMonth} 
                    onChange={e => setTargetMonth(e.target.value)}
                    className="h-9"
                  />
                </div>
              </div>

              {(forecastMode === 'single' || forecastMode === 'auto') && (
                <div className="space-y-4 pt-4 border-t border-slate-50">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Metode Prediksi</label>
                      {configResult && forecastMode === 'single' && (
                        <div className="text-[9px] text-indigo-400 font-medium italic">
                          Recommended: {configResult.recommended_mode}
                        </div>
                      )}
                    </div>
                    <Select value={method} onValueChange={(v) => setMethod(v as any)}>
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Pilih metode" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ai">Google Gemini AI (BETA)</SelectItem>
                        <SelectItem value="holt-winters">Holt-Winters (Triple Exp)</SelectItem>
                        <SelectItem value="decomposition">Time Series Decomposition</SelectItem>
                        <SelectItem value="holt-linear">Holt Linear (Double Exp)</SelectItem>
                        <SelectItem value="exponential-smoothing">Simple Exp Smoothing</SelectItem>
                        <SelectItem value="seasonal-index">Seasonal Index (7-Day Pattern)</SelectItem>
                        <SelectItem value="moving-average">Moving Average (Simple)</SelectItem>
                        <SelectItem value="weighted-moving-average">Weighted Moving Average</SelectItem>
                        <SelectItem value="linear-regression">Linear Regression</SelectItem>
                        <SelectItem value="naive">Naive Forecast</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              {forecastMode === 'hybrid' && (
                <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-100 space-y-2">
                  <div className="flex items-center gap-2 text-indigo-700 text-xs font-bold">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Hybrid Intelligence Enabled</span>
                  </div>
                  <p className="text-[10px] text-indigo-600/80 leading-relaxed font-medium">
                    Parameter dapat disesuaikan secara manual (Mode Hybrid Fleksibel) untuk akurasi maksimal menggunakan <strong>Event Intelligence</strong>.
                  </p>
                </div>
              )}

              <div className="space-y-4 pt-4 border-t border-slate-50">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                    <Calculator className="w-3 h-3" />
                    Preset Configuration
                  </h4>
                  <div className="flex items-center gap-2">
                    {configResult && configResult.recommended_preset !== wfmPreset && (
                       <div className="flex items-center gap-1 text-[9px] text-emerald-600 font-bold bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100 italic">
                          Rec: {configResult.recommended_preset}
                       </div>
                    )}
                    <div className="bg-slate-100 px-2 py-0.5 rounded text-[10px] text-slate-500 font-mono">
                      {forecastMode === 'auto' ? 'Auto Applied' : 'Manual'}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {(['Stable', 'Balanced', 'Responsive', 'Aggressive'] as WfmPreset[]).map((p) => (
                    <div key={p} className="relative group">
                      <Button
                        variant={wfmPreset === p ? 'default' : 'outline'}
                        className={`w-full text-[11px] h-9 justify-start gap-2 h-10 ${wfmPreset === p ? 'bg-indigo-600 border-indigo-600' : 'hover:border-indigo-200 hover:bg-indigo-50/30'}`}
                        onClick={() => setWfmPreset(p)}
                      >
                        <div className={`w-1.5 h-1.5 rounded-full ${
                          p === 'Stable' ? 'bg-emerald-400' : 
                          p === 'Balanced' ? 'bg-indigo-400' : 
                          p === 'Responsive' ? 'bg-amber-400' : 
                          'bg-rose-400'
                        }`} />
                        {p}
                      </Button>
                      <div className="absolute left-0 bottom-full mb-2 w-48 p-2 bg-slate-900 text-white rounded shadow-xl text-[9px] font-medium opacity-0 group-hover:opacity-100 transition-opacity z-50 pointer-events-none">
                        {WfmConfigEngine.getTooltip(p)}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Hidden Parameters Summary for visibility without interaction */}
                <div className="p-3 rounded-lg bg-slate-50/50 border border-slate-100 grid grid-cols-4 gap-2">
                  <div className="flex flex-col">
                    <span className="text-[8px] text-slate-400 font-bold">ALPHA</span>
                    <span className="text-[10px] font-mono font-bold text-slate-600">{alpha.toFixed(2)}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[8px] text-slate-400 font-bold">BETA</span>
                    <span className="text-[10px] font-mono font-bold text-slate-600">{beta.toFixed(2)}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[8px] text-slate-400 font-bold">GAMMA</span>
                    <span className="text-[10px] font-mono font-bold text-slate-600">{gamma.toFixed(2)}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[8px] text-slate-400 font-bold">WINDOW</span>
                    <span className="text-[10px] font-mono font-bold text-slate-600">{maPeriod}nd</span>
                  </div>
                </div>
              </div>

              {analysis && (
                <div className="space-y-3 pt-4 border-t border-slate-50">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                    <BarChart3 className="w-3 h-3" />
                    Data Snapshot
                  </h4>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-100 flex flex-col gap-1">
                      <span className="text-[9px] text-slate-400 font-bold uppercase">Trend Pattern</span>
                      <span className="text-xs font-bold text-slate-700 capitalize flex items-center gap-1.5">
                        <TrendingUp className="w-3 h-3 text-indigo-500" />
                        {analysis.trend}
                      </span>
                    </div>
                    <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-100 flex flex-col gap-1">
                      <span className="text-[9px] text-slate-400 font-bold uppercase">Seasonality</span>
                      <span className="text-xs font-bold text-slate-700 capitalize flex items-center gap-1.5">
                        <Calendar className="w-3 h-3 text-indigo-500" />
                        {analysis.seasonality}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <div className="pt-6 space-y-4">
                <Button 
                  className="w-full h-11 bg-indigo-600 hover:bg-indigo-700 shadow-md transition-all active:scale-[0.98]" 
                  onClick={generatePrediction}
                  disabled={isGenerating || history.length < 7}
                >
                  {isGenerating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Mengkalkulasi...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Generate Forecast
                    </>
                  )}
                </Button>
                
                <p className="text-[10px] text-center text-slate-400 leading-relaxed font-medium px-4">
                  * Algoritma akan melakukan auto-tuning parameter (alpha, beta, gamma) jika terdeteksi volatilitas tinggi.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm bg-white">
            <CardHeader className="pb-2 border-b border-slate-50 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-sm">Event Calendar</CardTitle>
                <CardDescription className="text-[10px]">Adjustments for future dates.</CardDescription>
              </div>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8 text-indigo-600 hover:text-indigo-700" 
                onClick={handleDetectEvents}
                disabled={isDetectingEvents}
              >
                {isDetectingEvents ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[300px] overflow-y-auto">
                {events.length > 0 ? (
                  <div className="divide-y divide-slate-100">
                    {events.map(event => (
                      <div key={event.date} className="p-3 flex items-center justify-between group">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono text-slate-500">{event.date}</span>
                            <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded ${
                              event.type === 'campaign' ? 'bg-amber-100 text-amber-700' :
                              event.type === 'payday' ? 'bg-emerald-100 text-emerald-700' :
                              event.type === 'holiday' ? 'bg-indigo-100 text-indigo-700' :
                              'bg-slate-100 text-slate-700'
                            }`}>
                              {event.type}
                            </span>
                          </div>
                          <p className="text-xs font-medium text-slate-700">{event.description || 'Adjustment Applied'}</p>
                          <div className="text-[10px] font-bold text-indigo-600">
                            Impact: {event.impact > 0 ? '+' : ''}{(event.impact * 100).toFixed(0)}%
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 text-rose-500 hover:text-rose-600 transition-opacity"
                          onClick={() => removeEvent(event.date)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-8 text-center bg-slate-50/50">
                    <Calendar className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                    <p className="text-[10px] text-slate-400">No events defined for the forecast period.</p>
                  </div>
                )}
              </div>
              
              <div className="p-3 border-t border-slate-50 bg-slate-50/30">
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="w-full h-8 text-xs text-indigo-600 border border-dashed border-indigo-200 bg-white hover:bg-indigo-50">
                      + Add Manual Event
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Add Forecast Event</DialogTitle></DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <label className="text-xs font-medium">Date</label>
                          <Input type="date" id="event_date" className="bg-slate-50" />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs font-medium">Impact (%)</label>
                          <Input type="number" id="event_impact" placeholder="e.g. 20 for +20%" className="bg-slate-50" />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium">Type</label>
                        <Select onValueChange={(v) => (window as any)._eventType = v}>
                          <SelectTrigger className="bg-slate-50">
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="campaign">Marketing Campaign</SelectItem>
                            <SelectItem value="payday">Payday</SelectItem>
                            <SelectItem value="holiday">Public Holiday</SelectItem>
                            <SelectItem value="other">Other Adjustment</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-medium">Description</label>
                        <Input id="event_desc" placeholder="e.g. 11.11 Promo" className="bg-slate-50" />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button onClick={() => {
                        const date = (document.getElementById('event_date') as HTMLInputElement).value;
                        const impact = parseInt((document.getElementById('event_impact') as HTMLInputElement).value) / 100;
                        const type = (window as any)._eventType || 'other';
                        const description = (document.getElementById('event_desc') as HTMLInputElement).value;
                        if (!date || isNaN(impact)) return;
                        addEvent({ date, impact, type, description });
                      }}>Add to Calendar</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
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
      </>
    )}
    </div>
  );
}
