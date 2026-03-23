import mongoose from 'mongoose'
import { logger } from './logger.js'

export const connectDB = async () => {
  try {
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/scheme-ai'
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
    })
    logger.info(`✅ MongoDB connected: ${mongoose.connection.host}`)
  } catch (err) {
    logger.error(`❌ MongoDB connection failed: ${err.message}`)
    logger.warn('⚠️  Continuing without DB — some features will be limited')
  }
}
