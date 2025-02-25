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
        roi,  
        account_balance,
        current_balance,
        TO_CHAR(date_joined, 'MM/DD/YYYY') AS date_joined, 
        TO_CHAR(date_payable, 'MM/DD/YYYY') AS date_payable
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
app.post("/investors/add", async (req, res) => {
  const { name, account_type, investment_term, roi } = req.body;

  if (!name || !account_type || !investment_term || !roi) {
    return res.status(400).json({ error: "All fields are required." });
  }

  try {
    const result = await pool.query(
      `INSERT INTO investors (name, account_type, investment_term, roi, account_balance, current_balance, date_joined, status)
       VALUES ($1, $2, $3::VARCHAR, $4, 0.00, 0.00, CURRENT_DATE, 'Active') 
       RETURNING *`,
      [name, account_type, investment_term, parseFloat(roi)]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error adding investor:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});





app.delete("/investors/:id", async (req, res) => {
  const { id } = req.params;

  try {
    // ✅ Delete all transactions associated with this investor
    await pool.query("DELETE FROM transactions WHERE investor_id = $1", [id]);

    // ✅ Delete the investor
    const deleteResult = await pool.query("DELETE FROM investors WHERE id = $1 RETURNING *", [id]);

    if (deleteResult.rowCount === 0) {
      return res.status(404).json({ error: "Investor not found" });
    }

    res.json({ message: "Investor deleted successfully" });
  } catch (error) {
    console.error("❌ Error deleting investor:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});



app.post("/transactions/process", async (req, res) => {
  try {
    let { investor_id, transaction_type, amount } = req.body;

    // ✅ Convert and Validate Inputs
    const investorId = parseInt(investor_id, 10);
    const amountValue = parseFloat(amount);

    if (isNaN(investorId) || isNaN(amountValue) || amountValue <= 0) {
      return res.status(400).json({ error: "Invalid transaction details" });
    }

    // ✅ Get current investor details
    const investorResult = await pool.query(
      `SELECT roi FROM investors WHERE id = $1`,
      [investorId]
    );

    if (investorResult.rows.length === 0) {
      return res.status(404).json({ error: "Investor not found" });
    }

    let roi = parseFloat(investorResult.rows[0].roi);

    // ✅ Get Total Deposits and Withdrawals BEFORE processing new transaction
    const balanceResult = await pool.query(
      `SELECT 
        COALESCE(SUM(CASE WHEN transaction_type = 'Deposit' THEN amount ELSE 0 END), 0) AS total_deposits,
        COALESCE(SUM(CASE WHEN transaction_type = 'Withdrawal' THEN amount ELSE 0 END), 0) AS total_withdrawals
      FROM transactions 
      WHERE investor_id = $1`,
      [investorId]
    );

    let totalDeposits = parseFloat(balanceResult.rows[0].total_deposits);
    let totalWithdrawals = parseFloat(balanceResult.rows[0].total_withdrawals);

    // ✅ Compute Account Balance BEFORE applying the transaction
    let accountBalance = totalDeposits - totalWithdrawals;

    // ✅ Apply the New Transaction
    if (transaction_type === "Deposit") {
      accountBalance += amountValue;
    } else if (transaction_type === "Withdrawal") {
      if (accountBalance < amountValue) {
        return res.status(400).json({ error: "Insufficient funds for withdrawal" });
      }
      accountBalance -= amountValue;
    }

    // ✅ Compute the New Current Balance
    let currentBalance = accountBalance + (accountBalance * (roi / 100));

    // ✅ Insert Transaction into Database
    await pool.query(
      "INSERT INTO transactions (investor_id, transaction_type, amount) VALUES ($1::INTEGER, $2::VARCHAR, $3::NUMERIC)",
      [investorId, transaction_type, amountValue]
    );

    // ✅ Update investor balances in the database
    await pool.query(
      `UPDATE investors 
       SET account_balance = $1::NUMERIC,
           current_balance = $2::NUMERIC
       WHERE id = $3::INTEGER`,
      [accountBalance, currentBalance, investorId]
    );

    res.json({
      message: `${transaction_type} successful`,
      account_balance: accountBalance,
      current_balance: currentBalance
    });

  } catch (error) {
    console.error("❌ Error processing transaction:", error.message, error.stack);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Investor get and delete

// ✅ Get a Single Investor by ID
app.get("/investors/:id", async (req, res) => {
  try {
    const investorId = parseInt(req.params.id, 10);

    if (isNaN(investorId)) {
      return res.status(400).json({ error: "Invalid investor ID" });
    }

    const investorResult = await pool.query(
      `SELECT * FROM investors WHERE id = $1`,
      [investorId]
    );

    if (investorResult.rows.length === 0) {
      return res.status(404).json({ error: "Investor not found" });
    }

    res.json(investorResult.rows[0]); // ✅ Return investor details
  } catch (error) {
    console.error("❌ Error fetching investor:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ✅ Delete an Investor by ID
app.delete("/investors/:id", async (req, res) => {
  try {
    const investorId = parseInt(req.params.id, 10);

    if (isNaN(investorId)) {
      return res.status(400).json({ error: "Invalid investor ID" });
    }

    // Check if the investor exists
    const investorCheck = await pool.query(
      `SELECT * FROM investors WHERE id = $1`,
      [investorId]
    );

    if (investorCheck.rows.length === 0) {
      return res.status(404).json({ error: "Investor not found" });
    }

    // Delete transactions associated with the investor (to maintain data integrity)
    await pool.query(`DELETE FROM transactions WHERE investor_id = $1`, [investorId]);

    // Delete the investor
    await pool.query(`DELETE FROM investors WHERE id = $1`, [investorId]);

    res.json({ message: "Investor deleted successfully" });
  } catch (error) {
    console.error("❌ Error deleting investor:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Transaction History

// ✅ Get All Transactions for an Investor
app.get("/transactions/:id", async (req, res) => {
  try {
    const investorId = parseInt(req.params.id, 10);

    if (isNaN(investorId)) {
      return res.status(400).json({ error: "Invalid investor ID" });
    }

    const transactionsResult = await pool.query(
      `SELECT transaction_date, transaction_type, amount 
       FROM transactions 
       WHERE investor_id = $1 
       ORDER BY transaction_date DESC`,
      [investorId]
    );

    res.json(transactionsResult.rows);
  } catch (error) {
    console.error("❌ Error fetching transactions:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
});


// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Backend running on port ${PORT}`));
