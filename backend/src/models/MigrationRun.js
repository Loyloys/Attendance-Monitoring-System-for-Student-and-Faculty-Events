import mongoose from 'mongoose';

const migrationRunSchema = new mongoose.Schema({
  sourcePath: { type: String, required: true },
  sourceSize: { type: Number, required: true },
  sourceModifiedAt: { type: Date, required: true },
  sourceSha256: { type: String, required: true },
  counts: { type: mongoose.Schema.Types.Mixed, required: true },
  status: { type: String, enum: ['completed'], default: 'completed' },
  completedAt: { type: Date, default: Date.now },
}, { versionKey: false });

export default mongoose.models.MigrationRun || mongoose.model('MigrationRun', migrationRunSchema);
