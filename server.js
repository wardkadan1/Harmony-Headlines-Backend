/* eslint-disable no-undef */
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const app = express();
const PORT = 3000;
const DATA_FILE = path.resolve(__dirname, "data.json");

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true, // If you're sending cookies or using credentials
  })
);
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

app.get("/data/:id", (req, res) => {
  const { id } = req.params;
  const currentData = readData();

  // Convert `id` to a number for comparison
  const dataItem = currentData.find((item) => item.id === Number(id));

  if (dataItem) {
    res.json(dataItem);
  } else {
    res.status(404).json({ message: "Data not found" });
  }
});

app.post("/initial-mood", (req, res) => {
  const { allData } = req.body;

  if (!allData || !Array.isArray(allData)) {
    return res.status(400).json({ message: "Invalid data format" });
  }

  writeData(allData);

  res.json({ message: "Data overridden successfully", allData });
});

app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
