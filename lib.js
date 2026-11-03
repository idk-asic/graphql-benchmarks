"use strict";

const fs = require("node:fs");
const path = require("node:path");

// Server order and display names must match the benchmark result file naming
// convention produced by run_benchmarks.sh (see run_analyze.js).
const SERVERS = [
  "apollo",
  "caliban",
  "netflixdgs",
  "gqlgen",
  "tailcall",
  "async_graphql",
  "hasura",
  "graphql_jit",
];

const FORMATTED_SERVER_NAMES = {
  tailcall: "Tailcall",
  gqlgen: "Gqlgen",
  apollo: "Apollo GraphQL",
  netflixdgs: "Netflix DGS",
  caliban: "Caliban",
  async_graphql: "async-graphql",
  hasura: "Hasura",
  graphql_jit: "GraphQL JIT",
};

const BENCH_QUERIES = {
  1: "{ posts { id userId title user { id name email}}}",
  2: "{ posts { title }}",
  3: "{ greet }",
};

// Mirrors `grep "$metric" "$file" | awk '{print $2}' | sed 's/ms//'`:
// every line containing the metric contributes its second field with the
// first "ms" occurrence stripped.
function extractValues(content, metric, file) {
  return content
    .split("\n")
    .filter((line) => line.includes(metric))
    .map((line) => {
      const field = line.trim().split(/\s+/)[1];
      if (field === undefined) {
        throw new Error(`No value found for metric "${metric}" in ${file}: ${line.trim()}`);
      }
      return field.replace("ms", "");
    });
}

function average(values) {
  if (values.length === 0) throw new Error("Cannot average an empty list of values");
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

// Reads one benchmark result file and returns its raw metric strings.
function readMetrics(file, metric) {
  const content = fs.readFileSync(file, "utf8");
  return extractValues(content, metric, file);
}

// Averages Requests/sec and Latency across the three runs of every server.
// resultFiles must be ordered in groups of 3 following SERVERS.
function aggregate(resultFiles) {
  if (resultFiles.length !== SERVERS.length * 3) {
    throw new Error(
      `Expected ${SERVERS.length * 3} result files (${SERVERS.length} servers x 3 runs), got ${resultFiles.length}`,
    );
  }
  const avgReqSecs = {};
  const avgLatencies = {};
  for (const [idx, server] of SERVERS.entries()) {
    const runFiles = resultFiles.slice(idx * 3, idx * 3 + 3);
    const reqSecVals = runFiles.flatMap((file) => readMetrics(file, "Requests/sec").map(Number));
    const latencyVals = runFiles.flatMap((file) => readMetrics(file, "Latency").map(Number));
    for (const [file, vals] of [[runFiles.join(", "), reqSecVals], [runFiles.join(", "), latencyVals]]) {
      if (vals.some((v) => Number.isNaN(v))) {
        throw new Error(`Non-numeric metric value in ${file}`);
      }
    }
    avgReqSecs[server] = average(reqSecVals);
    avgLatencies[server] = average(latencyVals);
  }
  return { avgReqSecs, avgLatencies };
}

// Detects which benchmark the files belong to, mirroring the shell check:
// `[[ $1 == bench2* ]]`.
function whichBench(firstFile) {
  const base = path.basename(String(firstFile));
  if (base.startsWith("bench2")) return 2;
  if (base.startsWith("bench3")) return 3;
  return 1;
}

// Sorts servers by Requests/sec, highest first.
function sortByReqSecs(avgReqSecs) {
  return [...SERVERS].sort((a, b) => avgReqSecs[b] - avgReqSecs[a]);
}

// Formats a number with two decimals and comma thousands separators,
// matching `printf "%.2f"` plus the perl grouping regex used before.
function formatComma(value) {
  return value
    .toFixed(2)
    .replace(/(?<=\d)(?=(\d{3})+(\.\d*)?$)/g, ",");
}

// Builds the markdown rows for one benchmark (header row for bench 1 is
// prepended by buildTable).
function buildTable(bench, avgReqSecs, avgLatencies) {
  const sorted = sortByReqSecs(avgReqSecs);
  const lastServer = sorted[sorted.length - 1];
  const lastReqSecs = avgReqSecs[lastServer];

  let table = `| ${bench} | \`${BENCH_QUERIES[bench]}\` |`;
  for (const server of sorted) {
    const reqSecs = formatComma(avgReqSecs[server]);
    const latency = formatComma(avgLatencies[server]);
    const relative = (avgReqSecs[server] / lastReqSecs).toFixed(2);
    table += `\n|| [${FORMATTED_SERVER_NAMES[server]}] | \`${reqSecs}\` | \`${latency}\` | \`${relative}x\` |`;
  }
  return table;
}

// Full table for one benchmark including the bench 1 header and, for bench 3,
// the trailing marker that closes the results block.
function resultsTableFor(bench, avgReqSecs, avgLatencies) {
  let table;
  if (bench === 1) {
    table =
      "<!-- PERFORMANCE_RESULTS_START -->\n\n" +
      "| Query | Server | Requests/sec | Latency (ms) | Relative |\n" +
      "|-------:|--------:|--------------:|--------------:|---------:|\n" +
      buildTable(bench, avgReqSecs, avgLatencies);
  } else {
    table = buildTable(bench, avgReqSecs, avgLatencies);
  }
  if (bench === 3) {
    table += "\n\n<!-- PERFORMANCE_RESULTS_END -->";
  }
  return table;
}

// Writes the gnuplot data files and returns their paths.
function writeDataFiles(avgReqSecs, avgLatencies, datDir) {
  const reqSecData = path.join(datDir, "reqSec.dat");
  const latencyData = path.join(datDir, "latency.dat");
  const format = (avg) =>
    "Server Value\n" + SERVERS.map((server) => `${server} ${avg[server]}`).join("\n") + "\n";
  fs.writeFileSync(reqSecData, format(avgReqSecs));
  fs.writeFileSync(latencyData, format(avgLatencies));
  return { reqSecData, latencyData };
}

module.exports = {
  SERVERS,
  FORMATTED_SERVER_NAMES,
  BENCH_QUERIES,
  extractValues,
  average,
  aggregate,
  whichBench,
  sortByReqSecs,
  formatComma,
  buildTable,
  resultsTableFor,
  writeDataFiles,
};
