"use strict";

// Replaces analyze.sh: takes the benchmark result files for one benchmark
// (three runs per server, in the order defined by lib.SERVERS), renders the
// histogram PNGs with gnuplot, appends the markdown table to results.md and,
// for bench 3, updates README.md between the performance markers.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  aggregate,
  whichBench,
  sortByReqSecs,
  resultsTableFor,
  writeDataFiles,
} = require("./lib");

function gnuplotScript(reqSecData, latencyData, reqSecOut, latencyOut) {
  return [
    `set term pngcairo size 1280,720 enhanced font "Courier,12"`,
    `set output "${reqSecOut}"`,
    `set style data histograms`,
    `set style histogram cluster gap 1`,
    `set style fill solid border -1`,
    `set xtics rotate by -45`,
    `set boxwidth 0.9`,
    `set title "Requests/Sec"`,
    `stats "${reqSecData}" using 2 nooutput`,
    `set yrange [0:STATS_max*1.2]`,
    `set key outside right top`,
    `plot "${reqSecData}" using 2:xtic(1) title "Req/Sec"`,
    ``,
    `set output "${latencyOut}"`,
    `set title "Latency (in ms)"`,
    `stats "${latencyData}" using 2 nooutput`,
    `set yrange [0:STATS_max*1.2]`,
    `plot "${latencyData}" using 2:xtic(1) title "Latency"`,
  ].join("\n");
}

function plotHistograms(reqSecData, latencyData, whichBench) {
  const reqSecOut = `req_sec_histogram${whichBench}.png`;
  const latencyOut = `latency_histogram${whichBench}.png`;
  const result = spawnSync("gnuplot", [], {
    input: gnuplotScript(reqSecData, latencyData, reqSecOut, latencyOut),
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) {
    throw new Error(`gnuplot failed: ${result.error || result.stderr}`);
  }
  return { reqSecOut, latencyOut };
}

function main(argv) {
  if (argv.length === 0) {
    console.error("Usage: node analyze.js <resultFile1> <resultFile2> ... (3 runs per server)");
    process.exitCode = 1;
    return;
  }

  const resultFiles = [...argv];
  const missing = resultFiles.filter((file) => !fs.existsSync(file));
  if (missing.length > 0) {
    throw new Error(`Missing result files: ${missing.join(", ")}`);
  }

  const bench = whichBench(resultFiles[0]);
  const { avgReqSecs, avgLatencies } = aggregate(resultFiles);

  const { reqSecData, latencyData } = writeDataFiles(avgReqSecs, avgLatencies, os.tmpdir());

  if (process.env.ANALYZE_SKIP_PLOT !== "1") {
    const { reqSecOut, latencyOut } = plotHistograms(reqSecData, latencyData, bench);
    fs.mkdirSync("assets", { recursive: true });
    for (const png of [reqSecOut, latencyOut]) {
      fs.renameSync(png, path.join("assets", png));
    }
  }

  const sorted = sortByReqSecs(avgReqSecs);
  console.log(`Sorted servers: ${sorted.join(" ")}`);

  const table = resultsTableFor(bench, avgReqSecs, avgLatencies);
  console.log(`resultsTable: ${table}`);

  fs.appendFileSync("results.md", table + "\n");

  if (bench === 3) {
    const fullResults = fs.readFileSync("results.md", "utf8");
    const stripped = fullResults
      .replace("<!-- PERFORMANCE_RESULTS_START -->", "")
      .replace("<!-- PERFORMANCE_RESULTS_END -->", "");
    console.log(stripped);

    const readmePath = "README.md";
    const readme = fs.readFileSync(readmePath, "utf8");
    const markerBlock = /<!-- PERFORMANCE_RESULTS_START -->[\s\S]*<!-- PERFORMANCE_RESULTS_END -->/;
    if (markerBlock.test(readme)) {
      fs.writeFileSync(readmePath, readme.replace(markerBlock, fullResults.trimEnd()));
    } else {
      fs.appendFileSync(readmePath, "\n" + fullResults + "\n");
    }
  }

  for (const file of resultFiles) {
    fs.unlinkSync(file);
  }
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}

module.exports = { main, plotHistograms, gnuplotScript };
