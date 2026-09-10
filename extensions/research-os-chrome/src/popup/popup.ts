const pairing = document.querySelector<HTMLElement>("#pairing")!;
const capture = document.querySelector<HTMLElement>("#capture")!;
const pairingCode = document.querySelector<HTMLInputElement>("#pairing-code")!;
const pairButton = document.querySelector<HTMLButtonElement>("#pair")!;
const startButton = document.querySelector<HTMLButtonElement>("#start")!;
const cancelButton = document.querySelector<HTMLButtonElement>("#cancel")!;
const statusElement = document.querySelector<HTMLElement>("#status")!;
const progressBar = document.querySelector<HTMLElement>("#progress-bar")!;
const error = document.querySelector<HTMLElement>("#error")!;
const baseUrl = document.querySelector<HTMLInputElement>("#base-url")!;
const saveBaseUrl = document.querySelector<HTMLButtonElement>("#save-base-url")!;

function showError(value: string | null) {
  error.hidden = !value;
  error.textContent = value ?? "";
}

function renderState(state: any) {
  statusElement.textContent = state?.message ?? "打开一条 ChatGPT 对话后开始捕获。";
  const running = state?.phase === "capturing" || state?.phase === "sending";
  startButton.disabled = running;
  cancelButton.hidden = !running;
  const discovered = Number(state?.discovered ?? 0);
  progressBar.style.width = state?.phase === "complete" ? "100%" : running ? `${Math.min(92, 15 + Math.log2(discovered + 1) * 12)}%` : "0";
}

async function refresh() {
  const response = await chrome.runtime.sendMessage({ type: "get-extension-state" });
  if (response?.error) throw new Error(response.error);
  pairing.hidden = response.paired;
  capture.hidden = !response.paired;
  baseUrl.value = response.baseUrl;
  renderState(response.state);
}

async function persistBaseUrl() {
  const response = await chrome.runtime.sendMessage({ type: "set-research-os-base-url", baseUrl: baseUrl.value });
  if (!response?.ok) throw new Error(response?.error ?? "无法保存 Research OS 地址");
  baseUrl.value = response.baseUrl;
  return response;
}

pairButton.addEventListener("click", async () => {
  showError(null);
  pairButton.disabled = true;
  try {
    await persistBaseUrl();
    const response = await chrome.runtime.sendMessage({ type: "pair-research-os", code: pairingCode.value });
    if (!response?.ok) throw new Error(response?.error ?? "配对失败");
    await refresh();
  } catch (pairError) {
    showError(pairError instanceof Error ? pairError.message : String(pairError));
  } finally {
    pairButton.disabled = false;
  }
});

saveBaseUrl.addEventListener("click", async () => {
  showError(null);
  saveBaseUrl.disabled = true;
  try {
    await persistBaseUrl();
    await refresh();
  } catch (saveError) {
    showError(saveError instanceof Error ? saveError.message : String(saveError));
  } finally {
    saveBaseUrl.disabled = false;
  }
});

startButton.addEventListener("click", async () => {
  showError(null);
  const response = await chrome.runtime.sendMessage({ type: "start-browser-capture" });
  if (!response?.ok) showError(response?.error ?? "无法开始捕获");
  await refresh();
});

cancelButton.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "cancel-browser-capture" });
  await refresh();
});

chrome.storage.onChanged.addListener((changes: any, area: string) => {
  if (area === "session" && changes.captureState?.newValue) renderState(changes.captureState.newValue);
});

void refresh().catch((loadError) => showError(loadError instanceof Error ? loadError.message : String(loadError)));
