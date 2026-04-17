import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { 
  Database, 
  Cloud, 
  Cpu, 
  ArrowRight, 
  Users, 
  Calendar, 
  TrendingUp, 
  ShieldCheck, 
  Globe,
  Server,
  Workflow,
  Settings,
  BrainCircuit,
  Lock,
  Zap,
  Layers
} from 'lucide-react';
import { motion } from 'motion/react';

export default function SystemArchitecture() {
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: { 
      opacity: 1,
      transition: { 
        staggerChildren: 0.1 
      }
    }
  };

  const itemVariants = {
    hidden: { y: 20, opacity: 0 },
    visible: { y: 0, opacity: 1 }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 group flex items-center gap-3">
          <Workflow className="w-8 h-8 text-indigo-600 group-hover:rotate-12 transition-transform" />
          System Architecture & Data Flow
        </h1>
        <p className="text-slate-500 mt-2">Visualization of the underlying infrastructure and data movement within TransRosterAI.</p>
      </div>

      <motion.div 
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-1 gap-12"
      >
        {/* Section 1: Data Flow Diagram */}
        <section className="space-y-6">
          <div className="flex items-center gap-2 mb-4">
            <Layers className="w-5 h-5 text-indigo-500" />
            <h2 className="text-xl font-bold text-slate-800">Operational Data Flow</h2>
          </div>
          
          <div className="relative p-8 bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="absolute inset-0 bg-grid-slate-100 [mask-image:linear-gradient(0deg,#fff,rgba(255,255,255,0.6))] -z-10" />
            
            <div className="flex flex-col lg:flex-row items-center justify-between gap-8 relative z-10">
              
              {/* Data Ingestion */}
              <FlowBlock 
                icon={<Database className="w-6 h-6" />}
                title="Input Layer"
                items={["CSV Volume Volume", "Shift Definitions", "Staff Records"]}
                color="bg-blue-50 text-blue-700 border-blue-100"
              />

              <FlowArrow />

              {/* Logic Engines */}
              <FlowBlock 
                icon={<Cpu className="w-6 h-6" />}
                title="Logic Engines"
                items={["Erlang-C Staffing", "Roster Algorithm", "Constraint Check"]}
                color="bg-indigo-50 text-indigo-700 border-indigo-100"
                highlight
              />

              <FlowArrow />

              {/* Intelligence Layer */}
              <FlowBlock 
                icon={<BrainCircuit className="w-6 h-6" />}
                title="AI Analysis"
                items={["Gemini 2.0 Flash", "Pattern Detection", "Staffing Recs"]}
                color="bg-purple-50 text-purple-700 border-purple-100"
              />

              <FlowArrow />

              {/* Output Layer */}
              <FlowBlock 
                icon={<Zap className="w-6 h-6" />}
                title="Output Hub"
                items={["Final Monthly Roster", "Live Dashboards", "Audit Logs"]}
                color="bg-emerald-50 text-emerald-700 border-emerald-100"
              />

            </div>
          </div>
        </section>

        {/* Section 2: Technical Topology */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          <Card className="border-none shadow-lg bg-white overflow-hidden">
            <CardHeader className="border-b border-slate-50">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600">
                  <Globe className="w-5 h-5" />
                </div>
                <div>
                  <CardTitle>Frontend Topology</CardTitle>
                  <CardDescription>Client-side environment and technologies</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-6">
              <div className="space-y-4">
                <TopologyItem 
                  label="Runtime" 
                  value="React 18 + TypeScript" 
                  desc="Type-safe components for robust roster logic."
                />
                <TopologyItem 
                  label="State" 
                  value="React Hooks + Firebase Real-time" 
                  desc="Instant updates across all dashboard views."
                />
                <TopologyItem 
                  label="Engines" 
                  value="JavaScript (Web Worker optimized)" 
                  desc="Erlang calculations run locally in your browser."
                />
                <TopologyItem 
                  label="Styling" 
                  value="Tailwind CSS + Framer Motion" 
                  desc="Utility-first CSS with 60fps animations."
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-lg bg-slate-900 text-white overflow-hidden">
            <CardHeader className="border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-500/20 rounded-lg text-indigo-400">
                  <Cloud className="w-5 h-5" />
                </div>
                <div>
                  <CardTitle className="text-white">Cloud Topology</CardTitle>
                  <CardDescription className="text-slate-400">Backend and managed services</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-6">
              <div className="space-y-4">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center shrink-0">
                    <Database className="w-5 h-5 text-indigo-400" />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-100">Cloud Firestore</h4>
                    <p className="text-sm text-slate-400">Serverless NoSQL database. Stores the blueprints and monthly results.</p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center shrink-0">
                    <Lock className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-100">Firebase Auth</h4>
                    <p className="text-sm text-slate-400">Role-based access control (RBAC) powered by Google Identity.</p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center shrink-0">
                    <Server className="w-5 h-5 text-amber-400" />
                  </div>
                  <div>
                    <h4 className="font-bold text-slate-100">Google Cloud Run</h4>
                    <p className="text-sm text-slate-400">Fully managed container hosting for the application bundle.</p>
                  </div>
                </div>

                <div className="mt-8 p-4 bg-indigo-500/10 rounded-2xl border border-indigo-500/20">
                  <div className="flex items-center gap-2 mb-2">
                    <ShieldCheck className="w-4 h-4 text-indigo-400" />
                    <span className="text-xs font-bold uppercase tracking-widest text-indigo-300">Security Layer</span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Firestore Security Rules ensure only authenticated administrators can modify core staffing levels 
                    and operational windows.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

        </div>
      </motion.div>
    </div>
  );
}

function FlowBlock({ icon, title, items, color, highlight = false }: { icon: React.ReactNode, title: string, items: string[], color: string, highlight?: boolean }) {
  return (
    <motion.div 
      whileHover={{ y: -5 }}
      className={`w-64 p-5 rounded-2xl border-2 shadow-sm ${color} ${highlight ? 'ring-4 ring-indigo-500/10' : ''}`}
    >
      <div className="mb-3">{icon}</div>
      <h3 className="font-bold text-lg mb-2">{title}</h3>
      <ul className="space-y-1">
        {items.map((item, idx) => (
          <li key={idx} className="text-xs opacity-75 flex items-center gap-2">
            <div className="w-1 h-1 rounded-full bg-current" />
            {item}
          </li>
        ))}
      </ul>
    </motion.div>
  );
}

function FlowArrow() {
  return (
    <div className="hidden lg:flex flex-col items-center">
      <ArrowRight className="w-6 h-6 text-slate-300" />
      <div className="w-1 h-12 bg-slate-100 rotate-90" />
    </div>
  );
}

function TopologyItem({ label, value, desc }: { label: string, value: string, desc: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase font-bold text-slate-400 tracking-widest">{label}</span>
        <span className="text-sm font-bold text-slate-900">{value}</span>
      </div>
      <p className="text-xs text-slate-500">{desc}</p>
      <div className="mt-2 h-px bg-slate-100" />
    </div>
  );
}
