// Main js test file that will be responsible for testing all api endpoints 

const request = require('supertest');
const app = require('../app');
const db = require('../config/db');
const bcrypt = require('bcryptjs');
const path = require('path');


// This is the main describe block for all tests
describe('API Routes', () => {

    // This beforeEach hook runs before every test
    beforeEach(async () => {
        const connection = await db.promise();

        // Before each it block in tests run, clear (breakdown) all relevant tables
        await connection.query('SET FOREIGN_KEY_CHECKS = 0');
        await connection.query('TRUNCATE TABLE trees');
        await connection.query('TRUNCATE TABLE species');
        await connection.query('TRUNCATE TABLE age');
        await connection.query('TRUNCATE TABLE tree_condition');
        await connection.query('TRUNCATE TABLE location');
        await connection.query('TRUNCATE TABLE user_info');
        await connection.query('TRUNCATE TABLE user_observations');
        await connection.query('TRUNCATE TABLE tree_updates');
        await connection.query('SET FOREIGN_KEY_CHECKS = 1');

        // Load hook's main testing data into each specified table
        await connection.query(`INSERT INTO species (species_id, common_name) VALUES (9990, 'Test Oak'), (9991, 'Test Maple');`);
        await connection.query(`INSERT INTO age (age_id, age_desc) VALUES (9990, 'Test Young'), (9991, 'Test Mature');`);
        await connection.query(`INSERT INTO tree_condition (condition_id, condition_level) VALUES (9990, 'Test Good'), (9991, 'Test Poor');`);
        await connection.query(`INSERT INTO location (location_id, latitude, longitude) VALUES (9990, 54.123, -5.456);`);
        await connection.query(
            `INSERT INTO trees (tree_id, species_id, age_id, condition_id, location_id, notes) VALUES (?, ?, ?, ?, ?, ?)`,
            [9999, 9990, 9990, 9990, 9990, 'A specific test tree.']
        );
    });

    // This afterAll hook runs once after all tests in this file are done
    afterAll(async () => {
        const connection = await db.promise();
        await connection.query('SET FOREIGN_KEY_CHECKS = 0');
        await connection.query('TRUNCATE TABLE trees');
        await connection.query('TRUNCATE TABLE species');
        await connection.query('TRUNCATE TABLE age');
        await connection.query('TRUNCATE TABLE tree_condition');
        await connection.query('TRUNCATE TABLE location');
        await connection.query('TRUNCATE TABLE user_info');
        await connection.query('TRUNCATE TABLE user_observations');
        await connection.query('TRUNCATE TABLE tree_updates');
        await connection.query('SET FOREIGN_KEY_CHECKS = 1');
        await connection.end();
    });

    // -------------------------- Tests for simple public GET routes --------------------------

    //Species
    describe('GET /api/species', () => {
        it('should return 200 OK and our 2 seeded species', async () => {
            const response = await request(app).get('/api/species');

            // Expect the status code to be 200 (OK)
            expect(response.statusCode).toBe(200);

            // Expect 2 results
            expect(response.body.length).toBe(2);

            // Expect a species ID
            expect(response.body[0]).toHaveProperty('species_id');

            //And a common name
            expect(response.body[0]).toHaveProperty('common_name');
        });
    });

    //Age
    describe('GET /api/age', () => {
        it('should return 200 OK and our 2 seeded ages', async () => {
            const response = await request(app).get('/api/age');
            expect(response.statusCode).toBe(200);
            expect(response.body.length).toBe(2);
        });
    });

    //Condition
    describe('GET /api/condition', () => {
        it('should return 200 OK and our 2 seeded conditions', async () => {
            const response = await request(app).get('/api/condition');
            expect(response.statusCode).toBe(200);
            expect(response.body.length).toBe(2);
        });
    });

    // -------------------------- Tests for GET with a parameter --------------------------

    // Verifies that GET api/trees/:id gets the correct tree data for the seeded ID
    describe('GET /api/trees/:id', () => {
        it('should return 200 OK and the correct tree data for a valid ID', async () => {
            const response = await request(app).get('/api/trees/9999');
            expect(response.statusCode).toBe(200);
            expect(response.body).toHaveProperty('tree_id', 9999);
            expect(response.body).toHaveProperty('common_name', 'Test Oak');
        });

        // If a non existent ID is passed return an error
        it('should return 404 Not Found for a non-existent ID', async () => {
            const response = await request(app).get('/api/trees/123456789');
            expect(response.statusCode).toBe(404);
            expect(response.body).toHaveProperty('error', 'Tree not found');
        });
    });

    // Tests that unathenticated users are not able to post data to the database
    describe('POST /api/trees', () => {

        describe('when user is not authenticated', () => {
            it('should return 401 Unauthorized', async () => {
                const response = await request(app).post('/api/trees').send({ species_id: 9990, age_id: 9990, condition_id: 9990, latitude: 54.597, longitude: -5.93 });
                expect(response.statusCode).toBe(401);
                expect(response.body.error).toBe('You must be logged in to submit data.');
            });

            // Checks that the unathenticated user's submitted tree record was not inserted
            it('should NOT add a tree to the database', async () => {
                await request(app).post('/api/trees').send({ species_id: 9990, age_id: 9990, condition_id: 9990, latitude: 54.597, longitude: -5.93 });
                const [rows] = await db.promise().query("SELECT COUNT(*) as count FROM trees WHERE tree_id != 9999");
                expect(rows[0].count).toBe(0);
            });
        });

        // Tests that users with valid credentials are able to post data to the database
        describe('when user is authenticated', () => {
            // This beforeEach only runs for tests inside this 'authenticated' describe block
            beforeEach(async () => {
                const hashedPassword = await bcrypt.hash('password123', 10);
                await db.promise().query(
                    `INSERT INTO user_info (user_id, user_name, user_email, user_password, role) VALUES (?, ?, ?, ?, ?)`,
                    [999, 'Test User', 'test@example.com', hashedPassword, 'user']
                );
            });

            // Checks that user with seeded login data was able to successfully submit their tree record into the database
            it('should return 200 OK and correctly create the tree in the database', async () => {
                const agent = request.agent(app);
                await agent.post('/auth/login').send({ email: 'test@example.com', password: 'password123' });

                const response = await agent.post('/api/trees').send({
                    species_id: 9991, age_id: 9991, condition_id: 9991,
                    latitude: 54.987, longitude: -5.654, notes: 'Authenticated test tree.'
                });

                expect(response.statusCode).toBe(200);
                expect(response.body).toHaveProperty('tree_id');

                const newTreeId = response.body.tree_id;
                const [rows] = await db.promise().query("SELECT * FROM trees WHERE tree_id = ?", [newTreeId]);
                expect(rows.length).toBe(1);
                expect(rows[0].notes).toBe('Authenticated test tree.');
            });
        });
    });

    // -------------------------- Voting Tests --------------------------

    describe('POST /api/updates/:id/vote', () => {

        let testUpdateId;
        let votingUserId;
        let votingUserAgent;

        // This beforeEach runs in addition to the top-level one
        // Use it to set up the specific data for these vote tests
        beforeEach(async () => {
            const connection = await db.promise();

            // Create a user to submit the update
            await connection.query(
                `INSERT INTO user_info (user_id, user_name, user_email, user_password, role) VALUES (?, ?, ?, ?, ?)`,
                [998, 'Update Owner', 'owner@example.com', 'hashedpassword', 'user']
            );

            // Create the update itself, linking it to the existing test tree (ID 9999)
            const [updateResult] = await connection.query(
                `INSERT INTO tree_updates (tree_id, user_id, species_id, age_id, condition_id, status) VALUES (?, ?, ?, ?, ?, ?)`,
                [9999, 998, 9991, 9991, 9991, 'pending']
            );
            testUpdateId = updateResult.insertId;

            // Create and log in a second user who will cast the vote
            const bcrypt = require('bcryptjs');
            const hashedPassword = await bcrypt.hash('password123', 10);
            const [userResult] = await connection.query(
                `INSERT INTO user_info (user_id, user_name, user_email, user_password, role) VALUES (?, ?, ?, ?, ?)`,
                [999, 'Voter User', 'voter@example.com', hashedPassword, 'user']
            );
            votingUserId = userResult.insertId;

            // Create an authenticated agent for the voting user
            votingUserAgent = request.agent(app);
            await votingUserAgent.post('/auth/login').send({ email: 'voter@example.com', password: 'password123' });
        });

        it('should return 401 Unauthorized if a user is not logged in', async () => {
            // Using the unauthenticated, seeded agent
            const response = await request(app)
                .post(`/api/updates/${testUpdateId}/vote`)
                .send({ vote: 'up' });

            expect(response.statusCode).toBe(401);
        });

        it('should correctly increment the upvote count when a logged-in user votes "up"', async () => {
            const response = await votingUserAgent // Using the authenticated agent
                .post(`/api/updates/${testUpdateId}/vote`)
                .send({ vote: 'up' });

            expect(response.statusCode).toBe(200);
            expect(response.body).toHaveProperty('upvotes', 1);
            expect(response.body).toHaveProperty('downvotes', 0);

            // Verify the change in the database directly
            const [[update]] = await db.promise().query("SELECT upvotes, downvotes FROM tree_updates WHERE update_id = ?", [testUpdateId]);
            expect(update.upvotes).toBe(1);
            expect(update.downvotes).toBe(0);
        });

        it('should correctly increment the downvote count when a logged-in user votes "down"', async () => {
            const response = await votingUserAgent
                .post(`/api/updates/${testUpdateId}/vote`)
                .send({ vote: 'down' });

            expect(response.statusCode).toBe(200);
            expect(response.body).toHaveProperty('upvotes', 0);
            expect(response.body).toHaveProperty('downvotes', 1);

            // Verify the change in the database
            const [[update]] = await db.promise().query("SELECT upvotes, downvotes FROM tree_updates WHERE update_id = ?", [testUpdateId]);
            expect(update.upvotes).toBe(0);
            expect(update.downvotes).toBe(1);
        });

        it('should allow a user to change their vote from up to down', async () => {
            // First, upvote
            await votingUserAgent
                .post(`/api/updates/${testUpdateId}/vote`)
                .send({ vote: 'up' });

            // Then, change vote to downvote
            const response = await votingUserAgent
                .post(`/api/updates/${testUpdateId}/vote`)
                .send({ vote: 'down' });

            expect(response.statusCode).toBe(200);
            expect(response.body).toHaveProperty('upvotes', 0);
            expect(response.body).toHaveProperty('downvotes', 1);

            // Verify the final state in the database
            const [[update]] = await db.promise().query("SELECT upvotes, downvotes FROM tree_updates WHERE update_id = ?", [testUpdateId]);
            expect(update.upvotes).toBe(0);
            expect(update.downvotes).toBe(1);
        });
    });

    // -------------------------- Deletion Tests --------------------------

    // This test will use three different levels of authorisation and attempt to delete tree records 
    // Test will verify that non-authorised, non-admin users are NOT able to delete tree records
    // Authorised admin users will be the only group with permission to execute this function
    describe('DELETE /api/trees/:id', () => {

        let regularUserAgent;
        let adminAgent;

        // Before each test in this block, create and log in two user types
        beforeEach(async () => {
            const bcrypt = require('bcryptjs');

            // Create a regular user and log them in
            const regularPassword = await bcrypt.hash('password123', 10);
            await db.promise().query(
                `INSERT INTO user_info (user_id, user_name, user_email, user_password, role) VALUES (?, ?, ?, ?, ?)`,
                [999, 'Regular User', 'user@example.com', regularPassword, 'user']
            );
            regularUserAgent = request.agent(app);
            await regularUserAgent.post('/auth/login').send({ email: 'user@example.com', password: 'password123' });

            // Create an admin user and log them in
            const adminPassword = await bcrypt.hash('adminpass', 10);
            await db.promise().query(
                `INSERT INTO user_info (user_id, user_name, user_email, user_password, role) VALUES (?, ?, ?, ?, ?)`,
                [998, 'Admin User', 'admin@example.com', adminPassword, 'admin']
            );
            adminAgent = request.agent(app);
            await adminAgent.post('/auth/login').send({ email: 'admin@example.com', password: 'adminpass' });
        });

        it('should return 401 Unauthorized if the user is not logged in', async () => {
            const response = await request(app).delete('/api/trees/9999');
            expect(response.statusCode).toBe(401);
            expect(response.body.error).toBe('User not authenticated'); // Match the middleware
        });

        it('should return 403 Forbidden if a regular user tries to delete a tree', async () => {
            // regularUserAgent is a seeded 'regular' (non-admin) user from the beforeEach hook
            const response = await regularUserAgent.delete('/api/trees/9999');
            //Expect a 403 forbidden
            expect(response.statusCode).toBe(403);
        });

        it('should return 200 OK and delete the tree if the user is an admin', async () => {
            const response = await adminAgent.delete('/api/trees/9999');
            expect(response.statusCode).toBe(200);
            expect(response.body).toHaveProperty('message', 'Tree and related data deleted successfully.');

            // Verify the tree was deleted from the database
            const [rows] = await db.promise().query("SELECT * FROM trees WHERE tree_id = 9999");
            expect(rows.length).toBe(0);
        });
    });

    // -------------------------- Update Tests --------------------------

    describe('PUT /api/trees/:id', () => {

        let regularUserAgent;
        let adminAgent;

        // This setup creates a regular user and an admin, then logs them in
        beforeEach(async () => {
            const bcrypt = require('bcryptjs');

            // Create and log in a regular user
            const regularPassword = await bcrypt.hash('password123', 10);
            await db.promise().query(
                `INSERT INTO user_info (user_id, user_name, user_email, user_password, role) VALUES (?, ?, ?, ?, ?)`,
                [999, 'Regular User', 'user@example.com', regularPassword, 'user']
            );
            regularUserAgent = request.agent(app);
            await regularUserAgent.post('/auth/login').send({ email: 'user@example.com', password: 'password123' });

            // Create and log in an admin user
            const adminPassword = await bcrypt.hash('adminpass', 10);
            await db.promise().query(
                `INSERT INTO user_info (user_id, user_name, user_email, user_password, role) VALUES (?, ?, ?, ?, ?)`,
                [998, 'Admin User', 'admin@example.com', adminPassword, 'admin']
            );
            adminAgent = request.agent(app);
            await adminAgent.post('/auth/login').send({ email: 'admin@example.com', password: 'adminpass' });
        });

        // The test data that is used to update the established seed data
        const updateData = {
            species_id: 9991, // Changing from Test Oak (9990) to Test Maple (9991)
            age_id: 9991,     // Changing from Test Young (9990) to Test Mature (9991)
            condition_id: 9991, // Changing from Test Good (9990) to Test Poor (9991)
            notes: 'This tree has been updated by a test.',
            latitude: 54.111, // Changing location
            longitude: -5.222
        };

        it('should return 401 Unauthorized if the user is not logged in', async () => {
            const response = await request(app).put('/api/trees/9999').send(updateData);
            expect(response.statusCode).toBe(401);
        });

        it('should return 403 Forbidden if a regular user tries to update a tree', async () => {

            const response = await regularUserAgent.put('/api/trees/9999').send(updateData);
            expect(response.statusCode).toBe(403);
        });

        it('should return 200 OK and update the tree if the user is an admin', async () => {
            const response = await adminAgent.put('/api/trees/9999').send(updateData);
            expect(response.statusCode).toBe(200);
            expect(response.body).toHaveProperty('success', true);
            expect(response.body).toHaveProperty('message', 'Tree updated successfully.');

            // Verify the data was actually changed in the database
            const [[updatedTree]] = await db.promise().query("SELECT * FROM trees WHERE tree_id = 9999");
            expect(updatedTree.species_id).toBe(9991); // Check if species was updated
            expect(updatedTree.age_id).toBe(9991);     // Check if age was updated
            expect(updatedTree.notes).toBe('This tree has been updated by a test.');
        });
    });

    // -------------------------- Data Filtering Tests --------------------------

    // This test will seed trees of different species, and with different conditions to verify that
    // the endpoint will return only the species requested and trees with the conditions chosen
    describe('GET /api/trees/search', () => {

        // Before these tests, add more specific trees to the database.
        beforeEach(async () => {
            const connection = await db.promise();
            // Tree 1: Oak, Good Condition
            await connection.query(
                `INSERT INTO trees (tree_id, species_id, age_id, condition_id, location_id, notes) VALUES (?, ?, ?, ?, ?, ?)`,
                [1001, 9990, 9990, 9990, 9990, 'A good oak tree.']
            );
            // Tree 2: Maple, Good Condition
            await connection.query(
                `INSERT INTO trees (tree_id, species_id, age_id, condition_id, location_id, notes) VALUES (?, ?, ?, ?, ?, ?)`,
                [1002, 9991, 9990, 9990, 9990, 'A good maple tree.']
            );
            // Tree 3: Maple, Poor Condition
            await connection.query(
                `INSERT INTO trees (tree_id, species_id, age_id, condition_id, location_id, notes) VALUES (?, ?, ?, ?, ?, ?)`,
                [1003, 9991, 9991, 9991, 9990, 'A poor maple tree.']
            );
        });

        it('should return all 4 seeded trees when no filters are applied', async () => {
            // This includes the 3 trees from this hook and the 1 from the main hook
            const response = await request(app).get('/api/trees/search');
            expect(response.statusCode).toBe(200);
            expect(response.body.length).toBe(4);
        });

        it('should return only the Oak trees when filtered by species_id=9990', async () => {
            const response = await request(app).get('/api/trees/search?species_id=9990');
            expect(response.statusCode).toBe(200);
            // There is 1 original oak tree (ID 9999) and 1 new oak tree (ID 1001)
            expect(response.body.length).toBe(2);
            // Verify that every tree returned is indeed an oak
            response.body.forEach(tree => {
                expect(tree.common_name).toBe('Test Oak');
            });
        });

        it('should return only the Maple trees when filtered by species_id=9991', async () => {
            const response = await request(app).get('/api/trees/search?species_id=9991');
            expect(response.statusCode).toBe(200);
            expect(response.body.length).toBe(2);
            response.body.forEach(tree => {
                expect(tree.common_name).toBe('Test Maple');
            });
        });

        it('should return only the trees in Good condition when filtered by condition_id=9990', async () => {
            const response = await request(app).get('/api/trees/search?condition_id=9990');
            expect(response.statusCode).toBe(200);
            // There is the original tree, the good oak, and the good maple
            expect(response.body.length).toBe(3);
            response.body.forEach(tree => {
                expect(tree.condition_level).toBe('Test Good');
            });
        });

        it('should return only the trees in Poor condition when filtered by condition_id=9991', async () => {
            const response = await request(app).get('/api/trees/search?condition_id=9991');
            expect(response.statusCode).toBe(200);
            expect(response.body.length).toBe(1);
            response.body.forEach(tree => {
                expect(tree.condition_level).toBe('Test Poor');
            });
        });

        it('should return only the poor Maple tree when filtered by both species and condition', async () => {
            const response = await request(app).get('/api/trees/search?species_id=9991&condition_id=9991');
            expect(response.statusCode).toBe(200);
            expect(response.body.length).toBe(1);
            expect(response.body[0].common_name).toBe('Test Maple');
            expect(response.body[0].condition_level).toBe('Test Poor');
        });
    });

    // -------------------------- Data Comparison Tests --------------------------

    // This test will verify that when a user wants to compare a pending update for a tree record
    // that the API correctly fetches and returns both the current data from the trees table, and 
    // the pending data from the tree_updates table.

    describe('GET /api/trees/:id/compare', () => {

        // Before this test, create a pending update
        beforeEach(async () => {
            const connection = await db.promise();

            await connection.query(
                `INSERT INTO user_info (user_id, user_name, user_email, user_password, role) VALUES (?, ?, ?, ?, ?)`,
                [999, 'Update Submitter', 'submitter@example.com', 'somepassword', 'user']
            );

            // Create a pending update for the main test tree (ID 9999)
            // The original tree is a "Test Oak" (species_id 9990) in "Test Good" condition (condition_id 9990)
            // The update will suggest changing it to a "Test Maple" (9991) in "Test Poor" condition (9991)
            await connection.query(
                `INSERT INTO tree_updates (tree_id, user_id, species_id, age_id, condition_id, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [9999, 999, 9991, 9991, 9991, 'pending', 'Suggesting a change to Maple.']
            );
        });

        it('should return 200 OK with both current and pending data', async () => {
            const response = await request(app).get('/api/trees/9999/compare');

            expect(response.statusCode).toBe(200);

            // Verify the response has the correct structure
            expect(response.body).toHaveProperty('current');
            expect(response.body).toHaveProperty('pending');
            expect(response.body.pending).not.toBeNull();
        });

        it('should return the correct original data in the "current" object', async () => {
            const response = await request(app).get('/api/trees/9999/compare');
            const currentData = response.body.current;

            expect(currentData.common_name).toBe('Test Oak');
            expect(currentData.condition_level).toBe('Test Good');
            expect(currentData.notes).toBe('A specific test tree.');
        });

        it('should return the correct suggested data in the "pending" object', async () => {
            const response = await request(app).get('/api/trees/9999/compare');
            const pendingData = response.body.pending;

            expect(pendingData.common_name).toBe('Test Maple');
            expect(pendingData.condition_level).toBe('Test Poor');
            expect(pendingData.notes).toBe('Suggesting a change to Maple.');
        });

        it('should return a null "pending" object if no pending update exists', async () => {
            // Test against a tree (ID 1001) that was seeded in another test's hook, which has no updates
            const connection = await db.promise();
            await connection.query(
                `INSERT INTO trees (tree_id, species_id, age_id, condition_id, location_id) VALUES (?, ?, ?, ?, ?)`,
                [1001, 9990, 9990, 9990, 9990] // Using a different ID
            );

            const response = await request(app).get('/api/trees/1001/compare');

            expect(response.statusCode).toBe(200);
            expect(response.body).toHaveProperty('current');
            expect(response.body.current).not.toBeNull();
            expect(response.body).toHaveProperty('pending', null);
        });
    });


    // -------------------------- Image Upload Tests --------------------------

    // This test will involve sending multipart/form-data. Use SuperTest's .attach() method.
    // The aim is to prove that an authenticated user is able to upload a file to the /api/upload-image endpoint, recieve a 200 OK,
    // and then verify that the image was created in the image_metadata table in the database. 

    describe('POST /api/upload-image', () => {

        let authenticatedUserAgent;
        let testTreeId;

        // Before each test, we need a logged-in user and a tree to associate the image with
        beforeEach(async () => {
            const connection = await db.promise();

            // Use the tree with ID 9999 that's created in the main beforeEach hook
            testTreeId = 9999;

            // Create and log in a user
            const bcrypt = require('bcryptjs');
            const hashedPassword = await bcrypt.hash('password123', 10);
            await connection.query(
                `INSERT INTO user_info (user_id, user_name, user_email, user_password, role) VALUES (?, ?, ?, ?, ?)`,
                [999, 'Uploader User', 'uploader@example.com', hashedPassword, 'user']
            );

            authenticatedUserAgent = request.agent(app);
            await authenticatedUserAgent.post('/auth/login').send({ email: 'uploader@example.com', password: 'password123' });
        });

        it('should return 401 Unauthorized if the user is not logged in', async () => {
            const response = await request(app).post('/api/upload-image');
            expect(response.statusCode).toBe(401);
        });

        it('should return 200 OK and save the image metadata for an authenticated user', async () => {
            // Use the real image file for the test
            const filePath = path.join(__dirname, '..', 'test-assets', 'test-image.jpg');

            // Make the POST request using a seeded agent
            const response = await authenticatedUserAgent
                            .post('/api/upload-image')
                            .field('tree_id', testTreeId)
                            .attach('images', filePath);

            // Expect the upload to be successful
            expect(response.statusCode).toBe(200);
            expect(response.body).toHaveProperty('message', 'Images uploaded successfully');

            // Verify that the image metadata was saved to the database
            const [rows] = await db.promise().query("SELECT * FROM image_metadata WHERE tree_id = ?", [testTreeId]);
            expect(rows.length).toBe(1);

            // Check if the URL is correct
            expect(rows[0].image_url).toMatch(/uploads\/.*-test-image.jpg/);
        });
    });

    // -------------------------- Geospatial (Nearby) Tests --------------------------

    describe('GET /api/trees/nearby', () => {

    // Before each test in this block, seed trees at known distances
    beforeEach(async () => {
        const connection = await db.promise();

        // Seed a location and tree insde the 5km search radius of Belfast City Centre
        // Use a central point: lat: 54.600, lng: -5.930
        await connection.query(
            `INSERT INTO location (location_id, latitude, longitude) VALUES (?, ?, ?)`,
            [1001, 54.601000, -5.930000] // Approx 111m away
        );
        await connection.query(
            `INSERT INTO trees (tree_id, notes, location_id, species_id, age_id, condition_id) VALUES (?, ?, ?, ?, ?, ?)`,
            [1001, 'Belfast City Hall Tree', 1001, 9990, 9990, 9990]
        );

        // Seed a location and tree outside the 5km radius.
        await connection.query(
            `INSERT INTO location (location_id, latitude, longitude) VALUES (?, ?, ?)`,
            [1002, 54.564, -6.048] // Approx 10km away in Lisburn
        );
        await connection.query(
            `INSERT INTO trees (tree_id, notes, location_id, species_id, age_id, condition_id) VALUES (?, ?, ?, ?, ?, ?)`,
            [1002, 'Lisburn Tree', 1002, 9991, 9991, 9991]
        );
    });

    it('should return only the tree within the search radius and exclude the tree outside of it', async () => {
        // Define the user's location
        const userLat = 54.600000;
        const userLng = -5.930000;

        // Make the API request with the user's coordinates
        const response = await request(app)

        .get(`/api/trees/nearby?latitude=${userLat}&longitude=${userLng}`);  
        // The request should be successful
        expect(response.statusCode).toBe(200);

        // The response should contain exactly one tree
        expect(response.body).toHaveLength(1);

        // The tree it found should be the correct one "Belfast City Hall Tree"
        const foundTree = response.body[0];
        expect(foundTree.tree_id).toBe(1001);
        expect(foundTree.notes).toBe('Belfast City Hall Tree');
    });

    it('should return a default set of trees if no coordinates are provided', async () => {
        // Make the API request with no latitude or longitude
        const response = await request(app).get('/api/trees/nearby');

        expect(response.statusCode).toBe(200);
        // The test should still find the seeded trees, as the fallback returns all trees up to a limit
        // Expect to find the 2 trees from this hook plus the 1 from the main hook
        expect(response.body.length).toBe(3);
    });
});

});