const fs = require("node:fs");
const path = require("node:path");

function toPositiveInt(value, fallback) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function formatNumber(value, { digits = 2 } = {}) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "n/a";
  return n.toFixed(digits);
}

function formatBytes(bytes) {
  const n = typeof bytes === "number" ? bytes : Number(bytes);
  if (!Number.isFinite(n)) return "n/a";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "+";
  const KB = 1024;
  const MB = 1024 * 1024;
  if (abs >= MB) return `${sign}${formatNumber(abs / MB, { digits: 2 })} MB`;
  if (abs >= KB) return `${sign}${formatNumber(abs / KB, { digits: 2 })} KB`;
  return `${sign}${Math.round(abs)} B`;
}

function percentile(sorted, p) {
  if (!Array.isArray(sorted) || sorted.length === 0) return NaN;
  const q = Math.min(1, Math.max(0, p));
  const idx = Math.ceil(q * sorted.length) - 1;
  const clamped = Math.min(sorted.length - 1, Math.max(0, idx));
  return sorted[clamped];
}

class BenchmarkRunner {
  constructor({ nowNs } = {}) {
    this._nowNs = typeof nowNs === "function" ? nowNs : () => process.hrtime.bigint();
    this.results = [];
  }

  async run(name, fn, { iterations = 200, warmup = 20 } = {}) {
    if (typeof name !== "string" || !name.trim()) throw new TypeError("BenchmarkRunner.run(name, fn): name must be a non-empty string");
    if (typeof fn !== "function") throw new TypeError("BenchmarkRunner.run(name, fn): fn must be a function");

    const iters = toPositiveInt(iterations, 200);
    const warm = Math.max(0, toPositiveInt(warmup, 0));

    const tryGc = () => {
      if (typeof globalThis.gc === "function") globalThis.gc();
    };

    tryGc();
    const memBefore = process.memoryUsage();

    for (let i = 0; i < warm; i++) {
      // eslint-disable-next-line no-await-in-loop
      await fn(i);
    }

    tryGc();
    const memStart = process.memoryUsage();

    const latenciesMs = new Array(iters);
    const startedAtNs = this._nowNs();
    for (let i = 0; i < iters; i++) {
      const t0 = this._nowNs();
      // eslint-disable-next-line no-await-in-loop
      await fn(i);
      const t1 = this._nowNs();
      latenciesMs[i] = Number(t1 - t0) / 1e6;
    }
    const endedAtNs = this._nowNs();

    tryGc();
    const memEnd = process.memoryUsage();

    const wallMs = Number(endedAtNs - startedAtNs) / 1e6;
    const opsPerSec = wallMs > 0 ? (iters / wallMs) * 1000 : NaN;

    const sorted = latenciesMs.slice().sort((a, b) => a - b);
    const stats = {
      p50Ms: percentile(sorted, 0.5),
      p95Ms: percentile(sorted, 0.95),
      p99Ms: percentile(sorted, 0.99),
    };

    const memDelta = {
      heapUsed: memEnd.heapUsed - memStart.heapUsed,
      rss: memEnd.rss - memStart.rss,
    };

    const result = {
      name,
      iterations: iters,
      warmup: warm,
      opsPerSec,
      latencyMs: stats,
      memoryDeltaBytes: memDelta,
      memoryBeforeBytes: memBefore,
      memoryAfterBytes: memEnd,
      wallMs,
      node: process.version,
      ts: new Date().toISOString(),
    };

    this.results.push(result);

    // Required output fields: ops/sec, p50/p95/p99 latency, memory increment.
    // Keep formatting stable for CI parsing.
    const heapDelta = formatBytes(memDelta.heapUsed);
    console.log(
      `[bench] ${name} | ops/sec ${formatNumber(opsPerSec, { digits: 1 })} | ` +
        `p50 ${formatNumber(stats.p50Ms)}ms p95 ${formatNumber(stats.p95Ms)}ms p99 ${formatNumber(stats.p99Ms)}ms | ` +
        `heap ${heapDelta}`
    );

    return result;
  }
}

function loadBenchFiles(benchDir) {
  if (!fs.existsSync(benchDir)) return [];
  const entries = fs.readdirSync(benchDir, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (e.isDirectory()) continue;
    if (!e.name.endsWith(".bench.js")) continue;
    out.push(path.join(benchDir, e.name));
  }
  out.sort();
  return out;
}

function readBaseline(baselinePath) {
  if (!fs.existsSync(baselinePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  } catch {
    return null;
  }
}

function writeBaseline(baselinePath, runner) {
  const payload = {
    schemaVersion: "1.0",
    generatedAt: new Date().toISOString(),
    node: process.version,
    benchmarks: Object.fromEntries(runner.results.map((r) => [r.name, r])),
  };
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
  fs.writeFileSync(baselinePath, JSON.stringify(payload, null, 2));
}

function compareToBaseline(baseline, currentResults, { maxSlowdownPct = 15 } = {}) {
  const base = baseline?.benchmarks && typeof baseline.benchmarks === "object" ? baseline.benchmarks : {};
  const failures = [];

  for (const result of currentResults) {
    const prior = base[result.name];
    if (!prior) continue;
    const prevOps = Number(prior.opsPerSec);
    const curOps = Number(result.opsPerSec);
    if (!Number.isFinite(prevOps) || !Number.isFinite(curOps) || prevOps <= 0) continue;

    const slowdownPct = ((prevOps - curOps) / prevOps) * 100;
    if (slowdownPct > maxSlowdownPct) {
      failures.push({
        name: result.name,
        prevOpsPerSec: prevOps,
        curOpsPerSec: curOps,
        slowdownPct,
      });
    }
  }

  if (failures.length) {
    console.error("[bench] Regression detected:");
    for (const f of failures) {
      console.error(
        `- ${f.name}: ops/sec ${formatNumber(f.prevOpsPerSec, { digits: 1 })} -> ${formatNumber(f.curOpsPerSec, { digits: 1 })} ` +
          `(${formatNumber(f.slowdownPct, { digits: 1 })}% slower)`
      );
    }
  }

  return failures;
}

async function runCli() {
  const args = new Set(process.argv.slice(2));
  const updateBaselineFlag = args.has("--update-baseline");
  const compareFlag = args.has("--compare") || process.env.BENCH_COMPARE === "1";
  const maxSlowdownPct = toPositiveInt(process.env.BENCH_MAX_SLOWDOWN_PCT, 15);

  const benchDir = path.resolve(__dirname, "agents");
  const baselinePath = path.resolve(__dirname, "baseline.json");

  const runner = new BenchmarkRunner();
  const benchFiles = loadBenchFiles(benchDir);
  if (benchFiles.length === 0) {
    console.error(`[bench] No benchmark files found in ${benchDir}`);
    process.exitCode = 1;
    return;
  }

  for (const file of benchFiles) {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const mod = require(file);
    const fn = typeof mod === "function" ? mod : typeof mod?.default === "function" ? mod.default : null;
    if (!fn) {
      console.error(`[bench] Skipping ${path.basename(file)} (expected module.exports = async (runner) => ...)`);
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    await fn(runner);
  }

  if (updateBaselineFlag) {
    writeBaseline(baselinePath, runner);
    console.log(`[bench] Baseline updated: ${baselinePath}`);
  }

  if (compareFlag) {
    const baseline = readBaseline(baselinePath);
    const failures = compareToBaseline(baseline, runner.results, { maxSlowdownPct });
    if (failures.length) process.exitCode = 2;
  }
}

if (require.main === module) {
  runCli().catch((err) => {
    console.error("[bench] Runner failed:", err);
    process.exitCode = 1;
  });
}

module.exports = { BenchmarkRunner };

