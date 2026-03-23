import express from 'express'
import { Scheme } from '../models/index.js'
import { ingestSchemes } from '../services/rag.js'
import { logger } from '../utils/logger.js'

const router = express.Router()

// GET /api/schemes — list with filters
router.get('/', async (req, res) => {
  try {
    const { category, state, search, page = 1, limit = 20 } = req.query

    const filter = { isActive: true }
    if (category) filter.category = category
    if (state) filter.$or = [{ state: 'Central' }, { state: state }]
    if (search) filter.$text = { $search: search }

    const [schemes, total] = await Promise.all([
      Scheme.find(filter)
        .sort(search ? { score: { $meta: 'textScore' } } : { name: 1 })
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .lean(),
      Scheme.countDocuments(filter),
    ])

    res.json({ schemes, total, page: Number(page), pages: Math.ceil(total / limit) })
  } catch (err) {
    // Return mock data if DB unavailable
    res.json({ schemes: MOCK_SCHEMES, total: MOCK_SCHEMES.length, page: 1, pages: 1 })
  }
})

// GET /api/schemes/:id
router.get('/:id', async (req, res) => {
  try {
    const scheme = await Scheme.findById(req.params.id).lean()
    if (!scheme) return res.status(404).json({ error: 'Scheme not found' })
    res.json(scheme)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// POST /api/schemes/seed — seed initial schemes
router.post('/seed', async (req, res) => {
  try {
    await Scheme.insertMany(SEED_SCHEMES, { ordered: false })
    await ingestSchemes(SEED_SCHEMES)
    res.json({ message: `Seeded ${SEED_SCHEMES.length} schemes`, count: SEED_SCHEMES.length })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// GET /api/schemes/categories
router.get('/meta/categories', async (req, res) => {
  const categories = ['Agriculture', 'Education', 'Health', 'Housing', 'Women & Child', 'Finance', 'Employment', 'Disability']
  res.json(categories)
})

export default router

// ── Seed Data ──
export const SEED_SCHEMES = [
  {
    name: 'PM-KISAN Samman Nidhi',
    ministry: 'Ministry of Agriculture & Farmers Welfare',
    category: 'Agriculture',
    state: 'Central',
    description: 'Direct income support of Rs.6000/year to all landholding farmers\' families with cultivable land.',
    eligibility: ['Landholding farmer', 'Indian citizen', 'Land ownership record required', 'Not a govt. employee or taxpayer'],
    benefit: '₹6,000/year',
    benefitAmount: '6000',
    documents: ['Aadhaar Card', 'Land ownership document', 'Bank account details'],
    applyLink: 'https://pmkisan.gov.in',
  },
  {
    name: 'Ayushman Bharat PM-JAY',
    ministry: 'Ministry of Health & Family Welfare',
    category: 'Health',
    state: 'Central',
    description: 'Health insurance coverage of Rs.5 lakh per family per year for secondary and tertiary hospitalization.',
    eligibility: ['SECC 2011 listed households', 'Deprived rural families', 'Urban workers in specific categories'],
    benefit: '₹5 lakh/year health cover',
    benefitAmount: '500000',
    documents: ['Aadhaar Card', 'Ration Card', 'SECC verification'],
    applyLink: 'https://pmjay.gov.in',
  },
  {
    name: 'PM Ujjwala Yojana',
    ministry: 'Ministry of Petroleum & Natural Gas',
    category: 'Women & Child',
    state: 'Central',
    description: 'Free LPG connections to women from BPL/poor households to promote clean cooking fuel.',
    eligibility: ['BPL household woman', 'No existing LPG connection', 'Age 18 or above', 'BPL ration card holder'],
    benefit: 'Free LPG connection + ₹1600 subsidy',
    documents: ['BPL Ration Card', 'Aadhaar Card', 'Bank account'],
    applyLink: 'https://pmuy.gov.in',
  },
  {
    name: 'National Scholarship Portal',
    ministry: 'Ministry of Education',
    category: 'Education',
    state: 'Central',
    description: 'Scholarships for students from minority, SC/ST, OBC communities and merit-based awards for education.',
    eligibility: ['Student in recognized institution', 'Family income below Rs.2.5 lakh/year', 'Minimum 50% marks in last exam'],
    benefit: 'Up to ₹50,000/year',
    documents: ['School/College ID', 'Income certificate', 'Caste certificate', 'Bank account'],
    applyLink: 'https://scholarships.gov.in',
  },
  {
    name: 'PM Awas Yojana - Gramin',
    ministry: 'Ministry of Rural Development',
    category: 'Housing',
    state: 'Central',
    description: 'Financial assistance to BPL households in rural areas for construction of pucca house with basic amenities.',
    eligibility: ['Rural household', 'No pucca house', 'SECC 2011 listed', 'Priority to SC/ST and minorities'],
    benefit: '₹1.3 lakh (plains) / ₹1.5 lakh (hills)',
    documents: ['Aadhaar Card', 'SECC listing proof', 'Land document', 'Bank account'],
    applyLink: 'https://pmayg.nic.in',
  },
  {
    name: 'MGNREGA',
    ministry: 'Ministry of Rural Development',
    category: 'Employment',
    state: 'Central',
    description: 'Guaranteed 100 days of unskilled manual employment per year to rural households at minimum wage.',
    eligibility: ['Rural adult aged 18+', 'Willing to do unskilled manual work', 'Resident of the Gram Panchayat'],
    benefit: '100 days employment @ ₹220-300/day',
    documents: ['Job Card (from Gram Panchayat)', 'Aadhaar Card', 'Bank account'],
    applyLink: 'https://nrega.nic.in',
  },
  {
    name: 'MUDRA Yojana',
    ministry: 'Ministry of Finance',
    category: 'Finance',
    state: 'Central',
    description: 'Collateral-free micro loans to non-corporate small/micro businesses in manufacturing, trading and service sectors.',
    eligibility: ['Micro/small business owner', 'Non-farm income activity', 'No default history', 'Indian citizen'],
    benefit: 'Loan up to ₹10 lakh (no collateral)',
    documents: ['Business proof', 'Identity proof', 'Address proof', 'Bank statements'],
    applyLink: 'https://mudra.org.in',
  },
  {
    name: 'Sukanya Samriddhi Yojana',
    ministry: 'Ministry of Finance',
    category: 'Women & Child',
    state: 'Central',
    description: 'Small savings scheme for girl child for education and marriage with attractive interest rates and tax benefits.',
    eligibility: ['Girl child below 10 years', 'Parent or legal guardian', 'Indian resident', 'Only 2 accounts per family'],
    benefit: '8.2% interest rate + tax exemption',
    documents: ['Birth certificate of girl', 'Parent Aadhaar', 'Address proof'],
    applyLink: 'https://www.india.gov.in',
  },
]

const MOCK_SCHEMES = SEED_SCHEMES.map((s, i) => ({ ...s, _id: `mock_${i}`, id: i + 1, match: 80 + i }))
