import express from 'express';
import { MongoClient, ObjectId } from 'mongodb';
import cors from 'cors';
import 'dotenv/config';
import { createServer } from 'http';
import { Server } from 'socket.io';

const app = express();

// MIDDLEWARE
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
  transports: ['websocket', 'polling'],
  allowEIO3: true
});

// MONGODB SETUP
const client = new MongoClient(process.env.MONGO_URI);
const dbName = 'amie_babie';

// MULTIPLAYER SETUP
const gameRooms = {};

io.on('connection', (socket) => {
  console.log(`${socket.id} connected`);

  socket.on('joinGame', ({ roomID, playerID, nickname, status, selectedPowerUp }) => {
  socket.join(roomID);

  if (!gameRooms[roomID]) {
    gameRooms[roomID] = {
      rows: 5,
      cols: 5,
      baseMines: 4, 
      nukes: 0,
      rounds: 0,
      players: {},
      state: "Lobby"
    };
  }

  if (!gameRooms[roomID].players[playerID]) {
    gameRooms[roomID].players[playerID] = {
      rows: gameRooms[roomID].rows,
      cols: gameRooms[roomID].cols,
      mines: gameRooms[roomID].baseMines,
      nukes: 0,
      powerUp: selectedPowerUp || { type: "None", value: 0 }, 
      status: status,
      nickname: nickname,
      score: 0
    };
  }

  io.to(roomID).emit('room_status_update', gameRooms[roomID]);
});

  socket.on('changeSettings', ({ rows, cols, mines, rounds, selectedPowerUp, roomID, playerID }) => {
    const room = gameRooms[roomID];
    if (!room || !room.players[playerID]) return;

    // Update base room settings
    room.rows = Number(rows);
    room.cols = Number(cols);
    room.mines = Number(mines);
    room.rounds = Number(rounds);

    // Save current player's power-up choice without computing extra mines/nukes yet
    if (selectedPowerUp) {
      room.players[playerID].powerUp = selectedPowerUp;
    }

    // Keep individual lobby status synced with base room settings
    Object.keys(room.players).forEach((pid) => {
      room.players[pid].rows = room.rows;
      room.players[pid].cols = room.cols;
      room.players[pid].mines = room.mines;
      room.players[pid].nukes = 0;
    });

    io.to(roomID).emit('room_status_update', room);
  });

  socket.on('startGame', ({ roomID }) => {
  const room = gameRooms[roomID];
  if (!room) return;

  room.state = "In Game";

  let totalExtraMinesInRoom = 0;
  let totalNukesInRoom = 0;

  Object.values(room.players).forEach((p) => {
    if (p.powerUp?.type === "Extra Mines") {
      totalExtraMinesInRoom += Number(p.powerUp?.value) || 2;
    }
    if (p.powerUp?.type === "Nuke") {
      totalNukesInRoom += Number(p.powerUp?.value) || 1;
    }
  });

  Object.keys(room.players).forEach((pid) => {
    const p = room.players[pid];

    const ownExtraMines = p.powerUp?.type === "Extra Mines" ? (Number(p.powerUp?.value) || 2) : 0;
    const ownNukes = p.powerUp?.type === "Nuke" ? (Number(p.powerUp?.value) || 1) : 0;

    p.status = "In Game";
    p.rows = Number(room.rows);
    p.cols = Number(room.cols);
    
    // Always calculate from room.baseMines so extra mines don't stack continuously
    p.mines = Number(room.baseMines) + (totalExtraMinesInRoom - ownExtraMines);
    p.nukes = Math.max(0, totalNukesInRoom - ownNukes);
  });

  io.to(roomID).emit('start_game', { room });
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