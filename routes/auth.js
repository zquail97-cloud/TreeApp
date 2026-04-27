/* auth.js */
// auth.js - Handles authentication routes for the application
const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Directs to the login page and handles login/logout functionality
router.get('/login', authController.showLogin);
router.post('/login', authController.login);
router.get('/logout', authController.logout);

//Routes for password management & recovery
router.get('/forgot-password', authController.showForgotPassword);
router.post('/forgot-password', authController.handleForgotPassword);
router.get('/reset/:token', authController.showResetPassword);
router.post('/reset/:token', authController.handleResetPassword);

//Routes handling user registration
router.post('/signup', authController.signup);

// Exports the router to be used in the main app
module.exports = router;