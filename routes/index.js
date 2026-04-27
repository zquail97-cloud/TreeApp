/* index.js */
// This file defines all of the public routes for the application. 
//It handles rendering the home page and managing user notifications, submissions, and inbox.

// Import necessary modules
const express = require('express');
const router = express.Router();
const db = require('../config/db'); // Ensure DB connection is imported


/*==================================*/
// Public & User Specific Routes //
/*==================================*/

// Route to render the home page
router.get('/', async (req, res) => {
  const flash = req.query.flash;
  const user = req.session.user || null;

  let notifications = [];

  // If user is logged in, fetch their notifications
  if (user) {
    const [rows] = await db.promise().query(
      'SELECT * FROM user_notifications WHERE user_id = ? AND is_read = FALSE',
      [user.user_id]
    );
    notifications = rows;
  }

  res.render('map_home', {
    user,
    error: null,
    flash: flash === 'loggedOut' ? 'You have successfully logged out.' : null,
    notifications
  });
});

// Route to handle notifications, renders the the 'notifications.ejs' page - which serves as the user's account management page.
// This page displays all notifications for the logged-in user.
router.get('/notifications', async (req, res) => {
  const userId = req.session.user?.user_id;
  if (!userId) return res.redirect('/login');

  try {
    const [notifications] = await db.promise().query(
      `SELECT * FROM user_notifications 
       WHERE user_id = ? 
       ORDER BY created_at DESC`,
      [userId]
    );

    res.render('notifications', {
      notifications,
      user: req.session.user 
    });
  } catch (err) {
    console.error('Error loading notifications:', err);
    res.status(500).send('Error loading notifications');
  }
});

// Route to show user's past submissions. Displays a list of trees submitted by the user.
router.get('/my-submissions', async (req, res) => {
  const userId = req.session.user?.user_id;
  if (!userId) return res.redirect('/login');

  try {
    const [trees] = await db.promise().query(
      `SELECT t.tree_id, t.species_id, s.common_name AS species_name, t.notes, t.created_at, t.is_verified
       FROM trees t
       JOIN user_observations uo ON t.tree_id = uo.tree_id
       LEFT JOIN species s ON t.species_id = s.species_id
       WHERE uo.user_id = ?
       ORDER BY t.created_at DESC`,
      [userId]
    );

    res.render('my_submissions', { trees });
  } catch (err) {
    console.error('Error loading user submissions:', err);
    res.status(500).send('Error loading submissions');
  }
});

// Route to handle the inbox
router.get('/inbox', async (req, res) => {
  const userId = req.session.user?.user_id;
  if (!userId) return res.redirect('/login');

  try {
    const [notifications] = await db.promise().query(
      `SELECT * FROM user_notifications 
       WHERE user_id = ? AND is_deleted = 0 
       ORDER BY created_at DESC`,
      [userId]
    );

    res.render('inbox', { notifications });
  } catch (err) {
    console.error('Error loading inbox:', err);
    res.status(500).send('Error loading inbox');
  }
});

// Route allowing users to view details of a specific tree they have submitted.
router.get('/my-submissions/:treeId', async (req, res) => {
  const userId = req.session.user?.user_id;
  const treeId = req.params.treeId;

  if (!userId) return res.redirect('/login');

  try {
    // Get the main tree data
    const [trees] = await db.promise().query(`
        SELECT t.tree_id, s.common_name AS species_name, s.botanical_name,
              a.age_desc, c.condition_level, sur.surround_type, t.notes, t.is_verified,
              l.latitude, l.longitude
          FROM trees t
          LEFT JOIN species s ON t.species_id = s.species_id
          LEFT JOIN age a ON t.age_id = a.age_id
          LEFT JOIN tree_condition c ON t.condition_id = c.condition_id
          LEFT JOIN tree_surround_type sur ON t.surround_id = sur.surround_id
          LEFT JOIN location l ON t.location_id = l.location_id
          JOIN user_observations uo ON t.tree_id = uo.tree_id
          WHERE t.tree_id = ? AND uo.user_id = ?
      `, [treeId, userId]);

    if (trees.length === 0) return res.status(404).send('Tree not found');

    // Fetch ALL associated images using the corrected, comprehensive query
    const [images] = await db.promise().query(
      `
      (SELECT image_url FROM image_metadata WHERE tree_id = ?)
      UNION
      (SELECT im.image_url FROM image_metadata im JOIN tree_updates tu ON im.update_id = tu.update_id WHERE tu.tree_id = ?)
      `,
      [treeId, treeId]
    );

    res.render('user_tree_details', { tree: { ...trees[0], images }, user: req.session.user });
  } catch (err) {
    console.error('Error loading tree details:', err);
    res.status(500).send('Server error');
  }
});

// Route to fetch the update history for a specific tree, showing all updates made to the tree, such as approved, pending and rejected updates.
router.get('/tree-history/:treeId', async (req, res) => {
  const treeId = req.params.treeId;

  try {
    const [history] = await db.promise().query(`
      SELECT tu.update_id, tu.tree_id, tu.notes, tu.status, tu.submitted_at,
             s.common_name AS species_name,
             a.age_desc,
             c.condition_level,
             u.user_name AS submitted_by
      FROM tree_updates tu
      LEFT JOIN species s ON tu.species_id = s.species_id
      LEFT JOIN age a ON tu.age_id = a.age_id
      LEFT JOIN tree_condition c ON tu.condition_id = c.condition_id
      LEFT JOIN user_info u ON tu.user_id = u.user_id
      WHERE tu.tree_id = ?
      ORDER BY tu.submitted_at DESC
    `, [treeId]);

    // Fetch associated image URLs for each update
    const [images] = await db.promise().query(
      `SELECT image_url, update_id FROM image_metadata WHERE tree_id = ?`,
      [treeId]
    );

    // Group images by update_id
    const imageMap = {};
    images.forEach(img => {
      if (!imageMap[img.update_id]) imageMap[img.update_id] = [];
      imageMap[img.update_id].push(img.image_url);
    });

    // Attach images to each history entry
    const historyWithImages = history.map(entry => ({
      ...entry,
      images: imageMap[entry.update_id] || []
    }));

    res.render('tree_history', { history: historyWithImages, treeId });
  } catch (err) {
    console.error('Error fetching tree history:', err);
    res.status(500).send('Server error');
  }
});


// Export the router to be used in the main app
module.exports = router;
