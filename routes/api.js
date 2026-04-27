/*api.js */
// This file defines the core API routes for the application.
//It handles data interaction, including tree submissions, updates, reads and deletes, and user notifications,
//handling user location updates etc.

// Import necessary modules
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const fs = require('fs');
const multer = require('multer');
const path = require('path');
const exifParser = require('exif-parser');

//Utility functions and middleware
const { isLoggedIn, isAdmin } = require('../middleware/auth');
const { createNotification } = require('../utils/notifications');
const { PythonShell } = require('python-shell');
const { processAIVerification } = require('../utils/aiProcessor');

//Constants
const VOTE_THRESHOLD = 5;

//Consistent upload dir
const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'public/uploads'),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});

// Set up multer for file uploads
const upload = multer({ storage });

/*==================================*/
// Helper Functions //
/*==================================*/

// Haversine formula to calculate distance between two points in meters.
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000; // metres
  const toRad = angle => angle * (Math.PI / 180);
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/*==================================*/
// API Routes //
/*==================================*/

// --- CRUD operations for trees ---

// Creates a new tree entry in the database
router.post('/trees', upload.none(), async (req, res, next) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'You must be logged in to submit data.' });
  }

  const connection = await db.promise().getConnection();
  try {
    // Destructure both basic and expert fields from the request body
    const { 
        species_id, age_id, condition_id, latitude, longitude, notes,
        botanical_species_id, surround_id, diameter_cm, spread_radius_m, tree_height_m 
    } = req.body;
    const userId = req.session.user?.user_id;

    if (!species_id || !age_id || !condition_id || !latitude || !longitude) {
      return res.status(400).json({ error: 'Missing required fields.' });
    }

    await connection.beginTransaction();

    const [locationRows] = await connection.query(
      'SELECT location_id FROM location WHERE latitude = ? AND longitude = ?',
      [latitude, longitude]
    );
    let locationId;
    if (locationRows.length > 0) {
      locationId = locationRows[0].location_id;
    } else {
      const [insertLocResult] = await connection.query(
        'INSERT INTO location (latitude, longitude) VALUES (?, ?)',
        [latitude, longitude]
      );
      locationId = insertLocResult.insertId;
    }
    
    // If a specific botanical name was chosen, it overrides the common name species_id
    const final_species_id = botanical_species_id || species_id;

    const treeChangeLog = req.session.user?.role === 'admin' ? 'Submitted by Admin' : 'Submitted by User';
    
    // Modified INSERT query to include expert fields
    const [insertTreeResult] = await connection.query(
      `INSERT INTO trees (species_id, age_id, condition_id, location_id, notes, tree_change_log, created_at, updated_at, surround_id, diameter_cm, spread_radius_m, tree_height_m) 
       VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?, ?, ?)`,
      [final_species_id, age_id, condition_id, locationId, notes || null, treeChangeLog, surround_id || null, diameter_cm || null, spread_radius_m || null, tree_height_m || null]
    );
    const treeId = insertTreeResult.insertId;

    await connection.query(
      `INSERT INTO user_observations (user_id, tree_id) VALUES (?, ?)`,
      [userId, treeId]
    );

    await connection.query(
      `INSERT INTO tree_updates (tree_id, user_id, species_id, age_id, condition_id, notes, status, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, 'approved', NOW())`,
      [treeId, userId, final_species_id, age_id, condition_id, "Initial submission by user."]
    );

    await connection.commit();

    res.json({ success: true, tree_id: treeId });

  } catch (err) {
    if (connection) await connection.rollback();
    console.error('Error inserting tree data:', err);
    res.status(500).json({ error: 'Failed to submit tree data.' });
  } finally {
    if (connection) connection.release();
  }
});

// Route to handle tree updates
router.put('/trees/:id', isLoggedIn, isAdmin, upload.none(), async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'You must be logged in to edit a tree.' });
  }

  const treeId = req.params.id;
  const {
    species_id, age_id, condition_id, latitude, longitude, notes
  } = req.body;

  // Check for required fields
  if (!species_id || !age_id || !condition_id || !latitude || !longitude) {
    return res.status(400).json({ error: 'Missing required fields for update.' });
  }

  try {
    const [locationRows] = await db.promise().query(
      'SELECT location_id FROM location WHERE latitude = ? AND longitude = ?',
      [latitude, longitude]
    );

    let locationId;
    if (locationRows.length > 0) {
      locationId = locationRows[0].location_id;
    } else {
      // Insert new location if it doesn't exist
      const [insertLocResult] = await db.promise().query(
        'INSERT INTO location (latitude, longitude) VALUES (?, ?)',
        [latitude, longitude]
      );
      locationId = insertLocResult.insertId;
    }

    await db.promise().query(
      // Update the tree entry with new data
      `UPDATE trees SET species_id = ?, age_id = ?, condition_id = ?, location_id = ?, notes = ? WHERE tree_id = ?`,
      [species_id, age_id, condition_id, locationId, notes, treeId]
    );

    res.json({ success: true, message: 'Tree updated successfully.' });
  } catch (err) {
    console.error('Update error:', err);
    res.status(500).json({ error: 'Failed to update tree data.' });
  }
});

// Deletes a tree entry and all associated data
router.delete('/trees/:id', isLoggedIn, isAdmin, async (req, res) => {
    // Extra security check to verify user is an admin
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'Forbidden. Admin access required.' });
    }

    const treeId = req.params.id;

    try {
        const conn = await db.promise().getConnection();
        await conn.beginTransaction();

        // Retrieve metadata_id
        const [images] = await conn.query('SELECT metadata_id FROM image_metadata WHERE tree_id = ?', [treeId]);
        const imageMetadataIds = images.map(row => row.metadata_id);
        
        if (imageMetadataIds.length > 0) {
            await conn.query('DELETE FROM user_observations WHERE metadata_id IN (?)', [imageMetadataIds]);
        }
        
        //Delete related tree data from all associated tables
        await conn.query('DELETE FROM image_metadata WHERE tree_id = ?', [treeId]);
        await conn.query('DELETE FROM tree_updates WHERE tree_id = ?', [treeId]);
        await conn.query('DELETE FROM user_observations WHERE tree_id = ?', [treeId]);
        await conn.query('DELETE FROM user_notifications WHERE tree_id = ?', [treeId]);
        await conn.query('DELETE FROM pinged_trees WHERE tree_id = ?', [treeId]);

        // Finally, delete the tree itself
        await conn.query('DELETE FROM trees WHERE tree_id = ?', [treeId]);

        //Commits change to database
        await conn.commit();
        //Releases connection
        conn.release();

        res.json({ message: 'Tree and related data deleted successfully.' });

    } catch (err) {
        console.error('Delete error:', err);
        // Rolls black catch block if error is encountered
        res.status(500).json({ error: 'Failed to delete tree and associated data.' });
    }
});

// Route to verify a tree entry
router.put('/trees/:id/verify', async (req, res) => {
  try {
    const treeId = req.params.id;

    // Verify the tree
    await db.promise().query(
      'UPDATE trees SET is_verified = 1 WHERE tree_id = ?',
      [treeId]
    );

    // Find who submitted it
    const [submitter] = await db.promise().query(
      'SELECT user_id FROM user_observations WHERE tree_id = ? LIMIT 1',
      [treeId]
    );

    // Notify them if found
    if (submitter.length > 0) {
      await createNotification({
        user_id: submitter[0].user_id,
        tree_id: treeId,
        message: 'Your tree has been verified by an admin.',
        type: 'tree_verified',
        db
      });
    }

    res.json({ message: 'Tree verified successfully.' });
  } catch (err) {
    console.error('Verification error:', err);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// --- Tree Data Endpoints ---

// The main parameterised search endpoint for trees. Supports filtering by species, condition, date range, and location
router.get('/trees/search', async (req, res, next) => {
  const { species_id, condition_id, has_pending_updates, startDate, endDate, latitude, longitude } = req.query;

  const whereClauses = [];
  const queryParams = [];

  //Dynamic selection and ordering
  let selectionSQL = `
    t.tree_id, t.is_verified, t.created_at, t.flag_type, l.latitude, l.longitude,
    s.common_name, c.condition_level,
    (SELECT COUNT(*) FROM tree_updates tu WHERE tu.tree_id = t.tree_id AND tu.status = 'pending') > 0 AS has_pending_update
  `;
  // Sort order
  let orderBySQL = "ORDER BY t.created_at DESC";

  // If latitude and longitude are provided, calculate distance using Haversine formula
  if (latitude && longitude) {
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    // Haversine formula in SQL to calculate distance in Kilometers
    selectionSQL += `, (
          6371 * ACOS(
              COS(RADIANS(?)) * COS(RADIANS(l.latitude)) *
              COS(RADIANS(l.longitude) - RADIANS(?)) +
              SIN(RADIANS(?)) * SIN(RADIANS(l.latitude))
          )
      ) AS distance`;

    // Add the latitude and longitude to the query parameters
    queryParams.push(lat, lng, lat);
    orderBySQL = "ORDER BY distance ASC";
  }

  // Uses a dynamic selection SQL based on the parameters provided
  let query = `
    SELECT ${selectionSQL}
    FROM trees t
    JOIN location l ON t.location_id = l.location_id
    LEFT JOIN species s ON t.species_id = s.species_id
    LEFT JOIN tree_condition c ON t.condition_id = c.condition_id
  `;

  // Build the WHERE clauses based on provided parameters
  if (species_id) { whereClauses.push("t.species_id = ?"); queryParams.push(species_id); }
  if (condition_id) { whereClauses.push("t.condition_id = ?"); queryParams.push(condition_id); }
  if (startDate) { whereClauses.push("t.created_at >= ?"); queryParams.push(startDate); }
  if (endDate) {
    const nextDay = new Date(endDate);
    nextDay.setDate(nextDay.getDate() + 1);
    const nextDayString = nextDay.toISOString().split('T')[0];
    whereClauses.push("t.created_at < ?");
    queryParams.push(nextDayString);
  }


  if (whereClauses.length > 0) {
    query += " WHERE " + whereClauses.join(" AND ");
  }

  if (has_pending_updates === 'true') {
    query += " HAVING has_pending_update = 1";
  }

  query += ` ${orderBySQL} LIMIT 2000`;

  try {
    const [rows] = await db.promise().query(query, queryParams);
    res.json(rows);
  } catch (err) {
    console.error("Error in /api/trees/search:", err);
    next(err);
  }
});

// Fetches trees within a 5km radius of the provided latitude and longitude, and loads upto 250 trees (applied filters increase this cap to 2000). 
router.get('/trees/nearby', async (req, res, next) => {
  const { latitude, longitude } = req.query;

  if (!latitude || !longitude) {
    // Return a default set of trees or an empty array (50). 
    try {
      const [rows] = await db.promise().query(`
            SELECT t.tree_id, l.latitude, l.longitude, s.common_name, c.condition_level, t.is_verified, t.notes,
                   (SELECT COUNT(*) FROM tree_updates tu WHERE tu.tree_id = t.tree_id AND tu.status = 'pending') > 0 AS has_pending_update
            FROM trees t
            JOIN location l ON t.location_id = l.location_id
            LEFT JOIN species s ON t.species_id = s.species_id
            LEFT JOIN tree_condition c ON t.condition_id = c.condition_id
            ORDER BY t.created_at DESC LIMIT 50
        `);
      return res.json(rows);
    } catch (err) {
      return next(err);
    }
  }

  const lat = parseFloat(latitude);
  const lng = parseFloat(longitude);

  // SQL to find trees within 5km of the provided latitude and longitude
  const sql = `
    SELECT
      t.tree_id, l.latitude, l.longitude, s.common_name, c.condition_level, t.is_verified, t.notes,
      (SELECT COUNT(*) FROM tree_updates tu WHERE tu.tree_id = t.tree_id AND tu.status = 'pending') > 0 AS has_pending_update,
      (
          6371 * ACOS(
              COS(RADIANS(?)) * COS(RADIANS(l.latitude)) *
              COS(RADIANS(l.longitude) - RADIANS(?)) +
              SIN(RADIANS(?)) * SIN(RADIANS(l.latitude))
          )
      ) AS distance
    FROM trees t
    JOIN location l ON t.location_id = l.location_id
    LEFT JOIN species s ON t.species_id = s.species_id
    LEFT JOIN tree_condition c ON t.condition_id = c.condition_id
    HAVING distance < 5 -- 5km radius
    ORDER BY distance ASC
    LIMIT 250;
  `;

  try {
    const [rows] = await db.promise().query(sql, [lat, lng, lat]);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Fetches all details for a specific tree by its ID, including species, age, condition, and location
router.get('/trees/:id', async (req, res) => {
  const treeId = req.params.id;
  try {
    const [rows] = await db.promise().query(`
      SELECT 
        t.tree_id, t.species_id, t.age_id, t.condition_id, t.notes,
        t.diameter_cm, t.spread_radius_m, t.tree_height_m,
        s.botanical_name, s.common_name,
        a.age_desc,
        c.condition_level,
        sur.surround_type, -- Added surround_type
        l.latitude, l.longitude,
        (SELECT COUNT(*) FROM tree_updates tu WHERE tu.tree_id = t.tree_id AND tu.status = 'pending') > 0 AS has_pending_update
      FROM trees t
      LEFT JOIN species s ON t.species_id = s.species_id
      LEFT JOIN age a ON t.age_id = a.age_id
      LEFT JOIN tree_condition c ON t.condition_id = c.condition_id
      LEFT JOIN tree_surround_type sur ON t.surround_id = sur.surround_id -- Added JOIN
      LEFT JOIN location l ON t.location_id = l.location_id
      WHERE t.tree_id = ?
    `, [treeId]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Tree not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(`Error fetching tree by ID (${treeId}):`, err);
    res.status(500).json({ error: 'Failed to fetch tree data' });
  }
});

// Provides formatted location data specifically for the heatmap, allowing filtering by species and condition
router.get('/trees/heatmap/:dataType', async (req, res, next) => {
  const { dataType } = req.params;
  // Gets both optional filters from the URL query string
  const { species_id, condition_id } = req.query;

  let baseQuery = `SELECT l.latitude, l.longitude FROM trees t JOIN location l ON t.location_id = l.location_id`;
  const whereClauses = [];
  const queryParams = [];

  // Handles the main data type for the heatmap
  switch (dataType) {
    case 'health-good':
      baseQuery += ` JOIN tree_condition c ON t.condition_id = c.condition_id`;
      whereClauses.push(`c.condition_level IN ('Excellent', 'Good')`);
      break;
    // other cases for 'health-fair', 'health-poor' etc
    case 'verification':
      whereClauses.push(`t.is_verified = 1`);
      break;
    case 'updates':
      whereClauses.push(`EXISTS (SELECT 1 FROM tree_updates tu WHERE tu.tree_id = t.tree_id AND tu.status = 'pending')`);
      break;
  }

  // Species x condition searching parameters
  if (species_id) {
    whereClauses.push('t.species_id = ?');
    queryParams.push(species_id);
  }
  if (condition_id) {
    whereClauses.push('t.condition_id = ?');
    queryParams.push(condition_id);
  }

  let finalQuery = baseQuery;
  if (whereClauses.length > 0) {
    finalQuery += ' WHERE ' + whereClauses.join(' AND ');
  }

  try {
    const [rows] = await db.promise().query(finalQuery, queryParams);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});


// --- Update Specific Routes ---

// Submits a new update suggestion for a tree, allowing users to suggest changes to species, age, condition, etc.
router.post('/tree-updates', upload.none(), async (req, res, next) => {

  // Destructure all possible fields from the body
  const { tree_id, species_id, age_id, condition_id, notes,
          botanical_species_id, surround_id, diameter_cm, spread_radius_m, tree_height_m } = req.body;
  
  const user_id = req.session.user?.user_id;

  // Validation checks
  if (!user_id) {
    return res.status(401).json({ error: 'You must be logged in.' });
  }
  if (!tree_id || !species_id || !age_id || !condition_id) {
    return res.status(400).json({ error: 'Missing required fields for suggestion.' });
  }

  try {
    // If a specific botanical name was chosen, it overrides the common name species_id
    const final_species_id = botanical_species_id || species_id;

    // This query inserts the new suggestion with a 'pending' status, including expert fields
    const [result] = await db.promise().query(
      `INSERT INTO tree_updates (tree_id, user_id, species_id, age_id, condition_id, notes,
                                 status, submitted_at, surround_id, diameter_cm, spread_radius_m, 
                                 tree_height_m)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', NOW(), ?, ?, ?, ?)`,
      [tree_id, user_id, final_species_id, age_id, condition_id, notes, surround_id 
        || null, diameter_cm || null, spread_radius_m || null, tree_height_m || null]
    );

    // Respond to the user.
    res.json({
      success: true,
      message: 'Your suggestion has been submitted and is now open for voting.',
      update_id: result.insertId
    });

  } catch (err) {
    next(err); 
  }
});

// Casts a vote on a tree update, allowing users to upvote or downvote suggestions
router.post('/updates/:id/vote', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'You must be logged in to vote.' });
  }

  const updateId = Number(req.params.id);
  const userId = req.session.user.user_id;
  const vote = req.body.vote === 'up' ? 'up' : 'down';
  const VOTE_THRESHOLD = 5;

  const connection = await db.promise().getConnection();
  try {
    await connection.beginTransaction();

    // Insert or update the user's vote
    await connection.query(
      `INSERT INTO update_votes (update_id, user_id, vote)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE vote = VALUES(vote)`,
      [updateId, userId, vote]
    );

    // Recalculate vote counts for this update
    const [[counts]] = await connection.query(
      `SELECT
         SUM(CASE WHEN vote = 'up' THEN 1 ELSE 0 END)   AS upvotes,
         SUM(CASE WHEN vote = 'down' THEN 1 ELSE 0 END) AS downvotes
       FROM update_votes
       WHERE update_id = ?`,
      [updateId]
    );

    // Force numbers them to be counted as numbers
    const upvotes = Number(counts.upvotes) || 0;
    const downvotes = Number(counts.downvotes) || 0;
    const totalVotes = upvotes + downvotes;

    // Persist counts on the update row
    await connection.query(
      `UPDATE tree_updates
       SET upvotes = ?, downvotes = ?
       WHERE update_id = ?`,
      [upvotes, downvotes, updateId]
    );

    const shouldRunAI = totalVotes >= VOTE_THRESHOLD;

    await connection.commit();
    connection.release();

    // Fire AI after the transaction is safely committed
    if (shouldRunAI) {
      processAIVerification(updateId);
    }

    res.json({ ok: true, upvotes, downvotes, totalVotes });
  } catch (err) {
    await connection.rollback();
    connection.release();
    console.error('Vote failed:', err);
    res.status(500).json({ error: 'Vote failed' });
  }
});


// Fetches current vs pending update data for a specific tree, allowing users to compare the current state of a tree with any pending updates
router.get('/trees/:id/compare', async (req, res) => {
  const treeId = req.params.id;
  try {
    // Current tree data query
    const [current] = await db.promise().query(`
      SELECT 
        t.tree_id,
        s.common_name, s.botanical_name,
        a.age_desc,
        c.condition_level,
        sur.surround_type,
        t.notes, t.is_verified, t.tree_height_m, t.spread_radius_m, t.diameter_cm,
        l.latitude, l.longitude
      FROM trees t
      LEFT JOIN species s ON t.species_id = s.species_id
      LEFT JOIN age a ON t.age_id = a.age_id
      LEFT JOIN tree_condition c ON t.condition_id = c.condition_id
      LEFT JOIN tree_surround_type sur ON t.surround_id = sur.surround_id
      LEFT JOIN location l ON t.location_id = l.location_id
      WHERE t.tree_id = ?
    `, [treeId]);

    // Pending update data query
    const [pending] = await db.promise().query(`
      SELECT 
        tu.update_id,
        s.common_name, s.botanical_name,
        a.age_desc,
        c.condition_level,
        sur.surround_type,
        tu.notes, tu.submitted_at, tu.tree_height_m, tu.spread_radius_m, tu.diameter_cm,
        u.user_name AS submitted_by
      FROM tree_updates tu
      LEFT JOIN species s ON tu.species_id = s.species_id
      LEFT JOIN age a ON tu.age_id = a.age_id
      LEFT JOIN tree_condition c ON tu.condition_id = c.condition_id
      LEFT JOIN tree_surround_type sur ON tu.surround_id = sur.surround_id
      LEFT JOIN user_info u ON tu.user_id = u.user_id
      WHERE tu.tree_id = ? AND tu.status = 'pending'
      ORDER BY tu.submitted_at DESC
      LIMIT 1
    `, [treeId]);

    res.json({
      current: current[0] || null,
      pending: pending[0] || null
    });

  } catch (err) {
    console.error('Error fetching comparison data:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});


// --- Image Handling ---

// Handles multipart/form data uploads for images. Extracts EXIF data (if available) and stores it in the database along with the image URL
router.post('/upload-image', isLoggedIn, upload.array('images', 10), async (req, res) => {
  const { tree_id, update_id } = req.body;

  // Check if tree_id or update_id is provided, and if files are uploaded
  if ((!tree_id && !update_id) || !req.files) {
    return res.status(400).send('Missing tree_id/update_id or images');
  }

  try {
    for (const file of req.files) {
        let exif = {}; // Default to an empty object
        let dateTaken = null;

        // Only try to parse EXIF data if the file is likely an image
        if (file.mimetype === 'image/jpeg' || file.mimetype === 'image/tiff') {
            try {
                const buffer = fs.readFileSync(file.path);
                const parser = exifParser.create(buffer);
                const result = parser.parse();
                exif = result.tags || {};
                dateTaken = exif.DateTimeOriginal ? new Date(exif.DateTimeOriginal * 1000) : null;
            } catch (exifError) {
                console.warn(`Could not parse EXIF data for ${file.filename}:`, exifError.message);
                // If parsing fails, just process EXIF data
            }
        }
        
        const imageUrl = `/uploads/${file.filename}`;
        const cameraMake = exif.Make || null;
        const cameraModel = exif.Model || null;
        const latitude = exif.GPSLatitude || null;
        const longitude = exif.GPSLongitude || null;

        await db.promise().query(
            `INSERT INTO image_metadata (tree_id, update_id, image_url, date_taken, latitude, longitude, camera_make, camera_model) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [tree_id || null, update_id || null, imageUrl, dateTaken, latitude, longitude, cameraMake, cameraModel]
        );
    }

    //Success and error handling
    res.status(200).json({ message: 'Images uploaded successfully' });
  } catch (err) {
    console.error('Error uploading images or extracting EXIF:', err);
    res.status(500).send('Error processing images');
  }
});


// Fetches images and urls associated with a specific tree ID, allowing users to view all images linked to a tree.
router.get('/trees/:id/images', async (req, res) => {
  const treeId = req.params.id;
  try {
    // This new, comprehensive query finds ALL images related to a tree.
    const [rows] = await db.promise().query(
      `
      (SELECT * FROM image_metadata WHERE tree_id = ?)
      UNION
      (SELECT im.* FROM image_metadata im JOIN tree_updates tu ON im.update_id = tu.update_id WHERE tu.tree_id = ?)
      `,
      [treeId, treeId]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching images for tree:', err);
    res.status(500).json({ error: 'Failed to fetch tree images' });
  }
});


// --- User-Specific Endpoints ---

// Updates the user's latest location and checks for nearby pinged trees, sending notifications if applicable.
router.post('/update-location', isLoggedIn, async (req, res) => {
  const userId = req.session.user.user_id;
  const { latitude, longitude } = req.body;

  if (!latitude || !longitude) {
    return res.status(400).json({ error: 'Missing latitude or longitude' });
  }

  try {
    // Update user's latest location
    await db.promise().query(
      'UPDATE user_info SET last_latitude = ?, last_longitude = ? WHERE user_id = ?',
      [latitude, longitude, userId]
    );

    // Get all active pinged trees and their locations
    const [pingedTrees] = await db.promise().query(`
      SELECT pt.tree_id, l.latitude, l.longitude
      FROM pinged_trees pt
      LEFT JOIN trees t ON pt.tree_id = t.tree_id
      LEFT JOIN location l ON t.location_id = l.location_id
      WHERE pt.active = 1
    `);

    // Loop through pinged trees and compare distance
    for (const ping of pingedTrees) {
      const dist = haversine(latitude, longitude, ping.latitude, ping.longitude);

      if (dist <= 300) {
        const [existing] = await db.promise().query(
          `SELECT 1 FROM user_notifications 
                  WHERE user_id = ? AND tree_id = ? AND type = 'general' AND is_deleted = 0 
                  LIMIT 1`,
          [userId, ping.tree_id]
        );


        if (existing.length === 0) {
          console.log(`📬 Sending ping notification to user ${userId} for tree ${ping.tree_id}`);
          await db.promise().query(
            `INSERT INTO user_notifications (user_id, tree_id, message, type)
                  VALUES (?, ?, ?, 'pinged_tree')
                  ON DUPLICATE KEY UPDATE message = VALUES(message)`,
            [userId, ping.tree_id, 'You are near a pinged tree. Please update it.']
          );
        } else {
          console.log(`🔁 Skipping notification: user ${userId} is already notified about tree ${ping.tree_id}`);
        }
      }

    }

    res.json({ success: true, message: 'Location updated and notifications checked.' });
  } catch (err) {
    console.error('Error updating user location:', err);
    res.status(500).json({ error: 'Server error' });
  }
});


// Fetches all notifications for the logged-in user, including pinged tree notifications, and renders them on the map home page
router.get('/notifications', async (req, res) => {
  const userId = req.session.user?.user_id;
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const [notifications] = await db.promise().query(
      `SELECT * FROM user_notifications 
      WHERE user_id = ? AND is_deleted = 0 
      ORDER BY created_at DESC`,
      [userId]
    );
    // Filter notifications for pinged trees
    const pingedNotifications = notifications.filter(n => n.type === 'pinged_tree');

    res.render('map_home', {
      user: req.session.user,
      notifications,
      pingedNotifications
    });

  } catch (err) {
    console.error('Error fetching notifications:', err);
    res.status(500).json({ error: 'Failed to load notifications' });
  }
});

// POST route to mark a notification as read
router.post('/notifications/:id/read', async (req, res) => {
  const userId = req.session.user?.user_id;
  const notifId = req.params.id;

  // Check if user is authenticated
  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  try {
    // Update the notification to mark it as read
    const [result] = await db.promise().query(
      `UPDATE user_notifications 
       SET is_read = 1 
       WHERE notification_id = ? AND user_id = ?`,
      [notifId, userId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Failed to mark notification as read:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE route to delete a notification
router.delete('/notifications/:id', async (req, res) => {
  const userId = req.session.user?.user_id;
  const notificationId = req.params.id;

  if (!userId) return res.status(401).json({ error: 'Not authenticated' });

  try {
    await db.promise().query(
      // Soft delete the notification by setting is_deleted to 1
      `UPDATE user_notifications 
       SET is_deleted = 1 
       WHERE notification_id = ? AND user_id = ?`,
      [notificationId, userId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Delete notification error:', err);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

// --- Dropdown Data Endpoints ---

// GET species for dropdown
router.get('/species', (req, res) => {

  // Fetches species with non-null common names, ensuring no duplicates by using MIN(species_id) for each common name
  const sql = `
      SELECT MIN(species_id) AS species_id, common_name
      FROM species
      WHERE common_name IS NOT NULL AND common_name != ''
      GROUP BY common_name
      ORDER BY common_name ASC
    `;

  db.query(sql, (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json(rows);
  });
});

// GET age options for dropdown
router.get('/age', (req, res) => {
  db.query('SELECT age_id, age_desc FROM age', (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json(rows);
  });
});


// GET condition levels for dropdown
router.get('/condition', (req, res) => {
  db.query('SELECT condition_id, condition_level FROM tree_condition', (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json(rows);
  });
});

// GET botanical names for a given common name
router.get('/species/botanical/:common_name', (req, res) => {
  const commonName = req.params.common_name;
  const sql = `
    SELECT species_id, botanical_name
    FROM species
    WHERE common_name = ? AND botanical_name IS NOT NULL AND botanical_name != ''
    ORDER BY botanical_name ASC
  `;
  db.query(sql, [commonName], (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json(rows);
  });
});


/* These endpoints are commented out as they are not currently in use, but can be uncommented if needed in the future. */

// GET description options for dropdown
// router.get('/description', (req, res) => {
//   db.query('SELECT description_id, description_notes FROM description', (err, rows) => {
//     if (err) return res.status(500).json({ error: 'DB error' });
//     res.json(rows);
//   });
// });

// GET surround types for dropdown
router.get('/surround', (req, res) => {
  db.query('SELECT surround_id, surround_type FROM tree_surround_type ORDER BY surround_type ASC', (err, rows) => {
    if (err) return res.status(500).json({ error: 'DB error' });
    res.json(rows);
  });
});

// // GET vigour levels for dropdown
// router.get('/vigour', (req, res) => {
//   db.query('SELECT vigour_id, vigour_level FROM tree_vigour', (err, rows) => {
//     if (err) return res.status(500).json({ error: 'DB error' });
//     res.json(rows);
//   });
// });


module.exports = router;