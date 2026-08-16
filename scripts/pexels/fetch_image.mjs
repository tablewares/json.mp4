#!/usr/bin/env node

import https from 'node:https';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const API_KEY = process.env.PEXELS_API_KEY;
if (!API_KEY) { console.error('No PEXELS_API_KEY'); process.exit(1); }

function searchPhotos(query, perPage = 8) {
  return new Promise((resolve, reject) => {
    const url = `/v1/search?query=${encodeURIComponent(query)}&per_page=${perPage}`;
    const req = https.get({
      hostname: 'api.pexels.com',
      path: url,
      headers: { Authorization: API_KEY },
    }, (res) => {
      let d = '';
      res.on('data', (c) => d += c);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${d}`));
        const data = JSON.parse(d);
        const results = [];
        for (const p of data.photos || []) {
          results.push({
            id: p.id,
            width: p.width,
            height: p.height,
            alt: p.alt || '',
            photographer: p.photographer,
            url: p.src.original,
          });
        }
        resolve(results);
      });
    });
    req.on('error', reject);
  });
}

function downloadFile(url, outputPath) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const ws = fs.createWriteStream(outputPath);
      res.pipe(ws);
      ws.on('finish', () => { ws.close(); resolve(); });
      ws.on('error', reject);
    });
    req.on('error', reject);
  });
}

const queries = process.argv.slice(2);
if (queries.length === 0) {
  console.error('Usage: node fetch_image.mjs "query1" "query2" ...');
  process.exit(1);
}

const outDir = path.join(process.cwd(), 'public', 'assets');
console.log('Output dir:', outDir);

for (const query of queries) {
  try {
    const results = await searchPhotos(query, 8);
    console.log(`\n=== "${query}" — ${results.length} photos ===`);
    for (let i = 0; i < Math.min(5, results.length); i++) {
      const r = results[i];
      console.log(`  [${i}] id=${r.id} ${r.width}x${r.height} alt="${r.alt}" by ${r.photographer}`);
    }
    if (results.length === 0) { console.log('  None found.'); continue; }
    // Download the first 2 results
    for (let i = 0; i < Math.min(2, results.length); i++) {
      const r = results[i];
      // Use medium size for faster download
      const dlUrl = r.url + '?auto=compress&cs=tinysrgb&w=1280';
      const fname = `img_${query.replace(/[^a-zA-Z0-9]/g, '_')}_${r.id}.jpg`;
      const outPath = path.join(outDir, fname);
      if (fs.existsSync(outPath)) {
        console.log(`  [${i}] SKIP (exists): ${fname}`);
      } else {
        console.log(`  [${i}] Downloading: ${fname}`);
        await downloadFile(dlUrl, outPath);
        console.log(`       Saved: ${outPath}`);
      }
    }
  } catch (e) {
    console.error(`  ERROR for "${query}": ${e.message}`);
  }
}
console.log('\nDone.');
