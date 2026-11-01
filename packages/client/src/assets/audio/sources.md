# Audio sources

The game ships one recording of its own world, `mokt.mp3`, the 목탁 strike (see below), and three short casino sounds (see the end of this file). Two more sounds are not files in this repository: they are YouTube embeds, played from YouTube's own player.

- The concert video on the open-air stage is the YouTube embed `ykT0Ezc9k-E`.
- The sound inside the 법당 is the YouTube embed `10TrBnVkPgc`. It plays only while the visitor is inside the 법당 and is paused the moment they step out (a phone ignores the player's volume, so pausing is the only way to silence it).

Whoever runs the game needs the rights (or the uploader's embedding permission) for both recordings.

## `mokt.mp3`: the 목탁 strike

`public/audio/mokt.mp3` is the single recorded 목탁 (wooden fish) strike that the audio engine plays as the knock sound (`MOKT_SAMPLE_URL` in `src/audio/engine.ts`). A synthesized knock stands in until it has loaded, or if it cannot.

- Work: 「Mokugyo.wav」, Freesound sound 607215.
- Author: jonopodmore.
- Licence: **CC0**, no attribution required.
- Made from: the Freesound HQ preview of that sound, trimmed to one strike with a short fade, encoded as mono MP3 at 128 kbps.
- Shipped file: 10,075 bytes, sha256 `3357cda78cb0b4850a0a3752f58b6ef3b2009ff0d971574574a0b04a54930300`.
- Not in this repository: the Freesound original and the HQ preview.

## The casino's sounds

Three short sounds for the casino's panels (`src/audio/casino.ts`). They are mono MP3, 96 kbps, 44.1 kHz, all under 300 KB, and they are fetched when a visitor first opens a casino panel, not before. The service worker does not precache them. The reel tick and the reel stop are not recordings: the audio engine synthesises them.

### `coin.mp3`: coins landing in the tray

- Work: 「Coin Drop」, Freesound sound 510735.
- Author: HoseNoseSounds.
- Page: https://freesound.org/people/HoseNoseSounds/sounds/510735/
- Licence: **CC0**, no attribution required (the page says Creative Commons 0).
- Made from: the Freesound HQ preview https://cdn.freesound.org/previews/510/510735_11159163-hq.mp3 (2.29 s), cut to 0.25 s – 2.15 s, +3 dB, limited to −1 dBTP, with a 5 ms fade in and a 0.2 s fade out.
- Shipped file: 23,510 bytes, 1.900 s, sha256 `54d9f7f161a071563e5dfbe97f3f5ff28ffaebc4ce880f4c3fb125c7488233e9`. True peak −1.4 dBTP.

### `click.mp3`: a button press

- Work: 「Button Click」, Freesound sound 538727.
- Author: AndrewEathan.
- Page: https://freesound.org/people/AndrewEathan/sounds/538727/
- Licence: **CC0**, no attribution required (the page says Creative Commons 0).
- Made from: the Freesound HQ preview https://cdn.freesound.org/previews/538/538727_10043349-hq.mp3 (0.92 s), cut to its first 0.2 s, −4 dB, limited to −1 dBTP, with a 50 ms fade out.
- Shipped file: 3,134 bytes, 0.200 s, sha256 `0132b2d491a0dc0b4020aef99593ff91f8472f46bcd2a02ead8c3682f91f4329`. True peak −2.4 dBTP.

### `jackpot.mp3`: the jackpot jingle

- Work: 「Jackpot jingle」, Freesound sound 860886.
- Author: Johnmode.
- Page: https://freesound.org/people/Johnmode/sounds/860886/
- Licence: **CC0**, no attribution required (the page says Creative Commons 0).
- Made from: the Freesound HQ preview https://cdn.freesound.org/previews/860/860886_17591071-hq.mp3 (12.13 s). The first 5 s of it is quiet noise, so it is cut to 5.15 s – 10.95 s, −5 dB, limited to −1 dBTP, with a 50 ms fade in and a 0.6 s fade out.
- Shipped file: 70,530 bytes, 5.800 s, sha256 `a8d3783bdf5e74f8ed678e6775e2c2b3dec6589948cb3a6961865376593c15f5`. −17.1 LUFS integrated, −2.7 dBTP true peak.

Not heard by a person: the cuts were chosen from waveform and loudness measurements, not by listening. That the coin file sounds like coins, the click like a click and the jingle like a jingle comes from the Freesound titles and tags. Someone should listen before the game is shown to the public.

Not in this repository: the Freesound originals and the HQ previews. Not shipped, on purpose: the 26 s reel recording and the 56 MB payout recording that were also on the shortlist.

Encode command (ffmpeg 8.0.1, libmp3lame; the same shape for all three, with the cut and gain above):

```
ffmpeg -i <preview>.mp3 -vn -map_metadata -1 -ac 1 -ar 44100 -af "atrim=start=5.15:end=10.95,asetpts=PTS-STARTPTS,volume=-5dB,alimiter=limit=0.891:attack=5:release=50:level=disabled,afade=t=in:st=0:d=0.05,afade=t=out:st=5.2:d=0.6" -c:a libmp3lame -b:a 96k -id3v2_version 0 jackpot.mp3
```
