const BASE = 'https://api.quran.com/api/v4'
const AUDIO_CDN = 'https://audio.qurancdn.com/'
const QDC_BASE = 'https://api.qurancdn.com/api/qdc'

// Maps our alquran.cloud reciter identifiers to quran.com's numeric recitation ids
export const RECITATION_IDS = {
  'ar.alafasy': 7,
  'ar.husary': 6,
  'ar.abdulbasitmurattal': 2,
  'ar.minshawi': 9,
}

// Reciters only available through quran.com's newer "qdc" reciter catalogue,
// which serves one audio file per surah (with per-ayah + per-word timings)
// rather than one file per ayah.
const QDC_RECITER_IDS = {
  'ar.yasseraldossari': 97,
}

const chapterWordsCache = new Map()
const ayahAudioCache = new Map()
const chapterAudioCache = new Map()

async function getJSON(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
  return res.json()
}

// Returns a Map<numberInSurah, word[]> for every ayah in the surah, where each
// word is { position, text, meaning, transliteration } — text already excludes
// end-of-ayah markers.
export function getChapterWords(surahNumber) {
  if (chapterWordsCache.has(surahNumber)) return chapterWordsCache.get(surahNumber)
  const promise = getJSON(
    `${BASE}/verses/by_chapter/${surahNumber}?words=true&word_fields=text_uthmani&per_page=300`
  ).then((data) => {
    const map = new Map()
    for (const verse of data.verses) {
      const words = verse.words
        .filter((w) => w.char_type_name === 'word')
        .map((w) => ({
          position: w.position,
          text: w.text_uthmani,
          meaning: w.translation?.text || '',
          transliteration: w.transliteration?.text || '',
        }))
      map.set(verse.verse_number, words)
    }
    return map
  })
  chapterWordsCache.set(surahNumber, promise)
  return promise
}

// Fetches the single whole-surah audio file for a qdc reciter, along with a
// Map<numberInSurah, { startMs, endMs, segments }> giving each ayah's offset
// and word timings within that one file.
function getChapterAudio(qdcReciterId, surahNumber) {
  const key = `${qdcReciterId}:${surahNumber}`
  if (chapterAudioCache.has(key)) return chapterAudioCache.get(key)
  const promise = getJSON(
    `${QDC_BASE}/audio/reciters/${qdcReciterId}/audio_files?chapter=${surahNumber}&segments=true`
  ).then((data) => {
    const file = data.audio_files?.[0]
    if (!file) throw new Error('No audio available for this surah')
    const verseTimings = new Map()
    for (const vt of file.verse_timings || []) {
      const numberInSurah = Number(vt.verse_key.split(':')[1])
      verseTimings.set(numberInSurah, {
        startMs: vt.timestamp_from,
        endMs: vt.timestamp_to,
        // Normalize qdc's [wordPosition, start, end] triples to the same
        // [_, wordPosition, start, end] shape the by_ayah segments use.
        segments: (vt.segments || []).map(([position, start, end]) => [0, position, start, end]),
      })
    }
    return { url: file.audio_url, verseTimings }
  })
  chapterAudioCache.set(key, promise)
  return promise
}

// Returns { url, segments, startMs, endMs } for one ayah's audio, where
// segments is an array of [_, wordPosition, startMs, endMs] marking when each
// word is spoken, and startMs/endMs (when present) mark where that ayah
// begins/ends within a shared whole-surah audio file.
export async function getAyahAudio(reciterId, surahNumber, numberInSurah) {
  const qdcReciterId = QDC_RECITER_IDS[reciterId]
  if (qdcReciterId) {
    const { url, verseTimings } = await getChapterAudio(qdcReciterId, surahNumber)
    const timing = verseTimings.get(numberInSurah)
    if (!timing) throw new Error('No audio available for this ayah')
    return { url, segments: timing.segments, startMs: timing.startMs, endMs: timing.endMs }
  }

  const qdcId = RECITATION_IDS[reciterId] || RECITATION_IDS['ar.alafasy']
  const verseKey = `${surahNumber}:${numberInSurah}`
  const key = `${qdcId}:${verseKey}`
  if (ayahAudioCache.has(key)) return ayahAudioCache.get(key)
  const promise = getJSON(`${BASE}/recitations/${qdcId}/by_ayah/${verseKey}?fields=segments`).then(
    (data) => {
      const file = data.audio_files?.[0]
      if (!file) throw new Error('No audio available for this ayah')
      return {
        url: /^(https?:)?\/\//.test(file.url) ? file.url : `${AUDIO_CDN}${file.url}`,
        segments: file.segments || [],
      }
    }
  )
  ayahAudioCache.set(key, promise)
  return promise
}
