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



app.post("/investors/add", async (req, res) => {
  const { name, account_type, investment_term, roi, date_joined } = req.body;

  if (!name || !account_type || !investment_term || !roi || !date_joined) {
    return res.status(400).json({ error: "All fields are required." });
  }

  try {
    const result = await pool.query(
      `INSERT INTO investors 
        (name, account_type, investment_term, roi, account_balance, current_balance, date_joined, status)
       VALUES ($1, $2, $3::VARCHAR, $4, 0.00, 0.00, $5::DATE, 'Active') 
       RETURNING *`,
      [name, account_type, investment_term, parseFloat(roi), date_joined]
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


// ================================
// ✅ FERRYPASS COMPONENT
// ================================
// Customer page
// ✅ Fetch All Customers
app.get("/customers", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM customers ORDER BY id DESC");
    res.json(result.rows);
  } catch (error) {
    console.error("❌ Error fetching customers:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ✅ Add New Customer
app.post("/customers", async (req, res) => {
  const { name, contact } = req.body;

  if (!name || !contact) {
    return res.status(400).json({ error: "Name and contact are required" });
  }

  try {
    const result = await pool.query(
      "INSERT INTO customers (name, contact) VALUES ($1, $2) RETURNING *",
      [name, contact]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error adding customer:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ✅ Delete Customer
app.delete("/customers/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query("DELETE FROM customers WHERE id = $1 RETURNING *", [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Customer not found" });
    }

    res.json({ message: "✅ Customer deleted successfully" });
  } catch (error) {
    console.error("❌ Error deleting customer:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Vehicle Types 
app.get("/vehicle-types", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM vehicle_types ORDER BY id DESC");
    res.json(result.rows);
  } catch (error) {
    console.error("❌ Error fetching vehicle types:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.post("/vehicle-types", async (req, res) => {
  const { name, cost } = req.body;
  if (!name || !cost) return res.status(400).json({ error: "Both fields are required." });

  try {
    const result = await pool.query(
      "INSERT INTO vehicle_types (name, cost) VALUES ($1, $2) RETURNING *",
      [name, cost]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error adding vehicle type:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.delete("/vehicle-types/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM vehicle_types WHERE id = $1", [id]);
    res.json({ message: "Vehicle type deleted successfully" });
  } catch (error) {
    console.error("❌ Error deleting vehicle type:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Passenger Types
app.get("/passenger-types", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM passenger_types ORDER BY id DESC");
    res.json(result.rows);
  } catch (error) {
    console.error("❌ Error fetching passenger types:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.post("/passenger-types", async (req, res) => {
  const { name, cost } = req.body;
  if (!name || !cost) return res.status(400).json({ error: "Both fields are required." });

  try {
    const result = await pool.query(
      "INSERT INTO passenger_types (name, cost) VALUES ($1, $2) RETURNING *",
      [name, cost]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error adding passenger type:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});
app.delete("/passenger-types/:id", async (req, res) => {
  const { id } = req.params;

  try {
    // Ensure the ID exists before deleting
    const checkExists = await pool.query("SELECT * FROM passenger_types WHERE id = $1", [id]);

    if (checkExists.rowCount === 0) {
      return res.status(404).json({ error: "Passenger type not found" });
    }

    // Delete the passenger type
    await pool.query("DELETE FROM passenger_types WHERE id = $1", [id]);

    res.json({ message: "✅ Passenger type deleted successfully" });
  } catch (error) {
    console.error("❌ Error deleting passenger type:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Bookings endpoint

// ✅ Submit a new booking
app.post("/bookings", async (req, res) => {
  const {
    customer,
    bookingNumber,
    paymentNumber,
    vehicleNumber,
    vehicleType,
    passengers,
    mode,
    travelDate,
    adminCharge,
    netCost,
  } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO bookings 
      (customer_name, booking_number, payment_number, vehicle_number, vehicle_type, 
       passengers, mode_of_travel, travel_date, admin_charge, net_cost, booking_status, payment_status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'Pending', 'Unpaid')
      RETURNING *`,
      [
        customer,
        bookingNumber,
        paymentNumber,
        vehicleNumber,
        vehicleType,
        JSON.stringify(passengers), // ✅ Store passengers as JSON
        mode,
        travelDate,
        adminCharge,
        netCost,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error creating booking:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ✅ Fetch all bookings (for displaying in the table)
app.get("/bookings", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, customer_name, booking_number, payment_number, vehicle_number, vehicle_type, 
              passengers, mode_of_travel, travel_date, admin_charge, net_cost, 
              booking_status, payment_status, TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at
       FROM bookings
       ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error("❌ Error fetching bookings:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ✅ Edit an existing booking
app.put("/bookings/:id", async (req, res) => {
  const { id } = req.params;
  const {
    customer,
    bookingNumber,
    paymentNumber,
    vehicleNumber,
    vehicleType,
    passengers,
    mode,
    travelDate,
    adminCharge,
    netCost,
  } = req.body;

  try {
    const result = await pool.query(
      `UPDATE bookings 
       SET customer_name = $1, booking_number = $2, payment_number = $3, vehicle_number = $4, 
           vehicle_type = $5, passengers = $6, mode_of_travel = $7, travel_date = $8, 
           admin_charge = $9, net_cost = $10
       WHERE id = $11 RETURNING *`,
      [
        customer,
        bookingNumber,
        paymentNumber,
        vehicleNumber,
        vehicleType,
        JSON.stringify(passengers),
        mode,
        travelDate,
        adminCharge,
        netCost,
        id,
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Booking not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error updating booking:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ✅ Update Booking Status
app.put("/bookings/:id/status", async (req, res) => {
  const { id } = req.params;
  const { bookingStatus, paymentStatus } = req.body;

  try {
    let query = "";
    let values = [];

    if (bookingStatus !== undefined && paymentStatus !== undefined) {
      // If both statuses are provided, update both
      query = `UPDATE bookings SET booking_status = $1, payment_status = $2 WHERE id = $3 RETURNING *`;
      values = [bookingStatus, paymentStatus, id];
    } else if (bookingStatus !== undefined) {
      // Only update booking status
      query = `UPDATE bookings SET booking_status = $1 WHERE id = $2 RETURNING *`;
      values = [bookingStatus, id];
    } else if (paymentStatus !== undefined) {
      // Only update payment status
      query = `UPDATE bookings SET payment_status = $1 WHERE id = $2 RETURNING *`;
      values = [paymentStatus, id];
    } else {
      return res.status(400).json({ error: "No valid status provided" });
    }

    const result = await pool.query(query, values);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Booking not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error updating booking status:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


// ✅ Update Payment Status
app.put("/bookings/:id/payment", async (req, res) => {
  const { id } = req.params;
  const { paymentStatus } = req.body;

  try {
    const result = await pool.query(
      `UPDATE bookings SET payment_status = $1 WHERE id = $2 RETURNING *`,
      [paymentStatus, id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error updating payment status:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ✅ Delete a booking
app.delete("/bookings/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query("DELETE FROM bookings WHERE id = $1 RETURNING *", [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Booking not found" });
    }

    res.json({ message: "✅ Booking deleted successfully" });
  } catch (error) {
    console.error("❌ Error deleting booking:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Vehicle number

app.post("/vehicle-numbers", async (req, res) => {
  const { vehicleNumber, vehicleType } = req.body;

  if (!vehicleNumber || !vehicleType) {
    return res.status(400).json({ error: "Vehicle number and type are required" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO vehicle_numbers (vehicle_number, vehicle_type) VALUES ($1, $2) RETURNING *`,
      [vehicleNumber, vehicleType]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error adding vehicle number:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/vehicle-numbers", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT vn.vehicle_number, vt.name AS vehicle_type
      FROM vehicle_numbers vn
      LEFT JOIN vehicle_types vt ON vn.vehicle_type = vt.id
      ORDER BY vn.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("❌ Error fetching vehicle numbers:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


// Start Server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Backend running on port ${PORT}`));
