import express from 'express'
import { User } from '../models/index.js'
import { logger } from '../utils/logger.js'

const router = express.Router()

// POST /api/users — create or update user profile
router.post('/', async (req, res) => {
  try {
    const { phone, name, language, profile } = req.body
    const user = await User.findOneAndUpdate(
      { phone },
      { name, language, profile, updatedAt: new Date() },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    )
    res.json(user)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/users/:id/schemes — user's applied schemes
router.get('/:id/schemes', async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .populate('appliedSchemes.schemeId')
      .lean()
    if (!user) return res.status(404).json({ error: 'User not found' })
    res.json(user.appliedSchemes)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/users/:id/apply — mark scheme as applied
router.post('/:id/apply', async (req, res) => {
  try {
    const { schemeId, status } = req.body
    const user = await User.findById(req.params.id)
    if (!user) return res.status(404).json({ error: 'User not found' })

    const existing = user.appliedSchemes.find(s => s.schemeId.toString() === schemeId)
    if (existing) {
      existing.status = status
    } else {
      user.appliedSchemes.push({ schemeId, status, appliedAt: new Date() })
    }
    await user.save()
    res.json({ success: true })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

export default router
