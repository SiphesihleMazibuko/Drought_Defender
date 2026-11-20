"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";

const methods = ["Avalanche Fuji", "Binance Pay"] as const;
type Method = typeof methods[number];
const key = "waterwise-mock-subscription-v1";
const eventName = "waterwise-payment";
const amount = new Intl.NumberFormat("en-ZA", {
  style: "currency", currency: "ZAR", maximumFractionDigits: 0,
}).format(600);

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(eventName, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(eventName, callback);
  };
}

function storedMethod(): Method | null {
  try {
    const value = localStorage.getItem(key);
    return methods.find(method => method === value) ?? null;
  } catch {
    return null;
  }
}

export default function Payments() {
  const [method, setMethod] = useState<Method>("Avalanche Fuji");
  const [error, setError] = useState("");
  const paidVia = useSyncExternalStore(subscribe, storedMethod, () => null);

  function pay(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (storedMethod()) return;
    try {
      localStorage.setItem(key, method);
      window.dispatchEvent(new Event(eventName));
      setError("");
    } catch {
      setError("This browser could not save the mock payment. Enable browser storage and retry.");
    }
  }

  return (
    <section className="panel scenarios" aria-label="Cooperative checkout">
      <div className="section-heading payment-heading">
        <div><h2>Cooperative subscription</h2><p>Six months · {amount} sample price</p></div>
        <span className="location">Mock checkout</span>
      </div>
      <p>WaterWise is free for farmers. This demo uses a simulated payment and moves no funds.</p>
      <div aria-live="polite">
        {paidVia && <p className="explanation"><strong>Mock payment complete</strong><br />{amount} via {paidVia} · Six-month demo subscription</p>}
        {error && <p className="agent-error">{error}</p>}
      </div>
      {!paidVia && (
        <form onSubmit={pay}>
          <fieldset>
            <legend>Choose a payment method</legend>
            <div className="grid">
              {methods.map((item) => (
                <label className="scenario" key={item}>
                  <input type="radio" name="payment-method" checked={method === item} onChange={() => setMethod(item)} />
                  <span><b>{item}</b><span>{item === "Avalanche Fuji" ? "Simulated test AVAX payment" : "Simulated Binance Pay checkout"}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="actions payment-actions">
            <button className="primary">Make mock payment · {amount}</button>
          </div>
        </form>
      )}
    </section>
  );
}
