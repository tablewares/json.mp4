
import https from 'node:https';

const API_KEY = process.env.PEXELS_API_KEY || '3YhLShsZATqtPbXQX1J19QQEnf0R04VQ3YhbtborXF3LLeS3eOL3MxNY';
console.log('API key length:', API_KEY.length);

const options = {
  hostname: 'api.pexels.com',
  path: '/v1/search?query=test&per_page=1',
  headers: { Authorization: API_KEY }
};

const req = https.get(options, (res) => {
  let d = '';
  res.on('data', (c) => d += c);
  res.on('end', () => {
    console.log('STATUS:', res.statusCode);
    console.log('BODY:', d.substring(0, 300));
  });
});
req.on('error', (e) => console.log('ERR:', e.message));
