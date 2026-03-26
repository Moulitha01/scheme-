

// ── Chat Session ──
const messageSchema = new mongoose.Schema({
  role: { type: String, enum: ['user', 'ai'], required: true },
  content: { type: String, required: true },
  schemes: [{ type: mongoose.Schema.Types.Mixed }],
  timestamp: { type: Date, default: Date.now },
})

const sessionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true, index: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  language: { type: String, default: 'English' },
  userProfile: { type: mongoose.Schema.Types.Mixed, default: {} },
  messages: [messageSchema],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
})

// ── Scheme ──
const schemeSchema = new mongoose.Schema({
  name: { type: String, required: true, index: true },
  slug: { type: String, unique: true },
  ministry: String,
  department: String,
  category: {
    type: String,
    enum: ['Agriculture', 'Education', 'Health', 'Housing', 'Women & Child', 'Finance', 'Employment', 'Disability', 'Other'],
  },
  state: { type: String, default: 'Central' },
  description: String,
  eligibility: [String],
  benefit: String,
  benefitAmount: String,
  documents: [String],
  applyLink: String,
  lastUpdated: { type: Date, default: Date.now },
  isActive: { type: Boolean, default: true },
  vectorId: String, // ChromaDB reference
})

schemeSchema.index({ name: 'text', description: 'text', category: 1 })

// ── User ──
const userSchema = new mongoose.Schema({
  name: String,
  phone: { type: String, unique: true, sparse: true },
  language: { type: String, default: 'English' },
  profile: {
    age: Number,
    gender: String,
    state: String,
    district: String,
    income: Number,
    occupation: String,
    caste: String,
    isDisabled: Boolean,
  },
  appliedSchemes: [{
    schemeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Scheme' },
    status: { type: String, enum: ['discovered', 'applied', 'submitted', 'approved', 'rejected'], default: 'discovered' },
    appliedAt: Date,
  }],
  createdAt: { type: Date, default: Date.now },
})

export const Session = mongoose.model('Session', sessionSchema)
export const Scheme = mongoose.model('Scheme', schemeSchema)
export const User = mongoose.model('User', userSchema)
