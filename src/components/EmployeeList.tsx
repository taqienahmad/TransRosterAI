import React, { useState, useEffect } from 'react';
import { db, collection, onSnapshot, query, orderBy, setDoc, doc, deleteDoc, OperationType, handleFirestoreError, writeBatch } from '../lib/firebase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Users, UserPlus, Search, Trash2, Edit2, Upload, Download, FileSpreadsheet, CheckSquare, Square, Settings2, Zap, ChevronLeft, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { Checkbox } from '@/components/ui/checkbox';
import { ShiftCode } from './ShiftCodeManager';
import { Label } from '@/components/ui/label';

import { format, subDays, subMonths, addMonths, startOfMonth, endOfMonth, eachDayOfInterval } from 'date-fns';

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
  preferredShifts?: string[];
  extraWorkingDays?: number;
  extraHours?: number;
  rosterHistory?: Record<string, string>;
}

export default function EmployeeList({ isAdmin }: { isAdmin: boolean }) {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [shiftCodes, setShiftCodes] = useState<ShiftCode[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [newEmployee, setNewEmployee] = useState<Partial<Employee>>({
    nip: '',
    name: '',
    email: '',
    skill: '',
    channel: '',
    site: '',
    gender: 'L',
    religion: '',
    role: '',
    department: '',
    skills: [],
    preferredShifts: [],
    extraWorkingDays: 0,
    extraHours: 0
  });
  const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkUpdateOpen, setIsBulkUpdateOpen] = useState(false);
  const [bulkData, setBulkData] = useState({ extraWorkingDays: 0, extraHours: 0 });
  const [isUpdating, setIsUpdating] = useState(false);
  const [legacyRoster, setLegacyRoster] = useState<Record<string, Record<string, string>>>({});
  const [targetMonth, setTargetMonth] = useState(new Date()); // The month being PLANNED

  useEffect(() => {
    const q = query(collection(db, 'employees'), orderBy('name'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Employee));
      setEmployees(list);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'employees');
    });

    const qShifts = query(collection(db, 'shiftCodes'));
    const unsubShifts = onSnapshot(qShifts, (snapshot) => {
      setShiftCodes(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ShiftCode)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'shiftCodes');
    });

    const unsubLegacy = onSnapshot(collection(db, 'legacyRoster'), (snapshot) => {
      const data: Record<string, Record<string, string>> = {};
      snapshot.docs.forEach(doc => {
        data[doc.id] = doc.data() as Record<string, string>;
      });
      setLegacyRoster(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'legacyRoster');
    });

    return () => {
      unsubscribe();
      unsubShifts();
      unsubLegacy();
    };
  }, []);

  const downloadTemplate = () => {
    // Generate headers for the last 7 days of the month PRIOR to targetMonth
    const historyMonth = subMonths(targetMonth, 1);
    const lastDayHistory = endOfMonth(historyMonth);
    const historyDates = [];
    const historyDayNumbers = [];
    for (let i = 6; i >= 0; i--) {
      const d = subDays(lastDayHistory, i);
      historyDates.push(format(d, 'yyyy-MM-dd'));
      historyDayNumbers.push(format(d, 'd')); // Use day number "24", "25" etc.
    }

    const headers = ["No", "NIP", "Name", "Email", "Skill", "Channel", "Site", "Gender", "Religion", "Role", "Department", "Skills", ...historyDayNumbers, "PreferredShifts", "ExtraWorkingDays", "ExtraHours"];
    
    // Updated example data with day numbers
    const example1 = ["1", "2222070", "Ayuningtias Srikandini", "ayu@example.com", "Consul", "Live Chat", "Tegal", "F", "Moslem", "Agent", "Consul", "HB", ...historyDayNumbers.map((_, idx) => idx === 6 ? "NS" : idx < 2 ? "P1" : idx < 4 ? "OFF" : "P2"), "P37,NS", "2", "0"];
    const example2 = ["2", "2222108", "Wiwi Aji Setianingsih", "wiwi@example.com", "Consul", "Live Chat", "Tegal", "F", "Moslem", "Agent", "Consul", "HB", ...historyDayNumbers.map((_, idx) => idx < 2 ? "OFF" : "P3"), "P31", "0", "0"];
    
    const csvContent = "sep=;\n" + headers.join(';') + "\n" + example1.join(';') + "\n" + example2.join(';');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `employee_template_${format(targetMonth, 'MMM_yyyy')}.csv`;
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
        // Remove BOM if present
        text = text.replace(/^\ufeff/, '');
        
        let lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
        if (lines.length === 0) return;

        // Skip Excel separator hint if present (e.g., "sep=,")
        if (lines[0].startsWith('sep=')) {
          lines = lines.slice(1);
        }

        if (lines.length < 2) {
          toast.error('CSV file is empty or missing data');
          return;
        }

        // Detect separator (comma, semicolon, or tab)
        const firstLine = lines[0];
        const counts = {
          ',': (firstLine.match(/,/g) || []).length,
          ';': (firstLine.match(/;/g) || []).length,
          '\t': (firstLine.match(/\t/g) || []).length
        };
        const separator = (Object.keys(counts) as Array<keyof typeof counts>).reduce((a, b) => counts[a] > counts[b] ? a : b);
        
        const headers = firstLine.split(separator).map(h => h.trim()); // Case sensitive for dates
        const lowerHeaders = headers.map(h => h.toLowerCase());
        
        // Flexible header matching
        const requiredHeaders = ['nip', 'name', 'skill'];
        const missingHeaders = requiredHeaders.filter(req => !lowerHeaders.some(h => h.includes(req)));
        
        if (missingHeaders.length > 0) {
          toast.error(`Missing required columns: ${missingHeaders.join(', ')}`);
          return;
        }

        const historyMonth = subMonths(targetMonth, 1);
        const year = historyMonth.getFullYear();
        const month = historyMonth.getMonth(); // 0-indexed

        let successCount = 0;
        let errorCount = 0;
        const legacyBatch = writeBatch(db);
        let hasLegacyData = false;

        for (let i = 1; i < lines.length; i++) {
          const values = lines[i].split(separator).map(v => v.trim());
          const empData: any = {};
          const historyData: Record<string, string> = {};
          
          headers.forEach((header, index) => {
            const hLower = header.toLowerCase();
            const mapping: any = {
              'nip': 'nip',
              'name': 'name',
              'email': 'email',
              'skill': 'skill',
              'channel': 'channel',
              'site': 'site',
              'gender': 'gender',
              'religion': 'religion',
              'role': 'role',
              'department': 'department',
              'skills': 'skills',
              'preferred': 'preferredShifts',
              'extra working days': 'extraWorkingDays',
              'extra hours': 'extraHours'
            };
            
            // Check if header is a date (YYYY-MM-DD or simple numeric day)
            if (header.match(/^\d{4}-\d{2}-\d{2}$/)) {
              if (values[index]) {
                historyData[header] = values[index].toUpperCase();
              }
              return;
            } else if (header.match(/^\d{1,2}$/)) {
              // Numeric day for previous month
              const day = parseInt(header);
              if (day >= 1 && day <= 31 && values[index]) {
                const dateObj = new Date(year, month, day);
                // Validate if day exists in that month (JS Date wraps e.g. Feb 30 to Mar 2)
                if (dateObj.getMonth() === month) {
                  const dateKey = format(dateObj, 'yyyy-MM-dd');
                  historyData[dateKey] = values[index].toUpperCase();
                }
              }
              return;
            }

            // Find mapping that is contained in the header (longest match first to avoid skill vs skills confusion)
            const matchedKey = Object.keys(mapping)
              .filter(key => hLower.includes(key))
              .sort((a, b) => b.length - a.length)[0];
            if (matchedKey) {
              let val = values[index];
              const field = mapping[matchedKey];
              
              if (field === 'gender' && val) {
                const g = val.toUpperCase();
                if (g === 'M') val = 'L';
                if (g === 'F') val = 'P';
              }

              if (field === 'extraWorkingDays' || field === 'extraHours') {
                empData[field] = parseInt(val) || 0;
              } else {
                empData[field] = val;
              }
            }
          });

          if (empData.name && empData.nip && empData.skill) {
            try {
              if (empData.preferredShifts && typeof empData.preferredShifts === 'string') {
                empData.preferredShifts = empData.preferredShifts.split(',').map((s: string) => s.trim().toUpperCase()).filter((s: string) => s.length > 0);
              }
              if (empData.skills && typeof empData.skills === 'string') {
                empData.skills = empData.skills.split(',').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
              }

              const id = empData.nip || Math.random().toString(36).substring(2, 9);
              await setDoc(doc(db, 'employees', id), { 
                ...empData, 
                id, 
                email: empData.email || '',
                role: empData.role || empData.skill,
                department: empData.department || empData.site || '',
                skills: empData.skills || [] 
              });

              if (Object.keys(historyData).length > 0) {
                legacyBatch.set(doc(db, 'legacyRoster', id), historyData, { merge: true });
                hasLegacyData = true;
              }

              successCount++;
            } catch (err) {
              console.error('Error uploading employee:', err);
              errorCount++;
            }
          } else {
            errorCount++;
          }
        }
        
        if (hasLegacyData) {
          await legacyBatch.commit();
          toast.success(`Uploaded history for ${successCount} employees`);
        }

        if (successCount > 0) {
          toast.success(`Successfully uploaded ${successCount} employees`);
        }
        if (errorCount > 0) {
          toast.error(`Failed to upload ${errorCount} rows. Check format.`);
        }
      } catch (err) {
        toast.error('Failed to process CSV file');
      }
    };
    reader.readAsText(file);
    // Reset input
    e.target.value = '';
  };

  const handleAddEmployee = async () => {
    if (!newEmployee.name || !newEmployee.nip || !newEmployee.skill) {
      toast.error('Please fill in required fields (Name, NIP, Skill)');
      return;
    }

    try {
      const id = newEmployee.nip || Math.random().toString(36).substring(2, 9);
      await setDoc(doc(db, 'employees', id), {
        ...newEmployee,
        id,
        email: newEmployee.email || '',
        role: newEmployee.role || newEmployee.skill || '',
        department: newEmployee.department || newEmployee.site || '',
        skills: [],
        extraWorkingDays: Number(newEmployee.extraWorkingDays) || 0,
        extraHours: Number(newEmployee.extraHours) || 0
      });
      toast.success('Employee added successfully');
      setIsAddDialogOpen(false);
      setNewEmployee({ 
        nip: '', name: '', email: '', skill: '', channel: '', 
        site: '', gender: 'L', religion: '', role: '', 
        department: '', skills: [], extraWorkingDays: 0, extraHours: 0
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'employees');
    }
  };

  const handleUpdateEmployee = async () => {
    if (!editingEmployee || !editingEmployee.name || !editingEmployee.nip || !editingEmployee.skill) {
      toast.error('Please fill in required fields');
      return;
    }

    try {
      await setDoc(doc(db, 'employees', editingEmployee.id), {
        ...editingEmployee,
        extraWorkingDays: Number(editingEmployee.extraWorkingDays) || 0,
        extraHours: Number(editingEmployee.extraHours) || 0
      });
      toast.success('Employee updated successfully');
      setIsEditDialogOpen(false);
      setEditingEmployee(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'employees');
    }
  };

  const handleBulkUpdate = async (applyToAll: boolean = false) => {
    setIsUpdating(true);
    try {
      const batch = writeBatch(db);
      const targets = applyToAll ? employees : employees.filter(e => selectedIds.has(e.id));
      
      if (targets.length === 0) {
        toast.error('No employees selected');
        return;
      }

      targets.forEach(emp => {
        const ref = doc(db, 'employees', emp.id);
        batch.update(ref, {
          extraWorkingDays: Number(bulkData.extraWorkingDays) || 0,
          extraHours: Number(bulkData.extraHours) || 0
        });
      });

      await batch.commit();
      toast.success(`Successfully updated ${targets.length} employees`);
      setIsBulkUpdateOpen(false);
      setSelectedIds(new Set());
    } catch (error) {
      console.error(error);
      toast.error('Failed to update employees');
    } finally {
      setIsUpdating(false);
    }
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredEmployees.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredEmployees.map(e => e.id)));
    }
  };

  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const handleDeleteEmployee = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'employees', id));
      toast.success('Employee deleted');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'employees');
    }
  };

  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false);

  const handleClearAll = async () => {
    if (!isAdmin || employees.length === 0) return;
    try {
      const batchSize = 500;
      const chunks = [];
      for (let i = 0; i < employees.length; i += batchSize) {
        chunks.push(employees.slice(i, i + batchSize));
      }

      for (const chunk of chunks) {
        const batch = writeBatch(db);
        chunk.forEach(emp => {
          batch.delete(doc(db, 'employees', emp.id));
        });
        await batch.commit();
      }

      toast.success('All employees cleared');
      setIsClearDialogOpen(false);
    } catch (error) {
      console.error('Clear employees error:', error);
      toast.error('Failed to clear employees');
    }
  };

  const filteredEmployees = employees.filter(emp => 
    (emp.name || '').toLowerCase().includes((searchTerm || '').toLowerCase()) ||
    (emp.email || '').toLowerCase().includes((searchTerm || '').toLowerCase()) ||
    (emp.role || '').toLowerCase().includes((searchTerm || '').toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Employees</h1>
          <p className="text-slate-500">Manage your team members and their roles.</p>
          <div className="mt-2 bg-indigo-50 border border-indigo-100 p-2 rounded-md inline-block">
            <p className="text-[10px] text-indigo-700 leading-tight">
              <span className="font-bold">Tip:</span> Your master sheet (with NIP & Name) can be used here <u>and</u> in Roster History.
            </p>
          </div>
        </div>
        
        {isAdmin && (
          <div className="flex items-center gap-2">
            <Dialog open={isBulkUpdateOpen} onOpenChange={setIsBulkUpdateOpen}>
              <DialogTrigger asChild>
                <Button 
                  variant="outline" 
                  className={`gap-2 border-indigo-200 text-indigo-700 hover:bg-indigo-50 ${selectedIds.size > 0 ? 'bg-indigo-50 ring-2 ring-indigo-500 ring-offset-2' : ''}`}
                >
                  <Settings2 className="w-4 h-4" />
                  Bulk Update {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[425px]">
                <DialogHeader>
                  <DialogTitle>Bulk Update Extra Time</DialogTitle>
                  <p className="text-sm text-slate-500">
                    Apply these settings to {selectedIds.size > 0 ? `${selectedIds.size} selected` : 'all'} employees.
                  </p>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Extra Working Days</label>
                    <Input 
                      type="number" 
                      value={bulkData.extraWorkingDays} 
                      onChange={e => setBulkData({...bulkData, extraWorkingDays: parseInt(e.target.value) || 0})} 
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Extra Hours</label>
                    <Input 
                      type="number" 
                      value={bulkData.extraHours} 
                      onChange={e => setBulkData({...bulkData, extraHours: parseInt(e.target.value) || 0})} 
                    />
                  </div>
                </div>
                <DialogFooter className="flex flex-col sm:flex-row gap-2">
                  <Button variant="ghost" onClick={() => setIsBulkUpdateOpen(false)} disabled={isUpdating}>Cancel</Button>
                  <div className="flex gap-2 w-full sm:w-auto">
                    <Button 
                      variant="outline" 
                      className="flex-1 sm:flex-none gap-2" 
                      onClick={() => handleBulkUpdate(true)}
                      disabled={isUpdating}
                    >
                      <Users className="w-4 h-4" />
                      Apply to All
                    </Button>
                    <Button 
                      className="flex-1 sm:flex-none gap-2 bg-indigo-600 hover:bg-indigo-700" 
                      onClick={() => handleBulkUpdate(false)}
                      disabled={isUpdating || selectedIds.size === 0}
                    >
                      <Zap className="w-4 h-4" />
                      Apply to Selected
                    </Button>
                  </div>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Dialog open={isClearDialogOpen} onOpenChange={setIsClearDialogOpen}>
              <DialogTrigger asChild>
                <Button 
                  variant="destructive" 
                  className="gap-2"
                  disabled={employees.length === 0}
                >
                  <Trash2 className="w-4 h-4" />
                  Clear Data
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Are you absolutely sure?</DialogTitle>
                  <p className="text-sm text-slate-500 py-4">
                    This action will permanently delete all employee records from the database. This cannot be undone.
                  </p>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsClearDialogOpen(false)}>Cancel</Button>
                  <Button variant="destructive" onClick={handleClearAll}>Delete All Data</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
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
            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2">
                  <UserPlus className="w-4 h-4" />
                  Add Employee
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add New Employee</DialogTitle>
                </DialogHeader>
                <div className="grid grid-cols-2 gap-4 py-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">NIP</label>
                    <Input 
                      placeholder="112" 
                      value={newEmployee.nip} 
                      onChange={e => setNewEmployee({...newEmployee, nip: e.target.value})} 
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Full Name</label>
                    <Input 
                      placeholder="Abu Sofyan" 
                      value={newEmployee.name} 
                      onChange={e => setNewEmployee({...newEmployee, name: e.target.value})} 
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Skill</label>
                    <Input 
                      placeholder="MPBK" 
                      value={newEmployee.skill} 
                      onChange={e => setNewEmployee({...newEmployee, skill: e.target.value})} 
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Channel</label>
                    <Input 
                      placeholder="Call" 
                      value={newEmployee.channel} 
                      onChange={e => setNewEmployee({...newEmployee, channel: e.target.value})} 
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Site</label>
                    <Input 
                      placeholder="Semarang" 
                      value={newEmployee.site} 
                      onChange={e => setNewEmployee({...newEmployee, site: e.target.value})} 
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Gender</label>
                    <select 
                      className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                      value={newEmployee.gender}
                      onChange={e => setNewEmployee({...newEmployee, gender: e.target.value})}
                    >
                      <option value="L">L (Laki-laki / Male)</option>
                      <option value="P">P (Perempuan / Female)</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Religion</label>
                    <Input 
                      placeholder="Islam" 
                      value={newEmployee.religion} 
                      onChange={e => setNewEmployee({...newEmployee, religion: e.target.value})} 
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Email (Optional)</label>
                    <Input 
                      type="email" 
                      placeholder="john@example.com" 
                      value={newEmployee.email} 
                      onChange={e => setNewEmployee({...newEmployee, email: e.target.value})} 
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Extra Working Days</label>
                    <Input 
                      type="number" 
                      placeholder="0" 
                      value={newEmployee.extraWorkingDays} 
                      onChange={e => setNewEmployee({...newEmployee, extraWorkingDays: parseInt(e.target.value) || 0})} 
                    />
                  </div>
                  <div className="space-y-2 col-span-2">
                    <label className="text-sm font-medium">Extra Hours</label>
                    <Input 
                      type="number" 
                      placeholder="0" 
                      value={newEmployee.extraHours} 
                      onChange={e => setNewEmployee({...newEmployee, extraHours: parseInt(e.target.value) || 0})} 
                    />
                  </div>
                  
                  <div className="space-y-2 col-span-2 border-t pt-4">
                    <label className="text-sm font-bold text-slate-700 uppercase tracking-wider">Shift Preferences / Restrictions</label>
                    <p className="text-xs text-slate-500 pb-2">Select shifts this employee is allowed to work. Leave empty for all shifts.</p>
                    <div className="grid grid-cols-3 gap-2 max-h-32 overflow-y-auto p-2 border rounded-md bg-slate-50/50">
                      {shiftCodes.map(sc => (
                        <div key={sc.id} className="flex items-center space-x-2">
                          <Checkbox 
                            id={`pref-${sc.id}`} 
                            checked={newEmployee.preferredShifts?.includes(sc.code)}
                            onCheckedChange={(checked) => {
                              const current = newEmployee.preferredShifts || [];
                              if (checked) {
                                setNewEmployee({...newEmployee, preferredShifts: [...current, sc.code]});
                              } else {
                                setNewEmployee({...newEmployee, preferredShifts: current.filter(c => c !== sc.code)});
                              }
                            }}
                          />
                          <Label htmlFor={`pref-${sc.id}`} className="text-xs cursor-pointer">{sc.code}</Label>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>Cancel</Button>
                  <Button onClick={handleAddEmployee}>Save Employee</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </div>

      <Card className="border-none shadow-sm overflow-hidden">
        <CardHeader className="bg-white border-b border-slate-100 py-4">
          <div className="flex flex-col md:flex-row gap-4 items-center">
            <div className="relative flex-1 w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <Input 
                placeholder="Search employees..." 
                className="pl-10 bg-slate-50 border-none h-10"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>
            
            <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-lg">
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8 hover:bg-white"
                onClick={() => setTargetMonth(prev => subMonths(prev, 1))}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <div className="px-3 min-w-[140px] text-center">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 leading-tight">View Context</p>
                <p className="text-sm font-bold text-indigo-600 leading-tight">{format(targetMonth, 'MMMM yyyy')}</p>
              </div>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8 hover:bg-white"
                onClick={() => setTargetMonth(prev => addMonths(prev, 1))}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-slate-50/50">
              <TableRow>
                {isAdmin && (
                  <TableHead className="w-12">
                    <Checkbox 
                      checked={selectedIds.size === filteredEmployees.length && filteredEmployees.length > 0}
                      onCheckedChange={toggleSelectAll}
                    />
                  </TableHead>
                )}
                <TableHead>NIP</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Skill</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead>Site</TableHead>
                <TableHead>Gender</TableHead>
                {/* Last 7 Days of Prev Month Display (Dynamic Based on targetMonth) */}
                {(() => {
                  const historyMonth = subMonths(targetMonth, 1);
                  const lastDayHistory = endOfMonth(historyMonth);
                  const days = [];
                  for (let i = 6; i >= 0; i--) {
                    days.push(subDays(lastDayHistory, i));
                  }
                  return days.map(d => (
                    <TableHead key={format(d, 'yyyy-MM-dd')} className="text-[9px] font-black uppercase tracking-widest text-indigo-500 text-center w-12 border-l border-slate-100 bg-indigo-50/20">
                      <div className="flex flex-col items-center">
                        <span className="text-[7px] opacity-70 leading-none mb-0.5">{format(d, 'MMM')}</span>
                        <span className="text-[10px] leading-none">{format(d, 'dd')}</span>
                      </div>
                    </TableHead>
                  ));
                })()}
                <TableHead>Extra D/H</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEmployees.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 9 : 8} className="h-32 text-center text-slate-500">
                    No employees found.
                  </TableCell>
                </TableRow>
              ) : (
                filteredEmployees.map((emp) => (
                  <TableRow key={emp.id} className={`hover:bg-slate-50/50 transition-colors ${selectedIds.has(emp.id) ? 'bg-indigo-50/30' : ''}`}>
                    {isAdmin && (
                      <TableCell>
                        <Checkbox 
                          checked={selectedIds.has(emp.id)}
                          onCheckedChange={() => toggleSelect(emp.id)}
                        />
                      </TableCell>
                    )}
                    <TableCell className="font-mono text-xs">{emp.nip}</TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-slate-900">{emp.name}</span>
                        <span className="text-xs text-slate-500">{emp.religion}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-normal bg-blue-50 text-blue-700 border-blue-100">
                        {emp.skill}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-slate-600 text-sm">{emp.channel || '-'}</TableCell>
                    <TableCell className="text-slate-600 text-sm">{emp.site || '-'}</TableCell>
                    <TableCell className="text-slate-600 text-sm">{emp.gender || '-'}</TableCell>
                    {/* Last 7 Days values (Dynamic based on targetMonth) */}
                    {(() => {
                      const historyMonth = subMonths(targetMonth, 1);
                      const lastDayHistory = endOfMonth(historyMonth);
                      const days = [];
                      for (let i = 6; i >= 0; i--) {
                        days.push(format(subDays(lastDayHistory, i), 'yyyy-MM-dd'));
                      }
                      return days.map(dKey => {
                        const shift = legacyRoster[emp.id]?.[dKey];
                        const isNight = shift && shiftCodes.find(s => s.code === shift)?.isNightShift;
                        return (
                          <TableCell key={dKey} className={`text-[10px] font-bold text-center border-l border-slate-100 ${isNight ? 'bg-indigo-600 text-white' : shift === 'OFF' ? 'text-slate-300' : 'text-indigo-600'}`}>
                            {shift || '-'}
                          </TableCell>
                        );
                      });
                    })()}
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        {emp.extraWorkingDays ? <Badge variant="outline" className="text-[10px] text-indigo-600 border-indigo-100">+{emp.extraWorkingDays} Days</Badge> : null}
                        {emp.extraHours ? <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-100">+{emp.extraHours} Hours</Badge> : null}
                        {!emp.extraWorkingDays && !emp.extraHours && <span className="text-slate-300 text-[10px]">None</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {isAdmin && (
                          <>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="text-slate-400 hover:text-indigo-600"
                              onClick={() => {
                                setEditingEmployee({ ...emp, preferredShifts: emp.preferredShifts || [] });
                                setIsEditDialogOpen(true);
                              }}
                            >
                              <Edit2 className="w-4 h-4" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="text-slate-400 hover:text-destructive"
                              onClick={() => handleDeleteEmployee(emp.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Employee: {editingEmployee?.name}</DialogTitle>
          </DialogHeader>
          {editingEmployee && (
            <div className="grid grid-cols-2 gap-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">NIP</label>
                <Input value={editingEmployee.nip} disabled />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Full Name</label>
                <Input 
                  value={editingEmployee.name || ''} 
                  onChange={e => setEditingEmployee({...editingEmployee, name: e.target.value})} 
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Skill</label>
                <Input 
                  value={editingEmployee.skill || ''} 
                  onChange={e => setEditingEmployee({...editingEmployee, skill: e.target.value})} 
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Extra Working Days</label>
                <Input 
                  type="number" 
                  value={editingEmployee.extraWorkingDays || 0} 
                  onChange={e => setEditingEmployee({...editingEmployee, extraWorkingDays: parseInt(e.target.value) || 0})} 
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Gender</label>
                <select 
                  className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  value={editingEmployee.gender || 'L'}
                  onChange={e => setEditingEmployee({...editingEmployee, gender: e.target.value})}
                >
                  <option value="L">L (Laki-laki / Male)</option>
                  <option value="P">P (Perempuan / Female)</option>
                </select>
              </div>
              <div className="space-y-2 col-span-2">
                <label className="text-sm font-medium">Extra Hours</label>
                <Input 
                  type="number" 
                  value={editingEmployee.extraHours || 0} 
                  onChange={e => setEditingEmployee({...editingEmployee, extraHours: parseInt(e.target.value) || 0})} 
                />
              </div>

              <div className="space-y-2 col-span-2 border-t pt-4">
                <label className="text-sm font-bold text-slate-700 uppercase tracking-wider">Shift Preferences / Restrictions</label>
                <p className="text-xs text-slate-500 pb-2">Select shifts this employee is allowed to work. Leave empty for all shifts.</p>
                <div className="grid grid-cols-3 gap-2 max-h-32 overflow-y-auto p-2 border rounded-md bg-slate-50/50">
                  {shiftCodes.map(sc => (
                    <div key={sc.id} className="flex items-center space-x-2">
                      <Checkbox 
                        id={`edit-pref-${sc.id}`} 
                        checked={editingEmployee.preferredShifts?.includes(sc.code)}
                        onCheckedChange={(checked) => {
                          const current = editingEmployee.preferredShifts || [];
                          if (checked) {
                            setEditingEmployee({...editingEmployee, preferredShifts: [...current, sc.code]});
                          } else {
                            setEditingEmployee({...editingEmployee, preferredShifts: current.filter(c => c !== sc.code)});
                          }
                        }}
                      />
                      <Label htmlFor={`edit-pref-${sc.id}`} className="text-xs cursor-pointer">{sc.code}</Label>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleUpdateEmployee}>Update Employee</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
