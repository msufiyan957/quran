import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { getSurah } from '../api/quran.js'
import { getAyahAudio } from '../api/quranWbw.js'
import { useSettings } from './SettingsContext.jsx'
import { useBookmarks } from './BookmarksContext.jsx'

const PlayerContext = createContext(null)

// Seeks to `ms` once the audio element's duration is known. Some reciters
// share one audio file across a whole surah, so playing a single ayah means
// seeking into it rather than loading a fresh clip.
function seekTo(audio, ms) {
  const seconds = ms / 1000
  if (!Number.isNaN(audio.duration)) {
    audio.currentTime = seconds
  } else {
    audio.addEventListener('loadedmetadata', () => { audio.currentTime = seconds }, { once: true })
  }
}

export function PlayerProvider({ children }) {
  const { settings } = useSettings()
  const { recordLastRead } = useBookmarks()
  const audioRef = useRef(null)
  const segmentsRef = useRef([])
  // Where the current ayah starts/ends within audio.src — both 0/null for a
  // reciter with one file per ayah, real offsets for a shared whole-surah file.
  const ayahBoundsRef = useRef({ startMs: 0, endMs: null })
  const endTriggeredRef = useRef(false)
  const [surah, setSurah] = useState(null)
  const [index, setIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const [activeWordPosition, setActiveWordPosition] = useState(null)
  const [loopAyah, setLoopAyah] = useState(false)

  useEffect(() => {
    const audio = new Audio()
    audio.preload = 'auto'
    // Keeps audio classified as active media playback by the OS/browser, so
    // it survives screen lock and backgrounding instead of being suspended —
    // mirrors how Spotify/Apple Music show lock-screen transport controls.
    // Also the single source of truth for isPlaying, since lock-screen/
    // Bluetooth controls can start or stop playback outside of our own UI.
    audio.addEventListener('play', () => {
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'
      setIsPlaying(true)
    })
    audio.addEventListener('pause', () => {
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'
      setIsPlaying(false)
    })
    audio.ontimeupdate = () => {
      const t = audio.currentTime * 1000
      const segments = segmentsRef.current
      if (segments.length) {
        const seg = segments.find(([, , start, end]) => t >= start && t < end)
        setActiveWordPosition(seg ? seg[1] : null)
      }
      const { endMs } = ayahBoundsRef.current
      if (endMs != null && !endTriggeredRef.current && t >= endMs) {
        endTriggeredRef.current = true
        audio.onended?.()
      }
    }
    audioRef.current = audio
    return () => audio.pause()
  }, [])

  async function playAt(surahNumber, idx) {
    setError(null)
    setLoopAyah(false)
    setIsLoading(true)
    try {
      let s = surah
      if (!s || s.number !== surahNumber) {
        s = await getSurah(surahNumber, { translation: settings.translation })
        setSurah(s)
      }
      const ayah = s.ayahs[idx]
      if (!ayah) return
      const audioData = await getAyahAudio(settings.reciter, surahNumber, ayah.numberInSurah)
      setIndex(idx)
      setActiveWordPosition(null)
      segmentsRef.current = audioData.segments
      ayahBoundsRef.current = { startMs: audioData.startMs ?? 0, endMs: audioData.endMs ?? null }
      endTriggeredRef.current = false
      const audio = audioRef.current
      if (audio.src !== audioData.url) audio.src = audioData.url
      seekTo(audio, audioData.startMs ?? 0)
      await audio.play()
      setIsPlaying(true)
      recordLastRead({
        surahNumber: s.number,
        surahName: s.englishName,
        numberInSurah: ayah.numberInSurah,
        totalAyahs: s.numberOfAyahs,
      })
    } catch (e) {
      setError('Could not play audio. Check your connection and try again.')
      setIsPlaying(false)
    } finally {
      setIsLoading(false)
    }
  }

  function togglePlayPause() {
    const audio = audioRef.current
    if (!audio || !surah) return
    if (isPlaying) {
      audio.pause()
      setIsPlaying(false)
    } else {
      audio.play()
      setIsPlaying(true)
    }
  }

  function goToNext() {
    if (!surah) return
    if (index + 1 < surah.ayahs.length) {
      playAt(surah.number, index + 1)
    } else if (settings.continuousPlay && surah.number < 114) {
      playAt(surah.number + 1, 0)
    } else {
      setIsPlaying(false)
    }
  }

  function goToPrev() {
    if (!surah) return
    if (index > 0) {
      playAt(surah.number, index - 1)
    } else if (surah.number > 1) {
      playAt(surah.number - 1, 0)
    }
  }

  // Keep the audio in sync when the user changes reciter or translation mid-playback
  useEffect(() => {
    if (!surah) return
    let cancelled = false
    ;(async () => {
      const wasPlaying = isPlaying
      try {
        const [s, audioData] = await Promise.all([
          getSurah(surah.number, { translation: settings.translation }),
          getAyahAudio(settings.reciter, surah.number, surah.ayahs[index].numberInSurah),
        ])
        if (cancelled) return
        setSurah(s)
        segmentsRef.current = audioData.segments
        ayahBoundsRef.current = { startMs: audioData.startMs ?? 0, endMs: audioData.endMs ?? null }
        endTriggeredRef.current = false
        setActiveWordPosition(null)
        const audio = audioRef.current
        if (audio) {
          if (audio.src !== audioData.url) audio.src = audioData.url
          seekTo(audio, audioData.startMs ?? 0)
          if (wasPlaying) audio.play()
        }
      } catch (e) {
        /* keep previous audio if refresh fails */
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.reciter, settings.translation])

  // Rebind the "ended" handler so it always sees the latest surah/index/continuousPlay/loopAyah
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.onended = () => {
      if (loopAyah) {
        endTriggeredRef.current = false
        seekTo(audio, ayahBoundsRef.current.startMs)
        audio.play()
      } else {
        goToNext()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surah, index, settings.continuousPlay, loopAyah])

  const currentAyah = surah ? surah.ayahs[index] : null

  // Lock-screen / notification-shade metadata, like a Spotify "now playing" card.
  useEffect(() => {
    if (!('mediaSession' in navigator) || !surah || !currentAyah) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: `${surah.englishName} — Ayah ${currentAyah.numberInSurah}`,
      artist: surah.englishNameTranslation || 'The Holy Quran',
      album: 'Assalamualaikum.org',
      artwork: [
        { src: '/icons/favicon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icons/favicon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    })
  }, [surah, currentAyah])

  // Lets the lock screen / Bluetooth / headset controls drive playback
  // directly, the same way Spotify and Apple Music respond to those buttons.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const audio = audioRef.current
    navigator.mediaSession.setActionHandler('play', () => audio?.play())
    navigator.mediaSession.setActionHandler('pause', () => audio?.pause())
    navigator.mediaSession.setActionHandler('stop', () => audio?.pause())
    navigator.mediaSession.setActionHandler('previoustrack', () => goToPrev())
    navigator.mediaSession.setActionHandler('nexttrack', () => goToNext())
    return () => {
      navigator.mediaSession.setActionHandler('play', null)
      navigator.mediaSession.setActionHandler('pause', null)
      navigator.mediaSession.setActionHandler('stop', null)
      navigator.mediaSession.setActionHandler('previoustrack', null)
      navigator.mediaSession.setActionHandler('nexttrack', null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surah, index, settings.continuousPlay])

  return (
    <PlayerContext.Provider
      value={{
        surah,
        index,
        currentAyah,
        isPlaying,
        isLoading,
        error,
        activeWordPosition,
        loopAyah,
        setLoopAyah,
        play: playAt,
        toggle: togglePlayPause,
        next: goToNext,
        prev: goToPrev,
      }}
    >
      {children}
    </PlayerContext.Provider>
  )
}

export function usePlayer() {
  const ctx = useContext(PlayerContext)
  if (!ctx) throw new Error('usePlayer must be used within PlayerProvider')
  return ctx
}
