const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('./models/User');
require('dotenv').config();

const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');

const app = express();
app.use(cors({
  origin: '*', // Tüm origin'lere geçici izin
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// ENV
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET;

// MongoDB bağlantısı
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB bağlantısı başarılı'))
  .catch(err => console.error('MongoDB bağlantı hatası:', err));

// ------------------------ AUTH ROUTES ------------------------
// ... (Auth routes aynen kalabilir) ...

app.post('/register', async (req, res) => {
  try {
    const { username, password, email } = req.body;
    if (!username || !password || !email) {
      return res.status(400).json({ message: 'Tüm alanları doldurunuz' });
    }

    const existingUser = await User.findOne({ $or: [{ username }, { email }] });
    if (existingUser) {
      return res.status(409).json({ 
        message: existingUser.username === username 
          ? 'Kullanıcı adı zaten alınmış' 
          : 'E-posta zaten kayıtlı'
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const newUser = new User({ username, email, password: hashedPassword });
    await newUser.save();

    const token = jwt.sign({ userId: newUser._id }, JWT_SECRET, { expiresIn: '1h' });

    res.status(201).json({
      token,
      user: { id: newUser._id, username: newUser.username, email: newUser.email }
    });

  } catch (error) {
    console.error('Kayıt hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ message: 'Geçersiz kimlik bilgileri' });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Geçersiz kimlik bilgileri' });
    }

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '1h' });

    res.json({
      token,
      user: { id: user._id, username: user.username, email: user.email }
    });

  } catch (error) {
    console.error('Giriş hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});

app.get('/user', async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Yetkilendirme hatası' });

    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId).select('-password');

    if (!user) return res.status(404).json({ message: 'Kullanıcı bulunamadı' });

    res.json(user);

  } catch (error) {
    console.error('Kullanıcı bilgisi alma hatası:', error);
    res.status(500).json({ message: 'Sunucu hatası' });
  }
});
// ------------------------ SENSOR DATA ------------------------

let sensorData = {
  temperature: "",
  humidity: "",
  pressure: "",
  soilMoisture: "",
  soilTemperature: "",
  waterLevel: "",
  wind: "",
  irrigation:"",
};

const port = new SerialPort({ path: 'COM4', baudRate: 9600 });
const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

parser.on('data', (line) => {
  line = line.trim();
  console.log('Arduino verisi:', line);

  if (line.startsWith("Hava Sıcaklığı:")) {
    sensorData.temperature = line.split(":")[1].replace("C", "").trim();
  } else if (line.startsWith("Hava Nemi:")) {
    sensorData.humidity = line.split(":")[1].replace("%", "").trim();
  } else if (line.startsWith("Basınç:")) {
    sensorData.pressure = line.split(":")[1].replace("hPa", "").trim();
  } else if (line.startsWith("Toprak Nemi:")) {
    sensorData.soilMoisture = line.split(":")[1].trim();
  } else if (line.startsWith("Toprak Sıcaklığı:")) {
    sensorData.soilTemperature = line.split(":")[1].replace("C", "").trim();
  } else if (line.startsWith("SU SEVİYESİ:")) {
    sensorData.waterLevel = line.split(":")[1].replace("%", "").trim();
  } else if (line.startsWith("Rüzgar:")) {
    sensorData.wind = line.split(":")[1].trim();
  }else if (line.startsWith("Sulama")) {
    sensorData.irrigation = line.split(":")[1].trim();
  }

  io.emit("sensorData", sensorData);
});

// Socket.io
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:8081",
    methods: ["GET", "POST"]
  }
});

io.on('connection', (socket) => {
  console.log('Yeni bir kullanıcı bağlandı!');
  socket.emit('sensorData', sensorData); // Başlangıç verisini gönder
});
// server.listen kısmını şu şekilde değiştirin:
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server http://10.70.37.88:${PORT} adresinde çalışıyor`);
});