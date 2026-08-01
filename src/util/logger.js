/**
 * Central logger for the video framework.
 *
 * Single seam for all console output across the three pipelines. Keeps a
 * consistent `[pipeline]` tag, supports ordered levels, and captures every
 * record into an in-memory sink so a caller (e.g. a test or a post-render
 * report) can replay or persist what happened during a run.
 *
 * Use it instead of bare `console.log`/`console.error` so pipeline output is
 * uniform and machine-readable.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

const DEFAULT_LEVEL = LEVELS.info;

let activeLevel = DEFAULT_LEVEL;
const records = [];

/**
 * Create a logger scoped to a pipeline/tag. The tag is prefixed to every
 * line, e.g. `createLogger('render')` → `[render] bundling...`.
 *
 * @param {string} tag
 * @returns {{ debug, info, warn, error, child }}
 */
export function createLogger(tag) {
  const emit = (method, args) => {
    const record = {
      ts: Date.now(),
      level: method,
      tag,
      message: args[0],
      rest: args.slice(1),
    };
    records.push(record);
    if (LEVELS[method] >= activeLevel) {
      const fn = method === "error" ? console.error : method === "warn" ? console.warn : console.log;
      fn(`[${tag}]`, ...args);
    }
  };

  return {
    debug: (...a) => emit("debug", a),
    info: (...a) => emit("info", a),
    warn: (...a) => emit("warn", a),
    error: (...a) => emit("error", a),
    /** Sub-logger with an extended tag (e.g. `render:timeline`). */
    child: (sub) => createLogger(`${tag}:${sub}`),
  };
}

/** Set the minimum level that prints to the console. */
export function setLogLevel(level) {
  if (typeof level === "string") {
    if (!(level in LEVELS)) throw new Error(`Unknown log level "${level}"`);
    activeLevel = LEVELS[level];
  } else {
    activeLevel = level;
  }
}

/** All log records captured this process, newest at the end. */
export function getRecords() {
  return records.slice();
}

/** Clear the captured records (e.g. between programmatic runs). */
export function clearRecords() {
  records.length = 0;
}
