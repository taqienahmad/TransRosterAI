import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Clock, Calendar, Save, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { db, doc, setDoc, OperationType, handleFirestoreError } from '../lib/firebase';

export interface DayWindow {
  start: string;
  end: string;
  isOpen: boolean;
}

export type OperationalWindows = Record<string, DayWindow>;

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const DEFAULT_WINDOWS: OperationalWindows = {
  'Monday': { start: '00:00', end: '23:59', isOpen: true },
  'Tuesday': { start: '00:00', end: '23:59', isOpen: true },
  'Wednesday': { start: '00:00', end: '23:59', isOpen: true },
  'Thursday': { start: '00:00', end: '23:59', isOpen: true },
  'Friday': { start: '00:00', end: '23:59', isOpen: true },
  'Saturday': { start: '00:00', end: '23:59', isOpen: true },
  'Sunday': { start: '00:00', end: '23:59', isOpen: true },
};

export default function OperationalWindowSettings({ 
  windows, 
  onUpdate,
  isAdmin = false
}: { 
  windows?: OperationalWindows | null, 
  onUpdate?: (windows: OperationalWindows) => void,
  isAdmin?: boolean
}) {
  const [localWindows, setLocalWindows] = useState<OperationalWindows>(windows || DEFAULT_WINDOWS);

  useEffect(() => {
    if (windows) {
      setLocalWindows(windows);
    }
  }, [windows]);

  const handleUpdate = (day: string, field: keyof DayWindow, value: any) => {
    if (!isAdmin) return;
    const updated = {
      ...localWindows,
      [day]: {
        ...localWindows[day],
        [field]: value
      }
    };
    setLocalWindows(updated);
  };

  const handleSave = async () => {
    if (!isAdmin) return;
    try {
      await setDoc(doc(db, 'erlangSettings', 'current'), { 
        operationalWindows: localWindows 
      }, { merge: true });
      if (onUpdate) onUpdate(localWindows);
      toast.success('Operational windows updated successfully');
    } catch (error) {
      console.error('Error saving operational windows:', error);
      toast.error('Failed to save operational windows');
    }
  };

  const handleReset = () => {
    if (!isAdmin) return;
    setLocalWindows(DEFAULT_WINDOWS);
    toast.info('Reset to 24/7 defaults. Click Save to apply.');
  };

  return (
    <Card className="border-none shadow-sm">
      <CardHeader className="bg-white border-b border-slate-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-50 rounded-lg">
              <Clock className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <CardTitle className="text-lg">Operational Windows</CardTitle>
              <CardDescription>Define when your business is active each day.</CardDescription>
            </div>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleReset} className="gap-2">
                <RotateCcw className="w-4 h-4" />
                Reset
              </Button>
              <Button size="sm" onClick={handleSave} className="gap-2 bg-indigo-600 hover:bg-indigo-700">
                <Save className="w-4 h-4" />
                Save Changes
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-6">
        <div className="grid gap-4">
          {DAYS.map((day) => {
            const config = localWindows[day] || DEFAULT_WINDOWS[day];
            return (
              <div key={day} className={`flex items-center justify-between p-4 rounded-xl border transition-all ${config.isOpen ? 'bg-white border-slate-200 shadow-sm' : 'bg-slate-50 border-slate-100 opacity-60'}`}>
                <div className="flex items-center gap-4 min-w-[140px]">
                  <Switch 
                    checked={config.isOpen} 
                    onCheckedChange={(checked) => handleUpdate(day, 'isOpen', checked)}
                    disabled={!isAdmin}
                  />
                  <span className={`font-bold ${config.isOpen ? 'text-slate-900' : 'text-slate-400'}`}>{day}</span>
                </div>

                <div className="flex items-center gap-6 flex-1 justify-end">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Start</span>
                    <Input 
                      type="time" 
                      value={config.start || ''} 
                      disabled={!config.isOpen || !isAdmin}
                      onChange={(e) => handleUpdate(day, 'start', e.target.value)}
                      className="w-32 h-9 text-sm"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">End</span>
                    <Input 
                      type="time" 
                      value={config.end || ''} 
                      disabled={!config.isOpen || !isAdmin}
                      onChange={(e) => handleUpdate(day, 'end', e.target.value)}
                      className="w-32 h-9 text-sm"
                    />
                  </div>
                  <div className="min-w-[100px] text-right">
                    {config.isOpen ? (
                      <Badge className="bg-emerald-50 text-emerald-700 border-emerald-100">Open</Badge>
                    ) : (
                      <Badge variant="outline" className="text-slate-400 border-slate-200">Closed</Badge>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
