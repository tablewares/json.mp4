'use strict';

/**
 * All predictable failures in this tool are thrown as CliError so the
 * top-level handler in cli.js can print a single, stable JSON error
 * contract to stderr and exit(1). Anything else (a genuine bug) falls
 * through as an "InternalError" so it's still visible as JSON, never a
 * raw stack trace on stdout.
 */
class CliError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.extra = extra;
  }

  toJSON() {
    return {
      ok: false,
      error: this.code,
      message: this.message,
      ...this.extra,
    };
  }
}

module.exports = { CliError };
