import { ProxyAgent, setGlobalDispatcher } from "undici";

const proxyUrl = process.env.HF_PROXY_URL ?? process.env.HTTPS_PROXY ?? process.env.https_proxy ?? "http://127.0.0.1:10808";

try {
  const parsed = new URL(proxyUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Unsupported proxy protocol: ${parsed.protocol}`);
  }
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
  console.info(JSON.stringify({ ts: new Date().toISOString(), level: "info", component: "network-proxy", event: "proxy_enabled", proxy: `${parsed.protocol}//${parsed.hostname}:${parsed.port || (parsed.protocol === "https:" ? "443" : "80")}`, source: process.env.HF_PROXY_URL ? "HF_PROXY_URL" : (process.env.HTTPS_PROXY || process.env.https_proxy) ? "HTTPS_PROXY" : "default" }));
} catch (error) {
  console.error(JSON.stringify({ ts: new Date().toISOString(), level: "error", component: "network-proxy", event: "proxy_configuration_failed", error: error instanceof Error ? error.message : String(error) }));
  throw error;
}
