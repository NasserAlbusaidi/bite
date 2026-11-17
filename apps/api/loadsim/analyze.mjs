// node analyze.mjs out/day.json  -> prints summary, writes out/<name>.summary.json
import { readFileSync, writeFileSync } from "node:fs";

const f = process.argv[2];
const d = JSON.parse(readFileSync(f, "utf8"));
const q = (v, p) =>
	v.length ? v[Math.min(v.length - 1, Math.floor(v.length * p))] : null;
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const by = {};
for (const [, , label, ms, status] of d.recs) {
	if (label === "probe") continue;
	by[label] ??= { ms: [], n: 0, err5xx: 0, net: 0, s4xx: {} };
	const b = by[label];
	b.ms.push(ms);
	b.n++;
	if (status === 0) b.net++;
	else if (status >= 500) b.err5xx++;
	else if (status >= 400) b.s4xx[status] = (b.s4xx[status] ?? 0) + 1;
}
const endpoints = Object.entries(by)
	.map(([k, b]) => {
		b.ms.sort((a, c) => a - c);
		return {
			label: k,
			n: b.n,
			p50: r1(q(b.ms, 0.5)),
			p95: r1(q(b.ms, 0.95)),
			p99: r1(q(b.ms, 0.99)),
			max: r1(b.ms.at(-1)),
			err: b.err5xx + b.net,
			s4xx: b.s4xx,
		};
	})
	.sort((a, b) => b.n - a.n);
const all = d.recs
	.filter((r) => r[2] !== "probe")
	.map((r) => r[3])
	.sort((a, b) => a - b);
const errs = d.recs.filter(
	(r) => r[2] !== "probe" && (r[4] === 0 || r[4] >= 500),
).length;
// Timeline in 15-min sim buckets (day) or 10 s real buckets (stress)
const stress = d.meta.mode === "stress";
const bucketOf = (r) =>
	stress
		? Math.floor((r[0] - d.recs[0][0]) / 10000)
		: Math.floor((r[1] - d.meta.from) / 900000);
const tl = {};
for (const r of d.recs) {
	const k = bucketOf(r);
	tl[k] ??= { n: 0, ms: [], writes: 0, err: 0 };
	const b = tl[k];
	b.n++;
	b.ms.push(r[3]);
	if (
		r[2].startsWith("sync.push") ||
		r[2] === "guest.order" ||
		r[2].startsWith("cart.")
	)
		b.writes++;
	if (r[4] === 0 || r[4] >= 500) b.err++;
}
const realSecPerBucket = stress ? 10 : 900 / d.meta.speed;
const timeline = Object.entries(tl)
	.map(([k, b]) => {
		b.ms.sort((a, c) => a - c);
		return {
			k: Number(k),
			simTime: stress
				? null
				: new Date(d.meta.from + Number(k) * 900000 + 4 * 3600000)
						.toISOString()
						.slice(11, 16),
			rps: r1(b.n / realSecPerBucket),
			wps: r1(b.writes / realSecPerBucket),
			p50: r1(q(b.ms, 0.5)),
			p95: r1(q(b.ms, 0.95)),
			p99: r1(q(b.ms, 0.99)),
			err: b.err,
		};
	})
	.sort((a, b) => a.k - b.k);
const db = d.dbSamples.filter((s) => s.tps != null);
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const dbs = {
	tpsAvg: r1(avg(db.map((s) => s.tps))),
	tpsMax: r1(Math.max(...db.map((s) => s.tps))),
	pgCpuAvg: r1(avg(db.map((s) => s.pgCpu))),
	pgCpuMax: r1(Math.max(...db.map((s) => s.pgCpu))),
	apiCpuAvg: r1(avg(db.map((s) => s.apiCpu))),
	apiCpuMax: r1(Math.max(...db.map((s) => s.apiCpu))),
	activeMax: Math.max(...db.map((s) => s.conns.active ?? 0)),
	idleInTxMax: Math.max(...db.map((s) => s.conns["idle in transaction"] ?? 0)),
	lockWaitsMax: Math.max(...db.map((s) => s.lockWaits)),
	deadlocks: db.reduce((a, s) => a + (s.deadlocks ?? 0), 0),
	cacheHitMin: Math.min(...db.map((s) => s.cacheHit ?? 1)),
	blkReadTotal: db.reduce((a, s) => a + (s.blkRead ?? 0), 0),
	rollbacks: db.reduce((a, s) => a + (s.rollbacks ?? 0), 0),
};
const rt = [...d.rtLatency].sort((a, b) => a - b);
const lag = [...(d.lag ?? [])].sort((a, b) => a - b);
const durS = (d.recs.at(-1)[0] - d.recs[0][0]) / 1000;
const summary = {
	meta: d.meta,
	durationRealS: r1(durS),
	totalReqs: all.length,
	rpsAvg: r1(all.length / durS),
	overall: {
		p50: r1(q(all, 0.5)),
		p95: r1(q(all, 0.95)),
		p99: r1(q(all, 0.99)),
		errors: errs,
		errorRate: errs / all.length,
	},
	endpoints,
	timeline,
	db: dbs,
	dbTimeline: db.map((s) => ({
		sim: s.sim,
		real: s.real,
		tps: r1(s.tps),
		pgCpu: r1(s.pgCpu),
		apiCpu: r1(s.apiCpu),
		active: s.conns.active ?? 0,
		idleTx: s.conns["idle in transaction"] ?? 0,
		lockWaits: s.lockWaits,
	})),
	realtime: {
		n: rt.length,
		p50: q(rt, 0.5),
		p95: q(rt, 0.95),
		p99: q(rt, 0.99),
	},
	simLag: { p50: r1(q(lag, 0.5)), p95: r1(q(lag, 0.95)), max: r1(lag.at(-1)) },
	stats: d.stats,
	notes: d.notes,
	leaks: d.leaks,
	problemCount: d.problemCount,
	problems: d.problems.slice(0, 60),
	probeStats: d.probeStats,
	recon: d.recon,
	top: d.top,
	dbsize: d.dbsize,
	counts: d.counts,
};
writeFileSync(
	f.replace(".json", ".summary.json"),
	JSON.stringify(summary, null, 1),
);
console.log(
	JSON.stringify(
		{
			dur: summary.durationRealS,
			reqs: summary.totalReqs,
			rps: summary.rpsAvg,
			overall: summary.overall,
			db: dbs,
			rt: summary.realtime,
			lag: summary.simLag,
			leaks: d.leaks.length,
			problems: d.problemCount,
		},
		null,
		0,
	),
);
for (const e of endpoints)
	console.log(
		e.label.padEnd(22),
		String(e.n).padStart(6),
		"p50",
		e.p50,
		"p95",
		e.p95,
		"p99",
		e.p99,
		"max",
		e.max,
		"err",
		e.err,
		JSON.stringify(e.s4xx),
	);
