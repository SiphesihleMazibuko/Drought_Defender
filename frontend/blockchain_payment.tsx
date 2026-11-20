"use client";

import { useEffect, useSyncExternalStore, useState, type FormEvent } from "react";

declare global {
  interface Window {
    avalanche?: Eip1193Provider;
    ethereum?: Eip1193Provider;
  }
}

interface Eip1193Provider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  isAvalanche?: boolean;
}

const FUJI_CHAIN_ID = "0xa869"; // 43113 (Avalanche C-Chain Fuji Testnet)
const FUJI_NETWORK_PARAMS = {
  chainId: FUJI_CHAIN_ID,
  chainName: "Avalanche Fuji C-Chain",
  nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
  rpcUrls: ["https://api.avax-test.network/ext/bc/C/rpc"],
  blockExplorerUrls: ["https://testnet.snowtrace.io/"],
};

// Default demo recipient wallet (replace with your team's Fuji testnet treasury address)
const DEFAULT_TREASURY_ADDRESS = "0x000000000000000000000000000000000000dEaD";

function avaxToHexWei(amountAvax: string): string {
  const parsed = Number(amountAvax);
  if (!Number.isFinite(parsed) || parsed <= 0) return "0x0";
  const wei = BigInt(Math.round(parsed * 1e9)) * BigInt(1e9);
  return "0x" + wei.toString(16);
}

export default function PaymentPanel() {
  const [method, setMethod] = useState<"core" | "binance">("core");

  // Core Wallet (Avalanche Fuji Testnet) state
  const [walletAddress, setWalletAddress] = useState<string>("");
  const [recipient, setRecipient] = useState<string>(DEFAULT_TREASURY_ADDRESS);
  const [amountAvax, setAmountAvax] = useState<string>("0.01");
  const [txHash, setTxHash] = useState<string>("");
  const [walletBusy, setWalletBusy] = useState<boolean>(false);
  const [walletError, setWalletError] = useState<string>("");

  // Binance Pay Simulator state
  const [binanceAmountUsdt, setBinanceAmountUsdt] = useState<string>("5.00");
  const [simOrder, setSimOrder] = useState<{
    orderId: string;
    status: "PENDING" | "PAID";
    amount: string;
  } | null>(null);

  function getCoreProvider(): Eip1193Provider | undefined {
    if (typeof window === "undefined") return undefined;
    return window.avalanche ?? window.ethereum;
  }

  async function ensureFujiTestnet(provider: Eip1193Provider) {
    const currentChain = (await provider.request({ method: "eth_chainId" })) as string;
    if (currentChain?.toLowerCase() === FUJI_CHAIN_ID) return;

    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: FUJI_CHAIN_ID }],
      });
    } catch (switchError: unknown) {
      const err = switchError as { code?: number };
      if (err?.code === 4902) {
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [FUJI_NETWORK_PARAMS],
        });
      } else {
        throw switchError;
      }
    }
  }

  async function connectCoreWallet() {
    setWalletError("");
    setTxHash("");
    const provider = getCoreProvider();
    if (!provider) {
      setWalletError("Core Wallet extension not detected in this browser. Install Core Wallet and refresh.");
      return;
    }

    setWalletBusy(true);
    try {
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      if (!accounts || accounts.length === 0) {
        setWalletError("No wallet account authorized.");
        return;
      }
      await ensureFujiTestnet(provider);
      setWalletAddress(accounts[0]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to connect Core Wallet.";
      setWalletError(message);
    } finally {
      setWalletBusy(false);
    }
  }

  async function sendCoreTestnetPayment(event: React.FormEvent) {
    event.preventDefault();
    setWalletError("");
    setTxHash("");

    const provider = getCoreProvider();
    if (!provider || !walletAddress) {
      setWalletError("Connect your Core Wallet first.");
      return;
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(recipient.trim())) {
      setWalletError("Enter a valid 0x Avalanche C-Chain wallet address.");
      return;
    }
    const numericAmount = Number(amountAvax);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setWalletError("Enter an AVAX amount greater than 0.");
      return;
    }

    setWalletBusy(true);
    try {
      await ensureFujiTestnet(provider);
      const hash = (await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: walletAddress,
            to: recipient.trim(),
            value: avaxToHexWei(amountAvax),
          },
        ],
      })) as string;
      setTxHash(hash);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Transaction cancelled or failed.";
      setWalletError(message);
    } finally {
      setWalletBusy(false);
    }
  }

  function createBinanceSimulation(event: React.FormEvent) {
    event.preventDefault();
    const numeric = Number(binanceAmountUsdt);
    if (!Number.isFinite(numeric) || numeric <= 0) return;
    const randomId = "BNP-SIM-" + Math.floor(100000 + Math.random() * 900000);
    setSimOrder({
      orderId: randomId,
      status: "PENDING",
      amount: numeric.toFixed(2),
    });
  }

  function confirmBinanceSimulation() {
    if (!simOrder) return;
    setSimOrder({ ...simOrder, status: "PAID" });
  }

  return (
    <section className="panel" aria-label="Payment options">
      {/* Payment Method Switcher */}
      <div className="actions" style={{ marginBottom: "1rem" }}>
        <button
          type="button"
          className={method === "core" ? "primary" : "secondary"}
          onClick={() => setMethod("core")}
        >
          Core Wallet (Avalanche Testnet)
        </button>
        <button
          type="button"
          className={method === "binance" ? "primary" : "secondary"}
          onClick={() => setMethod("binance")}
        >
          Binance Pay (Simulated)
        </button>
      </div>

      {/* OPTION 1: Core Wallet on Avalanche Fuji Testnet */}
      {method === "core" && (
        <div>
          <h2>Core Wallet · Avalanche Fuji C-Chain</h2>
          <p className="bed-info">
            Pay directly from wallet to wallet using Fuji Testnet AVAX (Chain ID 43113).
          </p>

          {!walletAddress ? (
            <div className="actions" style={{ marginTop: "1rem" }}>
              <button
                type="button"
                className="primary"
                disabled={walletBusy}
                onClick={connectCoreWallet}
              >
                {walletBusy ? "Connecting…" : "Connect Core Wallet"}
              </button>
            </div>
          ) : (
            <form onSubmit={sendCoreTestnetPayment} style={{ marginTop: "1rem" }}>
              <p className="bed-info">
                Connected wallet: <strong>{walletAddress}</strong>
              </p>

              <div className="grid" style={{ marginTop: "0.75rem" }}>
                <label>
                  Recipient Wallet Address (0x…)
                  <input
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    placeholder="0x..."
                    required
                  />
                </label>

                <label>
                  Amount (Testnet AVAX)
                  <input
                    type="number"
                    step="any"
                    min="0.0001"
                    value={amountAvax}
                    onChange={(e) => setAmountAvax(e.target.value)}
                    required
                  />
                </label>
              </div>

              <div className="actions" style={{ marginTop: "1rem" }}>
                <button type="submit" className="primary" disabled={walletBusy}>
                  {walletBusy ? "Confirm in Core Wallet…" : `Send ${amountAvax} AVAX`}
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    setWalletAddress("");
                    setTxHash("");
                    setWalletError("");
                  }}
                >
                  Disconnect
                </button>
              </div>
            </form>
          )}

          {walletError && (
            <p className="agent-error" style={{ marginTop: "0.75rem" }}>
              {walletError}
            </p>
          )}

          {txHash && (
            <div className="agent-answer" style={{ marginTop: "0.75rem" }}>
              <p>
                <strong>Testnet payment sent!</strong>
              </p>
              <p className="bed-info" style={{ wordBreak: "break-all" }}>
                Tx Hash: {txHash}
              </p>
              <p style={{ marginTop: "0.4rem" }}>
                <a
                  href={`https://testnet.snowtrace.io/tx/${txHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View on Avalanche Fuji Explorer ↗
                </a>
              </p>
            </div>
          )}
        </div>
      )}

      {/* OPTION 2: Secondary Simulated Binance Pay */}
      {method === "binance" && (
        <div>
          <h2>Binance Pay · Prototype Simulator</h2>
          <p className="bed-info">
            Secondary simulated payment flow for water credits (no real funds moved).
          </p>

          {!simOrder ? (
            <form onSubmit={createBinanceSimulation} style={{ marginTop: "1rem" }}>
              <label>
                Water Credit Amount (Simulated USDT)
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  value={binanceAmountUsdt}
                  onChange={(e) => setBinanceAmountUsdt(e.target.value)}
                  required
                />
              </label>
              <div className="actions" style={{ marginTop: "1rem" }}>
                <button type="submit" className="primary">
                  Generate Simulated Binance Order
                </button>
              </div>
            </form>
          ) : (
            <div className="agent-answer" style={{ marginTop: "1rem" }}>
              <p>
                Order ID: <strong>{simOrder.orderId}</strong>
              </p>
              <p className="bed-info">
                Amount: {simOrder.amount} USDT · Status:{" "}
                <strong>{simOrder.status}</strong>
              </p>

              <div className="actions" style={{ marginTop: "0.75rem" }}>
                {simOrder.status === "PENDING" ? (
                  <button
                    type="button"
                    className="primary"
                    onClick={confirmBinanceSimulation}
                  >
                    Simulate Payment Approval
                  </button>
                ) : (
                  <p>
                    <strong>Payment confirmed!</strong> Water credits allocated to farm account.
                  </p>
                )}
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setSimOrder(null)}
                >
                  New Order
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}