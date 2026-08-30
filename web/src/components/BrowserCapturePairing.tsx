import { useEffect, useState } from "react";

import {
  listBrowserCaptureClients,
  revokeBrowserCaptureClient,
  startBrowserCapturePairing,
} from "../researchApi";
import type { ResearchCaptureClient } from "../researchTypes";

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function BrowserCapturePairing({ onClose }: { onClose: () => void }) {
  const [pairing, setPairing] = useState<{ code: string; expiresAt: string } | null>(null);
  const [clients, setClients] = useState<ResearchCaptureClient[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    void listBrowserCaptureClients().then(setClients).catch((loadError) => setError(message(loadError)));
  }, []);

  async function createCode() {
    setPending(true);
    setError(null);
    try {
      setPairing(await startBrowserCapturePairing());
    } catch (pairError) {
      setError(message(pairError));
    } finally {
      setPending(false);
    }
  }

  async function revoke(client: ResearchCaptureClient) {
    setPending(true);
    setError(null);
    try {
      await revokeBrowserCaptureClient(client.id);
      setClients((current) => current.map((candidate) => candidate.id === client.id
        ? { ...candidate, revokedAt: new Date().toISOString() }
        : candidate));
    } catch (revokeError) {
      setError(message(revokeError));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="modal-backdrop research-import-backdrop" role="presentation">
      <section className="research-capture-pairing" role="dialog" aria-modal="true" aria-label="连接浏览器扩展">
        <header>
          <div><span>ChatGPT Browser Capture</span><h2>连接浏览器扩展</h2></div>
          <button type="button" onClick={onClose} aria-label="关闭">×</button>
        </header>
        <div className="research-capture-pairing-body">
          <p>扩展只会在你主动点击时读取当前 ChatGPT 对话。它不会读取 Cookie，也不会自动扫描历史记录。</p>
          {!pairing ? (
            <button className="button primary" type="button" disabled={pending} onClick={() => void createCode()}>
              生成一次性配对码
            </button>
          ) : (
            <div className="research-pairing-code">
              <span>把下面的配对码粘贴到 Research OS 扩展：</span>
              <strong>{pairing.code}</strong>
              <small>有效期至 {new Date(pairing.expiresAt).toLocaleTimeString()}，只能使用一次。</small>
              <button className="button" type="button" onClick={() => void navigator.clipboard.writeText(pairing.code)}>复制配对码</button>
            </div>
          )}
          <section className="research-capture-clients">
            <h3>已连接的扩展</h3>
            {clients.length === 0 ? <p>当前还没有已配对的浏览器扩展。</p> : clients.map((client) => (
              <div key={client.id}>
                <span><strong>{client.displayName}</strong><small>{client.revokedAt ? "已撤销" : client.lastUsedAt ? `最近使用 ${new Date(client.lastUsedAt).toLocaleString()}` : "尚未使用"}</small></span>
                {!client.revokedAt && <button type="button" disabled={pending} onClick={() => void revoke(client)}>撤销</button>}
              </div>
            ))}
          </section>
          {error && <div className="research-error" role="alert">{error}</div>}
        </div>
      </section>
    </div>
  );
}
