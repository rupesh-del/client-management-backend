const express = require("express");
const router = express.Router();
const pool = require("../db"); // Ensure this is your PostgreSQL connection

// ✅ Submit a new booking
router.post("/", async (req, res) => {
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
router.get("/", async (req, res) => {
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
router.put("/:id", async (req, res) => {
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
router.put("/:id/status", async (req, res) => {
  const { id } = req.params;
  const { bookingStatus } = req.body;

  try {
    const result = await pool.query(
      `UPDATE bookings SET booking_status = $1 WHERE id = $2 RETURNING *`,
      [bookingStatus, id]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error("❌ Error updating booking status:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ✅ Update Payment Status
router.put("/:id/payment", async (req, res) => {
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
router.delete("/:id", async (req, res) => {
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

module.exports = router;
