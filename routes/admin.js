/* admin.js */
//* This javascript file is responsible for handling admin-related functionalities such as tree management, verification, and CSV uploads.

// Import necessary modules, such as express, database connection, and utility functions
const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { createNotification } = require('../utils/notifications');
const { processAIVerification } = require('../utils/aiProcessor');
const fs = require('fs');
const csv = require('csv-parser');
const multer = require('multer');
const path = require('path');
//Import the json2csv library to handle CSV generation
const { Parser } = require('json2csv');

// Allows multer to handle file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '..', 'tmp', 'uploads');
    fs.mkdirSync(uploadPath, { recursive: true }); // Ensure directory exists
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

// Set up multer with the storage configuration
const upload = multer({ storage: storage });

/*==================================*/
// Admin Middleware and Utility Functions //
/*==================================*/


// Middleware to protect admin-only routes
function isAdmin(req, res, next) {
  if (req.session.user && req.session.user.role === 'admin') {
    return next();
  }
  return res.redirect('/'); // Or send 403 if it's an API
}

// Function to verify a tree and create a notification for the user who submitted 
async function verifyTree(treeId, adminUserId) {
  const connection = await db.promise().getConnection();
  try {
    await connection.beginTransaction();

    const [trees] = await connection.query('SELECT * FROM trees WHERE tree_id = ?', [treeId]);
    if (trees.length === 0) throw new Error(`Tree with ID ${treeId} not found.`);
    const currentTree = trees[0];

    // Verifies the tree by setting is_verified to 1
    await connection.query('UPDATE trees SET is_verified = 1 WHERE tree_id = ?', [treeId]);

    // Insert a record into tree_updates to log the verification
    await connection.query(
      `INSERT INTO tree_updates (tree_id, user_id, species_id, age_id, condition_id, notes, status, submitted_at) VALUES (?, ?, ?, ?, ?, ?, 'approved', NOW())`,
      [treeId, adminUserId, currentTree.species_id, currentTree.age_id, currentTree.condition_id, "Verified by Admin."]
    );

    // Create a notification for the user who submitted the tree
    const [observations] = await connection.query(
      'SELECT user_id FROM user_observations WHERE tree_id = ? ORDER BY observation_id ASC LIMIT 1',
      [treeId]
    );

    // If there are observations, create a notification for the first user who submitted the tree
    if (observations.length > 0) {
      await createNotification({
        user_id: observations[0].user_id,
        tree_id: treeId,
        message: `Your tree submission (#${treeId}) has been reviewed and verified by an admin.`,
        type: 'tree_verified',
        db: connection
      });
    }

    // Commit the transaction
    await connection.commit();
    return { success: true };
  } catch (err) {
    await connection.rollback();
    console.error(`Error in verifyTree function for tree ID ${treeId}:`, err);
    return { success: false, error: err };
  } finally {
    if (connection) connection.release();
  }
}

/*==================================*/
// Admin Routes //
/*==================================*/


// Route to get the admin dashboard
router.get('/dashboard', isAdmin, async (req, res) => {
  res.render('admin_dashboard', {
    user: req.session.user
  });
});

// Route to get management page for all trees
router.get('/trees', isAdmin, async (req, res) => {
  try {
    // Extract query parameters for filtering, sorting, and pagination
    const { is_verified, species, tree_id, page = 1, sortBy = 'tree_id', sortOrder = 'DESC' } = req.query;
    const itemsPerPage = 15;
    const offset = (page - 1) * itemsPerPage;

    // --- Build Filter Clause ---
    const whereClauses = [];
    const queryParams = [];
    if (is_verified && ['0', '1'].includes(is_verified)) { whereClauses.push('t.is_verified = ?'); queryParams.push(is_verified); }
    if (species) { whereClauses.push('t.species_id = ?'); queryParams.push(species); }
    if (tree_id) { whereClauses.push('t.tree_id = ?'); queryParams.push(tree_id); }
    const whereSQL = whereClauses.length ? 'WHERE ' + whereClauses.join(' AND ') : '';

    // --- Dynamically Build Query Parts for Sorting ---
    let selectSQL = 'SELECT t.tree_id, t.is_verified, s.common_name, c.condition_level, a.age_desc, t.created_at';
    let joinSQL = `
        LEFT JOIN species s ON t.species_id = s.species_id
        LEFT JOIN tree_condition c ON t.condition_id = c.condition_id
        LEFT JOIN age a ON t.age_id = a.age_id`;
    let groupSQL = '';
    
    const sortableColumns = {
        tree_id: 't.tree_id',
        species: 's.common_name',
        created_at: 't.created_at',
        status: 't.is_verified',
        recent_update: 'last_update_time' // Add new sort key
    };

    // If sorting by recent updates, modify the query to get the latest update time
    if (sortBy === 'recent_update') {
        selectSQL += ', MAX(tu.submitted_at) as last_update_time';
        joinSQL += ' LEFT JOIN tree_updates tu ON t.tree_id = tu.tree_id';
        // Group by all non-aggregated columns to get one row per tree
        groupSQL = 'GROUP BY t.tree_id, s.common_name, c.condition_level, a.age_desc';
    }

    // --- Build Final Query ---
    const sortColumn = sortableColumns[sortBy] || 't.tree_id';
    const order = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const orderBySQL = `ORDER BY ${sortColumn} ${order}`;

    const treesQuery = `
       ${selectSQL}
       FROM trees t
       ${joinSQL}
       ${whereSQL}
       ${groupSQL}
       ${orderBySQL}
       LIMIT ? OFFSET ?`;

    const [trees] = await db.promise().query(treesQuery, [...queryParams, itemsPerPage, offset]);

    // Count total trees for pagination (this query remains simple)
    const [countResult] = await db.promise().query(`SELECT COUNT(*) AS total FROM trees t ${whereSQL}`, queryParams);
    const totalCount = countResult[0].total;
    const totalPages = Math.ceil(totalCount / itemsPerPage);

    // Fetch lists for filter dropdowns (remains the same)
    const [commonNameList] = await db.promise().query(`
        SELECT common_name FROM species 
        WHERE common_name IS NOT NULL AND common_name != '' 
        GROUP BY common_name ORDER BY common_name ASC
    `);
    const [fullSpeciesList] = await db.promise().query(
      'SELECT species_id, common_name, botanical_name FROM species ORDER BY common_name, botanical_name ASC'
    );

    // Render the page with all necessary data
    res.render('admin_tree_management', {
      trees,
      currentPage: parseInt(page),
      totalPages,
      commonNameList,
      fullSpeciesList,
      selectedStatus: is_verified || '',
      selectedSpecies: species || '',
      searchId: tree_id || '',
      sortBy,
      sortOrder
    });

  } catch (err) {
    console.error('Error fetching tree management data:', err);
    res.status(500).send('Server Error');
  }
});

//Route allowing admins to see a detailed view of a specific tree
router.get('/tree/:id', isAdmin, async (req, res) => {
  const treeId = req.params.id;

  try {
    const [rows] = await db.promise().query(`
      SELECT 
        t.*,
        s.common_name AS species_name,
        s.botanical_name, -- <<< ADD THIS LINE
        a.age_desc,
        d.description_notes,
        v.vigour_level,
        c.condition_level,
        ts.surround_type,
        l.latitude,
        l.longitude
        -- Note: Image is handled separately or not needed here for the main details
      FROM trees t
      LEFT JOIN species s ON t.species_id = s.species_id
      LEFT JOIN age a ON t.age_id = a.age_id
      LEFT JOIN description d ON t.description_id = d.description_id
      LEFT JOIN tree_vigour v ON t.vigour_id = v.vigour_id
      LEFT JOIN tree_condition c ON t.condition_id = c.condition_id
      LEFT JOIN tree_surround_type ts ON t.surround_id = ts.surround_id
      LEFT JOIN location l ON t.location_id = l.location_id
      WHERE t.tree_id = ?
    `, [treeId]);

    if (rows.length === 0) {
      return res.status(404).send('Tree not found.');
    }
    
    // Fetch images separately to handle multiple images per tree
     const [images] = await db.promise().query(
      `
      (SELECT image_url FROM image_metadata WHERE tree_id = ?)
      UNION
      (SELECT im.image_url FROM image_metadata im JOIN tree_updates tu ON im.update_id = tu.update_id WHERE tu.tree_id = ?)
      `,
      [treeId, treeId]
    );

    const treeData = rows[0];
    treeData.images = images; // Attach images to the tree object

    res.render('admin_tree_details', { tree: treeData });
  } catch (err) {
    console.error('Error fetching tree details:', err);
    res.status(500).send('Failed to fetch tree details.');
  }
});

// GET page to show the form for editing a single tree
router.get('/edit-tree/:id', isAdmin, async (req, res, next) => {
  const treeId = req.params.id;
  try {
    // Fetch the tree details along with its location
    const [[tree]] = await db.promise().query(`
            SELECT t.*, l.latitude, l.longitude
            FROM trees t
            LEFT JOIN location l ON t.location_id = l.location_id
            WHERE t.tree_id = ?
        `, [treeId]);

    if (!tree) {
      req.flash('error', 'Tree not found.');
      return res.redirect('/admin/trees');
    }

    // 1. Fetch UNIQUE common names for the main species dropdown
    const [speciesList] = await db.promise().query(
      `SELECT MIN(species_id) as species_id, common_name 
             FROM species 
             WHERE common_name IS NOT NULL AND common_name != '' 
             GROUP BY common_name 
             ORDER BY common_name ASC`
    );

    // 2. Fetch ALL species (including botanical names) for the new subspecies dropdown
    const [subspeciesList] = await db.promise().query(
      'SELECT species_id, common_name, botanical_name FROM species ORDER BY common_name, botanical_name ASC'
    );

    const [ageList] = await db.promise().query('SELECT age_id, age_desc FROM age ORDER BY age_desc ASC');
    const [conditionList] = await db.promise().query('SELECT condition_id, condition_level FROM tree_condition ORDER BY condition_level ASC');

    res.render('admin_edit_tree', {
      tree,
      speciesList,
      subspeciesList, // Pass the new list to the template
      ageList,
      conditionList,
      error: req.flash('error'),
      success: req.flash('success')
    });
  } catch (err) {
    next(err);
  }
});

// POST updated data for a tree
router.post('/edit-tree/:id', isAdmin, async (req, res, next) => {
  const treeId = req.params.id;
  const { species_id, age_id, condition_id, latitude, longitude, notes } = req.body;

  // Basic validation
  if (!species_id || !age_id || !condition_id || !latitude || !longitude) {
    req.flash('error', 'All fields except Notes are required.');
    return res.redirect(`/admin/edit-tree/${treeId}`);
  }

  const connection = await db.promise().getConnection();
  try {
    await connection.beginTransaction();

    // Find or create the location record
    let [location] = await connection.query('SELECT location_id FROM location WHERE latitude = ? AND longitude = ?', [latitude, longitude]);
    let locationId;
    if (location.length > 0) {
      locationId = location[0].location_id;
    } else {
      const [result] = await connection.query('INSERT INTO location (latitude, longitude) VALUES (?, ?)', [latitude, longitude]);
      locationId = result.insertId;
    }

    // Update the tree record
    await connection.query(
      `UPDATE trees SET species_id = ?, age_id = ?, condition_id = ?, location_id = ?, notes = ? WHERE tree_id = ?`,
      [species_id, age_id, condition_id, locationId, notes || null, treeId]
    );

    await connection.commit();

    req.flash('success', `Tree #${treeId} updated successfully.`);
    res.redirect(`/admin/tree/${treeId}`); // Redirect to the details page to see changes
  } catch (err) {
    await connection.rollback();
    req.flash('error', 'Failed to update tree due to a server error.');
    res.redirect(`/admin/edit-tree/${treeId}`);
  } finally {
    if (connection) connection.release();
  }
});

// Route to delete a tree and all associated data, requires admin permission
router.delete('/trees/:id', isAdmin, async (req, res) => {
  const treeId = req.params.id;
  const connection = await db.promise().getConnection();

  try {
    await connection.beginTransaction();

    // Delete from all child tables first to avoid foreign key constraints
    await connection.query('DELETE FROM update_votes WHERE update_id IN (SELECT update_id FROM tree_updates WHERE tree_id = ?)', [treeId]);
    await connection.query('DELETE FROM tree_updates WHERE tree_id = ?', [treeId]);
    await connection.query('DELETE FROM image_metadata WHERE tree_id = ?', [treeId]);
    await connection.query('DELETE FROM user_notifications WHERE tree_id = ?', [treeId]);
    await connection.query('DELETE FROM user_observations WHERE tree_id = ?', [treeId]);
    await connection.query('DELETE FROM pinged_trees WHERE tree_id = ?', [treeId]);

    // Finally, delete the tree itself
    const [result] = await connection.query('DELETE FROM trees WHERE tree_id = ?', [treeId]);

    await connection.commit();

    //Success response
    if (result.affectedRows > 0) {
      res.json({ success: true, message: 'Tree deleted successfully.' });
    } else {
      // Message if the tree was not found
      res.status(404).json({ success: false, message: 'Tree not found.' });
    }
    //Error response
  } catch (err) {
    await connection.rollback();
    console.error(`Error deleting tree ID ${treeId}:`, err);
    res.status(500).json({ success: false, message: 'Failed to delete tree.' });
  } finally {
    if (connection) connection.release();
  }
});

// Route to allow admins to verify a tree
router.post('/verify/:id', isAdmin, async (req, res) => {
  const treeId = req.params.id;
  const adminUserId = req.session.user.user_id;
  const result = await verifyTree(treeId, adminUserId);
  if (result.success) {
    res.redirect('/admin/trees');
  } else {
    res.status(500).send('Failed to verify tree. The operation was rolled back.');
  }
});

// Route to allow admins to un-verify a tree
router.post('/unverify/:id', isAdmin, async (req, res) => {
  const treeId = req.params.id;
  try {
    // Set the is_verified flag back to 0 for the given tree ID
    await db.promise().query(
      'UPDATE trees SET is_verified = 0 WHERE tree_id = ?',
      [treeId]
    );

    // Success response
    req.flash('success', `Tree #${treeId} has been successfully marked as un-verified.`);
    res.redirect('/admin/trees');
  } catch (err) {
    //Error response
    console.error(`Error un-verifying tree ID ${treeId}:`, err);
    req.flash('error', 'An error occurred while trying to un-verify the tree.');
    res.redirect('/admin/trees');
  }
});

// POST route to handle pinging a tree
router.post('/ping-tree/:treeId', isAdmin, async (req, res) => {
  const treeId = req.params.treeId;
  const userId = req.session.user.user_id; // Admin's ID who is sending the ping

  try {
    // Inserts tree into pinged_trees table
    await db.promise().query(
      `INSERT INTO pinged_trees (tree_id, user_id) VALUES (?, ?)`,
      [treeId, userId]
    );

    req.flash('success', `Ping sent successfully for Tree #${treeId}.`);

    // Redirect to the trees management page
    res.redirect('/admin/trees');

  } catch (err) {
    console.error('Error pinging tree:', err);
    // Add a flash error message for better user feedback
    req.flash('error', `Failed to send ping for Tree #${treeId}.`);
    res.redirect('/admin/trees');
  }
});

/*==================================*/
// Tree Update Routes //
/*==================================*/

// GET route to view all tree update suggestions
router.get('/tree-updates', isAdmin, async (req, res) => {
  try {
    const [updates] = await db.promise().query(`
      SELECT 
        tu.update_id, tu.tree_id, tu.notes, tu.submitted_at,
        tu.upvotes, tu.downvotes, tu.status,       
        tu.ai_decision, tu.ai_justification,
        tu.ai_confidence,  
        tu.tree_height_m, tu.spread_radius_m, tu.diameter_cm, -- Expert fields
        u.user_name, 
        s.common_name, s.botanical_name, -- Both species names
        a.age_desc, 
        c.condition_level,
        sur.surround_type -- Expert field
      FROM tree_updates tu
      LEFT JOIN user_info u ON tu.user_id = u.user_id
      LEFT JOIN species s ON tu.species_id = s.species_id
      LEFT JOIN age a ON tu.age_id = a.age_id
      LEFT JOIN tree_condition c ON tu.condition_id = c.condition_id
      LEFT JOIN tree_surround_type sur ON tu.surround_id = sur.surround_id -- JOIN
      ORDER BY tu.submitted_at DESC;
    `);
    res.render('admin_tree_updates', { user: req.session.user, updates });
  } catch (err) {
    console.error('Error fetching update suggestions:', err);
    res.status(500).send('Server error');
  }
});


// POST route to approve a tree update
router.post('/tree-updates/:id/approve', isAdmin, async (req, res) => {

  // Get the update ID from the request parameters
  const updateId = req.params.id;

  const connection = await db.promise().getConnection();
  try {
    await connection.beginTransaction();

    // Selects the update details from the tree_updates table
    const [[update]] = await connection.query(
      'SELECT * FROM tree_updates WHERE update_id = ?',
      [updateId]
    );

    // If the update does not exist, rollback the transaction and return a 404 error
    if (!update) {
      await connection.rollback();
      return res.status(404).send('Update not found');
    }

    // Dynamically builds the set part of the update query
    const fieldsToUpdate = {};
    if (update.species_id) fieldsToUpdate.species_id = update.species_id;
    if (update.age_id) fieldsToUpdate.age_id = update.age_id;
    if (update.condition_id) fieldsToUpdate.condition_id = update.condition_id;
    if (update.notes) fieldsToUpdate.notes = update.notes;
    if (update.diameter_cm) fieldsToUpdate.diameter_cm = update.diameter_cm;
    if (update.spread_radius_m) fieldsToUpdate.spread_radius_m = update.spread_radius_m;
    if (update.tree_height_m) fieldsToUpdate.tree_height_m = update.tree_height_m;
    if (update.surround_id) fieldsToUpdate.surround_id = update.surround_id;
    
    // Add the timestamp automatically
    fieldsToUpdate.updated_at = new Date();

    // Only run the update query if there are actually fields to update
    if (Object.keys(fieldsToUpdate).length > 0) {
        await connection.query(
            'UPDATE trees SET ? WHERE tree_id = ?',
            [fieldsToUpdate, update.tree_id]
        );
    }

    // Updates the status of the tree update to 'approved' and set processed_by to 'human'
    await connection.query(
      `UPDATE tree_updates SET status = 'approved', processed_by = 'human' WHERE update_id = ?`,
      [updateId]
    );

    // Updates image_metadata to associated new images with the main tree_id
    await connection.query(
      `UPDATE image_metadata SET tree_id = ? WHERE update_id = ?`,
      [update.tree_id, updateId]
    );

    // Creates notification
    await createNotification({
      user_id: update.user_id,
      tree_id: update.tree_id,
      message: 'Your suggested tree update has been approved by an admin.',
      type: 'update_approved',
      db: connection 
    });

    await connection.commit();
    res.redirect('/admin/tree-updates');

  } catch (err) {
    await connection.rollback();
    console.error('Error approving update:', err);
    res.status(500).send('Server error');
  } finally {
    if (connection) connection.release();
  }
});


// POST route to reject a tree update
router.post('/tree-updates/:id/reject', isAdmin, async (req, res) => {
  // Get the update ID from the request parameters
  const updateId = req.params.id;
  const connection = await db.promise().getConnection(); 
  try {
    await connection.beginTransaction();

    // Check if the update exists
    await connection.query(
      `UPDATE tree_updates SET status = 'rejected', processed_by = 'human' WHERE update_id = ?`,
      [updateId]
    );

    const [[update]] = await connection.query(
      'SELECT tree_id, user_id FROM tree_updates WHERE update_id = ?',
      [updateId]
    );

    // Rejects the update by setting its status to 'rejected'
    if (update) {
      await createNotification({
        user_id: update.user_id,
        tree_id: update.tree_id,
        message: 'Your suggested tree update has been rejected by an admin.',
        type: 'update_rejected',
        db: connection // Pass the transaction connection
      });
    }

    //Commits and redirects to the tree updates page
    await connection.commit();
    res.redirect('/admin/tree-updates');
  } catch (err) {
    await connection.rollback();
    console.error('Error rejecting update:', err);
    res.status(500).send('Server error');
  } finally {
    if (connection) connection.release();
  }
});

// GET route to view images associated with a tree update
router.get('/tree-updates/:updateId/images', isAdmin, async (req, res) => {
  const { updateId } = req.params;
  try {
    //Selects the image URLs from the image_metadata table for the given update ID
    const [rows] = await db.promise().query(
      'SELECT image_url FROM image_metadata WHERE update_id = ?',
      [updateId]
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching update images:', err);
    res.status(500).json({ error: 'Failed to fetch update images' });
  }
});

// Admin route to compare a specific update with the current tree data
router.get('/compare-update/:updateId', isAdmin, async (req, res) => {
  const { updateId } = req.params;
  try {
    // Get suggested update data from 'tree_updates'
    const [[suggested]] = await db.promise().query(`
      SELECT 
        tu.tree_id, tu.notes,
        s.common_name AS species_name, s.botanical_name,
        a.age_desc, c.condition_level, sur.surround_type,
        tu.tree_height_m, tu.spread_radius_m, tu.diameter_cm
      FROM tree_updates tu
      LEFT JOIN species s ON tu.species_id = s.species_id
      LEFT JOIN age a ON tu.age_id = a.age_id
      LEFT JOIN tree_condition c ON tu.condition_id = c.condition_id
      LEFT JOIN tree_surround_type sur ON tu.surround_id = sur.surround_id
      WHERE tu.update_id = ?
    `, [updateId]);

    if (!suggested) {
      return res.status(404).json({ error: 'Update not found.' });
    }

    // Get current tree data from 'trees'
    const [[current]] = await db.promise().query(`
      SELECT 
        t.notes,
        s.common_name AS species_name, s.botanical_name,
        a.age_desc, c.condition_level, sur.surround_type,
        t.tree_height_m, t.spread_radius_m, t.diameter_cm
      FROM trees t
      LEFT JOIN species s ON t.species_id = s.species_id
      LEFT JOIN age a ON t.age_id = a.age_id
      LEFT JOIN tree_condition c ON t.condition_id = c.condition_id
      LEFT JOIN tree_surround_type sur ON t.surround_id = sur.surround_id
      WHERE t.tree_id = ?
    `, [suggested.tree_id]);

    // Get images for this specific update
    const [images] = await db.promise().query(
      'SELECT image_url FROM image_metadata WHERE update_id = ?',
      [updateId]
    );

    res.json({ current, suggested, images });

  } catch (err) {
    console.error('Error fetching comparison data:', err);
    res.status(500).json({ error: 'Server error' });
  }
});


/*==================================*/
// AI & Data Proccessing //
/*==================================*/

// Admin route to trigger AI for all pending updates 
router.post('/trigger-ai-all', isAdmin, async (req, res) => {
  try {
    const [pendingUpdates] = await db.promise().query(
      "SELECT update_id FROM tree_updates WHERE status = 'pending'"
    );

    if (pendingUpdates.length === 0) {
      return res.json({ message: 'No pending updates to process.' });
    }

    // Imports the processAIVerification function from the AI module
    pendingUpdates.forEach(update => {
      processAIVerification(update.update_id);
    });

    res.json({ message: `AI processing initiated for ${pendingUpdates.length} update(s).` });

  } catch (err) {
    console.error('Error triggering all AI processes:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET - CSV Upload Page
router.get('/csv-upload', isAdmin, (req, res) => {
  res.render('admin_csv_upload', {
    error: req.flash('error'),
    success: req.flash('success')
  });
});

// POST - Handle the CSV file upload and processing
router.post('/csv-upload', isAdmin, upload.single('csvFile'), async (req, res) => {
  if (!req.file) {
    req.flash('error', 'No file was uploaded. Please select a CSV file.');
    return res.redirect('/admin/csv-upload');
  }

  //
  const results = [];
  const filePath = req.file.path;
  const connection = await db.promise().getConnection();

  // Read the CSV file and parse it
  fs.createReadStream(filePath)
    .pipe(csv())
    .on('data', (data) => results.push(data))
    .on('end', async () => {
      try {
        await connection.beginTransaction();

        // Validate the CSV structure
        let rowNumber = 1;
        for (const row of results) {
          rowNumber++;

          // Trim whitespace from all relevant text fields from the CSV
          const commonName = row.common_name?.trim();
          const ageDesc = row.age_desc?.trim();
          const conditionLevel = row.condition_level?.trim();
          const latitude = row.latitude?.trim();
          const longitude = row.longitude?.trim();

          if (!commonName || !ageDesc || !conditionLevel || !latitude || !longitude) {
            throw new Error(`Row ${rowNumber}: Missing one or more required text fields (common_name, age_desc, condition_level, lat, lng).`);
          }

          // Find Foreign Key IDs using case-insensitive and trimmed values
          const [[species]] = await connection.query('SELECT species_id FROM species WHERE LOWER(common_name) = LOWER(?)', [commonName]);
          const [[age]] = await connection.query('SELECT age_id FROM age WHERE LOWER(age_desc) = LOWER(?)', [ageDesc]);
          const [[condition]] = await connection.query('SELECT condition_id FROM tree_condition WHERE LOWER(condition_level) = LOWER(?)', [conditionLevel]);

          // Find or create Location ID
          const [[loc]] = await connection.query('SELECT location_id FROM location WHERE latitude = ? AND longitude = ?', [latitude, longitude]);
          let locationId = loc ? loc.location_id : (await connection.query('INSERT INTO location (latitude, longitude) VALUES (?, ?)', [latitude, longitude]))[0].insertId;

          // Improved validation with a clearer error message
          if (!species) throw new Error(`Row ${rowNumber}: Could not find a matching species for "${commonName}".`);
          if (!age) throw new Error(`Row ${rowNumber}: Could not find a matching age for "${ageDesc}".`);
          if (!condition) throw new Error(`Row ${rowNumber}: Could not find a matching condition for "${conditionLevel}".`);


          // Insert the tree record
          await connection.query(
            `INSERT INTO trees (species_id, age_id, condition_id, location_id, notes, is_verified, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [species.species_id, age.age_id, condition.condition_id, locationId, row.notes, row.is_verified, new Date(row.created_at)]
          );
        }

        // Commit the transaction if all rows are processed successfully
        await connection.commit();
        req.flash('success', `${results.length} trees have been successfully imported.`);
      } catch (err) {
        // Rollback the transaction in case of any error
        await connection.rollback();
        console.error('CSV Import Error:', err);
        req.flash('error', `Import failed: ${err.message}`); // Give the specific error to the user
      } finally {
        // Release the connection back to the pool
        connection.release();
        fs.unlinkSync(filePath);
        res.redirect('/admin/csv-upload');
      }
    });
});

/*==================================*/
// Reporting Routes //
/*==================================*/

// GET route to view admin reports
router.get('/reports', isAdmin, async (req, res) => {
  try {
    // Fetch species statistics and condition totals
    const [speciesStats] = await db.promise().query(`
        SELECT
          s.common_name AS species,
          COUNT(t.tree_id) AS total_count,
          SUM(CASE WHEN t.is_verified = 1 THEN 1 ELSE 0 END) AS total_verified,
          SUM(CASE WHEN t.is_verified = 0 THEN 1 ELSE 0 END) AS total_unverified,
          ROUND(AVG(t.diameter_cm), 1) AS avg_diameter_cm,
          ROUND(AVG(t.spread_radius_m), 1) AS avg_spread_m,
          ROUND(AVG(t.tree_height_m), 1) AS avg_height_m,
          SUM(CASE WHEN c.condition_level IN ('Fair', 'Good') THEN 1 ELSE 0 END) AS condition_fair_or_above,
          SUM(CASE WHEN c.condition_level IN ('Poor', 'Very Poor', 'Dead', 'Dying') THEN 1 ELSE 0 END) AS condition_below_fair,
          SUM(CASE WHEN c.condition_level IS NULL OR c.condition_level = 'Not Recorded' THEN 1 ELSE 0 END) AS condition_not_recorded
        FROM trees t
        JOIN species s ON t.species_id = s.species_id
        LEFT JOIN tree_condition c ON t.condition_id = c.condition_id
        WHERE s.common_name IS NOT NULL AND s.common_name != ''
        GROUP BY s.common_name
        ORDER BY total_count DESC
      `);

    // Fetch totals for tree conditions
    const [[conditionTotals]] = await db.promise().query(`
          SELECT
            SUM(CASE WHEN c.condition_level IN ('Fair', 'Good') THEN 1 ELSE 0 END) AS fair_or_above,
            SUM(CASE WHEN c.condition_level IN ('Poor', 'Very Poor', 'Dead', 'Dying') THEN 1 ELSE 0 END) AS below_fair,
            SUM(CASE WHEN c.condition_level IS NULL OR c.condition_level = 'Not Recorded' THEN 1 ELSE 0 END) AS not_recorded
          FROM trees t
          LEFT JOIN tree_condition c ON t.condition_id = c.condition_id
        `);


    //Renders the admin reports page with the fetched data
    res.render('admin_reports', {
      user: req.session.user,
      speciesStats,
      conditionTotals
    });
  } catch (err) {
    //Error response
    console.error('Error generating report:', err);
    res.status(500).send('Failed to load report');
  }
});

// GET route to fetch report data for trees based on various filters
router.get('/reports/data', isAdmin, async (req, res, next) => {
  const { species_id, condition_id, is_verified, age_id, startDate, endDate } = req.query;

  const whereClauses = [];
  const queryParams = [];

  // Build the SQL query to fetch tree data based on the provided filters
  let query = `
    SELECT 
      t.tree_id, s.common_name, s.botanical_name, a.age_desc,
      c.condition_level, v.vigour_level, l.latitude, l.longitude,
      t.notes, t.created_at, t.is_verified, t.tree_height_m,
      t.spread_radius_m, t.diameter_cm
    FROM trees t
    LEFT JOIN species s ON t.species_id = s.species_id
    LEFT JOIN age a ON t.age_id = a.age_id
    LEFT JOIN tree_condition c ON t.condition_id = c.condition_id
    LEFT JOIN tree_vigour v ON t.vigour_id = v.vigour_id
    LEFT JOIN location l ON t.location_id = l.location_id
  `;

  // Add filters to the WHERE clause based on the provided query parameters
  if (species_id) { whereClauses.push("t.species_id = ?"); queryParams.push(species_id); }
  if (condition_id) { whereClauses.push("t.condition_id = ?"); queryParams.push(condition_id); }
  if (is_verified) { whereClauses.push("t.is_verified = ?"); queryParams.push(is_verified); }
  if (age_id) { whereClauses.push("t.age_id = ?"); queryParams.push(age_id); }
  if (startDate) { whereClauses.push("DATE(t.created_at) >= ?"); queryParams.push(startDate); }
  if (endDate) { whereClauses.push("DATE(t.created_at) <= ?"); queryParams.push(endDate); }

  if (whereClauses.length > 0) {
    query += " WHERE " + whereClauses.join(" AND ");
  }

  try {
    const [rows] = await db.promise().query(query, queryParams);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET route to download the report as a CSV file
router.get('/reports/download/csv', isAdmin, async (req, res, next) => {

  // Extract query parameters for filtering
  const { species_id, condition_id, is_verified, age_id, startDate, endDate } = req.query;
  const whereClauses = [];
  const queryParams = [];
  let query = `SELECT t.tree_id, s.common_name, s.botanical_name, a.age_desc, c.condition_level, v.vigour_level, t.tree_height_m, t.spread_radius_m, t.diameter_cm, l.latitude, l.longitude, t.notes, t.created_at, t.is_verified FROM trees t LEFT JOIN species s ON t.species_id = s.species_id LEFT JOIN age a ON t.age_id = a.age_id LEFT JOIN tree_condition c ON t.condition_id = c.condition_id LEFT JOIN tree_vigour v ON t.vigour_id = v.vigour_id LEFT JOIN location l ON t.location_id = l.location_id`;
  if (species_id) { whereClauses.push("t.species_id = ?"); queryParams.push(species_id); }
  if (condition_id) { whereClauses.push("t.condition_id = ?"); queryParams.push(condition_id); }
  if (is_verified) { whereClauses.push("t.is_verified = ?"); queryParams.push(is_verified); }
  if (age_id) { whereClauses.push("t.age_id = ?"); queryParams.push(age_id); }
  if (startDate) { whereClauses.push("DATE(t.created_at) >= ?"); queryParams.push(startDate); }
  if (endDate) { whereClauses.push("DATE(t.created_at) <= ?"); queryParams.push(endDate); }
  if (whereClauses.length > 0) { query += " WHERE " + whereClauses.join(" AND "); }

  
  try {
    // Execute the query to fetch the data
    const [rows] = await db.promise().query(query, queryParams);
    const fields = ['tree_id', 'common_name', 'botanical_name', 'age_desc', 'condition_level', 'vigour_level', 'tree_height_m', 'spread_radius_m', 'diameter_cm', 'latitude', 'longitude', 'notes', 'created_at', 'is_verified'];
    const parser = new Parser({ fields });
    const csv = parser.parse(rows);
    res.header('Content-Type', 'text/csv');
    res.attachment('tree_report.csv');
    res.send(csv);
  } catch (err) {
    next(err);
  }
});

module.exports = router;