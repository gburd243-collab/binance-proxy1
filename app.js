const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

// שורש - כדי לוודא שהשרת חי
app.get("/", (req, res) => {
  res.send("Hello from Render! (proxy ready)");
});

// נתיב שמחזיר את הזמן מ-Binance
app.get("/time", async (req, res) => {
  try {
    const r = await fetch("https://api.binance.com/api/v3/time");
    const txt = await r.text();
    res.type("application/json").send(txt);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log(`Server running on ${PORT}`));
