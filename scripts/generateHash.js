/*
 * This script generates a hashed password using bcrypt.
 * It is intended to be run in a Node.js environment.
 */
const bcrypt = require('bcrypt');

// Generate a hashed password for the user 'admin' with the password 'admin123'
bcrypt.hash('admin123', 10).then(hash => {
  console.log('Hashed password:', hash);
});
