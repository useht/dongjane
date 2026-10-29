# Audio sources

`sutra.mp3` is the only recording in the game: the Heart Sutra (반야심경) read aloud, looped under the 법당 roof.

- Work: "Bore Xinjing 般若心经 (Heart Sutra) in Mandarin recited by a Chinese Buddhist layperson", Wikimedia Commons.
- Page: https://commons.wikimedia.org/wiki/File:Bore_Xinjing_%E8%88%AC%E8%8B%A5%E5%BF%83%E7%BB%8F_%28Heart_Sutra%29_in_Mandarin_recited_by_a_Chinese_Buddhist_layperson.ogg
- Author: Nyarlathotep1001.
- Licence: **CC0 1.0**, public domain dedication, no attribution required. The credit is given anyway.
- Original: the 132.8 s Ogg Vorbis file from that page (sha256 `f7276ce71341143188389f208d5f8a20d7f4eddd80a940db2a8eda38c2981392`).
- Loop: the asset scout trimmed the leading and trailing silence so the file repeats without a gap (131.9 s, Ogg Vorbis 96 kbps, sha256 `48b00935b6d5826397f98413ff0d541cafb29ad0fdd4e7d52c405528b069ac72`).
- Shipped file: that loop re-encoded to mono MP3 at 56 kbps (about 0.9 MB, sha256 `68d4ae9b9e23ac5718c2ecf6e8f5d9fc5b7def225ba039018b1dc06cf87037fa`), because every browser the game targets decodes MP3 and the file is fetched only when someone steps into the 법당.

Encode command (ffmpeg 8.0.1, libmp3lame):

```
ffmpeg -i heartsutra_mandarin_CC0_Nyarlathotep1001_1_trim_loop.ogg -vn -map_metadata -1 -ac 1 -ar 44100 -c:a libmp3lame -b:a 56k -write_id3v2 0 sutra.mp3
```

The Japanese reading on Commons is CC BY 3.0 and is deliberately not used.

The concert video on the open-air stage is not a file in this repository: it is the YouTube embed `ykT0Ezc9k-E`, played from YouTube's own player. Whoever runs the game needs the rights (or the uploader's embedding permission) for that recording.
