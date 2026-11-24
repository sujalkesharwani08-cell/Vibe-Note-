const crypto = require('crypto');

async function extractMediaUrl(reelUrl) {
  const cleanUrl = reelUrl.split('?')[0];

  try {
    const embedUrl = cleanUrl.endsWith('/') ? `${cleanUrl}embed/captioned/` : `${cleanUrl}/embed/captioned/`;
    const res = await fetch(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml'
      }
    });
    const html = await res.text();
    const videoMatch = html.match(/"video_url":"([^"]+)"/) || html.match(/src="(https:\/\/[^"]+\.mp4[^"]*)"/);
    if (videoMatch && videoMatch[1]) {
      return videoMatch[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
    }
  } catch (e) {}

  const instances = [
    'https://cobalt-api.kwiatekmiki.com/',
    'https://api.cobalt.best/'
  ];
  for (const api of instances) {
    try {
      const res = await fetch(api, {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: cleanUrl, downloadMode: 'audio' })
      });
      const data = await res.json();
      if (data.url) return data.url;
    } catch (e) {}
  }

  return null;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: 'Reel link paste kar bhai!' });

    const mediaUrl = await extractMediaUrl(url);
    if (!mediaUrl) {
      return res.status(400).json({ error: 'Instagram block kar raha hai. Koi aur public Reel link try kar.' });
    }

    const audioRes = await fetch(mediaUrl);
    const arrayBuffer = await audioRes.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer).slice(0, 1024 * 1024);

    const host = process.env.ACR_HOST;
    const accessKey = process.env.ACR_ACCESS_KEY;
    const accessSecret = process.env.ACR_SECRET_KEY;
    const timestamp = Math.floor(Date.now() / 1000);

    const stringToSign = ['POST', '/v1/identify', accessKey, 'audio', '1', timestamp].join('\n');
    const signature = crypto.createHmac('sha1', accessSecret).update(Buffer.from(stringToSign, 'utf-8')).digest('base64');

    const formData = new FormData();
    formData.append('sample', new Blob([audioBuffer]), 'sample.mp3');
    formData.append('access_key', accessKey);
    formData.append('data_type', 'audio');
    formData.append('signature_version', '1');
    formData.append('signature', signature);
    formData.append('sample_bytes', audioBuffer.length);
    formData.append('timestamp', timestamp);

    const acrRes = await fetch(`https://${host}/v1/identify`, { method: 'POST', body: formData });
    const acrData = await acrRes.json();

    if (!acrData.metadata?.music?.length) {
      return res.status(404).json({ error: 'Is Reel mein koi official gaana nahi mila.' });
    }

    const track = acrData.metadata.music[0];
    const title = track.title;
    const artist = track.artists?.map(a => a.name).join(', ') || 'Unknown Artist';
    let spotifyUrl = track.external_metadata?.spotify?.track?.id
      ? `https://open.spotify.com/track/${track.external_metadata.spotify.track.id}`
      : null;
    let cover = '';

    if (process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET) {
      const auth = Buffer.from(`${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`).toString('base64');
      const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=client_credentials'
      });
      const { access_token } = await tokenRes.json();

      const searchRes = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(title + ' ' + artist)}&type=track&limit=1`, {
        headers: { 'Authorization': `Bearer ${access_token}` }
      });
      const searchData = await searchRes.json();
      const spTrack = searchData.tracks?.items?.[0];
      if (spTrack) {
        spotifyUrl = spotifyUrl || spTrack.external_urls?.spotify;
        cover = spTrack.album?.images?.[0]?.url || '';
      }
    }

    return res.status(200).json({ title, artist, spotifyUrl, cover });
  } catch (err) {
    return res.status(500).json({ error: 'Server error: ' + err.message });
  }
};
    
