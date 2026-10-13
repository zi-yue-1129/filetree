/**
 * Print a markdown table comparing the medians of several harness results.
 *
 *   node perf/compare.ts perf/results/before.json perf/results/after.json
 */
import { loadResult, renderComparison } from './lib/report.ts';

const files = process.argv.slice(2);
if (files.length === 0) throw new Error('usage: compare.ts <result.json>...');
process.stdout.write(`${renderComparison(files.map(loadResult))}\n`);
