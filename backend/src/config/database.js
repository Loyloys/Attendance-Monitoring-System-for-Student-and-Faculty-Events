import mongoose from 'mongoose';
import { env } from './env.js';
import '../models/index.js';

export async function connectDatabase(uri = env.mongoUri) {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 20,
  });
  return mongoose.connection;
}

export async function ensureDatabaseIndexes() {
  const models = mongoose.modelNames().map((name) => mongoose.model(name));
  await Promise.all(models.map((model) => model.init()));
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}
