// backend/src/services/ocr.js
import Tesseract from 'tesseract.js'
import { logger } from '../utils/logger.js'
import fs from 'fs'
import path from 'path'

// Indian ID document field patterns
const PATTERNS = {
  name: [
    /(?:name|नाम|பெயர்|లేదు)[:\s]*([A-Z][A-Za-z\s]{3,30})/m,
    /^([A-Z][A-Z\s]{3,30})$/m,
  ],
  dob: [
    /(?:dob|date of birth|जन्म तिथि|பிறந்த தேதி)[:\s]*(\d{2}[\/\-]\d{2}[\/\-]\d{4})/i,
    /(\d{2}[\/\-]\d{2}[\/\-]\d{4})/,
  ],
  gender: [
    /\b(male|female|पुरुष|महिला|ஆண்|பெண்|లో|స్త్రీ)\b/i,
  ],
  aadhaar: [
    /(\d{4}\s\d{4}\s\d{4})/,
    /(\d{12})/,
  ],
  pincode: [
    /\b(\d{6})\b/,
  ],
  mobile: [
    /(?:mobile|phone|mob)[:\s]*([6-9]\d{9})/i,
    /\b([6-9]\d{9})\b/,
  ],
  state: [
    /(?:Tamil Nadu|Maharashtra|Karnataka|Kerala|Andhra Pradesh|Telangana|Gujarat|Rajasthan|Uttar Pradesh|Bihar|West Bengal|Madhya Pradesh|Punjab|Haryana|Odisha|Assam|Jharkhand|Uttarakhand|Himachal Pradesh|Goa|Manipur|Meghalaya|Mizoram|Nagaland|Sikkim|Tripura|Arunachal Pradesh|Delhi|Chandigarh)/i,
  ],
  address: [
    /(?:address|पता|முகவரி|చిరునామా)[:\s]*(.{10,100})/i,
  ],
}

// Normalize gender to standard values
function normalizeGender(raw) {
  if (!raw) return ''
  const lower = raw.toLowerCase()
  if (['male', 'पुरुष', 'ஆண்', 'మగ'].some(v => lower.includes(v))) return 'Male'
  if (['female', 'महिला', 'பெண்', 'స్త్రీ'].some(v => lower.includes(v))) return 'Female'
  return raw
}

// Extract DOB and calculate age
function extractAge(dob) {
  if (!dob) return ''
  const parts = dob.split(/[\/\-]/)
  if (parts.length !== 3) return ''
  const [day, month, year] = parts.map(Number)
  const birthDate = new Date(year, month - 1, day)
  const today = new Date()
  const age = today.getFullYear() - birthDate.getFullYear()
  return isNaN(age) ? '' : String(age)
}

// Run Tesseract OCR on the file
async function runOCR(filePath) {
  logger.info(`Running Tesseract OCR on: ${filePath}`)
  try {
    const result = await Tesseract.recognize(filePath, 'eng+hin+tam+tel+kan+ben+guj+mar', {
      logger: () => {},
    })
    return result.data.text
  } catch (err) {
    logger.error(`Tesseract error: ${err.message}`)
    return ''
  }
}

// Extract fields using regex patterns from raw OCR text
function extractWithPatterns(text) {
  const fields = {}

  for (const [field, patterns] of Object.entries(PATTERNS)) {
    for (const pattern of patterns) {
      const match = text.match(pattern)
      if (match && match[1]) {
        fields[field] = match[1].trim()
        break
      }
    }
  }

  // Normalize
  if (fields.gender) fields.gender = normalizeGender(fields.gender)
  if (fields.dob) fields.age = extractAge(fields.dob)

  // Extract district/state from address if not found separately
  if (!fields.state && fields.address) {
    const stateMatch = fields.address.match(PATTERNS.state[0])
    if (stateMatch) fields.state = stateMatch[0]
  }

  return fields
}

// Use Gemini to intelligently extract fields from OCR text
async function extractWithGemini(ocrText, docType) {
  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' })

    const prompt = `
You are an expert at extracting information from Indian government documents like Aadhaar card, PAN card, ration card, voter ID, income certificate.

Extract ALL available fields from this OCR text of a ${docType} document.
Return ONLY a valid JSON object with these fields (use empty string "" if not found):
{
  "name": "",
  "dob": "DD/MM/YYYY format",
  "age": "calculated from dob",
  "gender": "Male or Female",
  "aadhaar": "XXXX XXXX XXXX format",
  "mobile": "10 digit number",
  "address": "full address",
  "state": "",
  "district": "",
  "pincode": "",
  "caste": "General/OBC/SC/ST",
  "income": "annual income in rupees if present",
  "occupation": ""
}

OCR Text:
${ocrText}

Return ONLY the JSON object, no explanation.
    `.trim()

    const result = await model.generateContent(prompt)
    const responseText = result.response.text().trim()

    // Strip markdown code fences if present
    const cleaned = responseText.replace(/```json|```/g, '').trim()
    return JSON.parse(cleaned)

  } catch (err) {
    logger.warn(`Gemini extraction failed: ${err.message}, using pattern fallback`)
    return null
  }
}

// Calculate confidence score based on how many fields were found
function calculateConfidence(fields) {
  const keyFields = ['name', 'dob', 'gender', 'aadhaar', 'state']
  const found = keyFields.filter(f => fields[f] && fields[f] !== '').length
  return Math.round((found / keyFields.length) * 100)
}

// Main export — called by route
export async function extractFromDocument(filePath, docType = 'aadhaar') {
  try {
    // Step 1: Run OCR
    const ocrText = await runOCR(filePath)

    if (!ocrText || ocrText.trim().length < 10) {
      return { success: false, fields: {}, confidence: 0, error: 'Could not read text from document' }
    }

    logger.info(`OCR extracted ${ocrText.length} characters`)

    // Step 2: Try Gemini first (smarter)
    let fields = await extractWithGemini(ocrText, docType)

    // Step 3: Fall back to regex patterns if Gemini fails
    if (!fields || Object.values(fields).every(v => v === '')) {
      logger.info('Using pattern-based extraction')
      fields = extractWithPatterns(ocrText)
    }

    // Step 4: Fill in age from dob if missing
    if (!fields.age && fields.dob) {
      fields.age = extractAge(fields.dob)
    }

    const confidence = calculateConfidence(fields)

    return {
      success: true,
      fields,
      confidence,
      rawText: ocrText.slice(0, 500), // for debugging
    }

  } catch (err) {
    logger.error(`extractFromDocument error: ${err.message}`)
    return { success: false, fields: {}, confidence: 0, error: err.message }
  }
}