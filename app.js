const express = require("express");
const app = express();
const PORT = process.env.PORT || 3000;

// שורש - כדי לבדוק שהשרת חי
app.get("/", (req, res) => {
  res.send("Hello from Render!");
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
// נתיב שמחזיר את המחיר הממוצע של מטבע
app.get("/avgPrice", async (req, res) => {
  try {
    const symbol = req.query.symbol; // נקבל מה-URL איזה מטבע לחפש
    if (!symbol) {
      return res.status(400).json({ error: "Missing symbol parameter" });
    }

    const r = await fetch(`https://api.binance.com/api/v3/avgPrice?symbol=${symbol}`);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
