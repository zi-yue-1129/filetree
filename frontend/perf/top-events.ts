/**
 * Debug helper: list the trace events with the largest self time on the
 * page's renderer main thread (and busiest threads overall).
 *
 *   node perf/top-events.ts /tmp/traces/trace-002.json [count]
 */
import { readFileSync } from 'node:fs';

interface TraceEvent {
  name: string;
  ph: string;
  ts: number;
  dur?: number;
  pid: number;
  tid: number;
  args?: { name?: string };
}

const [file, countArg] = process.argv.slice(2);
if (!file) throw new Error('usage: top-events.ts <trace.json> [count]');
const count = Number(countArg ?? '15');
const parsed = JSON.parse(readFileSync(file, 'utf-8')) as { traceEvents: TraceEvent[] };
const names = new Map<string, string>();
for (const event of parsed.traceEvents) {
  if (event.ph === 'M' && event.name === 'thread_name' && event.args?.name) names.set(`${event.pid}:${event.tid}`, event.args.name);
}
const perThread = new Map<string, TraceEvent[]>();
for (const event of parsed.traceEvents) {
  if (event.ph !== 'X' || event.dur === undefined) continue;
  const key = `${event.pid}:${event.tid}`;
  const list = perThread.get(key) ?? [];
  list.push(event);
  perThread.set(key, list);
}
for (const [key, events] of perThread) {
  const threadName = names.get(key) ?? key;
  const sorted = [...events].sort((a, b) => a.ts - b.ts || (b.dur ?? 0) - (a.dur ?? 0));
  const selfByName = new Map<string, number>();
  const stack: Array<{ end: number; name: string; self: number }> = [];
  const flush = (frame: { name: string; self: number }): void => {
    selfByName.set(frame.name, (selfByName.get(frame.name) ?? 0) + frame.self);
  };
  for (const event of sorted) {
    while (stack.length > 0 && stack[stack.length - 1].end <= event.ts) flush(stack.pop() as { name: string; self: number });
    const parent = stack[stack.length - 1];
    if (parent) parent.self -= event.dur ?? 0;
    stack.push({ end: event.ts + (event.dur ?? 0), name: event.name, self: event.dur ?? 0 });
  }
  while (stack.length > 0) flush(stack.pop() as { name: string; self: number });
  const total = [...selfByName.values()].reduce((sum, value) => sum + value, 0);
  if (total < 50_000) continue;
  process.stdout.write(`\n== ${threadName} (${key}) self total ${(total / 1000).toFixed(0)} ms\n`);
  for (const [name, self] of [...selfByName].sort((a, b) => b[1] - a[1]).slice(0, count)) {
    process.stdout.write(`${(self / 1000).toFixed(1).padStart(9)} ms  ${name}\n`);
  }
}
