import { generateEmbedding } from './gemini.js'
import { logger } from '../utils/logger.js'

let chromaClient = null
let collection = null
const CHROMA_COLLECTION = 'welfare_schemes'

const getChromaCollection = async () => {
  if (collection) return collection
  try {
    const { ChromaClient } = await import('chromadb')
    chromaClient = new ChromaClient({
      path: `http://${process.env.CHROMA_HOST || 'localhost'}:${process.env.CHROMA_PORT || 8000}`,
    })
    collection = await chromaClient.getOrCreateCollection({
      name: CHROMA_COLLECTION,
      metadata: { description: 'Indian government welfare schemes — Gemini embeddings' },
    })
    logger.info('✅ ChromaDB connected (Gemini text-embedding-004)')
    return collection
  } catch (err) {
    logger.warn(`ChromaDB unavailable: ${err.message}. Using MongoDB fallback.`)
    return null
  }
}

export const semanticSearch = async (query, userProfile = {}, limit = 10) => {
  try {
    const col = await getChromaCollection()
    if (!col) return []

    const enrichedQuery = buildRichQuery(query, userProfile)
    const queryEmbedding = await generateEmbedding(enrichedQuery)
    if (!queryEmbedding) return []

    const whereFilter = userProfile.state
      ? { $or: [{ state: 'Central' }, { state: userProfile.state }] }
      : undefined

    const results = await col.query({
      queryEmbeddings: [queryEmbedding],
      nResults: Math.min(limit, 20),
      ...(whereFilter ? { where: whereFilter } : {}),
    })

    if (!results.documents?.[0]?.length) return []

    return results.documents[0].map((doc, i) => ({
      content: doc,
      metadata: results.metadatas[0][i],
      distance: results.distances?.[0]?.[i],
      id: results.ids[0][i],
    }))
  } catch (err) {
    logger.error(`Semantic search error: ${err.message}`)
    return []
  }
}

export const ingestSchemes = async (schemes) => {
  try {
    const col = await getChromaCollection()
    if (!col) return false

    logger.info(`Ingesting ${schemes.length} schemes with Gemini embeddings...`)
    const BATCH = 10

    for (let i = 0; i < schemes.length; i += BATCH) {
      const batch = schemes.slice(i, i + BATCH)
      const documents = batch.map(s =>
        `${s.name}. Ministry: ${s.ministry}. Category: ${s.category}. ` +
        `State: ${s.state || 'Central'}. ${s.description}. ` +
        `Eligibility: ${Array.isArray(s.eligibility) ? s.eligibility.join(', ') : s.eligibility}. ` +
        `Benefit: ${s.benefit}.`
      )

      const embeddings = await Promise.all(documents.map(d => generateEmbedding(d)))
      const validIdxs = embeddings.map((e, idx) => (e ? idx : -1)).filter(i => i >= 0)
      if (!validIdxs.length) continue

      await col.upsert({
        ids: validIdxs.map(idx => (batch[idx]._id || batch[idx].id || `s_${i + idx}`).toString()),
        documents: validIdxs.map(idx => documents[idx]),
        embeddings: validIdxs.map(idx => embeddings[idx]),
        metadatas: validIdxs.map(idx => ({
          name: batch[idx].name,
          category: batch[idx].category || '',
          state: batch[idx].state || 'Central',
          benefit: batch[idx].benefit || '',
          ministry: batch[idx].ministry || '',
          applyLink: batch[idx].applyLink || '',
        })),
      })

      logger.info(`  Batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(schemes.length / BATCH)} done`)
      if (i + BATCH < schemes.length) await new Promise(r => setTimeout(r, 400))
    }

    logger.info(`✅ Ingested ${schemes.length} schemes`)
    return true
  } catch (err) {
    logger.error(`Ingest error: ${err.message}`)
    return false
  }
}

export const mongoTextSearch = async (query, userProfile = {}, limit = 10) => {
  try {
    const { Scheme } = await import('../models/index.js')
    const filter = { isActive: true }
    if (userProfile.state) filter.$or = [{ state: 'Central' }, { state: userProfile.state }]

    try {
      filter.$text = { $search: query }
      return await Scheme.find(filter, { score: { $meta: 'textScore' } })
        .sort({ score: { $meta: 'textScore' } })
        .limit(limit).lean()
    } catch {
      const words = query.split(' ').filter(w => w.length > 2)
      filter.$or = words.map(w => ({
        $or: [
          { name: { $regex: w, $options: 'i' } },
          { description: { $regex: w, $options: 'i' } },
          { category: { $regex: w, $options: 'i' } },
        ],
      }))
      return await Scheme.find(filter).limit(limit).lean()
    }
  } catch (err) {
    logger.error(`Mongo search error: ${err.message}`)
    return []
  }
}

const buildRichQuery = (query, profile) => {
  const parts = [query]
  if (profile.occupation) parts.push(profile.occupation)
  if (profile.state) parts.push(profile.state)
  if (profile.age) {
    if (profile.age < 25) parts.push('youth student education scholarship')
    if (profile.age > 60) parts.push('elderly pension senior citizen')
  }
  if (profile.gender === 'female') parts.push('women girl scheme mahila')
  if (profile.is_disabled) parts.push('disability divyang handicapped')
  if (profile.is_widow) parts.push('widow pension')
  if (profile.caste === 'sc') parts.push('scheduled caste SC Dalit')
  if (profile.caste === 'st') parts.push('scheduled tribe ST tribal adivasi')
  if (profile.caste === 'obc') parts.push('other backward class OBC')
  if (profile.income_annual && profile.income_annual < 100000) parts.push('BPL below poverty line poor')
  if (profile.land_acres) parts.push('farmer kisan agriculture')
  return parts.join(' ')
}
