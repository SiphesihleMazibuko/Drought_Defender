"use client";

import { useEffect, useState, type FormEvent } from "react";

type Plan = { scenario: "dry" | "rainy"; beds: { crop: string; stage: string; area: number }[] };
type Status = "pending" | "approved" | "issue_pending" | "issue_failed" | "issued" | "redeem_pending" | "redeem_failed" | "redeemed";
type RequestRecord = {
  id: string; voucherId: string; needed: number; available: number; shortfall: number;
  approved?: number; checkedSupply?: number; status: Status;
  transactions: { action: "issue" | "redeem"; hash: string; status: string; confirmations?: number; local?: boolean }[];
};
const labels: Record<Status, string> = {
  pending: "Pending approval", approved: "Approved · awaiting submission",
  issue_pending: "Issuance awaiting confirmation", issue_failed: "Issuance failed",
  issued: "Ready to collect", redeem_pending: "Redemption awaiting confirmation",
  redeem_failed: "Redemption failed", redeemed: "Used",
};
const endpoint = "/api/waterwise/requests";
const intentKey = "waterwise-request-intent";
const format = new Intl.NumberFormat("en-ZA", { maximumFractionDigits: 3 });
const litres = (value: number) => `${format.format(value)} L`;

function randomId() {
  const bytes = Array.from(crypto.getRandomValues(new Uint8Array(16)));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.map(byte => byte.toString(16).padStart(2, "0")).join("");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}

function farmerHeaders() {
  const key = "waterwise-demo-farmer";
  const owner = localStorage.getItem(key) || randomId();
  localStorage.setItem(key, owner);
  return { "x-waterwise-farmer": owner };
}

class RequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function api<T>(url: string, headers: Record<string, string>, body?: object): Promise<T> {
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { ...headers, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store",
    signal: AbortSignal.timeout(25000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new RequestError(data?.error ?? "The voucher service is unavailable.", response.status);
  return data as T;
}

type Planner = { available: string; setAvailable: (value: string) => void; source: string; openVoucher: () => void; loadDemo: () => void };

export default function WaterRequests({ plan, total, planner }: { plan: Plan; total: number; planner?: Planner }) {
  const available = planner?.available ?? "";
  const [records, setRecords] = useState<RequestRecord[]>([]);
  const [mode, setMode] = useState<"farmer" | "issue" | "redeem" | "replay">("farmer");
  const [staffCode, setStaffCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [recover, setRecover] = useState(false);
  const shortfall = Math.max(0, total - Number(available));

  function headers() {
    return mode === "farmer" ? farmerHeaders() : { Authorization: "Bearer " + staffCode };
  }

  useEffect(() => {
    if (mode !== "farmer" && !staffCode) return;
    let current = true;
    let running = false;
    async function load() {
      if (running) return;
      running = true;
      try {
        const auth = mode === "farmer" ? farmerHeaders() : { Authorization: "Bearer " + staffCode };
        if (mode === "farmer" && current) setRecover(Boolean(localStorage.getItem(intentKey)));
        const result = await api<RequestRecord[]>(mode === "farmer" ? endpoint : `${endpoint}?role=${mode}`, auth);
        if (current) setRecords(result);
      } catch (error) {
        if (current) setNotice(error instanceof Error ? error.message : "Could not load water requests.");
      } finally {
        running = false;
      }
    }
    void load();
    const timer = window.setInterval(load, 8000);
    return () => { current = false; window.clearInterval(timer); };
  }, [mode, staffCode, revision]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      const auth = farmerHeaders();
      const previous = localStorage.getItem(intentKey);
      const payload = previous ? JSON.parse(previous) : {
        scenario: plan.scenario, beds: plan.beds.map(({ crop, stage, area }) => ({ crop, stage, area })),
        available: Number(available), requestId: randomId(),
      };
      localStorage.setItem(intentKey, JSON.stringify(payload));
      await api<RequestRecord>(endpoint, auth, payload);
      localStorage.removeItem(intentKey);
      setRecover(false);
      setNotice("Request submitted for cooperative approval.");
      setRevision(value => value + 1);
      planner?.openVoucher();
    } catch (error) {
      if (error instanceof RequestError && [400, 409].includes(error.status)) localStorage.removeItem(intentKey);
      setRecover(Boolean(localStorage.getItem(intentKey)));
      setNotice(error instanceof Error ? error.message : "Could not submit your request. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function staffAction(event: FormEvent<HTMLFormElement>, record: RequestRecord) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice("");
    const form = new FormData(event.currentTarget);
    try {
      if (mode === "replay") {
        const proof = await api<{ message: string }>(`${endpoint}/${record.id}/replay`, headers(), {});
        setNotice(proof.message);
        return;
      }
      const updated = await api<RequestRecord>(`${endpoint}/${record.id}/${mode}`, headers(), {
        approved: Number(form.get("approved")), checkedSupply: Number(form.get("checkedSupply")),
        handedOver: form.has("handedOver"),
      });
      setRecords(previous => previous.map(item => item.id === record.id ? updated : item));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not send the transaction.");
    } finally {
      setRevision(value => value + 1);
      setBusy(false);
    }
  }

  return (
    <div className="voucher-workflow">
      {planner ? (
        <>
          <form className="panel voucher-form" onSubmit={submit}>
            <div className="metrics shortfall-metrics">
              <div><strong>{litres(total)}</strong><span>Estimated need</span></div>
              <label>Available water from {planner.source.toLowerCase()} (litres)
                <input type="number" inputMode="decimal" min="0" step="any" required value={available}
                  onChange={event => planner.setAvailable(event.target.value)} placeholder="e.g. 30" />
              </label>
              <div><strong aria-live="polite">{available === "" ? "–" : litres(shortfall)}</strong><span>Shortfall</span></div>
            </div>
            <div className="actions">
              {(recover || (available !== "" && shortfall > 0)) && (
                <button className="primary" formNoValidate={recover} disabled={busy}>
                  {busy ? "Submitting…" : recover ? "Retry previous request" : "Request water"}
                </button>
              )}
              <button type="button" className="secondary" onClick={planner.openVoucher}>My Voucher</button>
              <button type="button" className="secondary" disabled={busy} onClick={planner.loadDemo}>Load BACISS mock farm</button>
            </div>
            <p role="status" className="status">{notice}</p>
          </form>
        </>
      ) : <>
      <div className="actions" aria-label="Demo roles">
        {(["farmer", "issue", "redeem", "replay"] as const).map((role, index) => (
          <button key={role} className={mode === role ? "primary" : "secondary"} aria-pressed={mode === role} disabled={busy}
            onClick={() => { if (mode !== role) { setRecords([]); setNotice(""); setStaffCode(""); setMode(role); } }}>
            {["Farmer", "Cooperative staff", "Collection Point A", "Collection Point B"][index]}
          </button>
        ))}
      </div>
      {mode !== "farmer" && (
        <form key={mode} className="panel voucher-form" onSubmit={event => {
          event.preventDefault();
          setNotice("");
          setRecords([]);
          const code = String(new FormData(event.currentTarget).get("code"));
          event.currentTarget.reset();
          setStaffCode(code);
          setRevision(value => value + 1);
        }}>
          <label>Demo staff access code<input name="code" type="password" autoComplete="off" required /></label>
          <button className="primary">Open staff requests</button>
        </form>
      )}

      <p role="status" className="status">{notice}</p>

      {(mode === "farmer" || staffCode) && (
        <section>
          <div className="section-heading"><h2>{mode === "farmer" ? "Your water requests" : "Water requests"}</h2>
            <button className="secondary" onClick={() => setRevision(value => value + 1)}>Refresh</button>
          </div>
          {records.length === 0 && <p className="panel">No water requests to show.</p>}
          <div className="grid">
            {records.map(record => {
              const canIssue = mode === "issue" && ["pending", "approved", "issue_pending", "issue_failed"].includes(record.status);
              const canRedeem = mode === "redeem" && ["issued", "redeem_pending", "redeem_failed"].includes(record.status);
              const canReplay = mode === "replay" && record.status === "redeemed";
              return (
                <article key={record.id} className="card voucher-card">
                  <h3>{labels[record.status]}</h3>
                  <p>Requested {litres(record.shortfall)}{record.approved !== undefined && ` · Approved ${litres(record.approved)}`}</p>
                  {record.status.endsWith("_failed") && <p className="agent-error">The transaction failed. The staff member responsible can retry this voucher.</p>}
                  <details open={record.transactions.length > 0}><summary>Voucher details</summary>
                    <p className="voucher-id">{record.voucherId}</p>
                    {record.transactions.length > 0 && <ul>{record.transactions.map(tx => (
                      <li key={tx.hash}>{tx.action === "issue" ? "Issuance" : "Redemption"} · {tx.status === "confirmed"
                        ? tx.local ? <span>Confirmed on local test chain</span>
                          : <a href={`https://explorer-test.avax.network/c-chain/tx/${tx.hash}`} target="_blank" rel="noreferrer">Confirmed on Fuji</a>
                        : <span>{tx.status === "pending" ? `${tx.confirmations ?? 0} of 2 confirmations${tx.local ? " · Local test chain" : ""}` : "Failed"}</span>}</li>
                    ))}</ul>}
                  </details>
                  {(canIssue || canRedeem || canReplay) && <form className="voucher-form" onSubmit={event => staffAction(event, record)}>
                    {canIssue && record.approved === undefined && <>
                      <label>Supply checked (litres)<input name="checkedSupply" required type="number" min="1" step="any" /></label>
                      <label>Approve whole litres (up to {litres(Math.ceil(record.shortfall))})
                        <input name="approved" required type="number" min="1" max={Math.ceil(record.shortfall)} defaultValue={Math.ceil(record.shortfall)} />
                      </label>
                    </>}
                    {canRedeem && record.status !== "redeem_pending" && <label className="handover">
                      <input name="handedOver" type="checkbox" required /> I confirm the approved water was handed over.
                    </label>}
                    <button className="primary" disabled={busy}>
                      {canReplay ? "Simulate repeat redemption" : canIssue ? record.approved === undefined ? "Approve and issue" : "Retry issuance"
                        : record.status === "issued" ? "Redeem voucher" : "Retry redemption"}
                    </button>
                  </form>}
                </article>
              );
            })}
          </div>
        </section>
      )}
      </>}
    </div>
  );
}
