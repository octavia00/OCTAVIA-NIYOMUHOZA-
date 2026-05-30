const path = require("path");
const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const bcrypt = require("bcrypt");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });

const app = express();

app.use(cors());
app.use(express.json());

// DATABASE CONNECTION
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

db.connect((err) => {
  if (err) {
    console.error("MySQL connection error:", err);
    return;
  }

  console.log("MySQL Connected");

  db.query("SELECT COUNT(*) AS count FROM users", async (selectErr, result) => {
    if (selectErr) {
      console.error("User seed check failed:", selectErr);
      return;
    }

    if (result[0]?.count === 0) {
      try {
        const hashedPassword = await bcrypt.hash("123456", 10);
        db.query(
          "INSERT INTO users(username,password) VALUES (?,?)",
          ["didier", hashedPassword],
          (insertErr) => {
            if (insertErr) {
              console.error("Seed user insert failed:", insertErr);
            } else {
              console.log("Seed user didier created");
            }
          },
        );
      } catch (hashErr) {
        console.error("Failed to hash seed password:", hashErr);
      }
    }
  });

  const port = process.env.PORT || 5000;
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
});

// =========================
// REGISTER USER
// =========================
app.post("/register", async (req, res) => {
  const { username, password } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    db.query(
      "INSERT INTO users(username,password) VALUES (?,?)",
      [username, hashedPassword],
      (err, result) => {
        if (err) return res.status(500).json(err);

        res.json({
          message: "User Registered Successfully",
        });
      },
    );
  } catch (error) {
    res.status(500).json(error);
  }
});

// =========================
// LOGIN
// =========================
app.post("/login", (req, res) => {
  const { username, password } = req.body;

  db.query(
    "SELECT * FROM users WHERE username=?",
    [username],
    async (err, result) => {
      if (err) return res.status(500).json(err);

      if (result.length === 0) {
        return res.status(404).json({
          message: "User not found",
        });
      }

      const validPassword = await bcrypt.compare(password, result[0].password);

      if (!validPassword) {
        return res.status(401).json({
          message: "Wrong Password",
        });
      }

      res.json({ message: "Login Successful" });
    },
  );
});

// =========================
// GET SPARE PARTS
// =========================
app.get("/sparepart", (req, res) => {
  db.query("SELECT * FROM spare_part ORDER BY name", (err, result) => {
    if (err) return res.status(500).json(err);
    res.json(result);
  });
});

// =========================
// SPARE PART INSERT
// =========================
app.post("/sparepart", (req, res) => {
  const { name, category, quantity, unitPrice, totalPrice } = req.body;
  const finalTotal = totalPrice || Number(quantity) * Number(unitPrice);

  db.query(
    "INSERT INTO spare_part(name,category,quantity,unitPrice,totalPrice) VALUES (?,?,?,?,?)",
    [name, category, quantity, unitPrice, finalTotal],
    (err) => {
      if (err) return res.status(500).json(err);
      res.json({ message: "Spare Part Added" });
    },
  );
});

// =========================
// GET STOCK IN RECORDS
// =========================
app.get("/stockin", (req, res) => {
  db.query(
    `SELECT stock_in.*, spare_part.name
     FROM stock_in
     JOIN spare_part ON stock_in.sparePartId = spare_part.sparePartId
     ORDER BY stockInDate DESC`,
    (err, result) => {
      if (err) return res.status(500).json(err);
      res.json(result);
    },
  );
});

// =========================
// STOCK IN INSERT
// =========================
app.post("/stockin", (req, res) => {
  const { sparePartId, stockInQuantity, stockInDate } = req.body;

  db.beginTransaction((transactionErr) => {
    if (transactionErr) return res.status(500).json(transactionErr);

    db.query(
      "INSERT INTO stock_in(sparePartId,stockInQuantity,stockInDate) VALUES (?,?,?)",
      [sparePartId, stockInQuantity, stockInDate],
      (insertErr) => {
        if (insertErr) {
          return db.rollback(() => res.status(500).json(insertErr));
        }

        db.query(
          "UPDATE spare_part SET quantity = quantity + ? WHERE sparePartId = ?",
          [stockInQuantity, sparePartId],
          (updateErr) => {
            if (updateErr) {
              return db.rollback(() => res.status(500).json(updateErr));
            }

            db.commit((commitErr) => {
              if (commitErr) {
                return db.rollback(() => res.status(500).json(commitErr));
              }
              res.json({ message: "Stock In Saved" });
            });
          },
        );
      },
    );
  });
});

// =========================
// STOCK OUT INSERT
// =========================
app.post("/stockout", (req, res) => {
  const {
    sparePartId,
    stockOutQuantity,
    stockOutUnitPrice,
    stockOutTotalPrice,
    stockOutDate,
  } = req.body;

  db.beginTransaction((transactionErr) => {
    if (transactionErr) return res.status(500).json(transactionErr);

    db.query(
      "UPDATE spare_part SET quantity = quantity - ? WHERE sparePartId = ? AND quantity >= ?",
      [stockOutQuantity, sparePartId, stockOutQuantity],
      (stockErr, stockResult) => {
        if (stockErr) {
          return db.rollback(() => res.status(500).json(stockErr));
        }

        if (!stockResult.affectedRows) {
          return db.rollback(() =>
            res
              .status(400)
              .json({ message: "Insufficient stock for this spare part" }),
          );
        }

        db.query(
          "INSERT INTO stock_out(sparePartId,stockOutQuantity,stockOutUnitPrice,stockOutTotalPrice,stockOutDate) VALUES (?,?,?,?,?)",
          [
            sparePartId,
            stockOutQuantity,
            stockOutUnitPrice,
            stockOutTotalPrice,
            stockOutDate,
          ],
          (insertErr) => {
            if (insertErr) {
              return db.rollback(() => res.status(500).json(insertErr));
            }

            db.commit((commitErr) => {
              if (commitErr) {
                return db.rollback(() => res.status(500).json(commitErr));
              }
              res.json({ message: "Stock Out Saved" });
            });
          },
        );
      },
    );
  });
});

// =========================
// GET STOCK OUT
// =========================
app.get("/stockout", (req, res) => {
  db.query(
    `SELECT stock_out.*, spare_part.name
     FROM stock_out
     JOIN spare_part
     ON stock_out.sparePartId = spare_part.sparePartId`,
    (err, result) => {
      if (err) return res.status(500).json(err);

      res.json(result);
    },
  );
});

// =========================
// UPDATE STOCK OUT
// =========================
app.put("/stockout/:id", (req, res) => {
  const id = req.params.id;
  const {
    stockOutQuantity,
    stockOutUnitPrice,
    stockOutTotalPrice,
    stockOutDate,
  } = req.body;

  db.beginTransaction((transactionErr) => {
    if (transactionErr) return res.status(500).json(transactionErr);

    db.query(
      "SELECT sparePartId, stockOutQuantity FROM stock_out WHERE stockOutId = ?",
      [id],
      (selectErr, rows) => {
        if (selectErr) {
          return db.rollback(() => res.status(500).json(selectErr));
        }

        if (!rows.length) {
          return db.rollback(() =>
            res.status(404).json({ message: "Stock Out record not found" }),
          );
        }

        const { sparePartId, stockOutQuantity: oldQuantity } = rows[0];
        const quantityChange = stockOutQuantity - oldQuantity;

        const updateStockSql =
          quantityChange > 0
            ? "UPDATE spare_part SET quantity = quantity - ? WHERE sparePartId = ? AND quantity >= ?"
            : "UPDATE spare_part SET quantity = quantity + ? WHERE sparePartId = ?";
        const updateStockParams =
          quantityChange > 0
            ? [quantityChange, sparePartId, quantityChange]
            : [-quantityChange, sparePartId];

        db.query(
          updateStockSql,
          updateStockParams,
          (updateErr, updateResult) => {
            if (updateErr) {
              return db.rollback(() => res.status(500).json(updateErr));
            }

            if (quantityChange > 0 && !updateResult.affectedRows) {
              return db.rollback(() =>
                res.status(400).json({
                  message: "Insufficient stock to increase stock out quantity",
                }),
              );
            }

            db.query(
              `UPDATE stock_out
             SET stockOutQuantity=?, stockOutUnitPrice=?, stockOutTotalPrice=?, stockOutDate=?
             WHERE stockOutId=?`,
              [
                stockOutQuantity,
                stockOutUnitPrice,
                stockOutTotalPrice,
                stockOutDate,
                id,
              ],
              (updateOutErr) => {
                if (updateOutErr) {
                  return db.rollback(() => res.status(500).json(updateOutErr));
                }

                db.commit((commitErr) => {
                  if (commitErr) {
                    return db.rollback(() => res.status(500).json(commitErr));
                  }
                  res.json({ message: "Stock Out Updated" });
                });
              },
            );
          },
        );
      },
    );
  });
});

// =========================
// DELETE STOCK OUT
// =========================
app.delete("/stockout/:id", (req, res) => {
  const id = req.params.id;

  db.beginTransaction((transactionErr) => {
    if (transactionErr) return res.status(500).json(transactionErr);

    db.query(
      "SELECT sparePartId, stockOutQuantity FROM stock_out WHERE stockOutId = ?",
      [id],
      (selectErr, rows) => {
        if (selectErr) {
          return db.rollback(() => res.status(500).json(selectErr));
        }

        if (!rows.length) {
          return db.rollback(() =>
            res.status(404).json({ message: "Stock Out record not found" }),
          );
        }

        const { sparePartId, stockOutQuantity } = rows[0];

        db.query(
          "DELETE FROM stock_out WHERE stockOutId = ?",
          [id],
          (deleteErr) => {
            if (deleteErr) {
              return db.rollback(() => res.status(500).json(deleteErr));
            }

            db.query(
              "UPDATE spare_part SET quantity = quantity + ? WHERE sparePartId = ?",
              [stockOutQuantity, sparePartId],
              (updateErr) => {
                if (updateErr) {
                  return db.rollback(() => res.status(500).json(updateErr));
                }

                db.commit((commitErr) => {
                  if (commitErr) {
                    return db.rollback(() => res.status(500).json(commitErr));
                  }
                  res.json({ message: "Stock Out Deleted" });
                });
              },
            );
          },
        );
      },
    );
  });
});

// =========================
// DAILY STOCK OUT REPORT
// =========================
app.get("/reports/daily-stockout", (req, res) => {
  const today = new Date().toISOString().split("T")[0];

  db.query(
    `SELECT stock_out.*, spare_part.name
     FROM stock_out
     JOIN spare_part ON stock_out.sparePartId = spare_part.sparePartId
     WHERE stockOutDate=?
     ORDER BY stockOutDate DESC`,
    [today],
    (err, result) => {
      if (err) return res.status(500).json(err);
      res.json(result);
    },
  );
});

// =========================
// STOCK STATUS REPORT
// =========================
app.get("/reports/stock-status", (req, res) => {
  db.query(
    `SELECT
       sp.name,
       sp.quantity AS StoredQuantity,
       IFNULL(SUM(so.stockOutQuantity), 0) AS StockOut,
       sp.quantity AS RemainingQuantity
     FROM spare_part sp
     LEFT JOIN stock_out so ON sp.sparePartId = so.sparePartId
     GROUP BY sp.sparePartId
     ORDER BY sp.name`,
    (err, result) => {
      if (err) return res.status(500).json(err);
      res.json(result);
    },
  );
});
