/* utils/notifications.js
 * This module provides functions to create notifications for users in the database.
 * It handles inserting new notifications or updating existing ones.
 */
const db = require('../config/db');

/**
 * Creates a notification for a user in the database.
 */
async function createNotification({ user_id, tree_id, message, type, db: dbConnection = db }) {
  try {
    const sql = `
      INSERT INTO user_notifications (user_id, tree_id, message, type, is_read, created_at)
      VALUES (?, ?, ?, ?, 0, NOW())
      ON DUPLICATE KEY UPDATE
        message = VALUES(message), 
        is_read = 0,               
        created_at = NOW(),
        is_deleted = 0;
    `;
    
    // If dbConnection is the main pool, db.promise() is called.
    // If dbConnection is already a transactional connection, this logic handles it correctly.
    const promiseConnection = dbConnection.promise ? dbConnection.promise() : dbConnection;

    await promiseConnection.query(sql, [user_id, tree_id, message, type]);

  } catch (err) {
    // Log the error but don't crash the main process.
    console.error(`Failed to create or update notification:`, err);
  }
}

module.exports = {
  createNotification
};