"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Check } from "lucide-react";
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceArea, ResponsiveContainer,
} from "recharts";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
// ── Historical data: Spotify for Artists, Jan 2024 – Jun 2026 ────────────────
const HIST_MONTHS = ["2024-01","2024-02","2024-03","2024-04","2024-05","2024-06","2024-07","2024-08","2024-09","2024-10","2024-11","2024-12","2025-01","2025-02","2025-03","2025-04","2025-05","2025-06","2025-07","2025-08","2025-09","2025-10","2025-11","2025-12","2026-01","2026-02","2026-03","2026-04","2026-05","2026-06"];
const HIST = {
  ml:   [18753,13697,16541,16291,12976,30187,34270,23956,31022,28237,43113,66315,61488,67296,60770,63767,77378,89926,72455,66315,82086,131007,190457,80577,149755,148149,134052,131578,150668,135652],
  mal:  [6147,6716,6658,6225,6223,10658,11638,10876,12262,13766,14076,14527,15811,17556,18480,19278,21733,22302,22506,21542,26249,38628,39787,33829,39792,40306,41186,41802,42322,42359],
  foll: [5849,5948,5999,6089,6174,6374,6561,6665,6836,7137,7361,7630,7799,8051,8294,8586,8903,9122,9333,9510,9875,10993,11874,12455,13221,13824,14480,15052,15572,16137],
  cum:  [48531,83447,125872,161849,195818,257129,347939,416631,497032,580114,693007,843046,1000028,1161084,1329511,1494226,1691581,1889026,2071175,2227685,2440344,2865862,3390412,3650591,4108786,4510702,4924591,5315197,5730135,6055293],
};
const FUTURE_MONTHS = ["2026-07","2026-08","2026-09","2026-10","2026-11","2026-12","2027-01","2027-02","2027-03","2027-04","2027-05","2027-06"];
const ALL_MONTHS = [...HIST_MONTHS, ...FUTURE_MONTHS];

const DEFAULT_PARAMS = {
  base_mo: 390000, foll_pace: 582, foll_low_mult: 0.7, foll_high_mult: 1.25,
  tour_months: ["2026-09","2026-10","2026-11"], tour_uplift: 35, post_tour_decay: 50,
  mal_growth: 150, mal_tour_uplift: 28, stream_low_mult: 80, stream_high_mult: 130,
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (n: number | null) => n == null ? "—" : n >= 1e6 ? (n/1e6).toFixed(2)+"M" : n >= 1e3 ? (n/1e3).toFixed(0)+"k" : Math.round(n).toLocaleString();
const fmtM = (s: string | null) => { if (!s) return ""; const [y,m]=s.split("-"); const names=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]; return `${names[+m-1]} '${y.slice(2)}`; };
const avg = (arr: number[]) => arr.reduce((a,b)=>a+b,0)/arr.length;

interface AddedMonth { month: string; ml?: number | null; mal?: number | null; foll?: number | null; streams: number; saves?: number; }
type MetricKey = "cum" | "foll" | "mal" | "ml";
type MetricConfig = { label: string; act: string; base: string; low: string; high: string; desc: string };

const METRICS: Record<MetricKey, MetricConfig> = {
  cum:  { label:"Cumulative streams",    act:"cum_act",  base:"cum_base",  low:"cum_low",  high:"cum_high",  desc:"Running total Spotify streams since Jan 2024." },
  foll: { label:"Followers",             act:"foll_act", base:"foll_base", low:"foll_low", high:"foll_high", desc:"Cleanest predictable metric. Grows ~582/mo at recent pace." },
  mal:  { label:"Monthly active listeners", act:"mal_act",  base:"mal_base",  low:"mal_low",  high:"mal_high",  desc:"Plateaued ~42k since late 2025. Tour is the main upside lever." },
  ml:   { label:"Monthly listeners",     act:"ml_act",   base:"ml_base",   low:"ml_low",   high:"ml_high",   desc:"Event-driven, range-bound 130–190k. Shown as a scenario band." },
};

function buildChartData(addedMonths: AddedMonth[], params: typeof DEFAULT_PARAMS) {
  const addedMap: Record<string, AddedMonth> = {};
  addedMonths.forEach(r => { addedMap[r.month] = r; });

  const actuals: Record<string, { ml: number; mal: number; foll: number; cum: number; }> = {};
  HIST_MONTHS.forEach((m,i) => { actuals[m] = { ml: HIST.ml[i], mal: HIST.mal[i], foll: HIST.foll[i], cum: HIST.cum[i] }; });
  let lastCum = HIST.cum[HIST.cum.length-1];
  FUTURE_MONTHS.forEach(m => {
    if (addedMap[m]) { const r = addedMap[m]; lastCum += (r.streams || 0); actuals[m] = { ml: r.ml||0, mal: r.mal||0, foll: r.foll||0, cum: lastCum }; }
  });

  const lastActualMonth = [...HIST_MONTHS, ...FUTURE_MONTHS].filter(m => actuals[m]).slice(-1)[0];
  const lastA = actuals[lastActualMonth];
  const lastFoll = addedMonths.filter(r=>r.foll).slice(-1)[0]?.foll ?? lastA.foll;
  const lastMal = addedMonths.filter(r=>r.mal).slice(-1)[0]?.mal ?? lastA.mal;
  const lastCumAct = actuals[lastActualMonth]?.cum ?? HIST.cum[HIST.cum.length-1];

  const recentStreams = addedMonths.filter(r=>r.streams>0).map(r=>r.streams);
  const baseMo = recentStreams.length >= 3 ? avg(recentStreams.slice(-6)) : params.base_mo;
  const mlArr = HIST.ml.slice(-6); const mlMean = avg(mlArr);

  return ALL_MONTHS.map((month, i) => {
    const a = actuals[month];
    const isForecast = !a;
    const tourOn = params.tour_months.includes(month);
    const postTour = !tourOn && params.tour_months.some(t => t < month);
    const decayFactor = postTour ? params.post_tour_decay / 100 : 0;
    const uplift = params.tour_uplift / 100;
    const lastActualIdx = ALL_MONTHS.indexOf(lastActualMonth);
    const steps = i - lastActualIdx;

    const fp = params.foll_pace;
    const follBase = lastFoll + fp * steps;
    const follLow  = lastFoll + fp * params.foll_low_mult * steps;
    const follHigh = lastFoll + fp * params.foll_high_mult * steps * (tourOn ? (1 + uplift * 0.3) : 1);

    const malBase = lastMal + params.mal_growth * steps;
    const malLow  = lastMal;
    const malHigh = tourOn ? malBase * (1 + params.mal_tour_uplift / 100) : postTour ? malBase * (1 + (params.mal_tour_uplift / 100) * decayFactor) : malBase;

    const mlBase = mlMean;
    const mlLow  = mlMean;
    const mlHigh = tourOn ? mlMean * (1 + uplift * 0.9) : postTour ? mlMean * (1 + uplift * decayFactor * 0.5) : mlMean;

    const cumBase = lastCumAct + (params.base_mo) * steps;
    const cumLow  = lastCumAct + (params.base_mo * params.stream_low_mult / 100) * steps;
    const cumHigh = lastCumAct + (params.base_mo * params.stream_high_mult / 100) * steps * (tourOn ? (1 + uplift) : 1);

    return {
      month, label: fmtM(month), isForecast, isTour: tourOn,
      foll_act: a ? a.foll : null, mal_act: a ? a.mal : null, ml_act: a ? a.ml : null, cum_act: a ? a.cum : null,
      foll_base: isForecast ? follBase : null, foll_low: isForecast ? follLow : null, foll_high: isForecast ? follHigh : null,
      mal_base: isForecast ? malBase : null, mal_low: isForecast ? malLow : null, mal_high: isForecast ? malHigh : null,
      ml_base: isForecast ? mlBase : null, ml_low: isForecast ? mlLow : null, ml_high: isForecast ? mlHigh : null,
      cum_base: isForecast ? cumBase : null, cum_low: isForecast ? cumLow : null, cum_high: isForecast ? cumHigh : null,
    };
  });
}

// ── Sub-components ────────────────────────────────────────────────────────────
function Slider({ label, value, min, max, step=1, unit="", onChange, format }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void; format?: (v: number) => string; }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="mb-3">
      <div className="flex justify-between items-baseline mb-1">
        <span className="text-xs font-semibold text-muted-foreground">{label}</span>
        <span className="text-sm font-bold text-foreground">{format ? format(value) : value.toLocaleString()}{unit}</span>
      </div>
      <div className="relative h-1.5 bg-border rounded-full cursor-pointer">
        <div className="absolute left-0 h-full bg-primary rounded-full pointer-events-none" style={{ width: pct+"%" }} />
        <Input type="range" min={min} max={max} step={step} value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full opacity-0 cursor-pointer h-full" />
      </div>
    </div>
  );
}

function ChartTooltip({ active, payload, label, metric }: { active?: boolean; payload?: any[]; label?: string; metric: MetricKey; }) {
  if (!active || !payload?.length) return null;
  const vals: Record<string, number> = {};
  payload.forEach(p => { vals[p.dataKey] = p.value; });
  const m = METRICS[metric];
  const act = vals[m.act]; const base = vals[m.base]; const lo = vals[m.low]; const hi = vals[m.high];
  return (
    <div className="bg-card border border-border rounded-xl p-3 text-xs shadow-lg">
      <div className="font-bold mb-1.5 text-foreground">{label}</div>
      {act != null && <div className="text-primary">● Actual: <b>{fmt(act)}</b></div>}
      {base != null && <div className="text-primary/70">-- Forecast: <b>{fmt(base)}</b></div>}
      {lo != null && hi != null && <div className="text-muted-foreground">Range: {fmt(lo)} – {fmt(hi)}</div>}
    </div>
  );
}

function TourMonthPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void; }) {
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {FUTURE_MONTHS.map(m => {
        const on = value.includes(m);
        return (
          <Button key={m} onClick={() => onChange(on ? value.filter(x=>x!==m) : [...value,m].sort())}
            className={`text-xs font-semibold px-2 py-1 rounded-full transition-colors cursor-pointer ${on ? "bg-amber-500 text-white border-amber-500" : "bg-card text-muted-foreground border-border"} border`}>
            {fmtM(m)}
          </Button>
        );
      })}
    </div>
  );
}

function KPI({ value, label, sub, highlight }: { value: string; label: string; sub?: string; highlight?: boolean }) {
  return (
    <div className={`bg-card border rounded-2xl p-3.5 flex-1 min-w-[130px] ${highlight ? "border-primary/50" : "border-border"}`}>
      <div className={`text-2xl font-black tracking-tight leading-none ${highlight ? "text-primary" : "text-foreground"}`}>{value}</div>
      <div className="text-xs text-muted-foreground mt-1.5 font-semibold">{label}</div>
      {sub && <div className="text-xs text-primary mt-1 font-bold">{sub}</div>}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function TrueBlueForecast() {
  const [metric, setMetric]         = useState<MetricKey>("cum");
  const [showTour, setShowTour]     = useState(true);
  const [params, setParams]         = useState(DEFAULT_PARAMS);
  const [addedMonths, setAddedMonths] = useState<AddedMonth[]>([]);
  const [loaded, setLoaded]         = useState(false);
  const [panel, setPanel]           = useState<string>("params");
  const [form, setForm]             = useState({ month:"", ml:"", mal:"", foll:"", streams:"", saves:"" });
  const [formError, setFormError]   = useState("");
  const [saved, setSaved]           = useState(false);

  useEffect(() => {
    try { const r = localStorage.getItem("tb_params"); if (r) setParams(p => ({...DEFAULT_PARAMS, ...JSON.parse(r)})); } catch { /* ignore — stale or blocked localStorage falls back to defaults */ }
    try { const r = localStorage.getItem("tb_added"); if (r) setAddedMonths(JSON.parse(r)); } catch { /* ignore — stale or blocked localStorage falls back to defaults */ }
    setLoaded(true);
  }, []);

  const saveParams = useCallback((p: typeof DEFAULT_PARAMS) => {
    try { localStorage.setItem("tb_params", JSON.stringify(p)); setSaved(true); setTimeout(()=>setSaved(false), 1200); } catch { /* ignore — stale or blocked localStorage falls back to defaults */ }
  }, []);

  const saveAdded = useCallback((arr: AddedMonth[]) => {
    try { localStorage.setItem("tb_added", JSON.stringify(arr)); } catch { /* ignore — stale or blocked localStorage falls back to defaults */ }
  }, []);

  const setP = (key: keyof typeof DEFAULT_PARAMS, val: any) => setParams(p => { const n = {...p, [key]: val}; saveParams(n); return n; });

  const handleAddMonth = () => {
    setFormError("");
    const { month, ml, mal, foll, streams, saves } = form;
    if (!month.match(/^\d{4}-\d{2}$/)) { setFormError("Month must be YYYY-MM (e.g. 2026-07)"); return; }
    if (HIST_MONTHS.includes(month)) { setFormError("That month is already in the base historical data."); return; }
    if (!foll && !streams) { setFormError("Enter at least followers or streams."); return; }
    const existing = addedMonths.find(r => r.month === month);
    const entry: AddedMonth = { month, ml: +ml||null, mal: +mal||null, foll: +foll||null, streams: +streams||0, saves: +saves||0 };
    const updated = existing ? addedMonths.map(r => r.month===month ? entry : r) : [...addedMonths, entry].sort((a,b)=>a.month.localeCompare(b.month));
    setAddedMonths(updated);
    saveAdded(updated);
    setForm({ month:"", ml:"", mal:"", foll:"", streams:"", saves:"" });
    setPanel("log");
  };

  const deleteMonth = (month: string) => { const updated = addedMonths.filter(r => r.month !== month); setAddedMonths(updated); saveAdded(updated); };
  const resetParams = () => { setParams(DEFAULT_PARAMS); saveParams(DEFAULT_PARAMS); };

  const recalibrate = () => {
    const recentStreams = addedMonths.filter(r=>r.streams>0).map(r=>r.streams).slice(-6);
    if (recentStreams.length < 2) { alert("Add at least 2 months with stream counts to recalibrate."); return; }
    const newBase = Math.round(avg(recentStreams));
    const recentFoll = addedMonths.filter(r=>!!r.foll).map(r=>r.foll!).filter(Boolean);
    let newPace = params.foll_pace;
    if (recentFoll.length >= 2) { const diffs = recentFoll.slice(1).map((v,i)=>v-recentFoll[i]); newPace = Math.round(avg(diffs)); }
    const n = {...params, base_mo: newBase, foll_pace: Math.max(100, newPace)};
    setParams(n); saveParams(n);
  };

  const chartData = useMemo(() => buildChartData(addedMonths, params), [addedMonths, params]);
  const m = METRICS[metric];

  const latestActual = [...HIST_MONTHS.map((_,i)=>({ foll: HIST.foll[i], mal: HIST.mal[i], ml: HIST.ml[i], cum: HIST.cum[i] } as const)), ...addedMonths.map(a=>({ foll: a.foll ?? undefined, mal: a.mal ?? undefined, ml: a.ml ?? undefined, cum: undefined }))].slice(-1)[0];
  const nextMonth = (() => {
    const last = addedMonths.length ? addedMonths[addedMonths.length-1].month : "2026-06";
    const [y,mo] = last.split("-").map(Number);
    return mo === 12 ? `${y+1}-01` : `${y}-${String(mo+1).padStart(2,"0")}`;
  })();

  const labelStyle = "text-xs font-bold text-muted-foreground block mb-1";

  if (!loaded) return <div className="flex items-center justify-center h-[60vh] text-muted-foreground">Loading…</div>;

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="flex flex-wrap gap-3">
        <KPI value={fmt(latestActual?.foll ?? null)} label="Followers" sub={`+${params.foll_pace.toLocaleString()}/mo forecast`} />
        <KPI value={fmt(latestActual?.mal ?? null)} label="Monthly active listeners" sub="plateaued ~42k" />
        <KPI value={fmt(latestActual?.ml ?? null)} label="Monthly listeners" />
        <KPI value={fmt(latestActual?.cum ?? null)} label="Cumulative streams" highlight />
      </div>

      {/* Chart */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <div className="flex flex-wrap gap-2 items-center mb-4">
          {(Object.keys(METRICS) as MetricKey[]).map(key => (
            <Button key={key} onClick={() => setMetric(key)}
              className={`text-xs font-bold px-3 py-1.5 rounded-full transition-colors ${metric===key ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"}`}>
              {METRICS[key].label}
            </Button>
          ))}
          <div className="ml-auto flex items-center gap-2 text-xs font-semibold text-muted-foreground cursor-pointer select-none"
            onClick={() => setShowTour(t => !t)}>
            <div className={`w-9 h-5 rounded-full relative transition-colors ${showTour ? "bg-amber-500" : "bg-border"}`}>
              <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${showTour ? "left-4" : "left-0.5"}`} />
            </div>
            Tour scenario
          </div>
        </div>

        <div className="text-sm font-extrabold mb-0.5">{m.label}</div>
        <div className="text-xs text-muted-foreground mb-3">{m.desc}</div>

        <ResponsiveContainer width="100%" height={340}>
          <ComposedChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize:11, fill:"var(--muted-foreground)" }} tickLine={false} axisLine={false} interval={2} />
            <YAxis tickFormatter={v=>fmt(v)} tick={{ fontSize:11, fill:"var(--muted-foreground)" }} tickLine={false} axisLine={false} width={52} />
            <Tooltip content={<ChartTooltip metric={metric} />} />
            {showTour && params.tour_months.length > 0 && (() => {
              const firstTour = chartData.find(d => d.isTour)?.label;
              const lastTour  = [...chartData].reverse().find(d => d.isTour)?.label;
              return firstTour ? <ReferenceArea x1={firstTour} x2={lastTour} fill="rgba(245,158,11,0.12)" label={{ value:"Fall tour", position:"insideTop", fill:"#f59e0b", fontSize:11, fontWeight:700 }} /> : null;
            })()}
            <Area type="monotone" dataKey={m.high} stroke="none" fill={showTour ? "rgba(245,158,11,0.15)" : "rgba(16,185,129,0.1)"} activeDot={false} />
            <Area type="monotone" dataKey={m.low}  stroke="none" fill="var(--card)" activeDot={false} />
            <Line type="monotone" dataKey={m.base} stroke="var(--primary)" strokeWidth={2} strokeDasharray="6 4" dot={false} activeDot={false} />
            <Line type="monotone" dataKey={m.act} stroke="var(--primary)" strokeWidth={2.5} dot={false} connectNulls={false} />
          </ComposedChart>
        </ResponsiveContainer>

        <div className="flex gap-4 mt-3 flex-wrap text-xs text-muted-foreground font-semibold">
          <span><span className="inline-block w-4 border-t-2 border-primary align-middle mr-1"/>Actual</span>
          <span><span className="inline-block w-4 border-t-2 border-dashed border-primary align-middle mr-1"/>Forecast</span>
          <span><span className="inline-block w-3.5 h-2.5 rounded-sm bg-primary/10 align-middle mr-1"/>Scenario band</span>
          {showTour && <span><span className="inline-block w-3.5 h-2.5 rounded-sm bg-amber-100 border border-amber-500 align-middle mr-1"/>Tour window</span>}
        </div>
      </div>

      {/* Panel nav */}
      <div className="flex gap-2 border-b border-border">
        {[["params","Parameters"],["add","Add month"],["log",`Data log (${addedMonths.length})`] as const].map(([k,l]) => (
          <Button key={k} onClick={()=>setPanel(k)}
            className={`text-xs font-bold px-3 py-2 -mb-px transition-colors ${panel===k ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`}>
            {l}
          </Button>
        ))}
        {saved && <span className="inline-flex items-center gap-1 self-center ml-auto text-xs font-bold text-green-600"><Check className="h-3.5 w-3.5" />Saved</span>}
      </div>

      {/* Forecast parameters */}
      {panel === "params" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-card border border-border rounded-2xl p-4">
            <div className="font-extrabold text-sm mb-3">Streams</div>
            <Slider label="Baseline monthly streams" value={params.base_mo} min={100000} max={700000} step={5000} onChange={v=>setP("base_mo",v)} format={v=>(v/1000).toFixed(0)+"k"} />
            <Slider label="Low scenario (% of base)" value={params.stream_low_mult} min={50} max={99} unit="%" onChange={v=>setP("stream_low_mult",v)} />
            <Slider label="High scenario (% of base)" value={params.stream_high_mult} min={101} max={200} unit="%" onChange={v=>setP("stream_high_mult",v)} />
          </div>
          <div className="bg-card border border-border rounded-2xl p-4">
            <div className="font-extrabold text-sm mb-3">Followers</div>
            <Slider label="Monthly growth pace" value={params.foll_pace} min={100} max={1500} step={10} onChange={v=>setP("foll_pace",v)} format={v=>"+"+v.toLocaleString()+"/mo"} />
            <Slider label="Low band (× pace)" value={params.foll_low_mult} min={0.3} max={0.95} step={0.05} onChange={v=>setP("foll_low_mult",v)} format={v=>v.toFixed(2)+"×"} />
            <Slider label="High band (× pace)" value={params.foll_high_mult} min={1.05} max={2.5} step={0.05} onChange={v=>setP("foll_high_mult",v)} format={v=>v.toFixed(2)+"×"} />
          </div>
          <div className="bg-card border border-border rounded-2xl p-4">
            <div className="font-extrabold text-sm mb-3">Monthly active listeners</div>
            <Slider label="Monthly growth" value={params.mal_growth} min={-500} max={3000} step={50} onChange={v=>setP("mal_growth",v)} format={v=>(v>=0?"+":"")+v.toLocaleString()+"/mo"} />
            <Slider label="Tour uplift" value={params.mal_tour_uplift} min={0} max={80} unit="%" onChange={v=>setP("mal_tour_uplift",v)} />
          </div>
          <div className="bg-card border border-border rounded-2xl p-4">
            <div className="font-extrabold text-sm mb-1">Fall 2026 tour</div>
            <div className="text-xs text-muted-foreground mb-3">Select which months get the tour uplift applied.</div>
            <Slider label="Stream & listener uplift" value={params.tour_uplift} min={0} max={100} unit="%" onChange={v=>setP("tour_uplift",v)} />
            <Slider label="Post-tour retention" value={params.post_tour_decay} min={0} max={100} unit="%" onChange={v=>setP("post_tour_decay",v)} />
            <div className="text-xs font-bold text-muted-foreground mt-1">Tour months</div>
            <TourMonthPicker value={params.tour_months} onChange={v=>setP("tour_months",v)} />
          </div>
          <div className="md:col-span-2 flex gap-3 flex-wrap">
            <Button variant="outline" onClick={recalibrate} className="text-xs font-bold px-4 py-2 rounded-lg border border-primary bg-card text-primary cursor-pointer">↻ Recalibrate from added data</Button>
            <Button variant="outline" onClick={resetParams} className="text-xs font-bold px-4 py-2 rounded-lg border border-border bg-card text-muted-foreground cursor-pointer">Reset to defaults</Button>
          </div>
        </div>
      )}

      {/* Add new month */}
      {panel === "add" && (
        <div className="bg-card border border-border rounded-2xl p-4 max-w-lg">
          <p className="text-sm text-muted-foreground mb-4">
            Enter end-of-month Spotify figures when new data arrives. They'll be added to the chart as actuals and shift the forecast window forward.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className={labelStyle}>Month (YYYY-MM)</label>
              <Input placeholder={nextMonth} value={form.month} onChange={e=>setForm(f=>({...f,month:e.target.value}))}
                className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background" />
            </div>
            {([["foll","Followers (end of month)"],["mal","Monthly active listeners"],["ml","Monthly listeners"],["streams","Streams (monthly total)"],["saves","Saves (monthly total, optional)"]] as [string,string][]).map(([k,l]) => (
              <div key={k}>
                <label className={labelStyle}>{l}</label>
                <Input type="number" placeholder="—" value={(form as any)[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))}
                  className="w-full px-3 py-2 border border-border rounded-lg text-sm bg-background" />
              </div>
            ))}
          </div>
          {formError && <p className="text-red-600 text-xs mt-2">{formError}</p>}
          <Button onClick={handleAddMonth}
            className="mt-4 w-full py-2.5 text-sm font-extrabold rounded-lg bg-primary text-primary-foreground cursor-pointer">
            Add month →
          </Button>
        </div>
      )}

      {/* Data log */}
      {panel === "log" && (
        <div>
          {addedMonths.length === 0 ? (
            <p className="text-muted-foreground text-sm">No months added yet. Use the <b>Add month</b> tab when new Spotify data comes in.</p>
          ) : (
            <div className="overflow-x-auto bg-card border border-border rounded-2xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-primary/30">
                    {["Month","Followers","MAL","Monthly listeners","Streams","Saves",""].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-xs font-extrabold text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {addedMonths.map((r, i) => (
                    <tr key={r.month} className={`border-b border-border ${i%2 ? "bg-muted/30" : ""}`}>
                      <td className="px-3 py-2 font-bold">{fmtM(r.month)}</td>
                      <td className="px-3 py-2">{fmt(r.foll ?? null)}</td>
                      <td className="px-3 py-2">{fmt(r.mal ?? null)}</td>
                      <td className="px-3 py-2">{fmt(r.ml ?? null)}</td>
                      <td className="px-3 py-2">{fmt(r.streams)}</td>
                      <td className="px-3 py-2">{fmt(r.saves ?? null)}</td>
                      <td className="px-3 py-2">
                        <Button onClick={()=>deleteMonth(r.month)} className="text-xs text-red-600 font-bold cursor-pointer">Remove</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground border-t border-border pt-4 leading-relaxed">
        <b>Methodology.</b> Historical figures are actual Spotify for Artists data (Jan 2024 – Jun 2026). Forecasts use linear trend projection for followers, near-flat baseline for monthly active listeners (plateaued in late 2025), and a scenario band around the recent 6-month average for streams. Tour uplift is illustrative. All parameters and added data persist in your browser.
      </p>
    </div>
  );
}
