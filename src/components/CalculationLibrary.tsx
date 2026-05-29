import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { 
  Calculator, 
  Info, 
  MessageSquare, 
  Mail, 
  Phone, 
  Users, 
  Clock, 
  Percent,
  Sigma,
  Workflow,
  BookOpen,
  ArrowRight,
  ShieldCheck,
  LayoutDashboard,
  Calendar,
  Settings2,
  TrendingUp,
  Sparkles
} from 'lucide-react';

export default function CalculationLibrary() {
  return (
    <div className="space-y-8 pb-12 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-3">
          <BookOpen className="w-8 h-8 text-indigo-600" />
          Perpustakaan Metodologi Perhitungan
        </h1>
        <p className="text-slate-500 mt-2">
          Panduan deskriptif mengenai model matematika dan formula yang menggerakkan mesin prediktif TransRosterAI.
        </p>
      </div>

      {/* Core Concept: Erlang-C */}
      <section className="space-y-6">
        <div className="flex items-center gap-2">
          <Sigma className="w-5 h-5 text-indigo-500" />
          <h2 className="text-xl font-bold text-slate-800">Mesin Utama: Model Erlang-C</h2>
        </div>

        <Card className="border-none shadow-lg bg-white overflow-hidden">
          <CardHeader className="bg-slate-50 border-b border-slate-100">
            <CardTitle className="text-lg">Persamaan Erlang-C</CardTitle>
            <CardDescription>Model matematika utama untuk menghitung sistem dengan penundaan (antrean).</CardDescription>
          </CardHeader>
          <CardContent className="p-6 space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
              <div className="space-y-4">
                <h4 className="font-bold text-indigo-600 uppercase text-xs tracking-widest">1. Intensitas Trafik (A)</h4>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Sebelum kebutuhan staf ditentukan, kita menghitung total beban kerja dalam interval tertentu. 
                  Intensitas ($A$) merepresentasikan rata-rata jumlah tugas simultan.
                </p>
                <div className="p-4 bg-slate-900 rounded-xl text-center">
                  <span className="text-white font-mono text-lg italic">A = (Volume × AHT) / 3600</span>
                </div>
                <div className="text-[10px] text-slate-400 space-y-1 mt-2">
                  <p>• <strong>Volume:</strong> Total kontak dalam interval (misal: 1 jam).</p>
                  <p>• <strong>AHT:</strong> Waktu Penanganan Rata-rata dalam detik.</p>
                  <p>• <strong>3600:</strong> Faktor konversi (Detik ke Jam).</p>
                </div>
              </div>

              <div className="space-y-4">
                <h4 className="font-bold text-indigo-600 uppercase text-xs tracking-widest">2. Probabilitas Menunggu (P<sub>w</sub>)</h4>
                <p className="text-sm text-slate-600 leading-relaxed">
                  Menghitung kemungkinan seorang pelanggan harus menunggu sebelum dilayani. 
                  Ini adalah formula probabilitas "Erlang-C" yang sebenarnya.
                </p>
                <div className="p-4 bg-slate-900 rounded-xl text-center">
                   <div className="text-white font-mono text-sm overflow-x-auto text-nowrap p-2">
                    P<sub>w</sub> = ( (A^m / m!) * (m / (m - A)) ) / ( Σ [i=0 to m-1] (A^i / i!) + ( (A^m / m!) * (m / (m - A)) ) )
                  </div>
                </div>
                <div className="text-[10px] text-slate-400 space-y-1 mt-2">
                  <p>• <strong>m:</strong> Jumlah Agen yang disediakan.</p>
                  <p>• <strong>i:</strong> Indeks iterasi.</p>
                  <p>• <strong>Σ:</strong> Penjumlahan dari suku-suku sebelumnya.</p>
                </div>
              </div>
            </div>

            <div className="pt-8 border-t border-slate-100">
              <h4 className="font-bold text-indigo-600 uppercase text-xs tracking-widest mb-4">3. Perhitungan Service Level (SL) Akhir</h4>
              <p className="text-sm text-slate-600 mb-6">
                TransRosterAI melakukan iterasi jumlah agen ($m$) hingga Service Level yang memenuhi target Anda tercapai.
              </p>
              <div className="bg-indigo-50 border border-indigo-100 p-6 rounded-2xl flex flex-col md:flex-row items-center gap-8">
                 <div className="text-indigo-900 font-mono text-xl italic shrink-0">
                  SL = 1 - (P<sub>w</sub> × e<sup>-(m - A) × (t / AHT)</sup>)
                </div>
                <div className="h-full w-px bg-indigo-200 hidden md:block" />
                <ul className="grid grid-cols-2 gap-x-8 gap-y-2 text-xs text-indigo-700/80">
                  <li className="flex items-center gap-2"><div className="w-1 h-1 rounded-full bg-indigo-400"/> <strong>t:</strong> Target Waktu Jawab (misal: 20 detik)</li>
                  <li className="flex items-center gap-2"><div className="w-1 h-1 rounded-full bg-indigo-400"/> <strong>e:</strong> Bilangan Euler (~2.718)</li>
                  <li className="flex items-center gap-2"><div className="w-1 h-1 rounded-full bg-indigo-400"/> <strong>m:</strong> Jumlah Staf</li>
                  <li className="flex items-center gap-2"><div className="w-1 h-1 rounded-full bg-indigo-400"/> <strong>A:</strong> Intensitas Trafik</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Media Type Adjustments */}
      <section className="space-y-6">
        <div className="flex items-center gap-2">
          <Workflow className="w-5 h-5 text-indigo-500" />
          <h2 className="text-xl font-bold text-slate-800">Adaptasi Berdasarkan Media</h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="border-none shadow-sm h-full">
            <CardHeader className="pb-2">
              <div className="bg-blue-50 w-10 h-10 rounded-lg flex items-center justify-center text-blue-600 mb-2">
                <Phone className="w-5 h-5" />
              </div>
              <CardTitle className="text-base text-slate-900">Suara / Inbound</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-slate-500">Menggunakan <strong>Erlang-C Murni</strong>. Satu tugas per agen pada satu waktu.</p>
              <div className="text-[10px] p-2 bg-slate-50 rounded font-mono text-slate-700">
                Staf = Min(m) dimana SL(m) ≥ Target
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm h-full ring-2 ring-indigo-500/20">
            <CardHeader className="pb-2">
              <div className="bg-indigo-50 w-10 h-10 rounded-lg flex items-center justify-center text-indigo-600 mb-2">
                <MessageSquare className="w-5 h-5" />
              </div>
              <CardTitle className="text-base text-slate-900">Chat / WhatsApp</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-slate-500">Menerapkan parameter <strong>FRT (First Response Time)</strong> dan tingkat <strong>Konkurensi</strong>.</p>
              <div className="text-[10px] p-2 bg-indigo-50 rounded font-mono text-indigo-700">
                Sesi = Erlang_C(Vol, AHT, SL, FRT)<br/>
                Staf = ceil(Sesi / Konkurensi)
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm h-full">
            <CardHeader className="pb-2">
              <div className="bg-slate-50 w-10 h-10 rounded-lg flex items-center justify-center text-slate-600 mb-2">
                <Mail className="w-5 h-5" />
              </div>
              <CardTitle className="text-base text-slate-900">Email / Backlog</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-slate-500">Menerapkan parameter <strong>TAT (Turnaround Time)</strong>. Mengasumsikan pemrosesan batch atau Erlang dengan target waktu panjang.</p>
              <div className="text-[10px] p-2 bg-slate-50 rounded font-mono text-slate-700">
                Staf = Erlang_C(Vol, AHT, SL, TAT)
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Workforce Productivity Logic */}
      <section className="space-y-6">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-indigo-500" />
          <h2 className="text-xl font-bold text-slate-800">Logika Produktivitas Operasional</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <Card className="border-none shadow-sm">
            <CardHeader>
              <div className="flex items-center gap-2 text-indigo-600 mb-1">
                <Users className="w-4 h-4" />
                <CardTitle className="text-sm uppercase tracking-wider">Gross Staffing (Shrinkage)</CardTitle>
              </div>
              <CardDescription className="text-xs">Mengonversi kebutuhan net menjadi jumlah karyawan dunia nyata.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-slate-600">
                Untuk memperhitungkan istirahat, coaching, rapat, dan ketidakhadiran, kita menerapkan <strong>Shrinkage</strong>.
              </p>
              <div className="p-4 bg-slate-100 rounded-2xl text-center font-mono text-indigo-900">
                Gross Staff = Net Staff / (1 - Shrinkage%)
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm">
            <CardHeader>
              <div className="flex items-center gap-2 text-amber-600 mb-1">
                <Clock className="w-4 h-4" />
                <CardTitle className="text-sm uppercase tracking-wider">Prinsip Carry-Over</CardTitle>
              </div>
              <CardDescription className="text-xs">Cara menangani antrean yang tertunda saat kantor tutup.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-slate-600">
                Saat situs tutup, volume ditambahkan ke <strong>Antrean Carry-Over</strong>.
              </p>
              <div className="p-4 bg-slate-100 rounded-2xl text-center font-mono text-amber-900">
                V<sub>aktif</sub> = V<sub>saat_ini</sub> + V<sub>carry_over</sub>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Staffing Aggregation Logic */}
      <section className="space-y-6">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-indigo-500" />
          <h2 className="text-xl font-bold text-slate-800">Logika Agregasi Staf</h2>
        </div>

        <Card className="border-none shadow-lg bg-white overflow-hidden">
          <CardHeader className="bg-slate-50 border-b border-slate-100">
            <CardTitle className="text-lg">Metodologi Konversi: Interval ke FTE</CardTitle>
            <CardDescription>Panduan mendalam tentang bagaimana AI mengubah kebutuhan per interval menjadi jumlah kepala (Headcount).</CardDescription>
          </CardHeader>
          <CardContent className="p-6 space-y-8">
            {/* Formula Detail */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-3">
                <h4 className="font-bold text-indigo-600 uppercase text-xs tracking-widest">1. Total Jam Kerja Dibutuhkan (H)</h4>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Menghitung total beban kerja personil (Man-Hours) yang dikumpulkan dari setiap interval waktu ($i$).
                </p>
                <div className="p-4 bg-slate-900 rounded-xl text-center">
                  <span className="text-white font-mono text-sm italic">H = Σ (N<sub>i</sub> × (M / 60))</span>
                </div>
                <div className="text-[10px] text-slate-400 space-y-1">
                  <p>• <strong>N<sub>i</sub>:</strong> Kebutuhan agen di interval ke-i (hasil Erlang-C).</p>
                  <p>• <strong>M:</strong> Durasi interval dalam menit (misal: 60 untuk 1 jam, 30 untuk 0.5 jam).</p>
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="font-bold text-indigo-600 uppercase text-xs tracking-widest">2. Kebutuhan FTE (FTE<sub>req</sub>)</h4>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Konversi total jam kerja menjadi jumlah karyawan "Full-Time Equivalent" berdasarkan standar shift.
                </p>
                <div className="p-4 bg-slate-900 rounded-xl text-center">
                  <span className="text-white font-mono text-sm italic">FTE<sub>req</sub> = H / (S - B)</span>
                </div>
                <div className="text-[10px] text-slate-400 space-y-1">
                  <p>• <strong>S:</strong> Panjang Shift standar dalam jam (misal: 9 jam).</p>
                  <p>• <strong>B:</strong> Total waktu istirahat (Break) dalam jam (misal: 1 jam).</p>
                </div>
              </div>
            </div>

            {/* Step by Step Breakdown */}
            <div className="pt-8 border-t border-slate-100 space-y-6">
              <h4 className="font-bold text-slate-900 text-sm italic flex items-center gap-2">
                <Workflow className="w-4 h-4 text-indigo-500" />
                Alur Perhitungan Langkah-demi-Langkah:
              </h4>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  {
                    step: "Langkah 1",
                    title: "Kalkulasi Kerja Harian",
                    desc: "Sistem menjumlahkan semua kebutuhan agen dari setiap interval (misal: 00:00 - 23:00) untuk mendapatkan total 'Jam Kerja Netto'."
                  },
                  {
                    step: "Langkah 2",
                    title: "Normalisasi Kapasitas",
                    desc: "Total jam kerja tadi dibagi dengan jam kerja efektif per agen (Shift - Istirahat) untuk mendapatkan kebutuhan orang dasar."
                  },
                  {
                    step: "Langkah 3",
                    title: "Aplikasi Shrinkage",
                    desc: "Hasil akhir dibagi lagi dengan (1 - %Shrinkage) untuk mencakup absensi, rapat, dan faktor pendukung lainnya."
                  }
                ].map((item, idx) => (
                  <div key={idx} className="p-4 bg-slate-50 rounded-2xl space-y-2 border border-slate-100">
                    <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-tighter">{item.step}</span>
                    <h5 className="font-bold text-slate-900 text-xs">{item.title}</h5>
                    <p className="text-[10px] text-slate-500 leading-tight">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Example Case */}
            <div className="p-8 bg-indigo-900 rounded-3xl text-indigo-50 space-y-6 shadow-xl border border-indigo-500/30">
              <div className="flex items-center gap-3 border-b border-indigo-800 pb-4">
                <div className="bg-indigo-500/20 p-2 rounded-lg">
                  <Info className="w-5 h-5 text-indigo-300" />
                </div>
                <div>
                  <h4 className="font-bold text-sm">Studi Kasus: Perencanaan Kebutuhan Staf</h4>
                  <p className="text-[10px] text-indigo-300 opacity-80">Simulasi konversi volume menjadi jumlah karyawan nyata</p>
                </div>
              </div>

              <div className="text-xs space-y-6 leading-relaxed">
                <div className="space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-400">Tahap 1: Observasi Input</span>
                  <div className="bg-white/5 p-3 rounded-lg border border-white/10 mb-2">
                    <p className="text-[10px] text-indigo-200 italic leading-snug">
                      <strong>Catatan:</strong> Contoh ini menggunakan blok 4 jam agar perhitungan mudah diikuti. Dalam sistem nyata, AI melakukan perhitungan ini secara otomatis untuk seluruh 24 jam (atau jendela operasional Anda).
                    </p>
                  </div>
                  <p className="font-light">
                    Kebutuhan staf berdasarkan Erlang-C untuk blok waktu 4 jam (interval 1 jam) adalah: 
                    <span className="font-mono bg-indigo-800 px-2 py-0.5 rounded ml-2 text-white border border-indigo-700">10, 15, 20, 15 agen</span>.
                  </p>
                </div>

                <div className="space-y-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-400">Tahap 2: Kalkulasi Total Beban Kerja</span>
                  <p className="font-light">
                    Sistem menghitung total jam kerja personil (Manning Hours) yang harus dipenuhi:
                  </p>
                  <div className="font-mono bg-black/20 p-3 rounded-xl border border-white/5 text-center">
                    (10×1jam) + (15×1jam) + (20×1jam) + (15×1jam) = <span className="text-indigo-300 font-bold">60 Jam Personil</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2 bg-black/10 p-4 rounded-2xl border border-white/5">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-400">Kapasitas Orang</span>
                    <p className="font-light text-[11px]">
                      Shift 9 jam - 1 jam istirahat = <span className="font-bold">8 Jam Kerja Efektif</span> per staf.
                    </p>
                  </div>
                  <div className="space-y-2 bg-black/10 p-4 rounded-2xl border border-white/5">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-400">Kebutuhan Dasar</span>
                    <p className="font-light text-[11px]">
                      60 Jam / 8 Jam Efektif = <span className="font-bold text-indigo-300">7.5 Orang (Net)</span>.
                    </p>
                  </div>
                </div>

                <div className="space-y-3 pt-4 border-t border-indigo-800">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-400">Tahap 3: Finalisasi dengan Faktor Pengurang</span>
                  <p className="font-light italic text-indigo-200">
                    "Karena karyawan butuh cuti, libur, dan pelatihan (Shrinkage 25%), kita butuh lebih banyak staf di roster."
                  </p>
                  <div className="flex items-center gap-4 bg-white/5 p-4 rounded-2xl">
                    <div className="text-xl font-mono font-bold text-indigo-300">10</div>
                    <div className="text-[10px] leading-tight text-indigo-100/60">
                      Hasil dari: <span className="font-mono">7.5 / (1 - 0.25)</span><br />
                      Membulatkan ke atas untuk menjamin ketersediaan staf yang cukup di setiap hari kerja.
                    </div>
                  </div>
                </div>
                
                <p className="text-[10px] text-indigo-400 text-center italic">
                  *AI secara otomatis menyesuaikan pembulatan (Ceiling) pada setiap tahap untuk mitigasi risiko SL.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Forecasting Models */}
      <section className="space-y-6">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-indigo-500" />
          <h2 className="text-xl font-bold text-slate-800">Model Matematika Forecasting</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="border-none shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold">Metode Moving Average (MA)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-slate-500 italic">"Gunakan jika volume relatif stabil tanpa tren tajam."</p>
              <div className="p-3 bg-slate-50 rounded-lg font-mono text-[10px] text-indigo-700">
                F(t+1) = Σ [V(t) + V(t-1) ... + V(t-n+1)] / n
              </div>
              <p className="text-[10px] text-slate-400 leading-relaxed">
                Menghitung rata-rata dari N periode terakhir. Varian <strong>Weighted MA</strong> memberikan bobot lebih tinggi pada data terbaru.
              </p>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold">Exponential Smoothing (ES)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-slate-500 italic">"Penyeimbang antara data aktual dan ramalan sebelumnya."</p>
              <div className="p-3 bg-slate-50 rounded-lg font-mono text-[10px] text-indigo-700">
                F(t+1) = α.V(t) + (1-α).F(t)
              </div>
              <p className="text-[10px] text-slate-400 leading-relaxed">
                Menggunakan faktor <strong>Alpha (α)</strong>. Semakin tinggi Alpha, semakin responsif sistem terhadap perubahan mendadak.
              </p>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold">Holt-Winters (Triple Smoothing)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-slate-500 italic">"Model utama jika ada tren DAN pola musiman sekaligus."</p>
              <div className="p-3 bg-slate-50 rounded-lg font-mono text-[10px] text-indigo-700 leading-tight">
                F(t+k) = (L(t) + k.T(t)) × S(t-L+k)
              </div>
              <p className="text-[10px] text-slate-400 leading-relaxed">
                Menganalisis tiga komponen: <strong>Level</strong> (rata-rata), <strong>Trend</strong> (kecenderungan perubahan), dan <strong>Seasonality</strong> (pola berulang mingguan). Parameter α, β, dan γ dioptimasi secara otomatis.
              </p>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm bg-indigo-600 text-white md:col-span-2">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-indigo-200" />
                  Hybrid Intelligence Layer (WFM Expert Standard)
                </CardTitle>
                <div className="text-[10px] bg-white/20 px-2 py-0.5 rounded font-bold uppercase tracking-widest">Recommended</div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-xs text-indigo-100 italic">"Metodologi hibrida untuk akurasi operasional maksimal."</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white/10 p-3 rounded-xl border border-white/10 space-y-1">
                  <span className="text-[9px] font-bold text-indigo-300 uppercase">1. Baseline</span>
                  <p className="text-[10px] leading-tight"><strong>Holt-Winters</strong> digunakan untuk menangkap volume dasar dan tren pertumbuhan jangka panjang.</p>
                </div>
                <div className="bg-white/10 p-3 rounded-xl border border-white/10 space-y-1">
                  <span className="text-[9px] font-bold text-indigo-300 uppercase">2. Distribution</span>
                  <p className="text-[10px] leading-tight"><strong>Seasonal Index</strong> disempurnakan untuk memastikan setiap hari dalam seminggu memiliki bobot yang tepat.</p>
                </div>
                <div className="bg-white/10 p-3 rounded-xl border border-white/10 space-y-1">
                  <span className="text-[9px] font-bold text-indigo-300 uppercase">3. Intelligence</span>
                  <p className="text-[10px] leading-tight"><strong>Event Window (H-2 to H+2)</strong> diaplikasikan terakhir untuk pola lonjakan (spikes) dari kalender event.</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold flex items-center gap-2 text-indigo-600">
                <Calendar className="w-4 h-4" />
                Event Window Intelligence
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-slate-500 italic">"Logika peramalan berdasarkan jendela waktu event."</p>
              <div className="p-3 bg-indigo-50 rounded-lg font-mono text-[10px] text-indigo-700 italic border border-indigo-100">
                F = Baseline × (1 + (Impact × WindowMultiplier))
              </div>
              <p className="text-[10px] text-slate-400 leading-relaxed">
                Mendeteksi dampak tidak hanya di hari H, tapi juga jendela <strong>H-2, H-1</strong> (Antisipasi) dan <strong>H+1, H+2</strong> (Dampak Sisa). Ini mencegah lonjakan volume yang muncul tiba-tiba tanpa persiapan staf.
              </p>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold">Seasonal Indexing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-slate-500 italic">"Gunakan untuk pola mingguan (Senin sibuk, Minggu sepi)."</p>
              <div className="p-3 bg-slate-50 rounded-lg font-mono text-[10px] text-indigo-700">
                Index = Avg(Hari_i) / Global_Avg
              </div>
              <p className="text-[10px] text-slate-400 leading-relaxed">
                Mengalikan ramalan dasar dengan indeks musiman harian untuk mencerminkan fluktuasi hari-dalam-seminggu yang berulang.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Roster Optimization Constraints */}
      <section className="space-y-6">
        <div className="flex items-center gap-2">
          <Workflow className="w-5 h-5 text-indigo-500" />
          <h2 className="text-xl font-bold text-slate-800">Batasan Optimalisasi Roster (Constraint)</h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="border-none shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
                Aturan Logika Utama (Hard Constraints)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">Keamanan Gender</span>
                  <code className="text-[10px] bg-slate-100 px-1 rounded">IF Gender='P' THEN Night=FALSE</code>
                </div>
                <p className="text-[10px] text-slate-500">Membatasi staf perempuan dari penugasan Shift Malam.</p>
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-50">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">Preferensi Karyawan</span>
                  <code className="text-[10px] bg-slate-100 px-1 rounded">Shift ∈ PreferredShifts</code>
                </div>
                <p className="text-[10px] text-slate-500">AI memprioritaskan shift yang disukai karyawan.</p>
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-50">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">Istirahat Minimal</span>
                  <code className="text-[10px] bg-slate-100 px-1 rounded">Istirahat ≥ 11 Jam</code>
                </div>
                <p className="text-[10px] text-slate-500">Menjamin 660 menit antara akhir shift dan awal shift berikutnya.</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <Users className="w-4 h-4 text-indigo-500" />
                Distribusi & Penyeimbangan Staf
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">Suplai Harian</span>
                  <code className="text-[10px] bg-slate-100 px-1 rounded">Σ Shift = Kebutuhan</code>
                </div>
                <p className="text-[10px] text-slate-500">Total agen ditugaskan ($S_i$) harus mencapai target $N_i$.</p>
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-50">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">Integritas Cuti & Off</span>
                  <code className="text-[10px] bg-slate-100 px-1 rounded">Hari Off = Ref Bulanan</code>
                </div>
                <p className="text-[10px] text-slate-500">Hari Off sesuai target Referensi Hari Kerja.</p>
              </div>

              <div className="space-y-2 pt-2 border-t border-slate-50">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">Pencegahan Jump Shift</span>
                  <code className="text-[10px] bg-slate-100 px-1 rounded">Mulai(T) ≥ Mulai(T-1)</code>
                </div>
                <p className="text-[10px] text-slate-500">Mencegah shift lebih awal setelah shift lebih lambat.</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Process Flow & Key Features */}
      <section className="space-y-6 pt-4">
        <div className="flex items-center gap-2">
          <ArrowRight className="w-5 h-5 text-indigo-500" />
          <h2 className="text-xl font-bold text-slate-800">Alur Proses & Fitur Utama</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <Card className="border-none shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <div className="bg-indigo-50 w-10 h-10 rounded-xl flex items-center justify-center text-indigo-600 mb-2">
                <Calculator className="w-5 h-5" />
              </div>
              <CardTitle className="text-sm font-bold">1. Forecasting Volume</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Menganalisis data trafik historis (3 bulan terakhir) untuk memprediksi volume interaksi di masa depan dengan pola tren dan musiman.
              </p>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <div className="bg-emerald-50 w-10 h-10 rounded-xl flex items-center justify-center text-emerald-600 mb-2">
                <Sigma className="w-5 h-5" />
              </div>
              <CardTitle className="text-sm font-bold">2. Penentuan Kebutuhan Staf</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Menggunakan algoritma Erlang-C untuk menghitung jumlah agen ideal per interval guna mencapai target Service Level (SL).
              </p>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <div className="bg-amber-50 w-10 h-10 rounded-xl flex items-center justify-center text-amber-600 mb-2">
                <Calendar className="w-5 h-5" />
              </div>
              <CardTitle className="text-sm font-bold">3. Optimalisasi Roster Otomatis</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Mesin AI menyusun jadwal kerja yang seimbang, memastikan cakupan staf terpenuhi tanpa melanggar batasan hukum atau operasional.
              </p>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <div className="bg-blue-50 w-10 h-10 rounded-xl flex items-center justify-center text-blue-600 mb-2">
                <Users className="w-5 h-5" />
              </div>
              <CardTitle className="text-sm font-bold">4. Manajemen Preferensi Staf</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Menyelaraskan jadwal dengan preferensi shift karyawan untuk meningkatkan kepuasan kerja tanpa mengorbakan efisiensi.
              </p>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <div className="bg-purple-50 w-10 h-10 rounded-xl flex items-center justify-center text-purple-600 mb-2">
                <LayoutDashboard className="w-5 h-5" />
              </div>
              <CardTitle className="text-sm font-bold">5. Monitoring Performa</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Visualisasi data real-time melalui dashboard untuk memantau perbandingan antara volume aktual vs rencana dan pencapaian SL.
              </p>
            </CardContent>
          </Card>

          <Card className="border-none shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <div className="bg-slate-50 w-10 h-10 rounded-xl flex items-center justify-center text-slate-600 mb-2">
                <Settings2 className="w-5 h-5" />
              </div>
              <CardTitle className="text-sm font-bold">6. Penyesuaian Manual (Override)</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Memberikan fleksibilitas bagi Administrator untuk melakukan perubahan manual pada jadwal atau asumsi data jika diperlukan.
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Efficiency Metrics */}
      <section className="space-y-6">
        <div className="flex items-center gap-2">
          <Percent className="w-5 h-5 text-indigo-500" />
          <h2 className="text-xl font-bold text-slate-800">Metrik Efisiensi</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="p-6 bg-white rounded-3xl border border-slate-100 shadow-sm space-y-2">
            <h5 className="font-bold text-slate-900 text-sm">Occupancy</h5>
            <p className="text-xs text-slate-500">Persentase waktu agen menangani panggilan saat login.</p>
            <div className="text-lg font-mono font-bold text-indigo-600 mt-2">I / m</div>
          </div>
          <div className="p-6 bg-white rounded-3xl border border-slate-100 shadow-sm space-y-2">
            <h5 className="font-bold text-slate-900 text-sm">ASA</h5>
            <p className="text-xs text-slate-500">Rata-rata kecepatan jawab panggilan.</p>
            <div className="text-lg font-mono font-bold text-indigo-600 mt-2">(P<sub>w</sub> × AHT) / (m - I)</div>
          </div>
          <div className="p-6 bg-white rounded-3xl border border-slate-100 shadow-sm space-y-2">
            <h5 className="font-bold text-slate-900 text-sm">Staffing Yield</h5>
            <p className="text-xs text-slate-500">Rasio antara staf yang dibutuhkan dan tersedia.</p>
            <div className="text-lg font-mono font-bold text-indigo-600 mt-2">N<sub>req</sub> / N<sub>act</sub></div>
          </div>
        </div>
      </section>
    </div>
  );
}
