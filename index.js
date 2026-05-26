import express from 'express';
import { MongoClient } from 'mongodb';
import cors from 'cors';
import 'dotenv/config';

const app = express();

// 1. MIDDLEWARE
// This allows your Vercel frontend to talk to this Render backend
app.use(cors()); 
app.use(express.json());

// 2. MONGODB SETUP
const client = new MongoClient(process.env.MONGO_URI);
const dbName = 'amie_babie';

// 3. ROUTES
// Important: These must match exactly what you call in React
app.get('/api/events', async (req, res) => {
  try {
    const db = client.db(dbName);
    const events = await db.collection('milestones')
      .find()
      .sort({ sortDate: -1 })
      .toArray();
    res.json(events);
  } catch (err) {
    console.error("Error fetching events:", err);
    res.status(500).json({ error: "Failed to fetch events" });
  }
});

app.put('/api/events/:id', async (req, res) => {
  const db = client.db(dbName);
  try {
    const eventId = req.params.id;

    // Build the updated chronological sorting key from the incoming edit data
    const updatedSortDate = new Date(`${req.body.date}, ${req.body.year}`);

    const result = await db.collection('milestones').updateOne(
      { _id: new ObjectId(eventId) }, // 3. CRITICAL: Wrap the string ID in new ObjectId()
      { 
        $set: { 
          date: req.body.date,
          year: req.body.year,
          shortDesc: req.body.shortDesc,
          fullTitle: req.body.fullTitle,
          story: req.body.story,
          image: req.body.image,
          sortDate: updatedSortDate
        } 
      }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ error: "No milestone found with that ID" });
    }

    res.json({ success: true, message: "Milestone updated successfully", result });
  } catch (err) {
    console.error("❌ Backend PUT Error:", err);
    res.status(500).json({ error: "Failed to update milestone", details: err.message });
  }
});

app.post('/api/events', async (req, res) => {
  try {
    const db = client.db(dbName);
    const actualDate = new Date(`${req.body.date}, ${req.body.year}`);
    const result = await db.collection('milestones')
      .insertOne({ ...req.body, sortDate: actualDate, createdAt: new Date() });
    res.json(result);
  } catch (err) {
    console.error("Error saving event:", err);
    res.status(500).json({ error: "Failed to save event" });
  }
});

// 4. SERVER START & PORT LOGIC
// Render injects a PORT variable; we must listen on '0.0.0.0' for external access
const PORT = process.env.PORT || 3001;

async function start() {
  try {
    await client.connect();
    console.log("✅ Connected to MongoDB Atlas");
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server is live on port ${PORT}`);
    });
  } catch (err) {
    console.error("❌ Database connection failed:", err);
    process.exit(1);
  }
}

start();