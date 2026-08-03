import { cli, Strategy } from '@jackwener/opencli/registry';
import { CommandExecutionError, ArgumentError, EmptyResultError } from '@jackwener/opencli/errors';

const DOMAIN = 'yandex.com';

/**
 * Runs in-page. Extracts image results from anchor tags with img_url parameter.
 * Yandex Images now renders results as <a> links with img_url query param.
 */
function buildAnchorExtractorJs(limit) {
  return `(function(){
    var out = [];
    var seen = {};
    var links = document.querySelectorAll('a[href*="img_url="]');
    for (var i = 0; i < links.length && out.length < ${limit}; i++) {
      var href = links[i].href;
      var match = href.match(/img_url=([^&]+)/);
      if (!match) continue;
      try {
        var imgUrl = decodeURIComponent(match[1]);
        if (!imgUrl || seen[imgUrl]) continue;
        seen[imgUrl] = true;
        var img = links[i].querySelector('img');
        var title = links[i].getAttribute('aria-label') || (img ? img.alt : '') || '';
        var sourceUrl = links[i].href;
        out.push([imgUrl, '', 0, 0, sourceUrl, title]);
      } catch (e) {
        console.error('Failed to parse:', href, e);
      }
    }
    return out;
  })()`;
}

// --- inlined helpers -------------------------------------------------------

function requireSearchQuery(value, label = 'query') {
  const query = String(value ?? '').trim();
  if (!query) throw new ArgumentError(`${label} cannot be empty`);
  return query;
}

function requireBoundedInteger(value, defaultValue, min, max, label) {
  const raw = value ?? defaultValue;
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(parsed)) {
    throw new ArgumentError(`${label} must be an integer between ${min} and ${max}, got ${JSON.stringify(value)}`);
  }
  if (parsed < min || parsed > max) {
    throw new ArgumentError(`${label} must be between ${min} and ${max}, got ${parsed}`);
  }
  return parsed;
}

function requireNonNegativeInteger(value, defaultValue, label) {
  const raw = value ?? defaultValue;
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ArgumentError(`${label} must be a non-negative integer, got ${JSON.stringify(value)}`);
  }
  return parsed;
}

function unwrapBrowserResult(value) {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'session' in value && 'data' in value) {
    return value.data;
  }
  return value;
}

function requireRows(value, label) {
  const rows = unwrapBrowserResult(value);
  if (!Array.isArray(rows)) {
    throw new CommandExecutionError(`${label} returned an unexpected payload shape; expected an array of result rows.`);
  }
  return rows;
}

function toHttpsUrl(value, baseUrl) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw, baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.href;
  } catch {
    return '';
  }
}

function emptySearchResults(site, query) {
  return new EmptyResultError(`${site} search`, `No ${site} results matched "${query}".`);
}

async function runBrowserStep(label, fn) {
  try {
    return await fn();
  } catch (error) {
    if (error?.code || error?.name === 'ArgumentError') throw error;
    throw new CommandExecutionError(`${label} failed: ${error?.message ?? error}`);
  }
}
// --- end inlined helpers ---------------------------------------------------

const command = cli({
  site: 'yandeximages',
  name: 'search',
  access: 'read',
  description: 'Search Yandex Images by keyword',
  domain: DOMAIN,
  strategy: Strategy.PUBLIC,
  browser: true,
  args: [
    { name: 'query', positional: true, required: true, help: 'Search keyword' },
    { name: 'limit', type: 'int', default: 20, help: 'Number of results (1-100)' },
    { name: 'page', type: 'int', default: 0, help: 'Result page, 0-indexed (Yandex ?p= param)' },
  ],
  columns: ['rank', 'title', 'image_url', 'thumb_url', 'width', 'height', 'source_url'],
  func: async (page, kwargs) => {
    const limit = requireBoundedInteger(kwargs.limit, 20, 1, 100, '--limit');
    const query = requireSearchQuery(kwargs.query);
    const pageNum = requireNonNegativeInteger(kwargs.page, 0, '--page');

    const url = `https://${DOMAIN}/images/search?text=${encodeURIComponent(query)}&p=${pageNum}`;
    await runBrowserStep('yandeximages search navigation', () => page.goto(url));

    try {
      await page.wait({ selector: 'a[href*="img_url="]', timeout: 8 });
    } catch {
      await page.wait(3).catch(() => {});
    }

    let raw = await runBrowserStep(
      'yandeximages anchor extraction',
      () => page.evaluate(buildAnchorExtractorJs(limit))
    );
    let rows = requireRows(raw, 'yandeximages search');

    if (rows.length === 0) {
      // Could be a genuinely empty result set, a captcha wall, or a markup
      // change — surface a clear signal rather than silently returning [].
      const captchaCheck = await page
        .evaluate(`(function(){ return /captcha|SmartCaptcha/i.test(document.body.innerText.slice(0, 2000)); })()`)
        .catch(() => false);
      if (captchaCheck) {
        throw new CommandExecutionError(
          'Yandex Images returned a captcha/bot-check page instead of results. ' +
          'Open the URL manually in the connected Chrome profile and solve it once, then retry.'
        );
      }
      throw emptySearchResults('Yandex Images', query);
    }

    return rows
      .filter((r) => r[0])
      .map((r, i) => ({
        rank: i + 1 + pageNum * limit,
        title: r[5] || '',
        image_url: toHttpsUrl(r[0], `https://${DOMAIN}`),
        thumb_url: toHttpsUrl(r[1], `https://${DOMAIN}`),
        width: r[2] || 0,
        height: r[3] || 0,
        source_url: toHttpsUrl(r[4], `https://${DOMAIN}`),
      }));
  },
});

export const __test__ = { command };
