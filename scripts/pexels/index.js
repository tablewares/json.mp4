#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { finished } from 'stream/promises';
import { Command } from 'commander';
import { select, input, confirm } from '@inquirer/prompts';
import cliProgress from 'cli-progress';
import dotenv from 'dotenv';

dotenv.config();

const API_KEY = process.env.PEXELS_API_KEY;

if (!API_KEY) {
  console.error('Error: PEXELS_API_KEY is missing. Please set it in your .env file.');
  process.exit(1);
}

// Headers required by Pexels API
const headers = {
  Authorization: API_KEY,
};

/**
 * Fetch Images from Pexels API
 */
async function searchPhotos(query, perPage = 5) {
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${perPage}`;
  const response = await fetch(url, { headers });
  
  if (!response.ok) {
    throw new Error(`Pexels Photo API returned status: ${response.status}`);
  }

  const data = await response.json();
  return data.photos.map((photo) => ({
    name: `[Photo] ${photo.alt || 'Untitled'} (By: ${photo.photographer})`,
    value: {
      id: photo.id,
      type: 'photo',
      url: photo.src.original, // Options: original, large, medium, tiny
      extension: 'jpg',
      title: photo.alt ? photo.alt.replace(/[^a-zA-Z0-0]/g, '_').slice(0, 20) : 'photo',
    },
  }));
}

/**
 * Fetch Videos from Pexels API
 */
async function searchVideos(query, perPage = 5) {
  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=${perPage}`;
  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(`Pexels Video API returned status: ${response.status}`);
  }

  const data = await response.json();
  return data.videos.map((video) => {
    // Select the highest quality video file available
    const bestFile = video.video_files.sort((a, b) => b.width - a.width)[0];

    return {
      name: `[Video] ID: ${video.id} (${video.duration}s - ${bestFile.width}x${bestFile.height})`,
      value: {
        id: video.id,
        type: 'video',
        url: bestFile.link,
        extension: 'mp4',
        title: `video_${video.id}`,
      },
    };
  });
}

/**
 * Helper to download a file with a terminal progress bar
 */
async function downloadFile(fileUrl, outputPath) {
  const response = await fetch(fileUrl);
  if (!response.ok) throw new Error(`Failed to download resource: ${response.statusText}`);

  const totalBytes = Number(response.headers.get('content-length')) || 0;
  
  const progressBar = new cliProgress.SingleBar({
    format: 'Downloading [{bar}] {percentage}% | {value}/{total} Bytes',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true,
  });

  if (totalBytes > 0) progressBar.start(totalBytes, 0);

  const fileStream = fs.createWriteStream(outputPath);
  let downloadedBytes = 0;

  // Convert Fetch body stream to Node Stream & write to disk
  const reader = response.body.getReader();
  const nodeStream = new Readable({
    async read() {
      const { done, value } = await reader.read();
      if (done) {
        this.push(null);
      } else {
        downloadedBytes += value.length;
        if (totalBytes > 0) progressBar.update(downloadedBytes);
        this.push(Buffer.from(value));
      }
    },
  });

  await finished(nodeStream.pipe(fileStream));
  if (totalBytes > 0) progressBar.stop();
  console.log(`\nSuccessfully saved to: ${outputPath}`);
}

/**
 * Interactive Main CLI Workflow
 */
async function runInteractiveCLI() {
  console.log('\n Pexels Stock Media Downloader CLI\n');

  // 1. Select media type
  const mediaType = await select({
    message: 'What resource type are you looking for?',
    choices: [
      { name: 'Photos', value: 'photo' },
      { name: 'Videos', value: 'video' },
    ],
  });

  // 2. Input search keyword
  const searchQuery = await input({
    message: 'Enter search keywords:',
    validate: (val) => (val.trim() ? true : 'Search term cannot be empty.'),
  });

  // 3. Perform search
  console.log(`\nFetching ${mediaType}s for "${searchQuery}"...`);
  let choices = [];

  try {
    if (mediaType === 'photo') {
      choices = await searchPhotos(searchQuery);
    } else {
      choices = await searchVideos(searchQuery);
    }
  } catch (err) {
    console.error(`API Error: ${err.message}`);
    return;
  }

  if (choices.length === 0) {
    console.log('No media resources found for that query.');
    return;
  }

  // 4. Select item from results
  const selectedResource = await select({
    message: 'Select a resource to download:',
    choices: choices,
  });

  // 5. Confirm and execute download
  const confirmDownload = await confirm({
    message: `Download this ${selectedResource.type}?`,
    default: true,
  });

  if (confirmDownload) {
    const filename = `${selectedResource.title}_${selectedResource.id}.${selectedResource.extension}`;
    const downloadsDir = path.join(process.cwd(), 'downloads');

    if (!fs.existsSync(downloadsDir)) {
      fs.mkdirSync(downloadsDir, { recursive: true });
    }

    const targetPath = path.join(downloadsDir, filename);
    await downloadFile(selectedResource.url, targetPath);
  } else {
    console.log('Download canceled.');
  }
}

// Program command setup
const program = new Command();
program
  .name('pexels')
  .description('Interactive CLI to search and download Pexels photos and videos')
  .version('1.0.0')
  .action(runInteractiveCLI);

program.parse(process.argv);