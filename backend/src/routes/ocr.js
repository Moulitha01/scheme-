import express from 'express'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import { extractFromDocument } from '../services/ocr.js'
import { logger } from '../utils/logger.js'

const router = express.Router()

// Multer config — store in /tmp
const upload = multer({
  dest: '/tmp/scheme-ai-uploads/',
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/jpg', 'application/pdf']
    if (allowed.includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('Only JPG, PNG, PDF allowed'))
    }
  },
})

// POST /api/ocr/extract
router.post('/extract', upload.single('document'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' })
  }

  const filePath = req.file.path

  try {
    const result = await extractFromDocument(filePath, req.body.docType || 'aadhaar')

    // Clean up temp file
    fs.unlink(filePath, () => {})

    if (!result.success) {
      return res.status(422).json({ error: 'Could not extract data from document' })
    }

    logger.info(`OCR success: extracted ${Object.keys(result.fields).length} fields`)
    res.json({
      success: true,
      fields: result.fields,
      confidence: result.confidence,
    })
  } catch (err) {
    fs.unlink(filePath, () => {})
    logger.error(`OCR route error: ${err.message}`)

    // Demo fallback for development
    if (process.env.NODE_ENV !== 'production') {
      return res.json({
        success: true,
        fields: {
          name: 'Ravi Kumar Sharma',
          dob: '15/08/1985',
          gender: 'Male',
          address: 'House No. 42, Gandhi Nagar, Chennai, Tamil Nadu 600001',
          aadhaar: '1234 5678 9012',
          pincode: '600001',
          state: 'Tamil Nadu',
        },
        confidence: 87,
        demo: true,
      })
    }

    res.status(500).json({ error: 'OCR processing failed. Please try a clearer image.' })
  }
})

export default router
