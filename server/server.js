/* eslint-disable no-undef */
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const app = express();
const PORT = 3000;
const DATA_FILE = path.resolve(__dirname, "data.json");

app.use(cors());
app.use(express.json());

const readData = () => {
  try {
    const data = fs.readFileSync(DATA_FILE, "utf8");
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error("Error reading data file:", error.message);
    return [];
  }
};

const writeData = (newData) => {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(newData, null, 2));
  } catch (error) {
    console.error("Error writing to data file:", error.message);
  }
};

app.get("/", (req, res) => {
  res.send("Hello from the backend!");
});

app.get("/data", (req, res) => {
  const currentData = readData();
  res.json(currentData);
});

app.post("/initial-mood", (req, res) => {
  const { allData } = req.body;

  if (!allData || !Array.isArray(allData)) {
    return res.status(400).json({ message: "Invalid data format" });
  }

  writeData(allData);

  res.json({ message: "Data overridden successfully", allData });
});

app.post("/change-mood", (req, res) => {
  const { desiredNews, adjustedNews } = req.body;

  data.push({ type: "change-mood", desiredNews, adjustedNews });
  writeData(data);

  res.json({
    message: "Mood adjustment data saved successfully",
    adjustedNews,
  });
});

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
