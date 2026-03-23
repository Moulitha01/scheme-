import dotenv from 'dotenv'
dotenv.config({ path: '../.env' })
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import dns from 'dns'
dns.setServers(["1.1.1.1","8.8.8.8"])
import rateLimit from 'express-rate-limit'
import { connectDB } from './utils/db.js'
import { logger } from './utils/logger.js'
import chatRoutes from './routes/chat.js'
import schemeRoutes from './routes/schemes.js'
import ocrRoutes from './routes/ocr.js'
import userRoutes from './routes/users.js'
import ttsRoutes from './routes/tts.js'       // ← add this import

dotenv.config()

const app = express()
const PORT = process.env.PORT || 5000

// ── Middleware ──
app.use(helmet())
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Too many requests. Please try again later.' },
})
app.use('/api/', limiter)

// ── Routes ──
app.use('/api/chat', chatRoutes)
app.use('/api/schemes', schemeRoutes)
app.use('/api/ocr', ocrRoutes)
app.use('/api/users', userRoutes)
app.use('/api/tts', ttsRoutes)                 // ← add this route


// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'Scheme-AI Backend', version: '1.0.0' })
})

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' })
})

// Global error handler
app.use((err, req, res, next) => {
  logger.error(err.stack)
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
  })
})

// ── Start ──
const start = async () => {
  await connectDB()
  app.listen(PORT, () => {
    logger.info(`🚀 Scheme-AI Backend running on http://localhost:${PORT}`)
  })
}

start()
