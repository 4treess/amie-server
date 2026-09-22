import express from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import cors from 'cors';
import 'dotenv/config';
import { createServer } from 'http';
import { Server } from 'socket.io';

const app = express();

// MIDDLEWARE
// Allows preflight HTTP checks from cross-origin requests (Vercel)
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
}));
app.use(express.json());

// HTTP + SOCKETIO SETUP
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'], // Explicitly enables pure WebSocket fallback/upgrades
  allowEIO3: true
});

// MONGODB SETUP
const client = new MongoClient(process.env.MONGO_URI);
const dbName = 'amie_babie';

// MULTIPLAYER SETUP
const gameRooms = {};

function handlePowerUps(powerUp, previousPowerUp, mines, nukes) {
  if (powerUp && previousPowerUp && powerUp.type !== previousPowerUp.type) {
    switch (powerUp.type) {
      case "Extra Mines":
        mines += powerUp.value || 0;
        break;
      case "Nuke":
        nukes += powerUp.value || 0;
        break;
    }

    switch (previousPowerUp.type) {
      case "Extra Mines":
        mines -= previousPowerUp.value || 0;
        break;
      case "Nuke":
        nukes -= previousPowerUp.value || 0;
        break;
    }
  }
  return { mines, nukes };
}

io.on('connection', (socket) => {
  console.log(`${socket.id} connected`);

  socket.on('joinGame', ({ roomID, playerID, nickname, status }) => {
    socket.join(roomID);

    if (!gameRooms[roomID]) {
      gameRooms[roomID] = {
        rows: 5,
        cols: 5,
        mines: 4,
        rounds: 0,
        players: {},
        state: "Lobby"
      };
    }

    if (!gameRooms[roomID].players[playerID]) {
      gameRooms[roomID].players[playerID] = {
        rows: gameRooms[roomID].rows,
        cols: gameRooms[roomID].cols,
        mines: gameRooms[roomID].mines,
        nukes: 0,
        status: status,
        nickname: nickname,
        score: 0
      };
    }

    io.to(roomID).emit('room_status_update', gameRooms[roomID]);
  });

  socket.on('changeSettings', ({ rows, cols, mines, rounds, selectedPowerUp, previousPowerUp, roomID }) => {
    if (!gameRooms[roomID]) return;

    const result = handlePowerUps(selectedPowerUp, previousPowerUp, mines, 0);

    gameRooms[roomID].rows = rows;
    gameRooms[roomID].cols = cols;
    gameRooms[roomID].mines = result.mines;
    gameRooms[roomID].rounds = rounds;

    Object.keys(gameRooms[roomID].players).forEach((pid) => {
      gameRooms[roomID].players[pid].rows = gameRooms[roomID].rows;
      gameRooms[roomID].players[pid].cols = gameRooms[roomID].cols;
      gameRooms[roomID].players[pid].mines = gameRooms[roomID].mines;
      gameRooms[roomID].players[pid].nukes = (gameRooms[roomID].nukes || 0) + result.nukes;
    });

    io.to(roomID).emit('room_status_update', gameRooms[roomID]);
  });

  socket.on('startGame', ({ roomID }) => {
    if (!gameRooms[roomID]) return;
    gameRooms[roomID].state = "In Game";

    const playerIDs = Object.keys(gameRooms[roomID].players);

    playerIDs.forEach((pid) => {
      gameRooms[roomID].players[pid].rows = gameRooms[roomID].rows;
      gameRooms[roomID].players[pid].cols = gameRooms[roomID].cols;
      gameRooms[roomID].players[pid].mines = gameRooms[roomID].mines;
      gameRooms[roomID].players[pid].nukes = 0;
      gameRooms[roomID].players[pid].status = "In Game";
    });

    io.to(roomID).emit('start_game', { room: gameRooms[roomID] });
  });

  socket.on('endGame', ({ roomID, playerID, score, status }) => {
    if (!gameRooms[roomID] || !gameRooms[roomID].players[playerID]) return;

    gameRooms[roomID].players[playerID].score += Number(score);
    gameRooms[roomID].players[playerID].status = status;

    const playerIDs = Object.keys(gameRooms[roomID].players);

    playerIDs.forEach((pid) => {
      if (gameRooms[roomID].players[pid].status !== "Lobby") {
        io.to(roomID).emit('room_status_update', gameRooms[roomID]);
        return;
      }
    });

    gameRooms[roomID].state = "Lobby";
    io.to(roomID).emit('round_over', gameRooms[roomID]);
    io.to(roomID).emit('room_status_update', gameRooms[roomID]);
  });

  socket.on('statusUpdate', ({ roomID, playerID, status }) => {
    if (gameRooms[roomID]?.players[playerID]) {
      gameRooms[roomID].players[playerID].status = status;
      io.to(roomID).emit('room_status_update', gameRooms[roomID]);
    }
  });

  socket.on('resetPoints', ({ roomID, playerID }) => {
    if (gameRooms[roomID]?.players[playerID]) {
      gameRooms[roomID].players[playerID].score = 0;
      io.to(roomID).emit('room_status_update', gameRooms[roomID]);
    }
  });
});

// ROUTES
app.get('/api/events/:sortOrder', async (req, res) => {
  try {
    const sortOrder = req.params.sortOrder;
    const db = client.db(dbName);
    const events = await db.collection('milestones')
      .find()
      .sort({ sortDate: sortOrder })
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
    const updatedSortDate = new Date(`${req.body.date}, ${req.body.year}`);

    const result = await db.collection('milestones').updateOne(
      { _id: new ObjectId(eventId) },
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

app.delete('/api/events/:id', async (req, res) => {
  const db = client.db(dbName);
  try {
    const eventId = req.params.id;

    const result = await db.collection('milestones').deleteOne({
      _id: new ObjectId(eventId)
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: "No milestone found with that ID" });
    }

    res.json({ success: true, message: "Memory deleted successfully!" });
  } catch (err) {
    console.error("❌ Backend DELETE Error:", err);
    res.status(500).json({ error: "Failed to delete milestone", details: err.message });
  }
});

// SERVER START & PORT LOGIC
const PORT = process.env.PORT || 3001;

async function start() {
  try {
    await client.connect();
    console.log("✅ Connected to MongoDB Atlas");

    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server is live on port ${PORT}`);
    });
  } catch (err) {
    console.error("❌ Database connection failed:", err);
    process.exit(1);
  }
}

start();