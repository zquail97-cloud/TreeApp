/* app.js */
// This is the main entry point for the TreeApp application.
// It sets up the Express server, loads environment variables, configures middleware, sets up view engine, mounts routes, and starts the server.


// Import required modules
require('dotenv').config();
const express = require('express');
const flash = require('connect-flash');
const session = require('express-session');
const mysqlStore = require('express-mysql-session')(session);
const path = require('path');
const db = require('./config/db');

//Initalize the Express application
const app = express();

/*==================================*/
// Route Handlers //
/*==================================*/

//Imports route hanlders from /routes
const authRoutes = require('./routes/auth');
const indexroutes = require('./routes/index');
const adminRoutes = require('./routes/admin');
const apiRoutes = require('./routes/api');

/*==================================*/
// Middleware Config //
/*==================================*/

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

//  Session middleware
const sessionStore = new mysqlStore({}, db);
app.use(session({
  key: 'treeapp_session',
  secret: process.env.SESSION_SECRET || 'treeapp_secret',
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
}));

// Flash middleware
app.use(flash());

// Make flash messages accessible in views
app.use((req, res, next) => {
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  next();
});

/*==================================*/
// View Engine Setup //
/*==================================*/

// Set the view engine to EJS
app.set('view engine', 'ejs');
// Set the views directory
app.set('views', path.join(__dirname, 'views'));


/*==================================*/
// Route Mounting //
/*==================================*/

// Routes
app.use('/api', apiRoutes);
app.use('/', indexroutes);
app.use('/auth', authRoutes);
app.use('/admin', adminRoutes);

/*==================================*/
// Server Init //
/*==================================*/

// Defines the port
const PORT = process.env.PORT || 3000;
let server; // Define server variable

// Check if the file is being run directly
if (require.main === module) {
  server = app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
}

module.exports = app;