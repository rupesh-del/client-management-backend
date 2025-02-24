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

// API Route: Fetch a Single Client by ID
app.get("/clients/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query("SELECT * FROM clients WHERE id = $1", [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Client not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error fetching client:", error);
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

  try {
    await s3.send(new PutObjectCommand(params));
    const fileUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;
    console.log("✅ File Uploaded Successfully:", fileUrl);
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
  const updates = req.body; // Get updated fields

  console.log("📥 Received update request:", updates);

  // Fetch existing client data first to prevent missing fields
  const clientResult = await pool.query("SELECT * FROM clients WHERE id = $1", [id]);

  if (clientResult.rowCount === 0) {
    console.log(`❌ Client ID ${id} not found`);
    return res.status(404).json({ error: "Client not found" });
  }

  const existingClient = clientResult.rows[0];

  // Merge existing data with updates
  const finalUpdate = {
    name: updates.name || existingClient.name,
    policy_number: updates.policy_number || existingClient.policy_number,
    vehicle_number: updates.vehicle_number || existingClient.vehicle_number,
    premium_paid: updates.premium_paid || existingClient.premium_paid,
    paid_to_apex: updates.paid_to_apex || existingClient.paid_to_apex,
    insurer: updates.insurer || existingClient.insurer,
    renewal_date: updates.renewal_date || existingClient.renewal_date,
    additional_attachments: updates.additional_attachments || existingClient.additional_attachments,
  };

  let formattedDate = finalUpdate.renewal_date
    ? new Date(finalUpdate.renewal_date).toISOString().split("T")[0]
    : null;

  try {
    console.log(`🔄 Updating client ID ${id} with new data`);

    const result = await pool.query(
      `UPDATE clients 
       SET name = $1, policy_number = $2, vehicle_number = $3, premium_paid = $4, 
           paid_to_apex = $5, insurer = $6, renewal_date = $7, additional_attachments = $8
       WHERE id = $9 RETURNING *`,
      [
        finalUpdate.name,
        finalUpdate.policy_number,
        finalUpdate.vehicle_number,
        finalUpdate.premium_paid,
        finalUpdate.paid_to_apex,
        finalUpdate.insurer,
        formattedDate,
        JSON.stringify(finalUpdate.additional_attachments || []), // Ensure JSON format
        id
      ]
    );

    if (result.rowCount === 0) {
      console.log(`❌ Client ID ${id} not found`);
      return res.status(404).json({ error: "Client not found" });
    }

    console.log("✅ Client updated:", result.rows[0]);
    res.json(result.rows[0]);

  } catch (error) {
    console.error("❌ Error updating client:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


app.post("/clients/:id/upload", upload.single("file"), async (req, res) => {
  const { id } = req.params;

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

  try {
    await s3.send(new PutObjectCommand(params));
    const fileUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;
    console.log("✅ File Uploaded to S3:", fileUrl);

    // Ensure additionalAttachments field exists before updating
    const clientResult = await pool.query("SELECT additional_attachments FROM clients WHERE id = $1", [id]);

    if (clientResult.rowCount === 0) {
      console.log(`❌ Client ID ${id} not found`);
      return res.status(404).json({ error: "Client not found" });
    }

    let attachments = clientResult.rows[0].additional_attachments || [];
    if (typeof attachments === "string") {
      attachments = JSON.parse(attachments); // Convert string to array if necessary
    }
    
    attachments.push(fileUrl);

    // Update client with the new attachment list
    const updateResult = await pool.query(
      "UPDATE clients SET additional_attachments = $1 WHERE id = $2 RETURNING *",
      [JSON.stringify(attachments), id]
    );

    console.log("✅ Client attachments updated:", updateResult.rows[0]);
    res.json(updateResult.rows[0]);

  } catch (error) {
    console.error("❌ S3 Upload Error:", error);
    res.status(500).json({ error: "Failed to upload file to S3", details: error.message });
  }
});

// renewals:

app.get("/clients/:id/renewals", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      "SELECT * FROM renewals WHERE client_id = $1 ORDER BY renewal_date DESC",
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "No renewals found for this client" });
    }

    res.json(result.rows);
  } catch (error) {
    console.error("❌ Error fetching renewals:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});



app.post("/renewals", upload.single("file"), async (req, res) => {
  const { client_id, renewal_date, next_renewal_date } = req.body;

  if (!req.file) {
    console.log("❌ No file received");
    return res.status(400).json({ error: "No file uploaded" });
  }

  const fileName = `uploads/${Date.now()}_${req.file.originalname}`;
  const fileUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;

  const params = {
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: fileName,
    Body: req.file.buffer,
    ContentType: req.file.mimetype,
  };

  try {
    console.log("📤 Uploading file to AWS S3:", fileName);
    await s3.send(new PutObjectCommand(params));
    console.log("✅ File Uploaded Successfully:", fileUrl);

    // ✅ INSERT into renewals table (Not modifying clients)
    const renewalResult = await pool.query(
      `INSERT INTO renewals (client_id, renewal_date, next_renewal_date, policy_document) 
      VALUES ($1, $2, $3, $4) RETURNING *`,
      [client_id, renewal_date, next_renewal_date, fileUrl]
    );

    console.log("✅ Renewal record created:", renewalResult.rows[0]);
    res.json(renewalResult.rows[0]);

  } catch (error) {
    console.error("❌ AWS S3 Upload Error:", error);
    res.status(500).json({ error: "Failed to upload file to AWS", details: error.message });
  }
});



app.delete("/clients/:clientId/renewals/:renewalId", async (req, res) => {
  const { clientId, renewalId } = req.params;

  try {
    const deleteResult = await pool.query("DELETE FROM renewals WHERE client_id = $1 AND id = $2 RETURNING *", [clientId, renewalId]);

    if (deleteResult.rowCount === 0) {
      return res.status(404).json({ error: "Renewal not found" });
    }

    console.log("✅ Renewal deleted:", deleteResult.rows[0]);
    res.json({ message: "Renewal deleted successfully" });
  } catch (error) {
    console.error("❌ Error deleting renewal:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// INVESTORS

// ✅ Fetch all investors
app.get("/investors", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        id, 
        name, 
        account_type, 
        status, 
        investment_term, 
        interest_definition, 
        COALESCE(current_balance, 0.00) AS current_balance, 
        COALESCE(account_balance, 0.00) AS account_balance,
        date_joined, 
        date_payable 
      FROM investors 
      ORDER BY date_joined DESC
    `);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "No investors found" });
    }

    res.json(result.rows);
  } catch (error) {
    console.error("❌ Error fetching investors:", error);
    res.status(500).json({ error: "Internal server error", details: error.message });
  }
});



// ✅ Add a new investor
app.post("/investors", async (req, res) => {
  const { name, investment_amount, roi, investment_date, next_payout_date } = req.body;

  try {
    const result = await pool.query(
      "INSERT INTO investors (name, investment_amount, roi, investment_date, next_payout_date) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [name, investment_amount, roi, investment_date, next_payout_date]
    );

    console.log("✅ Investor added:", result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error adding investor:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Deposits and Withdrawals
// ✅ Add a Deposit
app.post("/transactions/deposit", async (req, res) => {
  const { investor_id, amount } = req.body;

  try {
    await pool.query(
      "INSERT INTO transactions (investor_id, transaction_type, amount) VALUES ($1, 'Deposit', $2)",
      [investor_id, amount]
    );

    res.json({ message: "Deposit successful" });
  } catch (error) {
    console.error("❌ Error processing deposit:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ✅ Add a Withdrawal
app.post("/transactions/withdrawal", async (req, res) => {
  const { investor_id, amount } = req.body;

  try {
    await pool.query(
      "INSERT INTO transactions (investor_id, transaction_type, amount) VALUES ($1, 'Withdrawal', $2)",
      [investor_id, amount]
    );

    res.json({ message: "Withdrawal successful" });
  } catch (error) {
    console.error("❌ Error processing withdrawal:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});



// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Backend running on port ${PORT}`));
