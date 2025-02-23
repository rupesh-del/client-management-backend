require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { Pool } = require("pg");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// PostgreSQL Database Connection (Use Your Render DB URL)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Required for Render PSQL connection
});

// Test database connection
pool.connect((err) => {
  if (err) {
    console.error("Database connection error", err);
  } else {
    console.log("✅ Connected to PostgreSQL Database on Render");
  }
});

// AWS S3 Configuration
const s3 = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY,
    secretAccessKey: process.env.AWS_SECRET_KEY,
  },
});

// Configure Multer for File Uploads
const storage = multer.memoryStorage();
const upload = multer({ storage });

// API Route: Fetch All Clients
app.get("/clients", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM clients ORDER BY id DESC");
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching clients:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// API Route: Add New Client (Stores Data in PSQL)
app.post("/clients", async (req, res) => {
  const {
    name,
    policyNumber,
    vehicleNumber,
    premiumPaid,
    paidToApex,
    paymentNumber,
    premium,
    insurer,
    renewalDate,
    policyType,
    policyDocument,
  } = req.body;

  try {
    const result = await pool.query(
      "INSERT INTO clients (name, policy_number, vehicle_number, premium_paid, paid_to_apex, payment_number, premium, insurer, renewal_date, policy_type, policy_document) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",
      [
        name,
        policyNumber,
        vehicleNumber,
        premiumPaid,
        paidToApex,
        paymentNumber,
        premium,
        insurer,
        renewalDate,
        policyType,
        policyDocument, // AWS S3 URL if provided
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error adding client:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// API Route: Upload File to AWS S3
app.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    console.log("❌ No file received");
    return res.status(400).json({ error: "No file uploaded" });
  }

  const fileName = `uploads/${Date.now()}_${req.file.originalname}`;
  const params = {
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: fileName,
    Body: req.file.buffer,
    ContentType: req.file.mimetype
  };

  console.log("🟢 Uploading File:", fileName);
  console.log("🔍 AWS Params:", params);

  try {
    await s3.send(new PutObjectCommand(params));
    const fileUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;
    console.log("✅ File Uploaded to S3:", fileUrl);
    res.json({ fileUrl });
  } catch (error) {
    console.error("❌ S3 Upload Error:", error);
    res.status(500).json({ error: "Failed to upload file to S3", details: error.message });
  }
});


// API Route: Delete Client from PostgreSQL
app.delete("/clients/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM clients WHERE id = $1", [id]);
    res.json({ message: "Client deleted successfully" });
  } catch (error) {
    console.error("Error deleting client:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.put("/clients/:id", async (req, res) => {
  const { id } = req.params;
  const { policy_document } = req.body;

  try {
    const result = await pool.query(
      "UPDATE clients SET policy_document = $1 WHERE id = $2 RETURNING *",
      [policy_document, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Client not found" });
    }

    console.log("✅ Client updated with policy document:", result.rows[0]);
    res.json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error updating client:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Backend running on port ${PORT}`));
