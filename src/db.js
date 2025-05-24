const { MongoClient } = require('mongodb');
const { MONGODB_URI } = require('./config');

let db;

async function connectDB() {
  if (db) {
    return db;
  }
  try {
    const client = new MongoClient(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    await client.connect();
    db = client.db(); // Assumes your MONGODB_URI includes the database name
    console.log('MongoDB connected successfully.');
    return db;
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1); // Exit process with failure
  }
}

function getDB() {
  if (!db) {
    throw new Error('DB not initialized! Call connectDB first.');
  }
  return db;
}

module.exports = { connectDB, getDB };
