#!/usr/bin/env node

import https from 'node:https';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const API_KEY = process.env.PEXELS_API_KEY;
if (!API_KEY) { console.error('No PEXELS_API_KEY'); process.exit(1); }

function searchVideos(query, perPage = 8) {
  return new Promise((resolve, reject) => {
    const url = `/videos/search?query=${encodeURIComponent(query)}&per_page=${perPage}`;
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
        for (const v of data.videos || []) {
          const landscape = (v.video_files || []).filter(f => (f.width || 0) >= 1280 && (f.height || 0) >= 720 && (f.width || 0) > (f.height || 0));
          landscape.sort((a, b) => Math.abs(a.width - 1920) - Math.abs(b.width - 1920));
          if (landscape.length === 0) continue;
          results.push({
            id: v.id,
            duration: v.duration,
            width: landscape[0].width,
            height: landscape[0].height,
            url: landscape[0].link,
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
  console.error('Usage: node fetch_broll.mjs "query1" "query2" ...');
  process.exit(1);
}

const outDir = path.join(process.cwd(), '..', '..', 'public', 'assets');
console.log('Output dir:', outDir);

for (const query of queries) {
  try {
    const results = await searchVideos(query, 8);
    console.log(`\n=== "${query}" — ${results.length} landscape HD videos ===`);
    // Pick the first result and download it
    if (results.length === 0) { console.log('  None found.'); continue; }
    for (let i = 0; i < Math.min(3, results.length); i++) {
      const r = results[i];
      const fname = `broll_${query.replace(/[^a-zA-Z0-9]/g, '_')}_${r.id}.mp4`;
      const outPath = path.join(outDir, fname);
      if (fs.existsSync(outPath)) {
        console.log(`  [${i}] SKIP (exists): ${fname}`);
      } else {
        console.log(`  [${i}] Downloading: ${fname} (${r.width}x${r.height}, ${r.duration}s)`);
        await downloadFile(r.url, outPath);
        console.log(`       Saved: ${outPath}`);
      }
    }
  } catch (e) {
    console.error(`  ERROR for "${query}": ${e.message}`);
  }
}
console.log('\nDone.');
