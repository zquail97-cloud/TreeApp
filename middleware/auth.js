// Middleware to check if a user is logged in and has the admin role
function isLoggedIn(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }

  // For API responses, return JSON
  if (req.originalUrl.startsWith('/api')) {
    return res.status(401).json({ error: 'User not authenticated' });
  }

  // For normal pages, redirect to login
  res.redirect('/auth/login');
}

function isAdmin(req, res, next) {
  if (req.session?.user?.role === 'admin') {
    return next();
  }
  return res.status(403).send('Forbidden: Admins only');
}

module.exports = {
  isLoggedIn,
  isAdmin
};
