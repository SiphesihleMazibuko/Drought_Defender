"use client";

import { useEffect, useSyncExternalStore, useState, type FormEvent } from "react";
import WaterRequests from "./water-requests";
import Payments from "./payments";

const stages = ["Seedling", "Growing", "Mature"] as const;
const crops = {
  Tomatoes: { icon: "🍅", factors: [0.6, 1.15, 0.9] },
  Spinach: { icon: "🥬", factors: [0.55, 0.85, 1] },
  Cabbage: { icon: "🥬", factors: [0.55, 0.9, 1.05] },
  Maize: { icon: "🌽", factors: [0.4, 0.85, 1.2] },
};

const weather = {
  dry: { label: "Dry spell", loss: 6, rain: 0, icon: "☀" },
  rainy: { label: "Rainy day", loss: 4, rain: 3, icon: "☂" },
};

type DemoData = {
  weather: Record<keyof typeof weather, { loss: number; rain: number }>;
  factors: Record<keyof typeof crops, number[]>;
};

function isDemoData(value: unknown): value is DemoData {
  const data = value as Partial<DemoData> | null;
  const nonNegative = (number: unknown) => typeof number === "number" && Number.isFinite(number) && number >= 0;
  return Boolean(data && (Object.keys(weather) as Array<keyof typeof weather>).every((scenario) => {
    const sample = data.weather?.[scenario];
    return sample && nonNegative(sample.loss) && nonNegative(sample.rain);
  }) && (Object.keys(crops) as Array<keyof typeof crops>).every((crop) => {
    const factors = data.factors?.[crop];
    return Array.isArray(factors) && factors.length === stages.length && factors.every(nonNegative);
  }));
}

type Bed = { id: string; crop: keyof typeof crops; stage: typeof stages[number]; area: number; plants: number };
type WaterSource = "Tank" | "Borehole";
type Reading = { available?: string; used?: number };
type Farm = {
  beds: Bed[]; location: string; scenario: keyof typeof weather;
  waterSource?: WaterSource;
  sourceReadings?: Partial<Record<WaterSource, Record<string, Reading>>>;
};
const demo: Farm = {
  location: "Ga-Mothapo, Limpopo",
  scenario: "dry",
  beds: [
    { id: "tomatoes", crop: "Tomatoes", stage: "Growing", area: 20, plants: 40 },
    { id: "spinach", crop: "Spinach", stage: "Mature", area: 12, plants: 24 },
  ],
};
const storageKey = "waterwise-farm-v1";
const initialSnapshot = JSON.stringify(demo);
let fallbackSnapshot = initialSnapshot;
let storageWritable = true;
const changeEvent = "waterwise-change";

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(changeEvent, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(changeEvent, callback);
  };
}

function snapshot() {
  if (!storageWritable) return fallbackSnapshot;
  try { return localStorage.getItem(storageKey) ?? initialSnapshot; }
  catch { return fallbackSnapshot; }
}

function saveFarm(farm: Farm) {
  fallbackSnapshot = JSON.stringify(farm);
  try {
    localStorage.setItem(storageKey, fallbackSnapshot);
    storageWritable = true;
  } catch {
    storageWritable = false;
  }
  window.dispatchEvent(new Event(changeEvent));
}

function readFarm(value: string): Farm {
  try {
    const farm = JSON.parse(value) as Farm;
    if (typeof farm.location === "string" && Object.hasOwn(weather, farm.scenario) && Array.isArray(farm.beds) &&
      farm.beds.every((bed) => bed && typeof bed.id === "string" && Object.hasOwn(crops, bed.crop) &&
        stages.includes(bed.stage) && Number.isFinite(bed.area) && bed.area > 0 &&
        Number.isSafeInteger(bed.plants) && bed.plants > 0)) return farm;
  } catch { /* Load the sample farm if stored data is invalid. */ }
  return demo;
}

const number = new Intl.NumberFormat("en-ZA", { maximumFractionDigits: 2 });
const farmDate = new Intl.DateTimeFormat("sv-SE", { timeZone: "Africa/Johannesburg" });
const currentFarmDate = () => farmDate.format(new Date());
function subscribeToFarmDate(callback: () => void) {
  const interval = window.setInterval(callback, 60_000);
  return () => window.clearInterval(interval);
}
const screens = ["Watering Plan", "Crop Beds", "Alerts", "My Voucher", "Ask WaterWise", "Payments"] as const;
const emptyBed: Bed = { id: "", crop: "Tomatoes", stage: "Seedling", area: 0, plants: 0 };

const toolLabels: Record<string, string> = {
  watering_plan: "Watering plan",
  avalanche_block: "Avalanche C-Chain",
  binance_price: "Binance Spot",
};

function Assistant({ farm }: { farm: Farm }) {
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ answer: string; tools: string[] }>();
  const [error, setError] = useState("");

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !question.trim()) return;
    setPending(true);
    setError("");
    setResult(undefined);
    try {
      const response = await fetch("/api/waterwise/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, scenario: farm.scenario, beds: farm.beds }),
        signal: AbortSignal.timeout(25000),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "The assistant is unavailable.");
        return;
      }
      setResult(data);
    } catch {
      setError("The assistant is unavailable. Check that the backend is running and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="panel assistant" aria-label="WaterWise assistant">
      <form onSubmit={ask}>
        <label>Your question
          <input value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={600} required
            placeholder="How much water would I save on a rainy day?" />
        </label>
        <div className="actions">
          <button className="primary" disabled={pending || !question.trim()}>{pending ? "Asking…" : "Ask WaterWise"}</button>
          <button type="button" className="secondary" onClick={() => setQuestion("What is the latest Avalanche block and the Binance AVAX/USDT price?")}>Try the provider tools</button>
        </div>
      </form>
      <div aria-live="polite" aria-busy={pending}>
        {error && <p className="agent-error">{error}</p>}
        {result && <div className="agent-answer"><p>{result.answer}</p>{result.tools.length > 0 && <p className="bed-info">Tools used · {result.tools.map((name) => toolLabels[name] ?? name).join(" · ")}</p>}</div>}
      </div>
    </section>
  );
}

export default function Home() {
  const farm = readFarm(useSyncExternalStore(subscribe, snapshot, () => initialSnapshot));
  const [screen, setScreen] = useState<typeof screens[number]>("Watering Plan");
  const [usageNotice, setUsageNotice] = useState("");
  const [editing, setEditing] = useState<Bed | null>(null);
  const [status, setStatus] = useState("");
  const [demoData, setDemoData] = useState<DemoData>();

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/waterwise/demo", { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((data: unknown) => {
        if (!controller.signal.aborted && isDemoData(data)) setDemoData(data);
      })
      .catch(() => { /* The bundled data keeps the browser demo available. */ });
    return () => controller.abort();
  }, []);

  const current = { ...weather[farm.scenario], ...demoData?.weather[farm.scenario] };
  const estimates = farm.beds.map((bed) => {
    const factor = (demoData?.factors[bed.crop] ?? crops[bed.crop].factors)[stages.indexOf(bed.stage)];
    const litres = Math.max(0, current.loss * factor - current.rain) * bed.area;
    return { bed, factor, litres };
  });
  const total = estimates.reduce((sum, estimate) => sum + estimate.litres, 0);
  const today = useSyncExternalStore(subscribeToFarmDate, currentFarmDate, () => "");
  const source = farm.waterSource === "Borehole" ? "Borehole" : "Tank";
  const readings = farm.sourceReadings?.[source] ?? {};
  const availableWater = readings[today]?.available ?? "";
  const loggedUsage = Object.values(readings).flatMap(({ used }) => typeof used === "number" && Number.isFinite(used) && used >= 0 ? [used] : []);
  const averageUsage = loggedUsage.reduce((sum, used) => sum + used / loggedUsage.length, 0);

  function saveReading(date: string, reading: Reading) {
    const latest = readFarm(snapshot());
    const sourceHistory = latest.sourceReadings?.[source] ?? {};
    saveFarm({ ...latest, sourceReadings: { ...latest.sourceReadings,
      [source]: { ...sourceHistory, [date]: { ...sourceHistory[date], ...reading } },
    } });
  }

  function logUsage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const date = String(data.get("date"));
    const used = Number(data.get("used"));
    if (!date || date > today || !Number.isFinite(used) || used < 0) return;
    saveReading(date, { used });
    setUsageNotice(`${source} usage saved for ${date}.`);
    event.currentTarget.reset();
  }

  function openScreen(next: typeof screen) {
    setScreen(next);
    setEditing(null);
    setStatus("");
  }

  function saveBed(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const data = new FormData(event.currentTarget);
    const bed: Bed = {
      id: editing.id || Array.from(crypto.getRandomValues(new Uint32Array(4))).join("-"),
      crop: data.get("crop") as Bed["crop"],
      stage: data.get("stage") as Bed["stage"],
      area: Number(data.get("area")),
      plants: Number(data.get("plants")),
    };
    if (!Number.isFinite(bed.area) || bed.area <= 0 || !Number.isSafeInteger(bed.plants) || bed.plants <= 0) {
      setStatus("Enter a positive area and a whole number of plants.");
      return;
    }
    const latest = readFarm(snapshot());
    saveFarm({ ...latest, beds: editing.id ? latest.beds.map((item) => item.id === bed.id ? bed : item) : [...latest.beds, bed] });
    setEditing(null);
    setStatus(editing.id ? "Crop bed updated." : "Crop bed added.");
  }

  return (
    <>
      <header className="header">
        <div className="shell top">
          <div className="brand"><span className="brand-icon" aria-hidden="true">♧</span> WaterWise</div>
          <span className="demo">BACISS demo</span>
        </div>
      </header>
      <nav aria-label="Main navigation" className="nav">
        <div className="shell nav-inner">
          {screens.map((item, index) => (
            <button key={item} aria-current={screen === item ? "page" : undefined} onClick={() => openScreen(item)}>
              <span aria-hidden="true">{["◈", "▤", "♧", "◇", "✦", "▣"][index]}</span> {item}
            </button>
          ))}
        </div>
      </nav>

      <main className="shell main">
        <div className="intro">
          <div><h1>{screen}</h1><p>{screen === "Watering Plan" ? "See how much water your crops need today." : screen === "Crop Beds" ? "Manage your farm location and crop beds." : screen === "Alerts" ? "See how demo weather changes your watering plan." : screen === "My Voucher" ? "Track water requests and voucher transactions." : screen === "Payments" ? "Try the proposed cooperative subscription checkout." : "Ask about your demo watering plan, Avalanche, or the Binance AVAX price."}</p></div>
          <span className="location"><span aria-hidden="true">⌖</span> {farm.location}</span>
        </div>

        {screen === "Watering Plan" && (
          <>
            <section className="summary" aria-label="Today’s water estimate">
              <div><p>Water needed today</p><strong aria-live="polite">{number.format(total)} <small>L</small></strong><p>Estimated total for {farm.beds.length} {farm.beds.length === 1 ? "bed" : "beds"}</p></div>
              <div className="weather"><span className="weather-icon" aria-hidden="true">{current.icon}</span><div><b>{current.label}</b><p>Demo weather</p><p>{current.rain} mm usable rain · {current.loss} mm reference water loss</p></div></div>
            </section>
            <section className="panel source-panel">
              <div className="section-heading payment-heading"><h2>Water source</h2></div>
              <div className="grid source-overview">
                <label>Source used for these beds
                  <select value={source} onChange={(event) => {
                    saveFarm({ ...readFarm(snapshot()), waterSource: event.target.value as WaterSource });
                    setUsageNotice("");
                  }}>
                    <option>Tank</option><option>Borehole</option>
                  </select>
                </label>
                <div><strong>{loggedUsage.length ? `${number.format(averageUsage)} L/day` : "No usage logged"}</strong>
                  <p>Average ${source.toLowerCase()} use{loggedUsage.length > 0 && ` over ${loggedUsage.length} logged ${loggedUsage.length === 1 ? "day" : "days"}`}</p></div>
              </div>
              <form className="source-log" key={`${source}:${today}`} onSubmit={logUsage}>
                <label>Date<input type="date" name="date" defaultValue={today} max={today} required /></label>
                <label>Actual water used (litres)<input type="number" name="used" min="0" max={Number.MAX_SAFE_INTEGER} step="any" inputMode="decimal" required /></label>
                <button className="secondary">Save daily usage</button>
              </form>
              <p className="source-note">Saving the same date updates that day’s reading. Enter 0 for a day with no usage.</p>
              <p role="status" className="status">{usageNotice}</p>
            </section>
            <WaterRequests plan={{ scenario: farm.scenario, beds: farm.beds }} total={total}
              planner={{ available: availableWater, setAvailable: (available) => saveReading(today, { available }),
                source, openVoucher: () => openScreen("My Voucher"),
                loadDemo: () => {
                  const latest = readFarm(snapshot());
                  const history = latest.sourceReadings?.Tank ?? {};
                  saveFarm({ ...latest, ...demo, waterSource: "Tank",
                    sourceReadings: { ...latest.sourceReadings, Tank: { ...history, [today]: { ...history[today], available: "30" } } },
                    beds: [
                    { ...demo.beds[0], area: 20 / 3, plants: 12 },
                    { ...demo.beds[1], area: 4, plants: 8 },
                  ] });
                  setUsageNotice("");
                } }} />
            <div className="section-heading"><h2>Water by crop bed</h2><button className="secondary" onClick={() => openScreen("Crop Beds")}>Manage beds</button></div>
            <div className="grid">
              {estimates.map(({ bed, factor, litres }) => (
                <article className="card" key={bed.id}>
                  <div className="crop-heading"><span className="crop-icon" aria-hidden="true">{crops[bed.crop].icon}</span><div><h3>{bed.crop}</h3><p>{bed.stage} stage</p></div></div>
                  <p className="bed-info">{number.format(bed.area)} m² · {number.format(bed.plants)} plants · Demo crop factor {number.format(factor)}</p>
                  <div className="metrics"><div><strong>{number.format(litres)} L</strong><span>Whole bed</span></div><div><strong>{number.format(litres / bed.plants)} L</strong><span>Average per plant</span></div></div>
                </article>
              ))}
            </div>
            {!estimates.length && <p className="panel">Add a crop bed to get a watering estimate.</p>}
            <section className="explanation">
              <h2>How we estimate watering</h2>
              <p>We multiply the reference daily water loss by the demo factor for the crop and growth stage, then subtract usable rain. If the result is below zero, we use zero. Each millimetre left needs one litre per square metre of bed. We divide the bed total by the number of plants to get the average.</p>
            </section>
          </>
        )}

        {screen === "Crop Beds" && (
          <>
            <form className="panel location-form" onSubmit={(event) => {
              event.preventDefault();
              const location = String(new FormData(event.currentTarget).get("location")).trim();
              if (!location) { setStatus("Enter your farm location."); return; }
              saveFarm({ ...readFarm(snapshot()), location });
              setStatus("Farm location saved.");
            }}>
              <label>Farm location<input key={farm.location} name="location" defaultValue={farm.location} maxLength={120} required /></label>
              <button className="primary">Save location</button>
            </form>
            <div className="section-heading"><h2>Your crop beds</h2><button className="primary" onClick={() => { setEditing(emptyBed); setStatus(""); }}>Add crop bed</button></div>
            {editing && (
              <form className="panel bed-form" key={editing.id} onSubmit={saveBed}>
                <h3>{editing.id ? "Edit crop bed" : "Add crop bed"}</h3>
                <div className="grid">
                  <label>Crop type<select name="crop" defaultValue={editing.crop} autoFocus>{Object.keys(crops).map((crop) => <option key={crop}>{crop}</option>)}</select></label>
                  <label>Growth stage<select name="stage" defaultValue={editing.stage}>{stages.map((stage) => <option key={stage}>{stage}</option>)}</select></label>
                  <label>Bed area (m²)<input name="area" type="number" step="any" min="0" defaultValue={editing.area || ""} required /></label>
                  <label>Number of plants<input name="plants" type="number" min="1" step="1" defaultValue={editing.plants || ""} required /></label>
                </div>
                <div className="actions"><button className="primary">Save crop bed</button><button className="secondary" type="button" onClick={() => { setEditing(null); setStatus(""); }}>Cancel</button></div>
              </form>
            )}
            <p role="status" className="status">{status}</p>
            <div className="grid">
              {farm.beds.map((bed) => (
                <article className="card" key={bed.id}>
                  <div className="crop-heading"><span className="crop-icon" aria-hidden="true">{crops[bed.crop].icon}</span><div><h3>{bed.crop}</h3><p>{bed.stage} stage</p></div></div>
                  <p className="bed-info">{number.format(bed.area)} m² · {number.format(bed.plants)} plants</p>
                  <div className="actions">
                    <button className="secondary" onClick={() => { setEditing(bed); setStatus(""); }}>Edit</button>
                    <button className="secondary remove" onClick={() => {
                      const latest = readFarm(snapshot());
                      saveFarm({ ...latest, beds: latest.beds.filter((item) => item.id !== bed.id) });
                      if (editing?.id === bed.id) setEditing(null);
                      setStatus("Crop bed removed.");
                    }}>Remove</button>
                  </div>
                </article>
              ))}
            </div>
            {!farm.beds.length && <p className="panel">You have no crop beds yet.</p>}
          </>
        )}

        {screen === "Alerts" && (
          <section className="panel scenarios">
            <fieldset>
              <legend>Demo weather scenario</legend>
              <div className="grid">
                {(Object.keys(weather) as Array<keyof typeof weather>).map((scenario) => (
                  <label className="scenario" key={scenario}>
                    <input type="radio" name="weather" checked={farm.scenario === scenario} onChange={() => saveFarm({ ...readFarm(snapshot()), scenario })} />
                    <span><b>{weather[scenario].label}</b><span>{(demoData?.weather[scenario] ?? weather[scenario]).rain} mm usable rain · {(demoData?.weather[scenario] ?? weather[scenario]).loss} mm reference water loss</span></span>
                  </label>
                ))}
              </div>
            </fieldset>
            <p role="status">The watering plan now estimates {number.format(total)} L for today.</p>
            {farm.scenario === "rainy" && <button className="secondary" onClick={() => openScreen("Watering Plan")}>View watering plan</button>}
          </section>
        )}

        {screen === "My Voucher" && <WaterRequests plan={{ scenario: farm.scenario, beds: farm.beds }} total={total} />}
        {screen === "Ask WaterWise" && <Assistant farm={farm} />}
        {screen === "Payments" && <Payments />}

        {farm.scenario === "dry" && (screen === "Alerts" || screen === "Watering Plan") && (
          <aside className="alert" aria-label="Dry spell alert">
            <div><strong>Dry spell alert</strong><p>The demo forecasts no usable rain. Check how much water your beds need today.</p></div>
            {screen !== "Watering Plan" && <button className="secondary" onClick={() => openScreen("Watering Plan")}>Open watering plan</button>}
          </aside>
        )}

        <footer>WaterWise · Weather and crop factors are demo data.</footer>
      </main>
    </>
  );
}
