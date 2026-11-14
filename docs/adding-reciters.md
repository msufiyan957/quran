# Adding a reciter

Audio comes from two different quran.com APIs depending on the reciter. Figure out
which one covers the reciter you want, then wire them up in the same two files
every time: `src/api/quran.js` (the picker list) and `src/api/quranWbw.js` (how the
audio is fetched).

## Step 1 — find the reciter's numeric id

Check the old per-ayah API first — it's simpler and is what the four existing
reciters (Afasy, Husary, Abdul Basit, Minshawi) use:

```bash
curl -s "https://api.quran.com/api/v4/resources/recitations?language=en"
```

If your reciter is in that list, note their `id` — that's a **"by_ayah" id**.

If they're *not* in that list, check the newer catalogue instead:

```bash
curl -s "https://api.qurancdn.com/api/qdc/audio/reciters?locale=en"
```

If they're in there, note their `id` — that's a **"qdc" id**. (This is where Yasser
Al-Dosari came from: `id: 97`, not present in the old `/resources/recitations` list.)

If a reciter isn't in either list, quran.com doesn't have them and you'd need a
different audio source entirely (e.g. everyayah.com per-ayah mp3s) — that gets you
playback but *not* word-by-word highlighting, since there's no timing data to go
with it. Prefer one of the two APIs above whenever possible.

## Step 2 — add them to the picker

In `src/api/quran.js`, add a row to `RECITERS`:

```js
export const RECITERS = [
  // ...
  { id: 'ar.somenewreciter', name: 'Reciter’s Display Name' },
]
```

The `id` is just our own internal key (`SettingsContext` stores it, `PlayerContext`
passes it to `getAyahAudio`) — it doesn't need to match quran.com's id, you map
between them in step 3.

## Step 3 — wire up audio in `src/api/quranWbw.js`

### If you got a "by_ayah" id (step 1, first list)

Add it to `RECITATION_IDS`:

```js
export const RECITATION_IDS = {
  'ar.alafasy': 7,
  // ...
  'ar.somenewreciter': <their id>,
}
```

That's it — `getAyahAudio` already knows how to fetch per-ayah clips + word segments
for anything in this map. Each ayah is its own audio file, so playback/looping/word
highlighting all just work with no further changes.

### If you got a "qdc" id (step 1, second list)

Add it to `QDC_RECITER_IDS` instead:

```js
const QDC_RECITER_IDS = {
  'ar.yasseraldossari': 97,
  'ar.somenewreciter': <their id>,
}
```

This path is different under the hood: qdc serves **one audio file per surah**
(with per-ayah offsets and per-word timings embedded in it), not one file per ayah.
`getChapterAudio` fetches and caches that whole file once per surah, and
`getAyahAudio` looks up the requested ayah's `{ startMs, endMs, segments }` inside
it. `PlayerContext` already knows how to handle this shape — it seeks within the
shared file instead of loading a new one when the url hasn't changed, and detects
each ayah's end itself (via `ontimeupdate`) since the browser's native `ended` event
only fires once at the very end of the whole surah file. You don't need to touch
`PlayerContext.jsx` at all for a new qdc reciter — only the id map above.

## Step 4 — verify

1. Settings → Reciter → pick the new one.
2. Open any surah, hit "Listen to this surah".
3. Confirm: audio plays, words highlight as they're spoken, and it advances
   cleanly from one ayah to the next (and from one surah to the next, if
   continuous play is on) without a stutter or restart.
4. Try the per-ayah loop button on a couple of ayahs — for a qdc reciter in
   particular, confirm it loops the *ayah*, not the whole surah file.

If word highlighting doesn't track correctly, double check the segment shape you're
getting back — `by_ayah` segments are 4-tuples `[_, wordPosition, startMs, endMs]`,
while qdc segments are 3-tuples `[wordPosition, startMs, endMs]`. `getChapterAudio`
normalizes qdc's shape to match the 4-tuple convention so the rest of the app (the
`ontimeupdate` handler in `PlayerContext.jsx`, word matching in `AyahCard.jsx`)
doesn't need to know which API the audio came from.
