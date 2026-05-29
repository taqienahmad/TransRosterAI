import React, { useState, useEffect } from 'react';
import { db, collection, onSnapshot, query, setDoc, doc, deleteDoc, OperationType, handleFirestoreError, writeBatch } from '../lib/firebase';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Upload, Download, Trash2, Calendar, BarChart3, TrendingUp, Workflow, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import * as XLSX from 'xlsx';

interface ForecastVolume {
  date: string;
  day: string;
  totalVolume: number;
  intervals: Record<string, number>;
  metadata?: {
    methodUsed: string;
    modeUsed: string;
    eventImpact?: number;
  };
}

export default function ForecastVolume(props: any) {
  const { isAdmin, allVolumeData } = props;
  const [volumes, setVolumes] = useState<ForecastVolume[]>(allVolumeData || []);
  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false);

  useEffect(() => {
    if (allVolumeData) {
      setVolumes([...allVolumeData].sort((a: any, b: any) => a.date.localeCompare(b.date)));
    }
  }, [allVolumeData]);

  const downloadTemplate = () => {
    const csvContent = "sep=;\nDates;01/04/2025;02/04/2025\nDays;Tue;Wed\nTotal Volume;1000;1100\n00:00 - 01:00;20;22\n01:00 - 02:00;15;17\n02:00 - 03:00;10;11\n03:00 - 04:00;10;11\n04:00 - 05:00;12;13\n05:00 - 06:00;15;17\n06:00 - 07:00;25;28\n07:00 - 08:00;40;44\n08:00 - 09:00;60;66\n09:00 - 10:00;70;77\n10:00 - 11:00;80;88\n11:00 - 12:00;75;83\n12:00 - 13:00;65;72\n13:00 - 14:00;70;77\n14:00 - 15:00;75;83\n15:00 - 16:00;70;77\n16:00 - 17:00;60;66\n17:00 - 18:00;50;55\n18:00 - 19:00;45;50\n19:00 - 20:00;40;44\n20:00 - 21:00;35;39\n21:00 - 22:00;30;33\n22:00 - 23:00;25;28\n23:00 - 00:00;20;22";
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'forecast_volume_template.csv';
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
        if (lines.length === 0) return;

        if (lines[0].startsWith('sep=')) {
          lines = lines.slice(1);
        }

        // Detect separator (comma, semicolon, or tab)
        const firstLine = lines[0];
        const counts = {
          ',': (firstLine.match(/,/g) || []).length,
          ';': (firstLine.match(/;/g) || []).length,
          '\t': (firstLine.match(/\t/g) || []).length
        };
        const separator = (Object.keys(counts) as Array<keyof typeof counts>).reduce((a, b) => counts[a] > counts[b] ? a : b);
        
        console.log('Detected separator:', separator);

        const dataMatrix = lines.map(line => line.split(separator).map(v => v.trim()));

        if (dataMatrix.length < 4) {
          toast.error('Invalid format. Need at least Dates, Days, Total Volume, and one interval.');
          return;
        }

        const datesIdx = dataMatrix.findIndex(row => (row[0] || '').toString().toLowerCase().includes('date'));
        const daysIdx = dataMatrix.findIndex(row => (row[0] || '').toString().toLowerCase().includes('day'));
        const totalVolumeIdx = dataMatrix.findIndex(row => (row[0] || '').toString().toLowerCase().includes('volume'));

        if (datesIdx === -1 || totalVolumeIdx === -1) {
          toast.error('Invalid format. Could not find "Dates" or "Total Volume" rows.');
          return;
        }

        const datesRow = dataMatrix[datesIdx];
        const daysRow = daysIdx !== -1 ? dataMatrix[daysIdx] : [];
        const totalVolumeRow = dataMatrix[totalVolumeIdx];
        
        // Interval rows are everything else that isn't one of the headers
        const intervalRows = dataMatrix.filter((_, idx) => 
          idx !== datesIdx && idx !== daysIdx && idx !== totalVolumeIdx
        );

        const parseNumber = (val: string): number => {
          if (!val) return 0;
          let s = val.trim().replace(/\s/g, '');
          
          // Handle cases like 1.234,56 or 1,234.56
          if (s.includes(',') && s.includes('.')) {
            const lastComma = s.lastIndexOf(',');
            const lastDot = s.lastIndexOf('.');
            if (lastComma > lastDot) {
              // Dot is thousands, comma is decimal
              return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
            } else {
              // Comma is thousands, dot is decimal
              return parseFloat(s.replace(/,/g, '')) || 0;
            }
          }
          
          // If only comma exists, assume it's a thousands separator or decimal
          if (s.includes(',')) {
            const parts = s.split(',');
            if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
              return parseFloat(s.replace(/,/g, '')) || 0;
            }
            return parseFloat(s.replace(',', '.')) || 0;
          }
          
          // If only dot exists, it's the most ambiguous case (1.482)
          if (s.includes('.')) {
            const parts = s.split('.');
            if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
              return parseFloat(s.replace(/\./g, '')) || 0;
            }
          }
          
          return parseFloat(s) || 0;
        };

        let successCount = 0;
        let errorCount = 0;
        let suspiciouslyLowCount = 0;

        // Iterate through columns (starting from index 1)
        for (let col = 1; col < datesRow.length; col++) {
          const rawDate = datesRow[col];
          if (!rawDate) continue;

          try {
            // Convert DD/MM/YYYY to YYYY-MM-DD
            let dateStr = '';
            if (rawDate.includes('/')) {
              const parts = rawDate.split('/');
              if (parts.length === 3) {
                if (parts[0].length === 4) {
                  dateStr = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
                } else {
                  dateStr = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
                }
              }
            } else if (rawDate.includes('-')) {
              const parts = rawDate.split('-');
              if (parts.length === 3) {
                if (parts[0].length === 4) {
                  dateStr = rawDate;
                } else {
                  dateStr = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
                }
              }
            }

            if (!dateStr) continue;

            const day = daysRow[col] || '';
            const totalVolume = parseNumber(totalVolumeRow[col]);
            
            if (totalVolume > 0 && totalVolume < 10) {
              suspiciouslyLowCount++;
            }

            const intervals: Record<string, number> = {};

            intervalRows.forEach(row => {
              const intervalName = row[0];
              if (intervalName) {
                const intervalValue = parseNumber(row[col]);
                intervals[intervalName] = intervalValue;
              }
            });

            // If no intervals were provided but totalVolume > 0, apply a default distribution
            if (Object.keys(intervals).length === 0 && totalVolume > 0) {
              const DEFAULT_DIST: Record<string, number> = {
                "00:00 - 01:00": 0.02, "01:00 - 02:00": 0.015, "02:00 - 03:00": 0.01, "03:00 - 04:00": 0.01,
                "04:00 - 05:00": 0.012, "05:00 - 06:00": 0.015, "06:00 - 07:00": 0.025, "07:00 - 08:00": 0.04,
                "08:00 - 09:00": 0.06, "09:00 - 10:00": 0.07, "10:00 - 11:00": 0.08, "11:00 - 12:00": 0.075,
                "12:00 - 13:00": 0.065, "13:00 - 14:00": 0.07, "14:00 - 15:00": 0.075, "15:00 - 16:00": 0.07,
                "16:00 - 17:00": 0.06, "17:00 - 18:00": 0.05, "18:00 - 19:00": 0.045, "19:00 - 20:00": 0.04,
                "20:00 - 21:00": 0.035, "21:00 - 22:00": 0.03, "22:00 - 23:00": 0.025, "23:00 - 00:00": 0.02
              };
              Object.entries(DEFAULT_DIST).forEach(([int, ratio]) => {
                intervals[int] = Math.round(totalVolume * ratio);
              });
            }

            await setDoc(doc(db, 'forecastVolume', dateStr), {
              date: dateStr,
              day,
              totalVolume,
              intervals
            });
            successCount++;
          } catch (err) {
            console.error('Error processing column:', col, err);
            errorCount++;
          }
        }

        if (successCount > 0) {
          toast.success(`Successfully uploaded ${successCount} days of volume data`);
          if (suspiciouslyLowCount > successCount / 2) {
            toast.warning('Warning: Detected very low volume values. Please check if your thousands separators (dots/commas) were parsed correctly.', { duration: 6000 });
          }
        } else {
          toast.error('No valid data columns found. Check date format (DD/MM/YYYY).');
        }
        
        if (errorCount > 0) {
          toast.error(`Failed to process ${errorCount} columns.`);
        }
      } catch (err) {
        console.error('File processing error:', err);
        toast.error('Failed to process CSV file');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleClearAll = async () => {
    if (!isAdmin || volumes.length === 0) return;
    try {
      // Use batches for better performance and limit per batch (500)
      const chunks = [];
      const batchSize = 500;
      for (let i = 0; i < volumes.length; i += batchSize) {
        chunks.push(volumes.slice(i, i + batchSize));
      }

      for (const chunk of chunks) {
        const batch = writeBatch(db);
        chunk.forEach(v => {
          batch.delete(doc(db, 'forecastVolume', v.date));
        });
        await batch.commit();
      }

      toast.success('All volume data cleared');
      setIsClearDialogOpen(false);
    } catch (error) {
      console.error('Clear data error:', error);
      toast.error('Failed to clear data');
    }
  };

  const exportToExcel = () => {
    if (volumes.length === 0) {
      toast.error('No data to export');
      return;
    }

    // 1. Prepare Main Data Sheet
    // Get all unique intervals and sort them chronologically
    const allIntervals = Array.from(new Set(volumes.flatMap(v => Object.keys(v.intervals)))).sort((a: string, b: string) => {
      // Extract starting time for sorting (e.g., "08:00" from "08:00 - 09:00")
      const timeA = a.split(' - ')[0] || a;
      const timeB = b.split(' - ')[0] || b;
      return timeA.localeCompare(timeB);
    }) as string[];

    const mainData = volumes.map(v => {
      const row: any = {
        'Date': v.date,
        'Day': v.day,
        'Method': v.metadata?.methodUsed || 'Manual Upload',
        'Forecast Mode': v.metadata?.modeUsed || '-',
        'Total Forecast Volume': v.totalVolume,
      };

      // Add intervals in sorted order
      allIntervals.forEach((interval: string) => {
        row[`Interval: ${interval}`] = v.intervals[interval] || 0;
      });

      return row;
    });

    // 2. Prepare Methodology Sheet
    const methodologyData = [
      { 
        'Method': 'Holt-Winters (Triple Exponential Smoothing)', 
        'Formula Description': 'L_t = α(Y_t / S_{t-m}) + (1-α)(L_{t-1} + T_{t-1})',
        'Logic': 'Calculates Base Level (α), Trend (β), and Seasonality (γ) simultaneously to predict future data points with recurring patterns.' 
      },
      { 
        'Method': 'Hybrid (Event Optimized)', 
        'Formula Description': 'Forecast = (Baseline + Trend) * (Seasonality_Index + Event_Impact)',
        'Logic': 'Combines a linear baseline with periodic seasonality and specific Event Intelligence multipliers (e.g., Payday, Promo).' 
      },
      { 
        'Method': 'Moving Average (MA)', 
        'Formula Description': 'Forecast = (Σ Y_{t-n} ... Y_t) / n',
        'Logic': 'Takes the average of the last N days (Window Size) to smooth out short-term fluctuations.' 
      },
    ];

    // 3. Create Workbook
    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.json_to_sheet(mainData);
    const ws2 = XLSX.utils.json_to_sheet(methodologyData);

    XLSX.utils.book_append_sheet(wb, ws1, "Forecast Results");
    XLSX.utils.book_append_sheet(wb, ws2, "Methodology Documentation");

    // 4. Save file
    XLSX.writeFile(wb, `WFM_Forecast_Export_${new Date().toISOString().split('T')[0]}.xlsx`);
    toast.success('Exporting to Excel successful');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Forecast Volume</h1>
          <p className="text-slate-500">Upload and manage work volume per interval.</p>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2">
            <Dialog open={isClearDialogOpen} onOpenChange={setIsClearDialogOpen}>
              <DialogTrigger asChild>
                <Button 
                  variant="destructive" 
                  className="gap-2"
                  disabled={volumes.length === 0}
                >
                  <Trash2 className="w-4 h-4" />
                  Clear Data
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Are you absolutely sure?</DialogTitle>
                  <p className="text-sm text-slate-500 py-4">
                    This action will permanently delete all forecast volume records. This cannot be undone.
                  </p>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsClearDialogOpen(false)}>Cancel</Button>
                  <Button variant="destructive" onClick={handleClearAll}>Delete All Data</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Button variant="outline" onClick={exportToExcel} className="gap-2 border-emerald-200 text-emerald-600 hover:bg-emerald-50">
              <FileSpreadsheet className="w-4 h-4" />
              Export Excel
            </Button>

            <Button variant="outline" onClick={downloadTemplate} className="gap-2">
              <Download className="w-4 h-4" />
              Template
            </Button>

            <label className="cursor-pointer">
              <Input type="file" accept=".csv" className="hidden" onChange={handleFileUpload} />
              <div className="flex items-center gap-2 px-4 py-2 rounded-md bg-slate-100 hover:bg-slate-200 text-sm font-medium transition-colors">
                <Upload className="w-4 h-4" />
                Upload CSV
              </div>
            </label>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-none shadow-sm">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Total Accumulated</p>
              <p className="text-xl font-bold text-slate-900">
                {volumes.reduce((acc, v) => acc + v.totalVolume, 0).toLocaleString()}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-none shadow-sm">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
              <Calendar className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Total Days</p>
              <p className="text-xl font-bold text-slate-900">{volumes.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-none shadow-sm">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
              <BarChart3 className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Avg Volume</p>
              <p className="text-xl font-bold text-slate-900">
                {volumes.length > 0 
                  ? Math.round(volumes.reduce((acc, v) => acc + v.totalVolume, 0) / volumes.length).toLocaleString() 
                  : 0}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-none shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-slate-50">
              <TableRow>
                <TableHead className="w-[120px]">Date</TableHead>
                <TableHead className="w-[80px]">Day</TableHead>
                <TableHead className="w-[120px]">Total Volume</TableHead>
                <TableHead className="w-[150px]">Forecasting Method</TableHead>
                <TableHead>Interval Breakdown</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {volumes.length > 0 ? (
                volumes.map((v) => (
                  <TableRow key={v.date}>
                    <TableCell className="font-medium">
                      <div className="text-xs">{v.date}</div>
                    </TableCell>
                    <TableCell className="text-xs">{v.day}</TableCell>
                    <TableCell>
                      <div className="text-sm font-bold text-indigo-600">
                        {v.totalVolume.toLocaleString()}
                      </div>
                    </TableCell>
                    <TableCell>
                      {v.metadata ? (
                        <div className="space-y-1">
                          <Badge variant="outline" className="text-[9px] font-bold uppercase py-0 leading-tight border-indigo-100 text-indigo-600">
                            {v.metadata.methodUsed}
                          </Badge>
                          <div className="text-[8px] text-slate-400 font-medium">
                            Mode: {v.metadata.modeUsed}
                          </div>
                        </div>
                      ) : (
                        <span className="text-[10px] text-slate-300 italic">Manual Upload</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(v.intervals).slice(0, 4).map(([time, val]) => (
                          <div key={time} className="text-xs bg-slate-100 px-2 py-1 rounded">
                            <span className="text-slate-500">{time}:</span> {val}
                          </div>
                        ))}
                        {Object.keys(v.intervals).length > 4 && (
                          <span className="text-xs text-slate-400">+{Object.keys(v.intervals).length - 4} more</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={4} className="h-32 text-center text-slate-500">
                    No volume data uploaded yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <div className="mt-8 space-y-4">
        <h3 className="text-sm font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
          <Workflow className="w-4 h-4" />
          Methodology Documentation
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Card className="border-none shadow-sm bg-indigo-50/30">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-xs font-bold text-indigo-700">Holt-Winters (Triple Exponential)</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 text-[11px] text-indigo-600/80 leading-relaxed">
              Metode standar WFM yang memperhitungkan 3 level: Level $(\alpha)$, Trend $(\beta)$, dan Seasonality $(\gamma)$. Sangat efektif untuk data dengan pola harian/mingguan yang jelas.
            </CardContent>
          </Card>
          <Card className="border-none shadow-sm bg-emerald-50/30">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-xs font-bold text-emerald-700">Hybrid Configuration</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 text-[11px] text-emerald-600/80 leading-relaxed">
              Menggabungkan baseline Holt-Linear dengan penyesuaian indeks musiman manual. Mengaktifkan **Event Intelligence** untuk mendeteksi lonjakan volume akibat kampanye atau hari gajian.
            </CardContent>
          </Card>
          <Card className="border-none shadow-sm bg-amber-50/30">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-xs font-bold text-amber-700">Moving Average (MA)</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 text-[11px] text-amber-600/80 leading-relaxed">
              Metode penghalusan sederhana yang mengambil rata-rata dari jendela waktu tertentu (Window Size). Cocok untuk data yang sangat tidak stabil atau sebagai pembanding dasar.
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
