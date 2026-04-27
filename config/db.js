// This file sets up a connection pool to a MySQL database using the mysql2 library
const mysql = require('mysql2');

// Define base database configuration in a variable.
const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: '',
  // Default Development database
  database: 'belfast_trees_db', 
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

// Check the environment variable, if it is set to test, change the database to test version
if (process.env.NODE_ENV === 'test') {
  console.log('NODE_ENV is "test", connecting to the TEST database.');
  dbConfig.database = 'treeapp_test'; 
}

// Establish the pool using test configuration
const pool = mysql.createPool(dbConfig);

// Setup a connection check and relay which database has been connected to
pool.getConnection((err, connection) => {
  if (err) {
    console.error('MySQL pool connection failed:', err);
  } else {
    // This log will let us know which database has been connected to
    console.log(`Connected to MySQL database (${dbConfig.database}) via pool.`);
    // Release the connection back to the pool
    connection.release(); 
  }
});


// Exports the pool for use in other parts of the application
module.exports = pool;