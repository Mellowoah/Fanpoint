// Error-state screenshot: server started with a fake Qloo key pointed at a closed local port (no external calls).
// Start it with QLOO_API_KEY=fake-local-test QLOO_BASE_URL=http://127.0.0.1:9 QLOO_TRUSTED_BASE_URL=http://127.0.0.1:9 (loopback must be explicitly trusted).
import puppeteer from "puppeteer-core";
const OUT = process.env.OUT ?? new URL("../screens", import.meta.url).pathname;
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", headless: "new", args: ["--no-sandbox", "--hide-scrollbars"] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 1000 });
await p.goto(`${BASE}/?auto=1`, { waitUntil: "networkidle0" });
await p.waitForFunction(() => document.body.innerText.includes("Connection problem"), { timeout: 60000 });
await new Promise((r) => setTimeout(r, 2500));
await p.screenshot({ path: `${OUT}/11-error-state-qloo-unreachable.png` });
await b.close();
console.log("done");
