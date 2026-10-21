// Re-take screens/*.png. Needs a server on :3100 (PORT=3100 npm start) and `npm i --no-save puppeteer-core`.
// Uses system Chrome (/usr/bin/google-chrome); override with CHROME_PATH. OUT defaults to ../screens.
import puppeteer from "puppeteer-core";
const OUT = process.env.OUT ?? new URL("../screens", import.meta.url).pathname;
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const b = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? "/usr/bin/google-chrome", headless: "new", args: ["--no-sandbox", "--hide-scrollbars"] });
const p = await b.newPage();
p.on("pageerror", (e) => console.log("pageerror:", e.message));
await p.setViewport({ width: 1440, height: 1000 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Live runs stream for a minute or more (Gemini free tier is paced), so navigation may wait that long for network idle.
p.setDefaultNavigationTimeout(300000);
// ONLY=fill,sources,plain,cohead,mobile retakes just those sections (default: all).
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;
const want = (s) => !ONLY || ONLY.has(s);
const tab = async (label) => { const [el] = await p.$$(`xpath/.//button[normalize-space()='${label}']`); await el.click(); await wait(1500); };

if (want("fill")) {
await p.goto(BASE, { waitUntil: "networkidle0" });
await wait(800);
await p.screenshot({ path: `${OUT}/01-landing.png` });

await (await p.$("form button")).click();
await wait(500);
await p.screenshot({ path: `${OUT}/02-agent-running.png` });
await p.waitForFunction(() => document.body.innerText.includes("Corridor candidates"), { timeout: 180000 });
await wait(1800);
await p.screenshot({ path: `${OUT}/03-fill-the-gaps.png` });
await p.screenshot({ path: `${OUT}/03b-fill-the-gaps-full.png`, fullPage: true });
// The primary comparison: same filtered cities, ranked Without Qloo (population/venues proxy)
await tab("Without Qloo");
await p.screenshot({ path: `${OUT}/03c-without-qloo.png` });
await tab("With Qloo");
const filter = await p.$("xpath/.//h3[normalize-space()='Corridor candidates → realistic fills']/ancestor::div[contains(@class,'bg-panel')][1]");
await filter.screenshot({ path: `${OUT}/04-candidate-filter.png` });

// expand the corridor-scan tool lines to show the exact heatmap requests
const btns = await p.$$(".font-mono button");
if (btns[4]) await btns[4].click(); // also expand the first get_city_intel
await p.evaluate(() => document.querySelectorAll(".max-h-72").forEach((n) => n.classList.remove("max-h-72")));
await wait(300);
const trace = await p.$("xpath/.//h3[starts-with(normalize-space(),'Agent trace')]/ancestor::div[contains(@class,'bg-panel')][1]");
await trace.screenshot({ path: `${OUT}/05-agent-trace-qloo-calls.png` });

// "Why this stop": the first stop card, every fact with its source
const card = await p.$("xpath/.//article[.//div[normalize-space()='Why this stop']][1]");
if (card) { await card.scrollIntoView(); await wait(300); await card.screenshot({ path: `${OUT}/12-why-this-stop.png` }); }

// Touring rules: the adjustable assumptions, open
await p.evaluate(() => { const d = document.querySelector("form details"); if (d) d.open = true; window.scrollTo(0, 0); });
await wait(400);
const rules = await p.$("form details");
if (rules) await rules.screenshot({ path: `${OUT}/13-touring-rules.png` });

}

if (want("sources")) {
// Sources & methodology panel
await p.goto(BASE + "/?sources=1", { waitUntil: "networkidle0" });
await wait(800);
const src = await p.$("#sources");
if (src) await src.screenshot({ path: `${OUT}/14-sources-methodology.png` });

}

if (want("plain")) {
await p.goto(BASE + "/?auto=1&view=plain", { waitUntil: "networkidle0" });
await p.waitForFunction(() => document.body.innerText.includes("passes drive rules") || document.body.innerText.includes("radius clause"), { timeout: 180000 });
await wait(1800);
// The plain-LLM baseline is a secondary panel below the results: scroll it into view.
await p.evaluate(() => [...document.querySelectorAll("b")].find((n) => n.textContent?.startsWith("Secondary baseline"))?.scrollIntoView());
await wait(500);
await p.screenshot({ path: `${OUT}/06-plain-ai-audit.png` });
await tab("Compare");
await p.evaluate(() => [...document.querySelectorAll("b")].find((n) => n.textContent?.startsWith("Secondary baseline"))?.scrollIntoView());
await wait(500);
await p.screenshot({ path: `${OUT}/07-compare.png` });

}

if (want("cohead")) {
await p.goto(BASE + "/?tab=cohead&auto=1", { waitUntil: "networkidle0" });
await p.waitForFunction(() => document.body.innerText.includes("Peers in"), { timeout: 180000 });
await wait(1800);
await p.screenshot({ path: `${OUT}/08-cohead-complementarity-map.png` });
await p.screenshot({ path: `${OUT}/08b-cohead-full.png`, fullPage: true });
// The most taste-similar peer is named in the "Most similar ≠ best partner." note; click its row.
const simName = await p.evaluate(() => document.body.innerText.match(/Most similar ≠ best partner\.\s*(.+?) is the most taste-similar/)?.[1] ?? null);
const [sim] = simName ? await p.$$(`xpath/.//button[contains(., ${JSON.stringify(simName)})]`) : [];
if (!sim) console.log(`09: most-similar peer button not found (${simName}); screenshot not retaken`);
if (sim) { await sim.click(); await wait(1500); await p.screenshot({ path: `${OUT}/09-cohead-most-similar-overlaps.png` }); }
await tab("Without Qloo");
await p.screenshot({ path: `${OUT}/08c-cohead-without-qloo.png` });

}

if (want("mobile")) {
await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await p.goto(BASE + "/?auto=1", { waitUntil: "networkidle0" });
await p.waitForFunction(() => document.body.innerText.includes("Corridor candidates"), { timeout: 180000 });
await wait(1500);
await p.screenshot({ path: `${OUT}/10-mobile-fill.png` });
}

await b.close();
console.log("done");
