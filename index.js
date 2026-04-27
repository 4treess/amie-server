// server/index.js
import express from 'express';
import { MongoClient } from 'mongodb';
import cors from 'cors';
import 'dotenv/config';

const app = express();
app.use(cors());
app.use(express.json());

const client = new MongoClient(process.env.MONGO_URI);
const dbName = 'amie_babie';

app.get('/api/events', async (req, res) => {
  await client.connect();
  const events = await client.db(dbName).collection('milestones')
    .find().sort({ createdAt: -1 }).toArray();
  res.json(events);
});

app.post('/api/events', async (req, res) => {
  await client.connect();
  const result = await client.db(dbName).collection('milestones')
    .insertOne({ ...req.body, createdAt: new Date() });
  res.json(result);
});

app.listen(3001, () => console.log('Server running on port 3001'));