import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import EmployeeList from './EmployeeList';
import LeaveManagement from './LeaveManagement';
import ShiftCodeManager from './ShiftCodeManager';
import WorkingDaysReference from './WorkingDaysReference';
import { Users, Calendar, Clock, BookOpen, Briefcase } from 'lucide-react';

interface WorkforceModuleProps {
  isAdmin: boolean;
}

export default function WorkforceModule(props: any) {
  const { isAdmin } = props;
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-3">
          <Briefcase className="w-8 h-8 text-indigo-600" />
          Workforce Hub
        </h1>
        <p className="text-slate-500">Manage your staff, schedules, leave requests, and operational policies.</p>
      </div>

      <Tabs defaultValue="employees" className="w-full">
        <div className="flex items-center justify-between mb-6">
          <TabsList className="grid grid-cols-4 w-full md:w-auto">
            <TabsTrigger value="employees" className="gap-2">
              <Users className="w-4 h-4" />
              <span className="hidden sm:inline">Employees</span>
            </TabsTrigger>
            <TabsTrigger value="leaves" className="gap-2">
              <Calendar className="w-4 h-4" />
              <span className="hidden sm:inline">Leaves</span>
            </TabsTrigger>
            <TabsTrigger value="shifts" className="gap-2">
              <Clock className="w-4 h-4" />
              <span className="hidden sm:inline">Shifts</span>
            </TabsTrigger>
            <TabsTrigger value="reference" className="gap-2">
              <BookOpen className="w-4 h-4" />
              <span className="hidden sm:inline">Policies</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="employees" className="mt-0 border-none p-0 outline-none">
          <EmployeeList {...props} />
        </TabsContent>
        
        <TabsContent value="leaves" className="mt-0 border-none p-0 outline-none">
          <LeaveManagement {...props} />
        </TabsContent>

        <TabsContent value="shifts" className="mt-0 border-none p-0 outline-none">
          <ShiftCodeManager {...props} />
        </TabsContent>

        <TabsContent value="reference" className="mt-0 border-none p-0 outline-none">
          <WorkingDaysReference {...props} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
