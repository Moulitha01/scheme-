// backend/src/routes/tts.js
import express from 'express'
import { logger } from '../utils/logger.js'

const router = express.Router()

// Full language name for Bhashini API
const LANG_TO_BHASHINI = {
  hi: 'Hindi',
  ta: 'Tamil',
  te: 'Telugu',
  kn: 'Kannada',
  bn: 'Bengali',
  mr: 'Marathi',
  gu: 'Gujarati',
  en: 'English',
  ml: 'Malayalam',
  pa: 'Punjabi',
  or: 'Odia',
  as: 'Assamese',
}

// Best voice per language
// Dravidian languages (ta, te, kn, ml) → Female2 has better phoneme accuracy
// Indo-Aryan languages (hi, bn, mr, gu, pa) → Female1 is more natural
const LANG_VOICE = {
  hi: 'Female1',  // Hindi    — warm, clear
  ta: 'Female2',  // Tamil    — Female2 better for Tamil phonemes
  te: 'Female2',  // Telugu   — Female2 more natural
  kn: 'Female2',  // Kannada  — Female2 better for Dravidian sounds
  bn: 'Female1',  // Bengali  — Female1 natural
  mr: 'Female1',  // Marathi  — Female1 clear Devanagari
  gu: 'Female1',  // Gujarati — Female1 natural
  en: 'Female1',  // English  — standard
  ml: 'Female2',  // Malayalam— Female2 Dravidian
  pa: 'Female1',  // Punjabi  — Female1
  or: 'Female1',  // Odia     — Female1
  as: 'Female1',  // Assamese — Female1
}

// Speech rate per language — Dravidian languages benefit from slightly slower rate
const LANG_RATE = {
  hi: 1.0,
  ta: 0.9,
  te: 0.9,
  kn: 0.9,
  bn: 1.0,
  mr: 1.0,
  gu: 1.0,
  en: 1.0,
  ml: 0.9,
  pa: 1.0,
  or: 1.0,
  as: 1.0,
}

// POST /api/tts/synthesize
// Body: { text: string, lang: string }
// Returns: audio/mpeg stream
router.post('/synthesize', async (req, res) => {
  const { text, lang = 'hi' } = req.body

  if (!text?.trim()) {
    return res.status(400).json({ error: 'Text is required' })
  }

  const language = LANG_TO_BHASHINI[lang] || 'Hindi'
  const voiceName = LANG_VOICE[lang] || 'Female1'

  try {
    const response = await fetch('https://tts.bhashini.ai/v1/synthesize', {
      method: 'POST',
      headers: {
        'accept': 'audio/mpeg',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text, language, voiceName }),
    })

    if (!response.ok) {
      const errText = await response.text()
      logger.warn(`Bhashini TTS failed (${response.status}) for ${language}: ${errText}`)
      return res.status(502).json({ error: 'TTS service unavailable', fallback: true })
    }

    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('Cache-Control', 'no-cache')

    const reader = response.body.getReader()
    const pump = async () => {
      const { done, value } = await reader.read()
      if (done) { res.end(); return }
      res.write(Buffer.from(value))
      await pump()
    }
    await pump()

  } catch (err) {
    logger.error(`TTS proxy error: ${err.message}`)
    res.status(500).json({ error: 'TTS proxy failed', fallback: true })
  }
})

// GET /api/tts/voices — list supported languages and their voice settings
router.get('/voices', (req, res) => {
  res.json({
    supported: Object.keys(LANG_TO_BHASHINI),
    voices: Object.entries(LANG_VOICE).map(([code, voice]) => ({
      code,
      language: LANG_TO_BHASHINI[code],
      voice,
      rate: LANG_RATE[code],
    })),
  })
})

export default router