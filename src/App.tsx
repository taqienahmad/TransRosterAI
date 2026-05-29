import React, { useState, useEffect } from 'react';
import { 
  auth, 
  db, 
  googleProvider, 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  collection, 
  onSnapshot, 
  query, 
  orderBy,
  User,
  doc,
  getDoc,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  setDoc
} from './lib/firebase';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { 
  Users, 
  Calendar, 
  TrendingUp, 
  LogOut, 
  LayoutDashboard,
  Plus,
  Clock,
  ShieldCheck,
  Mail,
  Lock,
  User as UserIcon,
  ArrowRight,
  Workflow,
  Sparkles,
  BookOpen,
  Briefcase,
  AlertTriangle,
  Zap
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Components
import EmployeeList from './components/EmployeeList';
import ForecastView from './components/ForecastView';
import ErlangForecaster from './components/ErlangForecaster';
import ShiftCodeManager from './components/ShiftCodeManager';
import ForecastVolume from './components/ForecastVolume';
import RosterView from './components/RosterView';
import WorkingDaysReference from './components/WorkingDaysReference';
import LeaveManagement from './components/LeaveManagement';
import SystemArchitecture from './components/SystemArchitecture';
import ForecastingModule from './components/ForecastingModule';
import WorkforceModule from './components/WorkforceModule';
import SchedulingHub from './components/SchedulingHub';
import CalculationLibrary from './components/CalculationLibrary';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('forecasting');
  
  // Shared Data State for System Integration
  const [employees, setEmployees] = useState<any[]>([]);
  const [shiftCodes, setShiftCodes] = useState<any[]>([]);
  const [allVolumeData, setAllVolumeData] = useState<any[]>([]);
  const [workingDaysRef, setWorkingDaysRef] = useState<any[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<any[]>([]);
  const [roster, setRoster] = useState<any[]>([]);
  const [legacyRoster, setLegacyRoster] = useState<Record<string, Record<string, string>>>({});
  const [erlangSettings, setErlangSettings] = useState<any>(null);
  const [erlangResults, setErlangResults] = useState<any[]>([]);
  const [schedulingConstraints, setSchedulingConstraints] = useState<any>(null);
  const [historicalVolume, setHistoricalVolume] = useState<any[]>([]);
  const [forecastEvents, setForecastEvents] = useState<any[]>([]);

  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;

    const unsubs: (() => void)[] = [];

    const handleSnapshotError = (error: any) => {
      console.error("Firestore Snapshot Sync Error:", error);
      if (error?.code === 'unavailable' || error?.message?.includes('unavailable') || error?.message?.includes('unreachable') || error?.message?.includes('Could not reach')) {
        setConnectionError("database_unavailable");
      } else {
        setConnectionError(error?.message || String(error));
      }
    };

    const handleSnapshotSuccess = () => {
      setConnectionError(null);
    };

    // 1. Volume Data
    unsubs.push(onSnapshot(query(collection(db, 'forecastVolume')), (snap) => {
      setAllVolumeData(snap.docs.map(doc => doc.data()));
      handleSnapshotSuccess();
    }, handleSnapshotError));

    // 2. Employees
    unsubs.push(onSnapshot(query(collection(db, 'employees')), (snap) => {
      setEmployees(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      handleSnapshotSuccess();
    }, handleSnapshotError));

    // 3. Shift Codes
    unsubs.push(onSnapshot(query(collection(db, 'shiftCodes')), (snap) => {
      setShiftCodes(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      handleSnapshotSuccess();
    }, handleSnapshotError));

    // 4. Working Days Ref
    unsubs.push(onSnapshot(query(collection(db, 'workingDaysRef')), (snap) => {
      setWorkingDaysRef(snap.docs.map(doc => doc.data()));
      handleSnapshotSuccess();
    }, handleSnapshotError));

    // 5. Leave Requests
    unsubs.push(onSnapshot(query(collection(db, 'leaveRequests')), (snap) => {
      setLeaveRequests(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      handleSnapshotSuccess();
    }, handleSnapshotError));

    // 6. Current Roster
    unsubs.push(onSnapshot(doc(db, 'roster', 'current'), (snap) => {
      if (snap.exists()) setRoster(snap.data().roster || []);
      handleSnapshotSuccess();
    }, handleSnapshotError));

    // 7. Legacy Roster
    unsubs.push(onSnapshot(collection(db, 'legacyRoster'), (snap) => {
      const data: Record<string, Record<string, string>> = {};
      snap.docs.forEach(doc => { data[doc.id] = doc.data() as Record<string, string>; });
      setLegacyRoster(data);
      handleSnapshotSuccess();
    }, handleSnapshotError));

    // 8. Erlang Settings
    unsubs.push(onSnapshot(doc(db, 'erlangSettings', 'current'), (snap) => {
      if (snap.exists()) setErlangSettings(snap.data());
      handleSnapshotSuccess();
    }, handleSnapshotError));

    // 9. Scheduling Constraints
    unsubs.push(onSnapshot(doc(db, 'schedulingConstraints', 'current'), (snap) => {
      if (snap.exists()) setSchedulingConstraints(snap.data());
      handleSnapshotSuccess();
    }, handleSnapshotError));

    // 10. Historical Volume
    unsubs.push(onSnapshot(query(collection(db, 'historicalVolume')), (snap) => {
      setHistoricalVolume(snap.docs.map(doc => doc.data()));
      handleSnapshotSuccess();
    }, handleSnapshotError));

    // 11. Forecast Events
    unsubs.push(onSnapshot(query(collection(db, 'forecastEvents')), (snap) => {
      setForecastEvents(snap.docs.map(doc => doc.data()));
      handleSnapshotSuccess();
    }, handleSnapshotError));

    // 12. Erlang Results
    unsubs.push(onSnapshot(query(collection(db, 'erlangResults')), (snap) => {
      setErlangResults(snap.docs.map(doc => doc.data()));
      handleSnapshotSuccess();
    }, handleSnapshotError));

    return () => unsubs.forEach(u => u());
  }, [user]);

  // Auth Form State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authLoading, setAuthLoading] = useState(false);

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace('#', '');
      if (hash && ['forecasting', 'workforce', 'scheduling', 'architecture', 'calculation-library'].includes(hash)) {
        setActiveTab(hash);
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    handleHashChange(); // Check on mount
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user);
      if (user) {
        // Check admin status
        try {
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          const userData = userDoc.data();
          setIsAdmin(userData?.role === 'admin' || user.email === 'taqienahmad@gmail.com');
          setConnectionError(null);
        } catch (err: any) {
          console.error("Failed to fetch user permissions:", err);
          if (err?.code === 'unavailable' || err?.message?.includes('unavailable') || err?.message?.includes('unreachable') || err?.message?.includes('Could not reach')) {
            setConnectionError("database_unavailable");
          } else {
            setConnectionError(err?.message || 'Unable to connect to database');
          }
          // Fallback to email checks if DB is offline
          setIsAdmin(user.email === 'taqienahmad@gmail.com' || user.email === 'admin@transroster.ai');
        }
      } else {
        setIsAdmin(false);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      toast.success('Successfully logged in!');
    } catch (error: any) {
      console.error(error);
      if (error.code === 'auth/operation-not-allowed') {
        toast.error('Google Sign-In is not enabled in your Firebase Console.');
      } else if (error.code === 'auth/popup-blocked') {
        toast.error('Sign-in popup was blocked by your browser. Please allow popups for this site or use Demo Login / Email Sign-In.');
      } else if (error.code === 'auth/cancelled-popup-request') {
        toast.info('Sign-in popup was closed before completing authentication.');
      } else {
        toast.error('Failed to log in with Google. Check console for details.');
      }
    }
  };

  const handleDemoSignIn = async (role: 'admin' | 'staff') => {
    const demoEmail = role === 'admin' ? 'admin@transroster.ai' : 'staff@transroster.ai';
    const demoPassword = role === 'admin' ? 'admin123' : 'staff123';
    const demoName = role === 'admin' ? 'System Admin' : 'Staff Member';
    
    setEmail(demoEmail);
    setPassword(demoPassword);
    setAuthLoading(true);
    
    try {
      // Try to sign in
      await signInWithEmailAndPassword(auth, demoEmail, demoPassword);
      toast.success(`Welcome back! Logged in as ${role === 'admin' ? 'Admin' : 'Staff'}!`);
    } catch (err: any) {
      // If user does not exist or credentials incorrect, and it is a demo credential, auto-register it!
      if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found') {
        try {
          toast.info(`Initializing new ${role} profile on your database...`);
          const userCredential = await createUserWithEmailAndPassword(auth, demoEmail, demoPassword);
          await updateProfile(userCredential.user, { displayName: demoName });
          
          await setDoc(doc(db, 'users', userCredential.user.uid), {
            uid: userCredential.user.uid,
            email: demoEmail,
            displayName: demoName,
            role: role,
            createdAt: new Date().toISOString()
          });
          toast.success(`Demo ${role} account created and logged in!`);
        } catch (regErr: any) {
          console.error("Auto-registration error:", regErr);
          if (regErr.code === 'auth/operation-not-allowed') {
            toast.error("Email/Password auth is not enabled in your Firebase Console. Please enable it under Authentication -> Sign-in method.");
          } else {
            toast.error(`Auth initialization failed: ${regErr.message || regErr}`);
          }
        }
      } else if (err.code === 'auth/operation-not-allowed') {
        toast.error("Email/Password auth is not enabled in your Firebase Console. See Authentication -> Sign-in method.");
      } else {
        toast.error(`Authentication failed: ${err.message || err}`);
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error('Please fill in all fields');
      return;
    }

    setAuthLoading(true);
    try {
      if (authMode === 'register') {
        if (!displayName) {
          toast.error('Please enter your name');
          setAuthLoading(false);
          return;
        }
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(userCredential.user, { displayName });
        
        // Create user profile in Firestore
        await setDoc(doc(db, 'users', userCredential.user.uid), {
          uid: userCredential.user.uid,
          email: userCredential.user.email,
          displayName,
          role: 'staff', // Default role
          createdAt: new Date().toISOString()
        });
        
        toast.success('Account created successfully!');
      } else {
        await signInWithEmailAndPassword(auth, email, password);
        toast.success('Welcome back!');
      }
    } catch (error: any) {
      console.error(error);
      let message = 'Authentication failed';
      if (error.code === 'auth/email-already-in-use') {
        message = 'Email already in use';
      } else if (error.code === 'auth/invalid-credential') {
        message = 'Invalid email/password. If you are a new user, please click the Register tab first to create your account.';
      } else if (error.code === 'auth/weak-password') {
        message = 'Password should be at least 6 characters';
      } else if (error.code === 'auth/operation-not-allowed') {
        message = 'Email/Password login is not enabled in your Firebase console under Authentication.';
      } else {
        message = error.message || 'Authentication error';
      }
      toast.error(message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      toast.success('Logged out');
    } catch (error) {
      console.error(error);
      toast.error('Failed to logout');
    }
  };

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-50">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full"
        />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full"
        >
          {connectionError === 'database_unavailable' && (
            <div className="mb-4 p-3.5 bg-amber-50 border border-amber-200 rounded-xl flex gap-3 text-xs text-amber-800 shadow-sm leading-relaxed">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5 animate-pulse" />
              <div>
                <strong className="font-semibold block text-amber-900 mb-0.5">Database Connection (Offline Mode)</strong>
                The application is experiencing sandbox environment connectivity limitations. This is standard during initial database provisioning or due to iframe privacy restrictions.
                <button 
                  type="button"
                  onClick={() => window.location.reload()} 
                  className="mt-2 block bg-white border border-amber-300 font-extrabold hover:bg-amber-100 text-amber-950 px-2.5 py-1 rounded transition-colors text-[10px]"
                >
                  🔄 Retry Connection
                </button>
              </div>
            </div>
          )}

          <Card className="border-none shadow-xl bg-white/80 backdrop-blur-sm overflow-hidden">
            <CardHeader className="text-center space-y-4 pb-2">
              <div className="mx-auto w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center">
                <Clock className="w-8 h-8 text-primary" />
              </div>
              <div>
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Clock className="w-8 h-8 text-primary" />
                  <span className="text-3xl font-bold tracking-tight bg-gradient-to-r from-primary to-indigo-600 bg-clip-text text-transparent">TransRosterAI</span>
                </div>
                <CardDescription className="text-slate-500 text-base">
                  Intelligent employee forecasting and scheduling.
                </CardDescription>
              </div>
            </CardHeader>
            
            <CardContent className="space-y-6 pt-6">
              <Tabs value={authMode} onValueChange={(v) => setAuthMode(v as any)} className="w-full">
                <TabsList className="grid w-full grid-cols-2 mb-6">
                  <TabsTrigger value="login">Login</TabsTrigger>
                  <TabsTrigger value="register">Register</TabsTrigger>
                </TabsList>
                
                <form onSubmit={handleEmailAuth} className="space-y-4">
                  {authMode === 'register' && (
                    <div className="space-y-2">
                      <Label htmlFor="name">Full Name</Label>
                      <div className="relative">
                        <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <Input 
                          id="name" 
                          placeholder="John Doe" 
                          className="pl-10"
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          required
                        />
                      </div>
                    </div>
                  )}
                  
                  <div className="space-y-2">
                    <Label htmlFor="email">Email Address</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <Input 
                        id="email" 
                        type="email" 
                        placeholder="name@example.com" 
                        className="pl-10"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <Input 
                        id="password" 
                        type="password" 
                        placeholder="••••••••" 
                        className="pl-10"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                      />
                    </div>
                  </div>
                  
                  <Button type="submit" className="w-full h-11 text-base font-medium" disabled={authLoading}>
                    {authLoading ? 'Processing...' : (authMode === 'login' ? 'Sign In' : 'Create Account')}
                  </Button>
                </form>
              </Tabs>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-slate-200" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white px-2 text-slate-400">Or continue with</span>
                </div>
              </div>

              <Button variant="outline" onClick={handleLogin} className="w-full h-11 text-base font-medium border-slate-200 hover:bg-slate-50" disabled={authLoading}>
                Sign in with Google
              </Button>
            </CardContent>
            
            <CardFooter className="bg-slate-50/50 border-t border-slate-100 p-4 flex flex-col gap-3">
              <div className="w-full">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2 text-center">✨ Live Demo Accounts (Auto-Setup)</p>
                <div className="grid grid-cols-2 gap-2">
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="text-[11px] h-8 bg-white border border-slate-200 hover:bg-indigo-50 hover:text-indigo-600 font-extrabold"
                    onClick={() => handleDemoSignIn('admin')}
                    disabled={authLoading}
                  >
                    Admin Demo
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="text-[11px] h-8 bg-white border border-slate-200 hover:bg-indigo-50 hover:text-indigo-600 font-extrabold"
                    onClick={() => handleDemoSignIn('staff')}
                    disabled={authLoading}
                  >
                    Staff Demo
                  </Button>
                </div>
              </div>
              <p className="text-[10px] text-center text-slate-400 px-4 leading-relaxed">
                💡 <strong className="text-indigo-600">Tip:</strong> Clicking the Demo buttons will automatically create these accounts in your live database if they don't exist! Or, choose the <strong className="text-slate-600">Register</strong> tab above to create any custom user/password.
              </p>
              <p className="text-[9px] text-center text-slate-400 border-t border-slate-100 pt-2 w-full">
                Ensure Email/Password auth is enabled in your Firebase Console → Authentication.
              </p>
            </CardFooter>
          </Card>
        </motion.div>
      </div>
    );
  }

  const sharedData = {
    employees,
    shiftCodes,
    allVolumeData,
    workingDaysRef,
    leaveRequests,
    roster,
    legacyRoster,
    erlangSettings,
    erlangResults,
    constraints: schedulingConstraints,
    historicalVolume,
    forecastEvents,
    isAdmin
  };

  const totalVolumeInForecast = allVolumeData.reduce((acc, d) => acc + (Number(d.totalVolume) || 0), 0).toLocaleString();
  const pendingLeaves = leaveRequests.filter(r => r.status === 'pending').length;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top Navigation Header */}
      <header className="sticky top-0 z-50 bg-[#960000] border-b border-white/10 px-4 h-[100px] flex items-center justify-between shadow-xl">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-3 group cursor-pointer">
            <div className="w-10 h-10 bg-[#000000] rounded-xl flex items-center justify-center shadow-2xl transition-transform group-hover:scale-105">
              <Clock className="w-6 h-6 text-white" />
            </div>
            <div className="flex flex-col">
              <span className="font-black text-lg tracking-tighter text-white leading-none">TransRosterAI</span>
              <span className="text-[10px] font-black text-[#000000] bg-white px-1.5 py-0.5 rounded-sm uppercase tracking-widest mt-1 w-fit shadow-sm">Enterprise</span>
            </div>
          </div>

          <nav className="hidden xl:flex items-center gap-1.5 bg-white/5 p-1 rounded-2xl backdrop-blur-md">
            <NavMenuItem 
              icon={<Sparkles className="w-4 h-4" />} 
              label="Forecasting" 
              active={activeTab === 'forecasting'} 
              color="bg-black"
              onClick={() => { setActiveTab('forecasting'); window.location.hash = 'forecasting'; }} 
            />
            <NavMenuItem 
              icon={<Briefcase className="w-4 h-4" />} 
              label="Workforce" 
              active={activeTab === 'workforce'} 
              color="bg-black"
              onClick={() => { setActiveTab('workforce'); window.location.hash = 'workforce'; }} 
            />
            <NavMenuItem 
              icon={<LayoutDashboard className="w-4 h-4" />} 
              label="Scheduling" 
              active={activeTab === 'scheduling'} 
              color="bg-black"
              onClick={() => { setActiveTab('scheduling'); window.location.hash = 'scheduling'; }} 
            />
            <NavMenuItem 
              icon={<Workflow className="w-4 h-4" />} 
              label="System" 
              active={activeTab === 'architecture'} 
              color="bg-black"
              onClick={() => { setActiveTab('architecture'); window.location.hash = 'architecture'; }} 
            />
            <NavMenuItem 
              icon={<BookOpen className="w-4 h-4" />} 
              label="Calculations" 
              active={activeTab === 'calculation-library'} 
              color="bg-black"
              onClick={() => { setActiveTab('calculation-library'); window.location.hash = 'calculation-library'; }} 
            />
          </nav>
        </div>

        <div className="flex items-center gap-4">
          {/* Data Stats Board */}
          <div className="hidden lg:flex items-center gap-2">
            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-full shadow-lg border border-white/20 transition-all hover:bg-slate-50">
              <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
                <Users className="w-4 h-4 text-slate-600" />
              </div>
              <div className="flex flex-col">
                <span className="text-[8px] font-black text-slate-400 uppercase tracking-tighter leading-none">Agents</span>
                <span className="text-sm font-black text-slate-900">{employees.length}</span>
              </div>
            </div>

            <div className="h-6 w-px bg-white/30 mx-1" />

            <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-full shadow-lg border border-white/20 transition-all hover:bg-slate-50">
              <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="flex flex-col">
                <span className="text-[8px] font-black text-slate-400 uppercase tracking-tighter leading-none">Vol</span>
                <span className="text-sm font-black text-slate-900">{totalVolumeInForecast}</span>
              </div>
            </div>
          </div>

          <div className="h-8 w-px bg-white/20 mx-2" />

          <div className="flex items-center gap-3 pl-2">
            <div className="hidden sm:flex flex-col items-end text-right">
              <p className="text-xs font-black text-white leading-none tracking-tight">{user.displayName}</p>
              <p className="text-[9px] font-bold text-white/70 uppercase tracking-widest mt-1">Administrator</p>
            </div>
            <div className="w-9 h-9 rounded-full bg-white flex items-center justify-center p-0.5 shadow-xl border-2 border-[#960000]">
              {user.photoURL ? (
                <img src={user.photoURL} alt={user.displayName || ''} className="rounded-full" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-full h-full rounded-full bg-slate-800 flex items-center justify-center text-white font-black text-sm">
                  {user.displayName?.charAt(0)}
                </div>
              )}
            </div>
            <Button variant="ghost" size="icon" onClick={handleLogout} className="text-white hover:bg-white/20 h-9 w-9 rounded-xl">
              <LogOut className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </header>

      {connectionError === 'database_unavailable' && (
        <div className="bg-amber-50 border-b border-amber-200 px-6 py-3 flex items-center justify-between gap-4 text-xs text-amber-800 shadow-sm shrink-0">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 animate-pulse shrink-0" />
            <span>
              <strong className="font-bold text-amber-900 mr-2">Firestore Connection Offline:</strong>
              The app is currently operating in offline mode. If the project's Firestore database is newly provisioned, please allow 1-2 minutes for GCP to complete provisioning or refresh the page.
            </span>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            className="bg-white border-amber-300 font-extrabold hover:bg-amber-100 text-amber-900 h-7 text-[10px] py-1 px-3 shrink-0"
            onClick={() => window.location.reload()}
          >
            Retry Connection
          </Button>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {/* Secondary Navigation for smaller screens / Mobile */}
        <div className="xl:hidden bg-[#960000] border-b border-white/10 px-4 py-3 overflow-x-auto whitespace-nowrap flex gap-2">
            <NavMenuItem 
              icon={<Sparkles className="w-4 h-4" />} 
              label="Forecasting" 
              active={activeTab === 'forecasting'} 
              color="bg-black"
              onClick={() => { setActiveTab('forecasting'); window.location.hash = 'forecasting'; }} 
            />
            <NavMenuItem 
              icon={<Briefcase className="w-4 h-4" />} 
              label="Workforce" 
              active={activeTab === 'workforce'} 
              color="bg-black"
              onClick={() => { setActiveTab('workforce'); window.location.hash = 'workforce'; }} 
            />
            <NavMenuItem 
              icon={<LayoutDashboard className="w-4 h-4" />} 
              label="Scheduling" 
              active={activeTab === 'scheduling'} 
              color="bg-black"
              onClick={() => { setActiveTab('scheduling'); window.location.hash = 'scheduling'; }} 
            />
            <NavMenuItem 
              icon={<Workflow className="w-4 h-4" />} 
              label="System" 
              active={activeTab === 'architecture'} 
              color="bg-black"
              onClick={() => { setActiveTab('architecture'); window.location.hash = 'architecture'; }} 
            />
            <NavMenuItem 
              icon={<BookOpen className="w-4 h-4" />} 
              label="Calculations" 
              active={activeTab === 'calculation-library'} 
              color="bg-black"
              onClick={() => { setActiveTab('calculation-library'); window.location.hash = 'calculation-library'; }} 
            />
        </div>

        <div className="flex-1 overflow-y-auto p-4 lg:p-6">
          <div className={activeTab === 'forecasting' ? 'block' : 'hidden'}>
            <ForecastingModule {...sharedData} />
          </div>
          <div className={activeTab === 'workforce' ? 'block' : 'hidden'}>
            <WorkforceModule {...sharedData} />
          </div>
          <div className={activeTab === 'scheduling' ? 'block' : 'hidden'}>
            <SchedulingHub {...sharedData} />
          </div>
          <div className={activeTab === 'architecture' ? 'block' : 'hidden'}>
            <SystemArchitecture />
          </div>
          <div className={activeTab === 'calculation-library' ? 'block' : 'hidden'}>
            <CalculationLibrary />
          </div>
        </div>
      </main>
      <Toaster position="top-right" />
    </div>
  );
}

function NavMenuItem({ icon, label, active, onClick, color }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void, color?: string }) {
  const activeClass = color || 'bg-black';
  
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2.5 px-5 py-2.5 rounded-2xl transition-all duration-300 group whitespace-nowrap ${
        active 
          ? `${activeClass} text-white shadow-2xl scale-[1.02] ring-1 ring-white/10` 
          : 'text-white/60 hover:bg-white/10 hover:text-white'
      }`}
    >
      <div className={`transition-transform duration-300 group-active:scale-95 ${active ? 'text-white' : 'text-white/50 group-hover:text-white'}`}>
        {icon}
      </div>
      <span className={`text-xs font-black uppercase tracking-widest transition-all ${active ? 'opacity-100' : 'opacity-70 group-hover:opacity-100'}`}>
        {label}
      </span>
    </button>
  );
}
