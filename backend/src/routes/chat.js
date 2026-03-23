import express from 'express'
import { v4 as uuidv4 } from 'uuid'
import { Session, Scheme } from '../models/index.js'
import { extractProfile, generateAIReply, scoreEligibility } from '../services/gemini.js'
import { semanticSearch, mongoTextSearch } from '../services/rag.js'
import { logger } from '../utils/logger.js'

const router = express.Router()

// POST /api/chat/message — main chat endpoint
router.post('/message', async (req, res) => {
  const { message, sessionId, language = 'English' } = req.body

  if (!message?.trim()) {
    return res.status(400).json({ error: 'Message is required' })
  }

  const sid = sessionId || uuidv4()

  try {
    // 1. Load or create session
    let session = await Session.findOne({ sessionId: sid })
    if (!session) {
      session = new Session({ sessionId: sid, language })
    }

    // 2. Layer 1 — Extract user profile silently
    const newProfile = await extractProfile(message)
    session.userProfile = { ...session.userProfile, ...newProfile }

    // 3. Layer 2 — RAG scheme retrieval
    let ragResults = await semanticSearch(message, session.userProfile, 10)
    if (!ragResults.length) {
      // Fallback to MongoDB text search
      ragResults = await mongoTextSearch(message, session.userProfile, 10)
    }

    // 4. Layer 3 — Score eligibility for top schemes
    const topSchemes = await Promise.all(
      ragResults.slice(0, 5).map(async (r) => {
        const schemeName = r.metadata?.name || r.name
        const schemeData = r.metadata || r
        const scored = await scoreEligibility(session.userProfile, {
          name: schemeName,
          description: r.content || schemeData.description || '',
          eligibility: schemeData.eligibility || [],
        })
        return {
          name: schemeName,
          ministry: schemeData.ministry || 'Government of India',
          benefit: schemeData.benefit || 'Check portal',
          eligibility: scored.score,
          reason: scored.reason,
          applyLink: schemeData.applyLink || '',
        }
      })
    )

    // Sort by eligibility score
    topSchemes.sort((a, b) => b.eligibility - a.eligibility)

    // 5. Layer 4+5 — Generate empathetic AI reply
    const reply = await generateAIReply({
      message,
      history: session.messages.slice(-6),
      userProfile: session.userProfile,
      matchedSchemes: topSchemes,
      language,
    })

    // 6. Save to DB
    session.messages.push({ role: 'user', content: message })
    session.messages.push({ role: 'ai', content: reply, schemes: topSchemes })
    session.language = language
    session.updatedAt = new Date()
    await session.save()

    logger.info(`Chat [${sid.slice(0, 8)}]: "${message.slice(0, 40)}..." → ${topSchemes.length} schemes`)

    res.json({
      reply,
      schemes: topSchemes,
      sessionId: sid,
      userProfile: session.userProfile,
    })
  } catch (err) {
    logger.error(`Chat error: ${err.message}`)
    res.status(500).json({
      error: 'AI service temporarily unavailable',
      reply: 'I apologize — I\'m having trouble connecting. Please try again in a moment.',
      schemes: [],
      sessionId: sid,
    })
  }
})

// GET /api/chat/history/:sessionId
router.get('/history/:sessionId', async (req, res) => {
  try {
    const session = await Session.findOne({ sessionId: req.params.sessionId }).lean()
    if (!session) return res.status(404).json({ error: 'Session not found' })
    res.json({ messages: session.messages, userProfile: session.userProfile })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// DELETE /api/chat/session/:sessionId
router.delete('/session/:sessionId', async (req, res) => {
  await Session.deleteOne({ sessionId: req.params.sessionId })
  res.json({ success: true })
})

export default router
