import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai'
import { logger } from '../utils/logger.js'

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'AIzaSyByIlrlu_1o0vAsA7ftnJtnrQmv8yUNmt8' )

// Safety settings — relaxed for welfare/government content
// ─────────────────────────────────────────────────────────────
const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
]

// ─────────────────────────────────────────────────────────────
// Model helpers
// ─────────────────────────────────────────────────────────────
const getFlashModel = () =>
  genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    safetySettings: SAFETY_SETTINGS,
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 256,
    },
  })

const getProModel = () =>
  genAI.getGenerativeModel({
    model: "gemini-1.5-pro",
    safetySettings: SAFETY_SETTINGS,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1024,
    },
  })

// ─────────────────────────────────────────────────────────────
// Helper: Safe JSON extraction
// ─────────────────────────────────────────────────────────────
const extractJSON = (rawText) => {
  try {
    let text = rawText.replace(/```json|```/g, "").trim()

    const match = text.match(/\{[\s\S]*\}/)

    if (!match) throw new Error("No JSON object found")

    return JSON.parse(match[0])
  } catch (err) {
    logger.error("JSON extraction failed:", err.message)
    return null
  }
}

// ─────────────────────────────────────────────────────────────
// LAYER 1 — Profile Extractor
// ─────────────────────────────────────────────────────────────
const PROFILE_PROMPT = `
You are a silent profile extractor for Scheme-AI, India's welfare navigator.

Extract structured citizen information from the user's message.

The user may speak in ANY Indian language (Tamil, Hindi, Telugu, Bengali etc).
You must still output structured JSON in English.

Return ONLY a valid JSON object.
Do NOT include markdown, comments, or explanation.
The response must start with { and end with }.

Fields to extract (use null if not mentioned):

{
  "age": number|null,
  "gender": "male"|"female"|"other"|null,
  "state": "state name"|null,
  "district": "district name"|null,
  "occupation": "farmer"|"student"|"daily_wage"|"unemployed"|"business"|"govt_employee"|"other"|null,
  "income_annual": number|null,
  "land_acres": number|null,
  "caste": "general"|"obc"|"sc"|"st"|null,
  "is_disabled": boolean|null,
  "is_widow": boolean|null,
  "has_aadhaar": boolean|null,
  "family_size": number|null,
  "need_category": ["education","health","housing","agriculture","finance","employment","women_child"]
}
`

export const extractProfile = async (message) => {
  try {
    const model = getFlashModel()

    const result = await model.generateContent(
      `${PROFILE_PROMPT}

User message:
"${message}"

Return ONLY valid JSON:`
    )

    const raw = result.response.text()

    const parsed = extractJSON(raw)

    if (parsed) return parsed

    return {
      age: null,
      gender: null,
      state: null,
      district: null,
      occupation: null,
      income_annual: null,
      land_acres: null,
      caste: null,
      is_disabled: null,
      is_widow: null,
      has_aadhaar: null,
      family_size: null,
      need_category: [],
    }
  } catch (err) {
    logger.error(`[Gemini] Profile extract error: ${err.message}`)

    return {
      age: null,
      gender: null,
      state: null,
      district: null,
      occupation: null,
      income_annual: null,
      land_acres: null,
      caste: null,
      is_disabled: null,
      is_widow: null,
      has_aadhaar: null,
      family_size: null,
      need_category: [],
    }
  }
}

// ─────────────────────────────────────────────────────────────
// LAYER 2-5 — AI Reply Generator
// ─────────────────────────────────────────────────────────────
const SYSTEM_INSTRUCTION = `
You are Scheme-AI, a compassionate welfare navigator helping Indian citizens find government schemes.

RULES
1. Respond in the SAME language as the user.
2. Avoid bureaucratic language.
3. Explain things like a helpful neighbour.
4. Recommend 2–4 schemes when possible.
5. Explain why the user qualifies.
6. Give simple application steps.
7. Be empathetic if the user seems confused or worried.

RESPONSE FORMAT

Start with empathy.

Then show schemes:

**Scheme Name**
Why they qualify
Benefit
Steps to apply

End with one follow-up question.

You know major Indian schemes including:
PM-KISAN, Ayushman Bharat, PMAY, MGNREGA, Ujjwala, NSP Scholarships,
Mudra Loans, Sukanya Samriddhi, APY, Kisan Credit Card and many others.
`

export const generateAIReply = async ({
  message,
  history = [],
  userProfile = {},
  matchedSchemes = [],
  language = "English",
}) => {
  try {
    const model = getProModel()

    const chatHistory = history.slice(-8).map((m) => ({
      role: m.role === "ai" ? "model" : "user",
      parts: [{ text: m.content }],
    }))

    const chat = model.startChat({
      history: chatHistory,
      systemInstruction: {
        role: "system",
        parts: [{ text: SYSTEM_INSTRUCTION }],
      },
    })

    const contextNote = `
---
[AI Context — not shown to user]

User Profile:
${JSON.stringify(userProfile)}

Language: ${language}

${
  matchedSchemes.length > 0
    ? `RAG Schemes: ${matchedSchemes
        .slice(0, 5)
        .map((s) => s.name)
        .join(", ")}`
    : "No RAG matches yet"
}

---
`

    const enrichedMessage = `${message}\n${contextNote}`

    const result = await chat.sendMessage(enrichedMessage)

    return result.response.text()
  } catch (err) {
    logger.error("AI reply failed:", err.message)

    return "Sorry, something went wrong. Please try again."
  }
}

// ─────────────────────────────────────────────────────────────
// LAYER 3 — Eligibility Scorer
// ─────────────────────────────────────────────────────────────
export const scoreEligibility = async (userProfile, scheme) => {
  try {
    const model = getFlashModel()

    const prompt = `
Citizen profile:
${JSON.stringify(userProfile)}

Government scheme:
Name: ${scheme.name}
Description: ${scheme.description}
Eligibility: ${
      Array.isArray(scheme.eligibility)
        ? scheme.eligibility.join(", ")
        : scheme.eligibility
    }

Score eligibility from 0 to 100.

Return ONLY JSON:
{"score": number, "reason": "short sentence"}
`

    const result = await model.generateContent(prompt)

    const raw = result.response.text()

    const parsed = extractJSON(raw)

    if (parsed) return parsed

    return {
      score: 70,
      reason: "Likely eligible based on available information",
    }
  } catch (err) {
    logger.error(`[Gemini] Eligibility score error: ${err.message}`)

    return {
      score: 70,
      reason: "Likely eligible based on available information",
    }
  }
}

// ─────────────────────────────────────────────────────────────
// Embedding generator for ChromaDB
// ─────────────────────────────────────────────────────────────
export const generateEmbedding = async (text) => {
  try {
    const embeddingModel = genAI.getGenerativeModel({
      model: "text-embedding-004",
    })

    const result = await embeddingModel.embedContent(text)

    return result.embedding.values
  } catch (err) {
    logger.error(`[Gemini] Embedding error: ${err.message}`)
    return null
  }
}