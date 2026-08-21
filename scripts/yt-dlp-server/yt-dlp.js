const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

// Helper function for formatted log timestamps
const log = (level, message, data = '') => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level}] ${message}`, data ? JSON.stringify(data, null, 2) : '');
};

// Request logging middleware
app.use((req, res, next) => {
  log('INFO', `Incoming ${req.method} request to ${req.url}`, req.body);
  next();
});

app.post('/download', (req, res) => {
  const videoUrl = req.body.url || 'https://www.instagram.com/reel/DcGtO6ZMKkf/?hl=en';
  const outputFileName = `video_${Date.now()}.mp4`;
  const outputPath = path.join(__dirname, outputFileName);

  const args = [
    videoUrl,
    '-o', outputPath,
    '--cookies-from-browser', 'firefox',
    '--js-runtimes', 'deno',
    '--remote-components', 'ejs:github',
    '--verbose' // Enables full yt-dlp internal debug output
  ];

  log('DEBUG', 'Spawning yt-dlp command', { executable: 'yt-dlp', args });

  // Use spawn instead of exec for real-time output debugging
  const ytdlp = spawn('yt-dlp', args);

  let stdoutLogs = '';
  let stderrLogs = '';

  ytdlp.stdout.on('data', (data) => {
    const chunk = data.toString();
    stdoutLogs += chunk;
    log('YTDLP-STDOUT', chunk.trim());
  });

  ytdlp.stderr.on('data', (data) => {
    const chunk = data.toString();
    stderrLogs += chunk;
    log('YTDLP-STDERR', chunk.trim());
  });

  ytdlp.on('error', (err) => {
    log('ERROR', 'Failed to start yt-dlp subprocess', err.message);
    res.status(500).json({
      error: 'Failed to launch yt-dlp executable.',
      details: err.message,
      suggestion: 'Ensure yt-dlp, firefox, and deno are added to system PATH.'
    });
  });

  ytdlp.on('close', (code) => {
    log('INFO', `yt-dlp process exited with code ${code}`);

    if (code !== 0) {
      log('ERROR', 'Download failed', { stderrLogs });
      return res.status(500).json({
        success: false,
        exitCode: code,
        error: 'yt-dlp failed to download media.',
        stderr: stderrLogs
      });
    }

    if (!fs.existsSync(outputPath)) {
      log('ERROR', 'File expected but not found on disk', { outputPath });
      return res.status(500).json({ success: false, error: 'Output file was not created.' });
    }

    log('INFO', 'Sending file to client', { outputPath });

    res.download(outputPath, outputFileName, (err) => {
      if (err) {
        log('ERROR', 'Error sending file to client', err.message);
      } else {
        log('INFO', 'File successfully transmitted to client');
      }

      fs.unlink(outputPath, (unlinkErr) => {
        if (unlinkErr) {
          log('ERROR', 'Failed to remove temporary file', unlinkErr.message);
        } else {
          log('DEBUG', 'Temporary file cleaned up', outputPath);
        }
      });
    });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => log('SYSTEM', `Debug-enabled server running on port ${PORT}`));