"use strict";

// Replaces run_analyze_script.sh: ensures gnuplot is available, then feeds the
// benchmark result files of every benchmark to analyze.js in the expected
// order (three runs per server).

const { execSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");

const SERVICES = [
  "apollo",
  "caliban",
  "netflixdgs",
  "gqlgen",
  "tailcall",
  "async_graphql",
  "hasura",
  "graphql_jit",
];

// Maps service names to their benchmark result file naming convention.
function resultFileService(service) {
  switch (service) {
    case "apollo":
      return "apollo_server";
    case "netflixdgs":
      return "netflix_dgs";
    default:
      return service;
  }
}

function ensureGnuplot() {
  // Plotting (and therefore gnuplot) is skipped in tests via the same flag
  // analyze.js honors.
  if (process.env.ANALYZE_SKIP_PLOT === "1") return;
  const probe = spawnSync("gnuplot", ["--version"], { encoding: "utf8" });
  if (probe.error || probe.status !== 0) {
    console.log("gnuplot not found, installing...");
    execSync("sudo apt-get update && sudo apt-get install -y gnuplot", { stdio: "inherit" });
  }
}

function analyzeCommand(bench) {
  const files = [];
  for (const service of SERVICES) {
    const fileService = resultFileService(service);
    for (let run = 1; run <= 3; run++) {
      files.push(`bench${bench}_result${run}_graphql_${fileService}_run.sh.txt`);
    }
  }
  return ["analyze.js", ...files];
}

function main() {
  ensureGnuplot();

  // Start from a clean results file, mirroring the previous shell behavior.
  fs.rmSync("results.md", { force: true });

  for (const bench of [1, 2, 3]) {
    console.log(`Processing files for bench${bench}:`);
    const cmd = analyzeCommand(bench);
    console.log(`Executing: node ${cmd.join(" ")}`);
    const result = spawnSync(process.execPath, cmd, { stdio: "inherit" });
    if (result.error || result.status !== 0) {
      throw new Error(`Analyzing bench${bench} failed: ${result.error || `exit code ${result.status}`}`);
    }
  }
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
}
