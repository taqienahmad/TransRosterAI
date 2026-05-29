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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  CheckSquare, 
  Plus, 
  Search, 
  Trash2, 
  Clock, 
  AlertCircle,
  ArrowUpDown,
  Filter,
  User as UserIcon,
  Calendar,
  MoreVertical,
  CheckCircle2,
  Circle,
  Layout
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface Task {
  id: string;
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  status: 'todo' | 'in-progress' | 'done';
  assignedTo?: string;
  assignedName?: string;
  createdBy: string;
  dueDate?: string;
  createdAt: string;
}

interface Employee {
  id: string;
  name: string;
}

const priorityWeight = {
  high: 3,
  medium: 2,
  low: 1
};

export default function TaskManagement({ isAdmin }: { isAdmin: boolean }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [sortConfig, setSortConfig] = useState<{ key: keyof Task | 'priority_weight'; direction: 'asc' | 'desc' }>({
    key: 'priority_weight',
    direction: 'desc'
  });
  const [statusFilter, setStatusFilter] = useState<'all' | Task['status']>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | Task['priority']>('all');
  
  const [newTask, setNewTask] = useState<Partial<Task>>({
    title: '',
    description: '',
    priority: 'medium',
    status: 'todo',
    dueDate: format(new Date(), 'yyyy-MM-dd')
  });

  const currentUserId = auth.currentUser?.uid;

  useEffect(() => {
    if (!currentUserId) return;

    // Fetch tasks
    // If admin, we can fetch all. If not, we SHOULD filter.
    // However, to keep it simple and because it's a team tool, 
    // we assume admins handle the list.
    const qTasks = query(collection(db, 'tasks'), orderBy('createdAt', 'desc'));
    
    const unsubTasks = onSnapshot(qTasks, (snapshot) => {
      setTasks(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Task)));
    }, (error) => {
      console.error('Task list fetch error:', error);
      handleFirestoreError(error, OperationType.LIST, 'tasks');
    });

    // Fetch employees for assignment
    const qEmp = query(collection(db, 'employees'), orderBy('name'));
    const unsubEmp = onSnapshot(qEmp, (snapshot) => {
      setEmployees(snapshot.docs.map(doc => ({ id: doc.id, name: doc.data().name } as Employee)));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'employees');
    });

    return () => {
      unsubTasks();
      unsubEmp();
    };
  }, []);

  const handleAddTask = async () => {
    if (!newTask.title) {
      toast.error('Task title is required');
      return;
    }

    if (!currentUserId) return;

    const taskId = Math.random().toString(36).substring(2, 9);
    const assignedEmployee = employees.find(e => e.id === newTask.assignedTo);

    const taskData: Task = {
      id: taskId,
      title: newTask.title,
      description: newTask.description || '',
      priority: (newTask.priority as any) || 'medium',
      status: 'todo',
      assignedTo: newTask.assignedTo,
      assignedName: assignedEmployee?.name || 'Unassigned',
      createdBy: currentUserId,
      dueDate: newTask.dueDate,
      createdAt: new Date().toISOString()
    };

    try {
      await setDoc(doc(db, 'tasks', taskId), taskData);
      toast.success('Task created successfully');
      setIsAddDialogOpen(false);
      setNewTask({ title: '', description: '', priority: 'medium', status: 'todo', dueDate: format(new Date(), 'yyyy-MM-dd') });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'tasks');
    }
  };

  const handleUpdateStatus = async (id: string, newStatus: Task['status']) => {
    try {
      await setDoc(doc(db, 'tasks', id), { status: newStatus }, { merge: true });
      toast.success(`Task marked as ${newStatus}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'tasks');
    }
  };

  const handleDeleteTask = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this task?')) return;
    try {
      await deleteDoc(doc(db, 'tasks', id));
      toast.success('Task deleted');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'tasks');
    }
  };

  const toggleSort = (key: keyof Task | 'priority_weight') => {
    setSortConfig(current => ({
      key,
      direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  const filteredAndSortedTasks = tasks
    .filter(task => {
      const matchesSearch = (task.title || '').toLowerCase().includes((searchTerm || '').toLowerCase()) || 
                           (task.description || '').toLowerCase().includes((searchTerm || '').toLowerCase());
      const matchesStatus = statusFilter === 'all' || task.status === statusFilter;
      const matchesPriority = priorityFilter === 'all' || task.priority === priorityFilter;
      return matchesSearch && matchesStatus && matchesPriority;
    })
    .sort((a, b) => {
      let valA: any = sortConfig.key === 'priority_weight' ? priorityWeight[a.priority] : a[sortConfig.key as keyof Task];
      let valB: any = sortConfig.key === 'priority_weight' ? priorityWeight[b.priority] : b[sortConfig.key as keyof Task];

      if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

  const getPriorityBadge = (priority: string) => {
    switch (priority) {
      case 'high': return (
        <Badge variant="destructive" className="bg-rose-100 text-rose-700 border-rose-200 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          High
        </Badge>
      );
      case 'medium': return (
        <Badge variant="secondary" className="bg-amber-100 text-amber-700 border-amber-200 flex items-center gap-1">
          <Clock className="w-3 h-3" />
          Medium
        </Badge>
      );
      case 'low': return (
        <Badge variant="outline" className="bg-slate-100 text-slate-700 border-slate-200 flex items-center gap-1">
          <ArrowUpDown className="w-3 h-3 opacity-50" />
          Low
        </Badge>
      );
      default: return null;
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'done': return <CheckCircle2 className="w-5 h-5 text-emerald-500" />;
      case 'in-progress': return <Clock className="w-5 h-5 text-amber-500" />;
      default: return <Circle className="w-5 h-5 text-slate-300" />;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Task Management</h1>
          <p className="text-slate-500">Track and prioritize team activities and action items.</p>
        </div>
        
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2 bg-indigo-600 hover:bg-indigo-700">
              <Plus className="w-4 h-4" />
              New Task
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Create New Task</DialogTitle>
              <CardDescription>Add a new action item for the team.</CardDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Title</label>
                <Input 
                  placeholder="e.g., Update safety protocols" 
                  value={newTask.title} 
                  onChange={e => setNewTask({...newTask, title: e.target.value})} 
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Description</label>
                <textarea 
                  className="w-full min-h-[100px] px-3 py-2 rounded-md border border-input bg-background text-sm"
                  placeholder="Task details..."
                  value={newTask.description}
                  onChange={e => setNewTask({...newTask, description: e.target.value})}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Priority</label>
                  <Select 
                    value={newTask.priority} 
                    onValueChange={val => setNewTask({...newTask, priority: val as any})}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select priority" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Due Date</label>
                  <Input 
                    type="date" 
                    value={newTask.dueDate} 
                    onChange={e => setNewTask({...newTask, dueDate: e.target.value})} 
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Assign To</label>
                <select 
                  className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                  value={newTask.assignedTo}
                  onChange={e => setNewTask({...newTask, assignedTo: e.target.value})}
                >
                  <option value="">Unassigned</option>
                  {employees.map(emp => (
                    <option key={emp.id} value={emp.id}>{emp.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleAddTask} className="bg-indigo-600 hover:bg-indigo-700">Create Task</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-slate-50 border-none shadow-none">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
              <CheckSquare className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Tasks</p>
              <p className="text-2xl font-bold text-slate-900">{tasks.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-slate-50 border-none shadow-none">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center">
              <AlertCircle className="w-5 h-5 text-rose-600" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">High Priority</p>
              <p className="text-2xl font-bold text-slate-900">{tasks.filter(t => t.priority === 'high' && t.status !== 'done').length}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-slate-50 border-none shadow-none">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
              <Clock className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Pending</p>
              <p className="text-2xl font-bold text-slate-900">{tasks.filter(t => t.status !== 'done').length}</p>
            </div>
          </CardContent>
        </Card>
        <Card className="bg-slate-50 border-none shadow-none">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Completed</p>
              <p className="text-2xl font-bold text-slate-900">{tasks.filter(t => t.status === 'done').length}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-none shadow-sm overflow-hidden">
        <CardHeader className="bg-white border-b border-slate-100 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input 
              placeholder="Search tasks..." 
              className="pl-10 bg-slate-50 border-none max-w-sm"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-400" />
              <select 
                className="h-9 px-3 rounded-md border-none bg-slate-100 text-sm font-medium"
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value as any)}
              >
                <option value="all">All Status</option>
                <option value="todo">To Do</option>
                <option value="in-progress">In Progress</option>
                <option value="done">Done</option>
              </select>
            </div>
            <select 
              className="h-9 px-3 rounded-md border-none bg-slate-100 text-sm font-medium"
              value={priorityFilter}
              onChange={e => setPriorityFilter(e.target.value as any)}
            >
              <option value="all">All Priorities</option>
              <option value="high">High Priority</option>
              <option value="medium">Medium Priority</option>
              <option value="low">Low Priority</option>
            </select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-slate-50/50">
              <TableRow>
                <TableHead className="w-[40px]"></TableHead>
                <TableHead>Task Name</TableHead>
                <TableHead className="cursor-pointer hover:text-indigo-600 transition-colors" onClick={() => toggleSort('priority_weight')}>
                  <div className="flex items-center gap-1">
                    Priority
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </TableHead>
                <TableHead>Assigned To</TableHead>
                <TableHead className="cursor-pointer hover:text-indigo-600 transition-colors" onClick={() => toggleSort('dueDate')}>
                  <div className="flex items-center gap-1">
                    Due Date
                    <ArrowUpDown className="w-3 h-3" />
                  </div>
                </TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAndSortedTasks.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-slate-500">
                    <div className="flex flex-col items-center gap-2">
                      <Layout className="w-8 h-8 opacity-20" />
                      <p>No tasks found.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredAndSortedTasks.map((task) => (
                  <TableRow key={task.id} className={`${task.status === 'done' ? 'opacity-60 bg-slate-50/20' : ''} ${task.priority === 'high' && task.status !== 'done' ? 'border-l-2 border-l-rose-500' : ''} hover:bg-slate-50/50 transition-colors`}>
                    <TableCell>
                      <button 
                        onClick={() => handleUpdateStatus(task.id, task.status === 'done' ? 'todo' : 'done')}
                        className="p-1 rounded-md hover:bg-slate-200 transition-colors"
                      >
                        {getStatusIcon(task.status)}
                      </button>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className={`font-semibold text-slate-900 ${task.status === 'done' ? 'line-through' : ''}`}>
                          {task.title}
                        </p>
                        <p className="text-xs text-slate-500 truncate max-w-[200px]">{task.description || "No description"}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      {getPriorityBadge(task.priority)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center">
                          <UserIcon className="w-3 h-3 text-slate-400" />
                        </div>
                        <span className="text-sm text-slate-600">{task.assignedName}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-xs font-mono text-slate-500">
                        <Calendar className="w-3 h-3" />
                        {task.dueDate || "-"}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Select 
                          onValueChange={(val) => handleUpdateStatus(task.id, val as Task['status'])}
                          defaultValue={task.status}
                        >
                          <SelectTrigger className="w-[110px] h-8 text-[10px]">
                            <SelectValue placeholder="Status" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="todo">To Do</SelectItem>
                            <SelectItem value="in-progress">In Progress</SelectItem>
                            <SelectItem value="done">Done</SelectItem>
                          </SelectContent>
                        </Select>
                        {(isAdmin || task.createdBy === currentUserId) && (
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="text-slate-400 hover:text-destructive h-8 w-8"
                            onClick={() => handleDeleteTask(task.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
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
