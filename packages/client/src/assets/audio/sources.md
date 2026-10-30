# Audio sources

The game ships two recordings: `sutra.mp3`, the chant recording, and `mokt.mp3`, the 목탁 strike (see the end of this file). `sutra.mp3` is a Korean Buddhist chant (염불) with 목탁 strikes, looped under the 법당 roof and heard faintly from the court in front of it.

- Work: 「염불소리1」, 공유마당 (한국저작권위원회).
- Page: https://gongu.copyright.or.kr/gongu/wrt/wrt/view.do?wrtSn=13254274&menuNo=200020
- Author: 김용배.
- Language: `ko`.
- Licence: **CC BY**, attribution required. The page's wording is 김용배 의 "염불소리1" 은 CC BY 라이선스로 제공됩니다. It does not say which version of CC BY, so none is claimed here. The credit is shown in the game's settings sheet (설정의 「소리와 모델 출처」).
- Not heard by a person: the asset scout could not listen to it, so that it is a Korean chant with 목탁 strikes comes from the catalogue's tags and description only. Someone should listen before the game is shown to the public.
- Original: the 공유마당 WAV (48 kHz, stereo, 119.4 s, 22.9 MB, sha256 `affd68ec279cd7302c04ecde02f9c153bd1efe7d5498b706f208151833a98efa`). It is not in this repository.
- Cut: the asset scout trimmed it to 116.0 s and encoded Ogg Vorbis 96 kbps (sha256 `ffa472510a03871966bf23071b9667bb50d96c63976e1db537f3616f9ec843e0`). That file is not in this repository either.
- Shipped file: that cut as mono MP3, CBR 128 kbps, 44.1 kHz, 1,856,991 bytes, sha256 `45bd58c1fe5a75cc683c7c9d60222df4af756e81a405696d07c2d2d5476b0033`. Every browser the game targets decodes MP3, and a constant bit rate makes every browser agree on its length, which the visitors' shared place in the loop depends on.
- Length: 116.000 s once decoded (5,115,600 samples at 44.1 kHz), which is `SUTRA_SECONDS` in `src/audio/music.ts`. `test/audio-contract.test.ts` holds the file to it.
- Level: −17.96 LUFS integrated, −1.87 dBTP true peak, measured on the decoded MP3 with ffmpeg's `loudnorm` filter in measuring mode. The recording is 21 dB from its peaks to its loudness, so `loudnorm` itself could not reach −18 LUFS under −1 dBTP (it stopped near −25 LUFS); a fixed gain and a look-ahead limiter did.
- Edges: a 0.5 s fade in and a 0.5 s fade out, so the loop has no click at its seam.

Encode command (ffmpeg 8.0.1, libmp3lame):

```
ffmpeg -i gongu_염불소리1_CC-BY_kimyongbae_trim116s_96k.ogg -vn -map_metadata -1 -ac 1 -ar 44100 -af "volume=19.5dB,alimiter=limit=0.708:attack=8:release=120:level=disabled,afade=t=in:st=0:d=0.5,afade=t=out:st=115.5:d=0.5,atrim=end=116" -c:a libmp3lame -b:a 128k -id3v2_version 0 sutra.mp3
```

The file is fetched when a visitor first taps the page, not before, and the service worker does not precache it.

The concert video on the open-air stage is not a file in this repository: it is the YouTube embed `ykT0Ezc9k-E`, played from YouTube's own player. Whoever runs the game needs the rights (or the uploader's embedding permission) for that recording.

## `mokt.mp3`: the 목탁 strike

`public/audio/mokt.mp3` is the single recorded 목탁 (wooden fish) strike that the audio engine plays as the knock sound (`MOKT_SAMPLE_URL` in `src/audio/engine.ts`). A synthesized knock stands in until it has loaded, or if it cannot.

- Work: 「Mokugyo.wav」, Freesound sound 607215.
- Author: jonopodmore.
- Licence: **CC0**, no attribution required.
- Made from: the Freesound HQ preview of that sound, trimmed to one strike with a short fade, encoded as mono MP3 at 128 kbps.
- Shipped file: 10,075 bytes, sha256 `3357cda78cb0b4850a0a3752f58b6ef3b2009ff0d971574574a0b04a54930300`.
- Not in this repository: the Freesound original and the HQ preview.
