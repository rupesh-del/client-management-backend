const express = require("express");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 8080;

app.get("/", (req, res) => {
  res.send("Backend is working!");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
