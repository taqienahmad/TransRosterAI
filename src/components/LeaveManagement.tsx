import React, { useState, useEffect } from 'react';
import { 
  db, 
  collection, 
  onSnapshot, 
  query, 
  orderBy, 
  setDoc, 
  doc, 
  deleteDoc, 
  auth,
  OperationType, 
  handleFirestoreError,
  where 
} from '../lib/firebase';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import * as XLSX from 'xlsx';
import { 
  Calendar, 
  Plus, 
  Search, 
  Trash2, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Filter,
  User as UserIcon,
  CalendarDays,
  Download,
  Upload,
  Edit2,
  Pencil,
  FileSpreadsheet,
  Save,
  X
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  type: 'annual' | 'sick' | 'casual' | 'other';
  status: 'pending' | 'approved' | 'rejected';
  reason?: string;
  submittedAt: string;
}

interface Employee {
  id: string;
  name: string;
  email: string;
}

export default function LeaveManagement({ isAdmin }: { isAdmin: boolean }) {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newRequest, setNewRequest] = useState<Partial<LeaveRequest>>({
    date: format(new Date(), 'yyyy-MM-dd'),
    type: 'annual',
    reason: ''
  });
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<LeaveRequest>>({});

  const currentUserId = auth.currentUser?.uid;

  useEffect(() => {
    // Fetch employees for dropdown (if admin) or just current employee
    const qEmp = query(collection(db, 'employees'), orderBy('name'));
    const unsubEmp = onSnapshot(qEmp, (snapshot) => {
      setEmployees(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Employee)));
    });

    const qReq = isAdmin 
      ? query(collection(db, 'leaveRequests'), orderBy('submittedAt', 'desc'))
      : query(collection(db, 'leaveRequests'), where('employeeId', '==', currentUserId), orderBy('submittedAt', 'desc'));

    const unsubReq = onSnapshot(qReq, (snapshot) => {
      const list = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as LeaveRequest));
      // If not admin, filter to only show user's own requests
      // Note: Security rules also enforce this, but double check in UI
      setRequests(isAdmin ? list : list.filter(r => r.employeeId === currentUserId));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'leaveRequests');
    });

    return () => {
      unsubEmp();
      unsubReq();
    };
  }, [isAdmin, currentUserId]);

  const handleAddRequest = async () => {
    if (!currentUserId) {
      toast.error('You must be logged in to submit a request');
      return;
    }

    // Find employee record for current user
    const employee = employees.find(e => e.id === currentUserId) || 
                     employees.find(e => e.email === auth.currentUser?.email);
    
    if (!employee && !isAdmin) {
      toast.error('Employee record not found. Please contact admin.');
      return;
    }

    const requestId = Math.random().toString(36).substring(2, 9);
    const submission: LeaveRequest = {
      id: requestId,
      employeeId: employee?.id || currentUserId,
      employeeName: employee?.name || auth.currentUser?.displayName || 'Unknown Staff',
      date: newRequest.date || format(new Date(), 'yyyy-MM-dd'),
      type: (newRequest.type as any) || 'annual',
      status: 'pending',
      reason: newRequest.reason || '',
      submittedAt: new Date().toISOString()
    };

    try {
      await setDoc(doc(db, 'leaveRequests', requestId), submission);
      toast.success('Leave request submitted successfully');
      setIsAddDialogOpen(false);
      setNewRequest({ date: format(new Date(), 'yyyy-MM-dd'), type: 'annual', reason: '' });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'leaveRequests');
    }
  };

  const handleUpdateStatus = async (id: string, newStatus: 'approved' | 'rejected') => {
    if (!isAdmin) return;
    try {
      const ref = doc(db, 'leaveRequests', id);
      await setDoc(ref, { status: newStatus }, { merge: true });
      toast.success(`Request ${newStatus}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'leaveRequests');
    }
  };

  const handleDeleteRequest = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'leaveRequests', id));
      toast.success('Request deleted');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'leaveRequests');
    }
  };

  const handleDownloadTemplate = () => {
    const data = [
      {
        employee_id: 'emp_123',
        employee_name: 'John Doe',
        date: format(new Date(), 'yyyy-MM-dd'),
        type: 'annual',
        reason: 'Vacation',
        status: 'pending'
      }
    ];

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Leave Template");
    
    // Auto-size columns
    const max_width = data.reduce((w, r) => Math.max(w, r.employee_name.length), 10);
    worksheet["!cols"] = [ { wch: 15 }, { wch: max_width + 5 }, { wch: 15 }, { wch: 12 }, { wch: 30 }, { wch: 12 } ];

    XLSX.writeFile(workbook, "leave_request_template.xlsx");
    toast.success('Excel template downloaded');
  };

  const handleUploadFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const data = new Uint8Array(e.target?.result as ArrayBuffer);
      const workbook = XLSX.read(data, { 
        type: 'array',
        cellDates: true,
        cellNF: false,
        cellText: false
      });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet);
      
      let successCount = 0;
      let errorCount = 0;

      for (const row of jsonData as any[]) {
        // Normalize keys (case-insensitive)
        const normalizedRow: any = {};
        Object.keys(row).forEach(key => {
          normalizedRow[key.toLowerCase().trim().replace(/ /g, '_')] = row[key];
        });

        if (normalizedRow.employee_id && normalizedRow.date) {
          const id = Math.random().toString(36).substring(2, 9);
          
          let dateStr = normalizedRow.date;
          if (dateStr instanceof Date) {
            dateStr = format(dateStr, 'yyyy-MM-dd');
          } else if (typeof dateStr === 'string' && dateStr.includes('T')) {
             dateStr = dateStr.split('T')[0];
          }

          const submission: LeaveRequest = {
            id,
            employeeId: String(normalizedRow.employee_id),
            employeeName: normalizedRow.employee_name || 'Uploaded Staff',
            date: String(dateStr),
            type: (normalizedRow.type as any) || 'annual',
            status: (normalizedRow.status as any) || 'pending',
            reason: normalizedRow.reason || '',
            submittedAt: new Date().toISOString()
          };

          try {
            await setDoc(doc(db, 'leaveRequests', id), submission);
            successCount++;
          } catch (err) {
            console.error('Failed to upload row:', submission, err);
            errorCount++;
            handleFirestoreError(err, OperationType.CREATE, `leaveRequests/${id}`);
          }
        }
      }

      if (successCount > 0) toast.success(`Successfully uploaded ${successCount} requests`);
      if (errorCount > 0) toast.error(`Failed to upload ${errorCount} requests`);
    };
    reader.readAsArrayBuffer(file);
    event.target.value = '';
  };

  const startEditing = (req: LeaveRequest) => {
    setEditingId(req.id);
    setEditForm(req);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditForm({});
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    try {
      await setDoc(doc(db, 'leaveRequests', editingId), editForm, { merge: true });
      toast.success('Request updated');
      setEditingId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'leaveRequests');
    }
  };

  const filteredRequests = requests.filter(req => {
    const matchesSearch = req.employeeName.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         (req.reason || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === 'all' || req.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'approved': return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200"><CheckCircle2 className="w-3 h-3 mr-1" /> Approved</Badge>;
      case 'rejected': return <Badge variant="destructive" className="bg-rose-100 text-rose-700 border-rose-200"><XCircle className="w-3 h-3 mr-1" /> Rejected</Badge>;
      default: return <Badge variant="secondary" className="bg-amber-100 text-amber-700 border-amber-200"><Clock className="w-3 h-3 mr-1" /> Pending</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Leave Management</h1>
          <p className="text-slate-500">
            {isAdmin ? 'Manage and approve staff leave requests.' : 'Submit and track your leave requests.'}
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          {isAdmin && (
            <>
              <Button variant="outline" className="gap-2" onClick={handleDownloadTemplate}>
                <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                Template
              </Button>
              <div className="relative">
                <input 
                  type="file" 
                  accept=".csv, .xlsx, .xls" 
                  className="absolute inset-0 opacity-0 cursor-pointer" 
                  onChange={handleUploadFile}
                />
                <Button variant="outline" className="gap-2">
                  <Upload className="w-4 h-4" />
                  Upload
                </Button>
              </div>
            </>
          )}
          {!isAdmin && (
            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2 bg-indigo-600 hover:bg-indigo-700">
                  <Plus className="w-4 h-4" />
                  Request Leave
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>New Leave Request</DialogTitle>
                  <CardDescription>Submit a request for a future date.</CardDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Leave Date</label>
                    <Input 
                      type="date" 
                      value={newRequest.date} 
                      onChange={e => setNewRequest({...newRequest, date: e.target.value})} 
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Leave Type</label>
                    <select 
                      className="w-full h-10 px-3 rounded-md border border-input bg-background"
                      value={newRequest.type}
                      onChange={e => setNewRequest({...newRequest, type: e.target.value as any})}
                    >
                      <option value="annual">Annual Leave</option>
                      <option value="sick">Sick Leave</option>
                      <option value="casual">Casual Leave</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Reason (Optional)</label>
                    <Input 
                      placeholder="Going on vacation..." 
                      value={newRequest.reason} 
                      onChange={e => setNewRequest({...newRequest, reason: e.target.value})} 
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>Cancel</Button>
                  <Button onClick={handleAddRequest} className="bg-indigo-600 hover:bg-indigo-700">Submit Request</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      <Card className="border-none shadow-sm overflow-hidden">
        <CardHeader className="bg-white border-b border-slate-100 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input 
              placeholder="Search by name or reason..." 
              className="pl-10 bg-slate-50 border-none max-w-sm"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-slate-400" />
            <select 
              className="h-9 px-3 rounded-md border-none bg-slate-100 text-sm font-medium"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as any)}
            >
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-slate-50/50">
              <TableRow>
                {isAdmin && <TableHead>Employee</TableHead>}
                <TableHead>Date</TableHead>
                <TableHead>Leave Type</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredRequests.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={isAdmin ? 6 : 5} className="h-32 text-center text-slate-500">
                    <div className="flex flex-col items-center gap-2">
                      <CalendarDays className="w-8 h-8 opacity-20" />
                      <p>No leave requests found.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredRequests.map((req) => (
                  <TableRow key={req.id} className="hover:bg-slate-50/50 transition-colors">
                    {isAdmin && (
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
                            <UserIcon className="w-4 h-4 text-slate-500" />
                          </div>
                          <span className="font-medium text-slate-900">{req.employeeName}</span>
                        </div>
                      </TableCell>
                    )}
                    <TableCell>
                      {editingId === req.id ? (
                        <Input 
                          type="date" 
                          className="h-8 text-xs font-mono w-32"
                          value={editForm.date}
                          onChange={e => setEditForm({...editForm, date: e.target.value})}
                        />
                      ) : (
                        <div className="flex items-center gap-2 font-mono text-sm text-slate-600">
                          <Calendar className="w-3.5 h-3.5" />
                          {req.date}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {editingId === req.id ? (
                        <select 
                          className="h-8 text-xs px-2 rounded-md border border-input bg-background"
                          value={editForm.type}
                          onChange={e => setEditForm({...editForm, type: e.target.value as any})}
                        >
                          <option value="annual">Annual</option>
                          <option value="sick">Sick</option>
                          <option value="casual">Casual</option>
                          <option value="other">Other</option>
                        </select>
                      ) : (
                        <Badge variant="outline" className="capitalize">
                          {req.type}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-slate-600">
                      {editingId === req.id ? (
                        <Input 
                          className="h-8 text-xs"
                          value={editForm.reason}
                          onChange={e => setEditForm({...editForm, reason: e.target.value})}
                        />
                      ) : (
                        req.reason || "-"
                      )}
                    </TableCell>
                    <TableCell>
                      {editingId === req.id && isAdmin ? (
                         <select 
                          className="h-8 text-xs px-2 rounded-md border border-input bg-background"
                          value={editForm.status}
                          onChange={e => setEditForm({...editForm, status: e.target.value as any})}
                        >
                          <option value="pending">Pending</option>
                          <option value="approved">Approved</option>
                          <option value="rejected">Rejected</option>
                        </select>
                      ) : (
                        getStatusBadge(req.status)
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {editingId === req.id ? (
                          <>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-600" onClick={handleSaveEdit}>
                              <Save className="w-4 h-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400" onClick={cancelEditing}>
                              <X className="w-4 h-4" />
                            </Button>
                          </>
                        ) : (
                          <>
                            {isAdmin && req.status === 'pending' && (
                              <>
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 h-8 text-[10px] font-bold uppercase tracking-wider px-2"
                                  onClick={() => handleUpdateStatus(req.id, 'approved')}
                                >
                                  Approve
                                </Button>
                                <Button 
                                  variant="ghost" 
                                  size="sm" 
                                  className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 h-8 text-[10px] font-bold uppercase tracking-wider px-2"
                                  onClick={() => handleUpdateStatus(req.id, 'rejected')}
                                >
                                  Reject
                                </Button>
                              </>
                            )}
                            {(isAdmin || req.status === 'pending') && (
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="text-slate-400 hover:text-indigo-600 h-8 w-8"
                                onClick={() => startEditing(req)}
                              >
                                <Pencil className="w-4 h-4" />
                              </Button>
                            )}
                            {(isAdmin || req.status === 'pending') && (
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="text-slate-400 hover:text-destructive h-8 w-8"
                                onClick={() => handleDeleteRequest(req.id)}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
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
    </div>
  );
}
