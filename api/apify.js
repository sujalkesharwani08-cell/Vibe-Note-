const crypto = require('crypto');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: 'Instagram Reel link paste kar bhai!' });

    const apifyToken = process.env.APIFY_TOKEN || 'apify_api_MJWMKzWTVf4aueAJ0vg1YqVK2oj41e08mC8c';
    const cleanUrl = url.split('?')[0];

    const apifyRes = await fetch(
      `https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=${apifyToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          directUrls: [cleanUrl],
          resultsType: 'posts',
          resultsLimit: 1
        })
      }
    );

    const items = await apifyRes.json();
    const post = Array.isArray(items) ? items[0] : null;
    const mediaUrl = post?.videoUrl || post?.audioUrl;

    if (!mediaUrl) {
      return res.status(400).json({ error: 'Reel nahi mil paayi. Check kar ki Reel Public hai!' });
    }

    const audioRes = await fetch(mediaUrl);
    const arrayBuffer = await audioRes.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer).slice(0, 1024 * 1024);

    const host = process.env.ACR_HOST;
    const accessKey = process.env.ACR_ACCESS_KEY;
    const accessSecret = process.env.ACR_SECRET_KEY;
    const timestamp = Math.floor(Date.now() / 1000);

    const stringToSign = ['POST', '/v1/identify', accessKey, 'audio', '1', timestamp].join('\n');
    const signature = crypto
      .createHmac('sha1', accessSecret)
      .update(Buffer.from(stringToSign, 'utf-8'))
      .digest('base64');

    const formData = new FormData();
    formData.append('sample', new Blob([audioBuffer]), 'sample.mp4');
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

      const searchRes = await fetch(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(title + ' ' + artist)}&type=track&limit=1`,
        { headers: { 'Authorization': `Bearer ${access_token}` } }
      );
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
      
