//Handles user authentication, including login and logout functionality
//Import MySQL database connection and bcrypt for password hashing
const db = require('../config/db');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

// Displays the login page
exports.showLogin = (req, res) => {
  res.render('map_home', { user: null, error: null, flash: null, notifications: [] });
};


// Handle User Login
exports.login = (req, res) => {
  const { email, password } = req.body;

  // Looks up user in the database by email address
  db.query('SELECT * FROM user_info WHERE user_email = ?', [email], async (err, results) => {
    if (err) throw err;

    // If no user is found with the provided email, show an error message on map_home page
    if (results.length === 0) {
      return res.render('map_home', {
        user: null,
        error: 'No account found with that email.',
        notifications: []
      });

    }

    const user = results[0];

    // Check is user or password is missing, if so, render the map_home page with an error message
    if (!password || !user.user_password) {
      return res.render('map_home', {
        user: null,
        error: 'Invalid login credentials.',
        notifications: []
      });

    }

    //Use bcrypt to compare the provided password with the stored hashed password
    const match = await bcrypt.compare(password, user.user_password);

    // If the password does not match, render the map_home page with an error message
    if (!match) {
      return res.render('map_home', {
        user: null,
        error: 'Incorrect password. Please try again.',
        notifications: []
      });
    }

    // Store user information in the session to keep the user logged in
    req.session.user = {
      user_id: user.user_id,
      email: user.user_email,
      name: user.user_name,
      role: user.role
    };

    // Redirect to the home page after successful login
    res.redirect('/');
  });
};

//  Handle User Logout 
exports.logout = (req, res) => {
  // Destroys the session to log the user out
  req.session.destroy(err => {
    if (err) {
      console.error('Session destruction error:', err);
      return res.redirect('/'); // fallback
    }
    res.redirect('/?flash=loggedOut');
  });
};

// **** Handle User Signup ****
exports.signup = async (req, res) => {
  const { username, email, password } = req.body;

  // Validate that all fields are filled in
  if (!username || !email || !password) {
    return res.render('map_home', { user: null, error: 'Please fill in all fields.', flash: null, notifications: [] });
  }

  try {
    // Hash the password using bcrypt
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert the new user into the database with default role as 'user'
    db.query(
      'INSERT INTO user_info (user_name, user_email, user_password, role) VALUES (?, ?, ?, ?)',
      [username, email, hashedPassword, 'user'],
      (err, result) => {
        if (err) {
          //Handle duplicate email registration
          if (err.code === 'ER_DUP_ENTRY') {
            return res.render('map_home', { user: null, error: 'That email is already registered.', flash: null, notifications: [] });
          }
          // Handle other errors relating to db insert problems
          console.error(err);
          return res.render('map_home', { user: null, error: 'Something went wrong. Please try again.', flash: null, notifications: [] });
        }

        // If the user is successfully created, redirect to the login page
        res.redirect('/auth/login');
      }
    );
  } catch (error) {
    //Catch errors during password hashing or database operations
    console.error(error);
    res.render('map_home', { user: null, error: 'An unexpected error occurred.', flash: null, notifications: [] });
  }
};

exports.showSignup = (req, res) => {
  res.render('map_home', { user: null, error: null, flash: null, notifications: [] });
};


// Render the forgot password form
exports.showForgotPassword = (req, res) => {
  res.render('forgot_password', { error: null, success: null });
};

// Handle password reset request
exports.handleForgotPassword = async (req, res) => {
  const { email } = req.body;

  try {
   
    const [users] = await db.promise().query(
        'SELECT * FROM user_info WHERE user_email = ?', 
        [email]
    );

    //Renders the forgot password page with a success message if a user with that email exists
    if (users.length === 0) {
      return res.render('forgot_password', { 
        success: 'If an account with that email exists, a reset link has been sent.', 
        error: null 
      });
    }
    const user = users[0];

    const token = crypto.randomBytes(32).toString('hex');

    const expires = new Date(Date.now() + 3600000); 

    // Update the user record with the reset token and expiration time
    await db.promise().query(
      'UPDATE user_info SET reset_token = ?, reset_expires = ? WHERE user_id = ?',
      [token, expires, user.user_id]
    );

    // Sends link via terminal, would be sent via email in real-world system
    const resetUrl = `http://localhost:3000/auth/reset/${token}`;
    console.log('=============================================');
    console.log('PASSWORD RESET LINK');
    console.log(resetUrl);
    console.log('=============================================');

    // Render the forgot password page with a success message
    res.render('forgot_password', { 
      success: 'If an account with that email exists, a reset link has been sent.', 
      error: null 
    });

  } catch (err) {
    console.error('Error in password reset:', err);
    res.render('forgot_password', { 
        error: 'Something went wrong. Please try again.', 
        success: null 
    });
  }
};

// Render the reset password form
exports.showResetPassword = async (req, res) => {
  const { token } = req.params;
  try {
    // Check if the token is valid and not expired
    const [rows] = await db.promise().query(
      `SELECT * FROM user_info WHERE reset_token = ? AND reset_expires > NOW()`, [token]
    );

    // If no user is found with the token, render the reset password form with an error
    if (rows.length === 0) {
      return res.render('reset_password', { error: 'Invalid or expired token.', token: null });
    }

    // Render the reset password form with the token
    res.render('reset_password', { error: null, token });
  } catch (err) {
    console.error(err);
    res.render('reset_password', { error: 'Error loading form.', token: null });
  }
};

// Handle the new password submission
exports.handleResetPassword = async (req, res) => {
  const { token } = req.params;
  const { new_password, confirm_password } = req.body;

  // Check if the new password and confirm password fields are filled in
  if (!new_password || !confirm_password) {
    return res.render('reset_password', { error: 'Please fill in all fields.', success: null });
  }

  // Return an error if the new password and confirm password do not match
  if (new_password !== confirm_password) {
    return res.render('reset_password', { error: 'Passwords do not match.', success: null });
  }

  // Hash the new password and update the user record
  try {
    const hashedPassword = await bcrypt.hash(new_password, 10);

    const [result] = await db.promise().query(
      `UPDATE user_info SET user_password = ?, reset_token = NULL, reset_expires = NULL 
       WHERE reset_token = ? AND reset_expires > NOW()`,
      [hashedPassword, token]
    );

    // If no rows were affected, the token is invalid or expired
    if (result.affectedRows === 0) {
      return res.render('reset_password', { error: 'Reset link is invalid or has expired.', success: null });
    }

    // If the password is successfully updated, render the reset password page with a success message
    res.render('reset_password', { success: 'Your password has been reset successfully.', error: null });
  } catch (err) {
    //Error message
    console.error('Error resetting password:', err);
    res.render('reset_password', { error: 'An error occurred while resetting your password.', success: null });
  }
};

