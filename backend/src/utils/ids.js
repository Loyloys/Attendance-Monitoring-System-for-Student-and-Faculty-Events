import Counter from '../models/Counter.js';

export async function nextNumericId(name) {
  const counter = await Counter.findByIdAndUpdate(
    name,
    { $inc: { sequence: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  return counter.sequence;
}

export async function seedCounter(name, minimum) {
  await Counter.updateOne(
    { _id: name },
    { $max: { sequence: minimum } },
    { upsert: true, setDefaultsOnInsert: true },
  );
}
